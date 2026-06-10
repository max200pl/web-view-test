// Show / hide lifecycle controller — Steps 5–8.
//
// Ties the render layer (Step 4) to the host window: render first, then on the
// first size report position the window bottom-right and SHOW it, arm auto-hide,
// route actions (Step 6), apply localization/data updates (Step 7), and route
// every failure through on.onError (Step 8). The Sciter window calls and the timer
// live behind injectable adapters so the lifecycle is unit-testable in Node. This
// is the testable core of showNotification (Step 9 wires the real adapters).
//
// Lifecycle invariants:
//   - SHOW happens only after BOTH render-ready AND a size report (render first).
//   - auto-hide fires after spec.hideAfterMs; any close cancels it.
//   - close is idempotent and always emits exactly one onClose(reason).
//   - inbound handlers are registered BEFORE loadHtml (no missed handshake).
//   - setLang/setI18n/update re-inject + reload; window stays open (never closed/
//     re-shown) and resizes to the new content via the reloaded page's onSize.
//   - a BROKEN notification is never shown; every failure stage is reported to
//     on.onError (window-create / injection / render / callback / localization /
//     auto-hide) and never throws out of the controller.

import { renderNotification } from "./render.mjs";
import { injectTemplate } from "./inject.mjs";
import { CLOSE_REASON, DEFAULTS, ERROR_STAGE } from "./contract.mjs";

/**
 * @typedef {Object} WindowCtl
 * @property {() => void} show
 * @property {() => void} close
 * @property {(x:number,y:number,w:number,h:number) => void} move
 * @property {() => [number, number]} workarea - [width, height] of the work area
 *
 * @typedef {Object} BridgeTransport
 * @property {(method:string, handler:(payload:any)=>void) => (()=>void)} on - returns unsubscribe
 * @property {(html:string) => void} loadHtml
 *
 * @typedef {Object} Scheduler
 * @property {(fn:()=>void, ms:number) => *} setTimer
 * @property {(id:*) => void} clearTimer
 */

function mergeI18n(target, incoming) {
  if (!incoming || typeof incoming !== "object") return;
  for (const [lng, dict] of Object.entries(incoming)) {
    if (!dict || typeof dict !== "object") continue;
    target[lng] = { ...(target[lng] || {}), ...dict };
  }
}

const msg = (err) => String((err && err.message) || err);

/**
 * @param {{bridge: BridgeTransport, windowCtl: WindowCtl, scheduler: Scheduler}} deps
 * @param {import("./contract.mjs").NotificationSpec} spec
 * @returns {import("./contract.mjs").NotificationHandle}
 */
export function createNotification(deps, spec) {
  const { bridge, windowCtl, scheduler } = deps;
  const on = (spec && spec.on) || {};

  // Mutable view of what should be rendered. setLang/setI18n/update mutate this
  // and re-inject from it, so the live content always reflects the latest state.
  const current = {
    template: spec && spec.template,
    data: { ...((spec && spec.data) || {}) },
    i18n: { ...((spec && spec.i18n) || {}) },
    lang: (spec && spec.lang) || DEFAULTS.LANG,
    actions: (spec && spec.actions) || [],
  };

  let ready = false;
  let shown = false;
  let closed = false;
  let lastSize = null;
  let hideTimer = null;

  // No hardcoded/magic action ids — clicks are handled uniformly. An action
  // closes the window ONLY if the spec declares it with `closes: true`.
  const closingActions = new Set();
  for (const a of current.actions) {
    if (a && typeof a === "object" && a.closes && a.id) closingActions.add(a.id);
  }

  // Report a failure. Never throws (onError itself is guarded).
  function fail(stage, error, message) {
    const cb = on.onError;
    if (typeof cb !== "function") return;
    try {
      cb({ stage, message: message || msg(error), cause: error });
    } catch (_e) {
      /* a throwing onError must not break the bridge */
    }
  }

  // Invoke a non-error callback; a throwing handler surfaces via onError(callback).
  const emit = (name, arg) => {
    const cb = on[name];
    if (typeof cb !== "function") return;
    try {
      cb(arg);
    } catch (err) {
      fail(ERROR_STAGE.CALLBACK, err, `callback ${name} threw`);
    }
  };

  // Size the window to the latest reported content size (bottom-right anchored) on
  // EVERY onSize — so the window tracks content growth/relocalize and never clips
  // (which would show scrollbars). The window is SHOWN (and auto-hide armed +
  // onReady fired) only once, on the first size after render.
  function applyWindow() {
    if (closed || !ready || !lastSize) return;

    let w;
    let h;
    try {
      const [screenW, screenH] = windowCtl.workarea();
      w = Math.max(DEFAULTS.MIN_WIDTH, Number(lastSize.width) || 0);
      h = Math.max(DEFAULTS.MIN_HEIGHT, Number(lastSize.height) || 0);
      windowCtl.move(Math.max(0, screenW - w), Math.max(0, screenH - h), w, h);
      if (!shown) windowCtl.show();
    } catch (err) {
      // window failed to position/show -> do NOT mark shown, do NOT arm auto-hide
      fail(ERROR_STAGE.WINDOW_CREATE, err);
      return;
    }

    if (shown) return; // a later resize: window already visible, nothing else to do

    shown = true;
    const ms = Number(spec && spec.hideAfterMs);
    if (ms > 0) {
      hideTimer = scheduler.setTimer(() => close(CLOSE_REASON.AUTO_HIDE, ERROR_STAGE.AUTO_HIDE), ms);
    }
    emit("onReady", { lang: current.lang, width: w, height: h });
  }

  function close(reason, errStage) {
    if (closed) return;
    closed = true;
    if (hideTimer != null) {
      try {
        scheduler.clearTimer(hideTimer);
      } catch (_e) {
        /* ignore */
      }
      hideTimer = null;
    }
    try {
      windowCtl.close();
    } catch (err) {
      fail(errStage || ERROR_STAGE.WINDOW_CREATE, err);
    }
    emit("onClose", reason);
  }

  // Re-inject from `current` and reload. No show/move here — the window stays open
  // and is never re-shown (the `shown` guard); the reloaded page's onSize then
  // resizes it to fit the new content.
  function rerender() {
    if (closed) return;
    try {
      bridge.loadHtml(injectTemplate(current));
    } catch (err) {
      fail(ERROR_STAGE.LOCALIZATION, err);
    }
  }

  // Register inbound handlers BEFORE loadHtml so nothing is missed.
  bridge.on("template:onSize", (p) => {
    lastSize = { width: p && p.width, height: p && p.height };
    applyWindow();
  });
  bridge.on("template:onAction", (p) => {
    if (closed) return; // ignore actions after close
    const action = p && p.action;
    const data = { ...p };
    delete data.action;

    // Forward to the host (on.onAction): the JS-side seam where a future C++
    // integration would marshal the action back to native code.
    emit("onAction", { id: action, data });

    if (closingActions.has(action)) close(CLOSE_REASON.ACTION);
  });
  // Runtime-B render failure reported by the template (TO_HOST.ERROR).
  bridge.on("template:onError", (p) => {
    fail(ERROR_STAGE.RENDER, p, (p && p.message) || "template render error");
  });

  const renderAdapter = {
    loadHtml: (html) => bridge.loadHtml(html),
    onReady: (cb) => bridge.on("template:onReady", cb),
  };

  renderNotification(renderAdapter, current)
    .then((info) => {
      ready = true;
      current.lang = info.lang;
      applyWindow();
    })
    .catch((err) => {
      // injection/render failed -> never show a broken notification
      fail(err && err.stage ? err.stage : ERROR_STAGE.RENDER, err);
    });

  return {
    close: () => close(CLOSE_REASON.HOST),

    /** Switch the active language: re-render and notify (onLocalizationChanged). */
    setLang: (l) => {
      if (closed || !l) return;
      current.lang = l;
      rerender();
      emit("onLocalizationChanged", { lang: l });
    },

    /** Merge translation dictionaries (per-language shallow) and re-render. */
    setI18n: (i18n) => {
      if (closed) return;
      mergeI18n(current.i18n, i18n);
      rerender();
    },

    /** Merge data and re-render. */
    update: (data) => {
      if (closed) return;
      current.data = { ...current.data, ...(data || {}) };
      rerender();
    },
  };
}
