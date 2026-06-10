// Lifecycle tests for createNotification (Step 5): show-after-render, auto-hide,
// manual/action close, idempotency, no timer leaks, independence of instances.
// Uses mock bridge / windowCtl / scheduler — no real Sciter window.
//
// Run: npm test   (from Templates/)

import { test } from "node:test";
import assert from "node:assert/strict";

import { createNotification } from "../../bridge/core/notification.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

function mockBridge() {
  const handlers = new Map();
  return {
    loadedHtml: null,
    on(method, cb) {
      const list = handlers.get(method) || [];
      list.push(cb);
      handlers.set(method, list);
      return () => handlers.set(method, (handlers.get(method) || []).filter((h) => h !== cb));
    },
    loadHtml(html) {
      this.loadedHtml = html;
    },
    fire(method, payload) {
      for (const cb of handlers.get(method) || []) cb(payload);
    },
  };
}

function mockWindow(workarea = [1920, 1080]) {
  return {
    calls: [],
    show() {
      this.calls.push(["show"]);
    },
    close() {
      this.calls.push(["close"]);
    },
    move(x, y, w, h) {
      this.calls.push(["move", x, y, w, h]);
    },
    workarea: () => workarea,
  };
}

function mockScheduler() {
  const timers = new Map();
  let seq = 0;
  return {
    timers,
    setTimer(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    runTimer(id) {
      const t = timers.get(id);
      if (t) t.fn();
    },
    only() {
      return [...timers.values()][0];
    },
  };
}

const SPEC = {
  template: "<b>{{text.title}}</b>",
  i18n: { en: { title: "Hi" }, uk: { title: "Привіт" } },
  lang: "en",
};

function setup(spec = SPEC, workarea) {
  const bridge = mockBridge();
  const windowCtl = mockWindow(workarea);
  const scheduler = mockScheduler();
  const events = [];
  const on = {
    onReady: (i) => events.push(["onReady", i]),
    onClose: (r) => events.push(["onClose", r]),
    onError: (e) => events.push(["onError", e]),
  };
  const handle = createNotification({ bridge, windowCtl, scheduler }, { ...spec, on });
  return { bridge, windowCtl, scheduler, events, handle };
}

const calls = (w, name) => w.calls.filter((c) => c[0] === name);

test("loads the injected html (render before show)", async () => {
  const { bridge, windowCtl } = setup();
  await tick();
  assert.equal(bridge.loadedHtml, "<b>Hi</b>");
  assert.equal(calls(windowCtl, "show").length, 0, "must not show before ready+size");
});

test("shows only after BOTH ready and size, positioned bottom-right", async () => {
  const { bridge, windowCtl, events } = setup();
  bridge.fire("template:onReady", { lang: "en" });
  await tick();
  assert.equal(calls(windowCtl, "show").length, 0, "ready alone must not show");

  bridge.fire("template:onSize", { width: 450, height: 420 });
  assert.equal(calls(windowCtl, "show").length, 1, "shows once both arrive");
  assert.deepEqual(windowCtl.calls.find((c) => c[0] === "move"), ["move", 1470, 660, 450, 420]);
  assert.deepEqual(events.find((e) => e[0] === "onReady")[1], { lang: "en", width: 450, height: 420 });
});

test("resizes the window on a later onSize (content grew) without a second show", async () => {
  const { bridge, windowCtl } = setup();
  bridge.fire("template:onReady", { lang: "en" });
  await tick();
  bridge.fire("template:onSize", { width: 450, height: 420 });
  assert.equal(calls(windowCtl, "show").length, 1);
  assert.deepEqual(windowCtl.calls.find((c) => c[0] === "move"), ["move", 1470, 660, 450, 420]);

  // content grew (e.g. ResizeObserver after font/layout settle, or relocalize)
  bridge.fire("template:onSize", { width: 500, height: 500 });
  assert.equal(calls(windowCtl, "show").length, 1, "no second show");
  assert.deepEqual(calls(windowCtl, "move").at(-1), ["move", 1420, 580, 500, 500], "window re-sized to fit");
});

test("size before ready also works (order independent)", async () => {
  const { bridge, windowCtl } = setup();
  bridge.fire("template:onSize", { width: 450, height: 420 });
  assert.equal(calls(windowCtl, "show").length, 0, "size alone must not show");
  bridge.fire("template:onReady", { lang: "en" });
  await tick();
  assert.equal(calls(windowCtl, "show").length, 1);
});

test("clamps tiny sizes to the documented minimum", async () => {
  const { bridge, windowCtl } = setup(SPEC, [1000, 800]);
  bridge.fire("template:onReady", { lang: "en" });
  await tick();
  bridge.fire("template:onSize", { width: 10, height: 10 });
  assert.deepEqual(windowCtl.calls.find((c) => c[0] === "move"), ["move", 800, 680, 200, 120]);
});

test("auto-hide closes after hideAfterMs with reason auto-hide", async () => {
  const { bridge, windowCtl, scheduler, events } = setup({ ...SPEC, hideAfterMs: 5000 });
  bridge.fire("template:onReady", { lang: "en" });
  await tick();
  bridge.fire("template:onSize", { width: 450, height: 420 });

  assert.equal(scheduler.only().ms, 5000, "timer armed for hideAfterMs");
  assert.equal(calls(windowCtl, "close").length, 0);

  scheduler.runTimer([...scheduler.timers.keys()][0]);
  assert.equal(calls(windowCtl, "close").length, 1);
  assert.deepEqual(events.find((e) => e[0] === "onClose"), ["onClose", "auto-hide"]);
});

test("no auto-hide timer when hideAfterMs absent", async () => {
  const { bridge, scheduler } = setup(SPEC);
  bridge.fire("template:onReady", { lang: "en" });
  await tick();
  bridge.fire("template:onSize", { width: 450, height: 420 });
  assert.equal(scheduler.timers.size, 0);
});

test("handle.close() closes with reason host and cancels auto-hide", async () => {
  const { bridge, windowCtl, scheduler, events, handle } = setup({ ...SPEC, hideAfterMs: 5000 });
  bridge.fire("template:onReady", { lang: "en" });
  await tick();
  bridge.fire("template:onSize", { width: 450, height: 420 });

  handle.close();
  assert.equal(calls(windowCtl, "close").length, 1);
  assert.deepEqual(events.find((e) => e[0] === "onClose"), ["onClose", "host"]);
  assert.equal(scheduler.timers.size, 0, "auto-hide timer cancelled");
});

test("a declared-closing action closes with reason action", async () => {
  const { bridge, windowCtl, events } = setup({ ...SPEC, actions: [{ id: "close_webview", closes: true }] });
  bridge.fire("template:onReady", { lang: "en" });
  await tick();
  bridge.fire("template:onSize", { width: 450, height: 420 });

  bridge.fire("template:onAction", { action: "close_webview" });
  assert.equal(calls(windowCtl, "close").length, 1);
  assert.deepEqual(events.find((e) => e[0] === "onClose"), ["onClose", "action"]);
});

test("close is idempotent (one close, one onClose)", async () => {
  const { bridge, windowCtl, events, handle } = setup();
  bridge.fire("template:onReady", { lang: "en" });
  await tick();
  bridge.fire("template:onSize", { width: 450, height: 420 });

  handle.close();
  handle.close();
  bridge.fire("template:onAction", { action: "close_webview" });
  assert.equal(calls(windowCtl, "close").length, 1);
  assert.equal(events.filter((e) => e[0] === "onClose").length, 1);
});

test("repeated notifications are independent (no cross-talk, no timer leak)", async () => {
  const a = setup({ ...SPEC, hideAfterMs: 3000 });
  const b = setup({ ...SPEC, hideAfterMs: 9000 });
  for (const s of [a, b]) {
    s.bridge.fire("template:onReady", { lang: "en" });
  }
  await tick();
  for (const s of [a, b]) s.bridge.fire("template:onSize", { width: 450, height: 420 });

  a.handle.close();
  assert.equal(a.scheduler.timers.size, 0, "a timer cleared");
  assert.equal(b.scheduler.timers.size, 1, "b timer intact");
  assert.equal(calls(b.windowCtl, "close").length, 0, "closing a does not close b");
});

test("injection failure: no show, onError emitted", async () => {
  const { bridge, windowCtl, events } = setup({ ...SPEC, template: "{{bogus}}" });
  await tick();
  assert.equal(bridge.loadedHtml, null, "nothing loaded");
  assert.equal(calls(windowCtl, "show").length, 0, "not shown");
  const err = events.find((e) => e[0] === "onError");
  assert.ok(err, "onError emitted");
  assert.equal(err[1].stage, "injection");
});
