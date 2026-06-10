// Tests for the Sciter adapter glue (Step 9). Uses mock `elemWebView` / `Window`
// objects to verify the adapter construction WITHOUT a real Sciter engine —
// notably the B->A param-unpacking (single array: [method, payload]) and the
// end-to-end show via showNotification().
//
// Run: npm test   (from Templates/)

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeSciterDeps, showNotification } from "../../bridge/sciter/sciter-host.mjs";

function mockWebView() {
  return {
    jsBridgeCall: null,
    loaded: [],
    webview: {
      loadHtml(html) {
        this._owner.loaded.push(html);
      },
    },
    _bind() {
      this.webview._owner = this;
      return this;
    },
  };
}

function mockWindow() {
  const calls = [];
  return {
    calls,
    WINDOW_SHOWN: "shown",
    this: {
      state: null,
      move(...args) {
        calls.push(["move", ...args]);
      },
      close() {
        calls.push(["close"]);
      },
      screenBox: (kind, what, ppx) => {
        calls.push(["screenBox", kind, what, ppx]);
        return [1920, 1080];
      },
    },
  };
}

test("installs a jsBridgeCall that unpacks [method, payload] and fans out", () => {
  const wv = mockWebView()._bind();
  const win = mockWindow();
  const { bridge } = makeSciterDeps(wv, win);

  const seen = [];
  bridge.on("template:onReady", (p) => seen.push(["ready", p]));
  bridge.on("template:onSize", (p) => seen.push(["size", p]));

  assert.equal(typeof wv.jsBridgeCall, "function", "handler installed");
  const ret = wv.jsBridgeCall(["template:onReady", { lang: "en" }]);
  assert.deepEqual(JSON.parse(ret), { ok: true }, "returns the {ok} contract string");
  wv.jsBridgeCall(["template:onSize", { width: 450, height: 420 }]);

  assert.deepEqual(seen, [
    ["ready", { lang: "en" }],
    ["size", { width: 450, height: 420 }],
  ]);
});

test("bridge.on unsubscribe stops further dispatch", () => {
  const wv = mockWebView()._bind();
  const { bridge } = makeSciterDeps(wv, mockWindow());
  const hits = [];
  const off = bridge.on("template:onAction", (p) => hits.push(p));
  wv.jsBridgeCall(["template:onAction", { action: "cta_click" }]);
  off();
  wv.jsBridgeCall(["template:onAction", { action: "cta_click" }]);
  assert.equal(hits.length, 1);
});

test("bridge.loadHtml forwards to webview.loadHtml", () => {
  const wv = mockWebView()._bind();
  const { bridge } = makeSciterDeps(wv, mockWindow());
  bridge.loadHtml("<b>x</b>");
  assert.deepEqual(wv.loaded, ["<b>x</b>"]);
});

test("windowCtl maps to Sciter Window calls (workarea in CSS px)", () => {
  const wv = mockWebView()._bind();
  const win = mockWindow();
  const { windowCtl } = makeSciterDeps(wv, win);

  assert.deepEqual(windowCtl.workarea(), [1920, 1080]);
  assert.deepEqual(win.calls.at(-1), ["screenBox", "workarea", "dimension", false], "asPPX=false → CSS px");

  windowCtl.move(1470, 660, 450, 420); // no devicePixels → identity
  assert.deepEqual(win.calls.at(-1), ["move", 1470, 660, 450, 420, "client"]);

  windowCtl.show();
  assert.equal(win.this.state, "shown");

  windowCtl.close();
  assert.deepEqual(win.calls.at(-1), ["close"]);
});

test("windowCtl.move converts CSS px -> physical px via devicePixels", () => {
  const wv = mockWebView()._bind();
  const win = mockWindow();
  const { windowCtl } = makeSciterDeps(wv, win, (n) => n * 1.5); // e.g. 150% DPI
  windowCtl.move(100, 200, 300, 400);
  assert.deepEqual(win.calls.at(-1), ["move", 150, 300, 450, 600, "client"]);
});

test("showNotification wires the full path: ready+size -> injected load + show", async () => {
  const wv = mockWebView()._bind();
  const win = mockWindow();
  const events = [];
  showNotification(
    { elemWebView: wv, win },
    {
      template: "<b>{{text.title}}</b>",
      i18n: { en: { title: "Hi" } },
      lang: "en",
      on: { onReady: (i) => events.push(i) },
    },
  );

  await new Promise((r) => setTimeout(r, 0));
  wv.jsBridgeCall(["template:onReady", { lang: "en" }]);
  await new Promise((r) => setTimeout(r, 0));
  wv.jsBridgeCall(["template:onSize", { width: 450, height: 420 }]);

  assert.deepEqual(wv.loaded, ["<b>Hi</b>"], "injected html loaded");
  assert.equal(win.this.state, "shown", "window shown after ready+size");
  assert.deepEqual(win.calls.find((c) => c[0] === "move"), ["move", 1470, 660, 450, 420, "client"]);
  assert.deepEqual(events, [{ lang: "en", width: 450, height: 420 }]);
});
