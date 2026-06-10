// Sciter <-> WebView notification bridge — CONTRACT (definition only).
//
// Step 2 deliverable. This module DEFINES and DOCUMENTS the bridge API; it does
// not implement it. Behaviour is added incrementally:
//   Step 3 — template injection layer        Step 6 — click callbacks
//   Step 4 — WebView render layer            Step 7 — localization update
//   Step 5 — show / hide lifecycle           Step 8 — error handling
//
// Scope is JS-ONLY: the bridge runs on the Sciter host (runtime A,
// Templates/index.html). Notification data originates in host JS; there are no
// C++ changes. Internally the bridge drives the WebView template (runtime B)
// over the two channels (jsBridgeCall B->A, loadHtml/re-render A->B) — see the
// enums below and ../../.claude/docs/jsbridge.md (legacy mechanics reference).
//
// This file exports two things: the frozen protocol enums (real values used by
// later steps and by the tests), and the JSDoc typedefs that describe the
// public API surface. Keeping it side-effect free means there is nothing here
// to break at runtime — the contract tests guard it against the live runtimes.

// ============================================================================
// Wire protocol — the two raw channels between host (A) and template (B).
// Already live today (except TO_HOST.ERROR, wired in Step 8).
// ============================================================================

/** Channel B -> A : `window.jsBridgeCall(method, payload)` (template -> host). */
export const TO_HOST = Object.freeze({
  READY: "template:onReady", // {lang}            — handshake, template loaded
  SIZE: "template:onSize", // {width, height}     — measured size of the root element
  ACTION: "template:onAction", // {action, href?} — user activated an action
  ERROR: "template:onError", // {stage, message}  — runtime-B render failure
});

// Channel A -> B vocabulary. The current bridge applies updates by RE-INJECTING +
// reloading (loadHtml) rather than sending incremental __fromSciter messages, so
// these are kept as documented protocol values, not used by the reload-based impl.
export const TO_TEMPLATE = Object.freeze({
  INIT: "init", // {lang, i18n, data}
  SET_LANG: "setLang", // {lang}
  SET_I18N: "setI18n", // {i18n}
  UPDATE: "update", // {data}
});

// ============================================================================
// Semantic enums (public surface).
// ============================================================================

// NOTE: there are NO built-in/magic action ids. Every click is handled uniformly
// (forwarded to on.onAction); an action closes the window only if the spec marks it
// `closes: true`. So action ids ("cta_click", "dismiss", …) are entirely caller-defined.

/** Why a notification closed — delivered to {@link NotificationCallbacks.onClose}. */
export const CLOSE_REASON = Object.freeze({
  USER: "user", // user clicked the template's close control
  ACTION: "action", // an action with `closes: true` was activated
  AUTO_HIDE: "auto-hide", // hideAfterMs elapsed
  HOST: "host", // host called handle.close()
});

/** Stage at which a {@link BridgeError} originated (mirrors plan Step 8). */
export const ERROR_STAGE = Object.freeze({
  WINDOW_CREATE: "window-create",
  INJECTION: "injection", // building HTML from template + data + i18n
  RENDER: "render", // template threw while rendering in the WebView
  CALLBACK: "callback", // a host-supplied callback threw
  LOCALIZATION: "localization",
  AUTO_HIDE: "auto-hide",
  UNKNOWN_METHOD: "unknown-method", // jsBridgeCall received an unhandled method
});

/** Defaults applied when a spec omits a field. */
export const DEFAULTS = Object.freeze({
  LANG: "en",
  MIN_WIDTH: 200, // window-size floors, faithful to index.html onSize clamp (jsbridge.md §9)
  MIN_HEIGHT: 120,
});

// ============================================================================
// Public API typedefs (JSDoc — JS-only project, no TypeScript).
// ============================================================================

/**
 * Localization dictionaries: language code -> (i18n key -> template string).
 * Strings may contain `{dataKey}` placeholders filled from {@link NotificationSpec.data}.
 * @typedef {Object<string, Object<string, string>>} I18nDict
 * @example { en: { title: "Removed: {programName}" }, uk: { title: "Видалено: {programName}" } }
 */

/**
 * An action the template may emit (declared so the host knows its effect).
 * @typedef {Object} NotificationAction
 * @property {string} id      - Identifier carried in `template:onAction` (e.g. "cta_click").
 * @property {string} [name]  - Stable handle a template can reference via `{{action.NAME}}` to
 *                              inject this action's `id` into `data-action` (keeps templates generic).
 * @property {boolean} [closes] - If true, activating it closes the window. The ONLY way an action closes.
 */

/**
 * Bridge INPUT. Everything needed to show one notification.
 * Field -> wire mapping is handled by the injection layer (Step 3).
 * @typedef {Object} NotificationSpec
 * @property {string} template          - HTML string rendered inside the WebView (runtime B).
 * @property {Object<string, *>} [data] - Values interpolated into i18n strings via `{key}`.
 *                                         Maps to the wire `payload` field (see jsbridge.md).
 * @property {NotificationAction[]} [actions] - Actions the template may emit.
 * @property {I18nDict} [i18n]          - Localization dictionaries.
 * @property {string} [lang=en]         - Initial language code ({@link DEFAULTS}.LANG).
 * @property {number} [hideAfterMs]     - Auto-hide timeout (ms). Falsy/absent = no auto-hide.
 *                                         Enforced host-side by a timer (no wire message).
 * @property {NotificationCallbacks} [on] - Lifecycle / event callbacks (bridge OUTPUT).
 */

/**
 * Bridge OUTPUT. Lifecycle and event callbacks. All are optional; each is
 * invoked inside a try/catch so a throwing handler surfaces via `onError`
 * (stage = {@link ERROR_STAGE}.CALLBACK) instead of breaking the bridge.
 * @typedef {Object} NotificationCallbacks
 * @property {(info: ReadyInfo) => void} [onReady]      - Template loaded, rendered and sized.
 * @property {(ev: ActionEvent) => void} [onAction]     - An action was activated.
 * @property {(reason: string) => void} [onClose]       - Window closed; reason ∈ {@link CLOSE_REASON}.
 * @property {(change: LocalizationChange) => void} [onLocalizationChanged] - Active language changed.
 * @property {(err: BridgeError) => void} [onError]     - Something failed (see {@link ERROR_STAGE}).
 */

/** @typedef {Object} ReadyInfo  @property {string} lang @property {number} width @property {number} height */
/** @typedef {Object} ActionEvent @property {string} id - action id @property {Object<string,*>} [data] - extra fields the template attached */
/** @typedef {Object} LocalizationChange @property {string} lang - new active language */
/**
 * @typedef {Object} BridgeError
 * @property {string} stage   - one of {@link ERROR_STAGE}
 * @property {string} message - human-readable description
 * @property {*} [cause]      - underlying error/value, if any
 */

/**
 * Live handle returned by {@link showNotification}, for driving an open
 * notification. Mirrors the A->B wire messages.
 * @typedef {Object} NotificationHandle
 * @property {(lang: string) => void} setLang       - switch language ({@link TO_TEMPLATE}.SET_LANG)
 * @property {(i18n: I18nDict) => void} setI18n     - merge/replace dictionaries ({@link TO_TEMPLATE}.SET_I18N)
 * @property {(data: Object<string,*>) => void} update - merge data + re-render ({@link TO_TEMPLATE}.UPDATE)
 * @property {() => void} close                     - close the window (fires onClose, reason "host")
 */

// This module is types + enums only (no behaviour). The public entry points are:
//   - createNotification(deps, spec) -> NotificationHandle   (./notification.js) — core, deps-injected, testable
//   - makeSciterDeps(elemWebView, win) / showNotification(env, spec)  (./sciter-host.js) — Sciter glue
// See ./README.md for the final API and how to wire / extend it.
