// Drift guard for the Sciter bundle (Step 9b). index.html loads bridge/bundle.js
// (a generated, import-free concatenation of bridge/*.js) because Sciter can't
// resolve relative imports under a path with a space. This test fails if the
// committed bundle is stale — run `node bridge/build-bundle.mjs` to refresh it.
//
// Run: npm test   (from Templates/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildBundle } from "../build/build-bundle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(HERE, "..", "build", "bundle.js");

test("committed bundle.js matches a fresh build (not stale)", () => {
  const onDisk = readFileSync(bundlePath, "utf8");
  assert.equal(onDisk, buildBundle(), "bundle.js is stale — run `node bridge/build/build-bundle.mjs`");
});

test("bundle.js has no leftover import statements (Sciter-safe)", () => {
  const src = readFileSync(bundlePath, "utf8");
  assert.ok(!/^\s*import\s.+from\s+["']/m.test(src), "bundle must not import anything");
});

test("bundle exposes the public API and behaves end-to-end (mock Sciter env)", async () => {
  const { showNotification, notificationTemplate } = await import("../build/bundle.js");
  assert.equal(typeof showNotification, "function");
  assert.equal(typeof notificationTemplate, "string");

  const wv = { webview: { loaded: [], loadHtml(h) { this.loaded.push(h); } }, jsBridgeCall: null };
  const win = { WINDOW_SHOWN: "shown", this: { state: null, move() {}, close() {}, screenBox: () => [1920, 1080] } };
  const ready = [];
  showNotification(
    { elemWebView: wv, win },
    {
      template: notificationTemplate,
      i18n: { en: { title: "Removed: {programName}", subtitle: "L: {count}", counter: "C", cta: "CTA", close: "X" } },
      data: { programName: "WinZip", count: 12 },
      lang: "en",
      actions: [{ name: "cta", id: "cta_click" }, { name: "close", id: "close_webview", closes: true }],
      on: { onReady: (i) => ready.push(i) },
    },
  );

  await new Promise((r) => setTimeout(r, 0));
  wv.jsBridgeCall(["template:onReady", { lang: "en" }]);
  await new Promise((r) => setTimeout(r, 0));
  wv.jsBridgeCall(["template:onSize", { width: 450, height: 420 }]);

  assert.ok(wv.webview.loaded[0].includes("Removed: WinZip"), "injected html loaded");
  assert.ok(!/\{\{|\}\}/.test(wv.webview.loaded[0]), "no leftover tokens");
  assert.equal(win.this.state, "shown", "window shown");
  assert.deepEqual(ready, [{ lang: "en", width: 450, height: 420 }]);
});
