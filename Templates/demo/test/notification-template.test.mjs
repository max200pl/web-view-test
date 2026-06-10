// Tests for the demo + skeleton templates (Step 4, revised). Templates carry NO
// inline bridge glue — they pull it in via the {{client}} token and only opt into
// the data-* conventions. injectTemplate binds the external template + data.
//
// Run: npm test   (from Templates/)

import { test } from "node:test";
import assert from "node:assert/strict";

import { notificationTemplate } from "../templates/notification-template.js";
import { skeletonTemplate } from "../templates/skeleton-template.js";
import { injectTemplate } from "../../bridge/core/inject.mjs";

const SPEC = {
  template: notificationTemplate,
  data: { programName: "WinZip", count: 12 },
  i18n: {
    en: {
      title: "Removed: {programName}",
      subtitle: "Leftover files: {count}",
      counter: "Live counter",
      cta: "CTA",
      close: "Close",
    },
  },
  lang: "en",
  actions: [
    { name: "cta", id: "cta_click" },
    { name: "close", id: "close_webview", closes: true },
  ],
};

test("demo template is markup-only: no inline glue, base CSS + glue via tokens", () => {
  // the bridge code/styles are NOT in the source template — they arrive via tokens
  assert.ok(notificationTemplate.includes("{{styles}}"), "pulls required base CSS via token");
  assert.ok(notificationTemplate.includes("{{client}}"), "pulls the client via token");
  assert.ok(!notificationTemplate.includes("querySelector('.card')"), "no inline .card glue");
  assert.ok(!notificationTemplate.includes("window.jsBridgeCall"), "no inline bridge calls");
  assert.ok(!notificationTemplate.includes("data-notify-root"), "no wrapper element — content straight in <body>");
  assert.ok(notificationTemplate.includes('data-action="{{action.cta}}"'), "action ids come from the spec via {{action.NAME}}");
  assert.ok(!notificationTemplate.includes('data-action="cta_click"'), "no hardcoded action id in the template");
});

test("demo template injects to clean HTML with base CSS + client + bound data", () => {
  const html = injectTemplate(SPEC);
  assert.ok(!/\{\{|\}\}/.test(html), "no leftover tokens");
  assert.ok(html.includes("Removed: WinZip"), "title bound");
  assert.ok(html.includes("Leftover files: 12"), "subtitle bound");
  assert.ok(html.includes('lang="en"'), "lang applied");
  assert.ok(html.includes("inline-block"), "base styles injected ({{styles}})");
  assert.ok(html.includes('data-action="cta_click"'), "action id resolved from spec ({{action.cta}})");
  // {{client}} resolved -> the agnostic glue is now present
  assert.ok(html.includes("template:onReady") && html.includes("[data-notify-root]"), "client injected");
});

test("skeleton is the minimal build base: styles + client + tokens, no wrapper", () => {
  assert.ok(!skeletonTemplate.includes("data-notify-root"), "no wrapper — content straight in <body>");
  assert.ok(skeletonTemplate.includes("{{styles}}"), "pulls base CSS");
  assert.ok(skeletonTemplate.includes("{{client}}"), "pulls the client");
  assert.ok(skeletonTemplate.includes("{{lang}}"), "lang token");
  const html = injectTemplate({ template: skeletonTemplate, lang: "en" });
  assert.ok(!/\{\{|\}\}/.test(html), "injects clean with just lang+styles+client");
  assert.ok(html.includes("inline-block"), "base CSS present after injection");
  assert.ok(html.includes("template:onAction"), "client present after injection");
});

test("neither template embeds an i18n dictionary (data arrives from the host)", () => {
  for (const t of [notificationTemplate, skeletonTemplate]) {
    assert.ok(!t.includes("mergeI18n"), "no runtime i18n");
    assert.ok(!t.includes("Програму видалено"), "no embedded dictionary");
  }
});
