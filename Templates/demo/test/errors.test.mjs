// Error-handling tests (Step 8): every failure stage routes to on.onError, a
// broken notification is never shown, and a throwing onError never breaks the
// bridge. Stages: window-create / injection / render / callback / localization /
// auto-hide. Also: benign inputs (empty data, missing i18n) must NOT error.
//
// Run: npm test   (from Templates/)

import { test } from "node:test";
import assert from "node:assert/strict";

import { createNotification } from "../../bridge/core/notification.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

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
    runAll() {
      for (const { fn } of timers.values()) fn();
    },
  };
}

function harness({ spec = {}, windowThrow = {}, loadThrowAt = null, extraOn = {} } = {}) {
  const handlers = new Map();
  let loadCount = 0;
  const bridge = {
    loads: [],
    on(m, cb) {
      const l = handlers.get(m) || [];
      l.push(cb);
      handlers.set(m, l);
      return () => {};
    },
    loadHtml(html) {
      loadCount += 1;
      if (loadThrowAt === loadCount) throw new Error("load fail");
      this.loads.push(html);
    },
    fire(m, p) {
      for (const cb of handlers.get(m) || []) cb(p);
    },
  };
  const windowCtl = {
    calls: [],
    show() {
      this.calls.push(["show"]);
      if (windowThrow.show) throw new Error("show fail");
    },
    close() {
      this.calls.push(["close"]);
      if (windowThrow.close) throw new Error("close fail");
    },
    move() {
      this.calls.push(["move"]);
    },
    workarea: () => [1920, 1080],
  };
  const scheduler = mockScheduler();
  const errors = [];
  const events = [];
  const on = {
    onError: (e) => errors.push(e),
    onReady: (i) => events.push(["ready", i]),
    onClose: (r) => events.push(["close", r]),
    onLocalizationChanged: (c) => events.push(["loc", c]),
    ...extraOn,
  };
  const handle = createNotification(
    { bridge, windowCtl, scheduler },
    { template: "<b>{{text.title}}</b>", i18n: { en: { title: "Hi" } }, lang: "en", ...spec, on },
  );
  return { bridge, windowCtl, scheduler, errors, events, handle };
}

async function bringUp(h) {
  h.bridge.fire("template:onReady", { lang: "en" });
  await tick();
  h.bridge.fire("template:onSize", { width: 450, height: 420 });
}

const stages = (h) => h.errors.map((e) => e.stage);
const has = (h, name) => h.windowCtl.calls.some((c) => c[0] === name);

test("injection failure -> onError(injection), nothing loaded or shown", async () => {
  const h = harness({ spec: { template: "{{bogus}}" } });
  await tick();
  assert.deepEqual(stages(h), ["injection"]);
  assert.equal(h.bridge.loads.length, 0);
  assert.equal(has(h, "show"), false);
});

test("window failure on show -> onError(window-create), not marked shown (no onReady)", async () => {
  const h = harness({ windowThrow: { show: true } });
  await bringUp(h);
  assert.deepEqual(stages(h), ["window-create"]);
  assert.equal(has(h, "show"), true, "show was attempted");
  assert.equal(h.events.some((e) => e[0] === "ready"), false, "onReady not emitted on a failed show");
});

test("callback failure -> onError(callback)", async () => {
  const h = harness({ extraOn: { onReady: () => {
    throw new Error("cb boom");
  } } });
  await bringUp(h);
  assert.ok(stages(h).includes("callback"));
});

test("localization reload failure -> onError(localization)", async () => {
  const h = harness({ loadThrowAt: 2 }); // first load ok, the relocalize reload throws
  await bringUp(h);
  h.handle.setLang("uk");
  assert.ok(stages(h).includes("localization"));
});

test("auto-hide close failure -> onError(auto-hide), still emits onClose", async () => {
  const h = harness({ spec: { hideAfterMs: 5000 }, windowThrow: { close: true } });
  await bringUp(h);
  h.scheduler.runAll();
  assert.ok(stages(h).includes("auto-hide"));
  assert.ok(h.events.some((e) => e[0] === "close" && e[1] === "auto-hide"));
});

test("template:onError wire -> onError(render)", async () => {
  const h = harness();
  await bringUp(h);
  h.bridge.fire("template:onError", { message: "boom in webview" });
  assert.ok(stages(h).includes("render"));
  assert.equal(h.errors.find((e) => e.stage === "render").message, "boom in webview");
});

test("a throwing onError never breaks the bridge", async () => {
  const h = harness({
    spec: { template: "{{bogus}}" },
    extraOn: {
      onError: () => {
        throw new Error("onError itself throws");
      },
    },
  });
  await tick(); // must not throw / reject
  assert.ok(true);
});

test("benign inputs do NOT error: empty data + missing i18n key", async () => {
  const h = harness({
    spec: { template: "<b>{{text.title}}</b> c={{data.count}}", data: {}, i18n: { en: {} } },
  });
  await bringUp(h);
  assert.deepEqual(h.errors, [], "no errors for empty data / missing key (soft fallback)");
  assert.equal(has(h, "show"), true, "still shows");
});
