// Unit tests for the render orchestration (Step 4), using a mock WebViewAdapter.
// Proves the render-first ordering and error behaviour without a real WebView.
//
// Run: npm test   (from Templates/)

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderNotification } from "../../bridge/core/render.mjs";
import { InjectionError } from "../../bridge/core/inject.mjs";

function mockAdapter() {
  const calls = [];
  let readyCb = null;
  return {
    calls,
    loadHtml(html) {
      calls.push({ type: "load", html });
    },
    onReady(cb) {
      readyCb = cb;
      calls.push({ type: "register" });
      return () => {
        readyCb = null;
        calls.push({ type: "unsub" });
      };
    },
    fireReady(info) {
      if (readyCb) readyCb(info);
    },
  };
}

const idx = (a, type) => a.calls.findIndex((c) => c.type === type);

test("injects, registers ready BEFORE loading, then resolves on ready", async () => {
  const a = mockAdapter();
  const p = renderNotification(a, {
    template: "<b>{{text.title}}</b>",
    i18n: { en: { title: "Hi" } },
    lang: "en",
  });

  const load = a.calls.find((c) => c.type === "load");
  assert.ok(load, "loadHtml must be called");
  assert.equal(load.html, "<b>Hi</b>", "loads the INJECTED html");
  assert.ok(idx(a, "register") < idx(a, "load"), "ready listener registered before load");

  a.fireReady({ lang: "en" });
  const res = await p;
  assert.equal(res.lang, "en");
});

test("does not resolve until ready fires", async () => {
  const a = mockAdapter();
  let resolved = false;
  const p = renderNotification(a, { template: "x" }).then(() => {
    resolved = true;
  });
  await Promise.resolve(); // flush a microtask
  assert.equal(resolved, false, "must wait for the ready handshake");
  a.fireReady({});
  await p;
  assert.equal(resolved, true);
});

test("defaults lang to en when ready info omits it", async () => {
  const a = mockAdapter();
  const p = renderNotification(a, { template: "x" });
  a.fireReady({});
  assert.equal((await p).lang, "en");
});

test("unsubscribes the ready listener after resolving", async () => {
  const a = mockAdapter();
  const p = renderNotification(a, { template: "x" });
  a.fireReady({ lang: "en" });
  await p;
  assert.ok(idx(a, "unsub") !== -1, "listener should be removed");
});

test("injection failure rejects WITHOUT loading anything", async () => {
  const a = mockAdapter();
  await assert.rejects(
    () => renderNotification(a, { template: "{{bogus}}" }),
    (e) => e instanceof InjectionError && e.stage === "injection",
  );
  assert.equal(a.calls.find((c) => c.type === "load"), undefined, "must not load on injection error");
  assert.equal(a.calls.find((c) => c.type === "register"), undefined, "must not register on injection error");
});

test("invalid adapter rejects", async () => {
  await assert.rejects(() => renderNotification(null, { template: "x" }), /adapter/i);
  await assert.rejects(() => renderNotification({}, { template: "x" }), /adapter/i);
});
