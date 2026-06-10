// Localization-update tests (Step 7): setLang / setI18n / update re-inject and
// reload the WebView content WITHOUT closing or repositioning the open window;
// missing keys fall back; updates after close are ignored.
//
// Run: npm test   (from Templates/)

import { test } from "node:test";
import assert from "node:assert/strict";

import { createNotification } from "../../bridge/core/notification.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

function mockBridge() {
  const handlers = new Map();
  return {
    loads: [],
    on(method, cb) {
      const list = handlers.get(method) || [];
      list.push(cb);
      handlers.set(method, list);
      return () => handlers.set(method, (handlers.get(method) || []).filter((h) => h !== cb));
    },
    loadHtml(html) {
      this.loads.push(html);
    },
    last() {
      return this.loads[this.loads.length - 1];
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
    move() {
      this.calls.push(["move"]);
    },
    workarea: () => [1920, 1080],
  };
}

const noopScheduler = { setTimer: () => 1, clearTimer: () => {} };
const count = (w, name) => w.calls.filter((c) => c[0] === name).length;

const SPEC = {
  template: "<h1>{{text.title}}</h1> c={{data.count}}",
  i18n: {
    en: { title: "Removed: {programName}" },
    uk: { title: "Видалено: {programName}" },
  },
  data: { programName: "WinZip", count: 12 },
  lang: "en",
};

async function shown(spec = SPEC) {
  const bridge = mockBridge();
  const windowCtl = mockWindow();
  const events = [];
  const handle = createNotification(
    { bridge, windowCtl, scheduler: noopScheduler },
    {
      ...spec,
      on: {
        onLocalizationChanged: (c) => events.push(["loc", c]),
        onError: (e) => events.push(["err", e]),
      },
    },
  );
  bridge.fire("template:onReady", { lang: spec.lang || "en" });
  await tick();
  bridge.fire("template:onSize", { width: 450, height: 420 });
  return { bridge, windowCtl, events, handle };
}

test("initial render uses the starting language", async () => {
  const { bridge } = await shown();
  assert.equal(bridge.last(), "<h1>Removed: WinZip</h1> c=12");
  assert.equal(bridge.loads.length, 1);
});

test("setLang re-renders in the new language and fires onLocalizationChanged", async () => {
  const { bridge, events, handle } = await shown();
  handle.setLang("uk");
  assert.equal(bridge.last(), "<h1>Видалено: WinZip</h1> c=12");
  assert.deepEqual(events.find((e) => e[0] === "loc"), ["loc", { lang: "uk" }]);
});

test("setLang does NOT close or reposition the open window", async () => {
  const { windowCtl, handle } = await shown();
  const showsBefore = count(windowCtl, "show");
  const movesBefore = count(windowCtl, "move");
  handle.setLang("uk");
  assert.equal(count(windowCtl, "show"), showsBefore, "no re-show");
  assert.equal(count(windowCtl, "move"), movesBefore, "no reposition");
  assert.equal(count(windowCtl, "close"), 0, "not closed");
});

test("update(data) re-renders with new data and does NOT fire onLocalizationChanged", async () => {
  const { bridge, events, handle } = await shown();
  handle.update({ count: 27 });
  assert.equal(bridge.last(), "<h1>Removed: WinZip</h1> c=27");
  assert.equal(events.filter((e) => e[0] === "loc").length, 0);
});

test("setI18n merges dictionaries and re-renders the active language", async () => {
  const { bridge, handle } = await shown();
  handle.setI18n({ en: { title: "NEW {programName}" } });
  assert.equal(bridge.last(), "<h1>NEW WinZip</h1> c=12");
});

test("missing target language falls back to en (no throw), still marks lang changed", async () => {
  const { bridge, events, handle } = await shown();
  handle.setLang("fr"); // not in i18n
  assert.equal(bridge.last(), "<h1>Removed: WinZip</h1> c=12", "falls back to en content");
  assert.deepEqual(events.find((e) => e[0] === "loc"), ["loc", { lang: "fr" }]);
  assert.equal(events.filter((e) => e[0] === "err").length, 0, "no error on missing key");
});

test("localization updates after close are ignored", async () => {
  const { bridge, events, handle } = await shown();
  const loadsBefore = bridge.loads.length;
  handle.close();
  handle.setLang("uk");
  handle.update({ count: 99 });
  handle.setI18n({ en: { title: "X" } });
  assert.equal(bridge.loads.length, loadsBefore, "no reload after close");
  assert.equal(events.filter((e) => e[0] === "loc").length, 0);
});
