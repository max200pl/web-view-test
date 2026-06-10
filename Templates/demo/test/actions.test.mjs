// Action-routing tests (Step 6): primary / secondary / close / link actions are
// forwarded to on.onAction, and closing actions also close. Reuses the mock
// bridge/window/scheduler pattern from notification.test.mjs.
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

function mockWindow() {
  return {
    calls: [],
    show() {
      this.calls.push(["show"]);
    },
    close() {
      this.calls.push(["close"]);
    },
    move() {},
    workarea: () => [1920, 1080],
  };
}

const noopScheduler = { setTimer: () => 1, clearTimer: () => {} };

async function shown(spec) {
  const bridge = mockBridge();
  const windowCtl = mockWindow();
  const actions = [];
  const closes = [];
  const handle = createNotification(
    { bridge, windowCtl, scheduler: noopScheduler },
    {
      template: "<b>{{text.title}}</b>",
      i18n: { en: { title: "Hi" } },
      lang: "en",
      ...spec,
      on: {
        onAction: (a) => actions.push(a),
        onClose: (r) => closes.push(r),
      },
    },
  );
  bridge.fire("template:onReady", { lang: "en" });
  await tick();
  bridge.fire("template:onSize", { width: 450, height: 420 });
  return { bridge, windowCtl, actions, closes, handle };
}

const closeCount = (w) => w.calls.filter((c) => c[0] === "close").length;

test("primary action forwards to onAction and does NOT close", async () => {
  const { bridge, windowCtl, actions, closes } = await shown();
  bridge.fire("template:onAction", { action: "cta_click" });
  assert.deepEqual(actions, [{ id: "cta_click", data: {} }]);
  assert.equal(closeCount(windowCtl), 0);
  assert.equal(closes.length, 0);
});

test("a declared-closing action forwards onAction AND closes with reason action", async () => {
  // no magic id — close_webview closes only because the spec declares closes:true
  const { bridge, windowCtl, actions, closes } = await shown({
    actions: [{ id: "close_webview", closes: true }],
  });
  bridge.fire("template:onAction", { action: "close_webview" });
  assert.deepEqual(actions, [{ id: "close_webview", data: {} }]);
  assert.equal(closeCount(windowCtl), 1);
  assert.deepEqual(closes, ["action"]);
});

test("close_webview does NOT close when not declared closes:true (no magic id)", async () => {
  const { bridge, windowCtl, actions } = await shown(); // no actions declared
  bridge.fire("template:onAction", { action: "close_webview" });
  assert.deepEqual(actions, [{ id: "close_webview", data: {} }], "still forwarded");
  assert.equal(closeCount(windowCtl), 0, "but does not close — it's not special");
});

test("declared closes:true secondary action closes; closes:false does not", async () => {
  const a = await shown({
    actions: [{ id: "renew_now", closes: true }, { id: "remind_later", closes: false }],
  });
  a.bridge.fire("template:onAction", { action: "remind_later" });
  assert.equal(closeCount(a.windowCtl), 0, "remind_later must not close");

  a.bridge.fire("template:onAction", { action: "renew_now" });
  assert.equal(closeCount(a.windowCtl), 1, "renew_now closes");
  assert.deepEqual(a.closes, ["action"]);
});

test("link action carries its href through to onAction.data", async () => {
  const { bridge, actions, windowCtl } = await shown();
  bridge.fire("template:onAction", { action: "open_link", href: "https://example.com" });
  assert.deepEqual(actions, [{ id: "open_link", data: { href: "https://example.com" } }]);
  assert.equal(closeCount(windowCtl), 0);
});

test("actions are ignored after the notification closes", async () => {
  const { bridge, actions, handle } = await shown();
  handle.close();
  bridge.fire("template:onAction", { action: "cta_click" });
  assert.equal(actions.length, 0, "no onAction after close");
});
