// Tests for the template-agnostic bridge client (runtime B glue).
// The whole point: NO hardcoded markup selectors — a template author drops this
// in (or the host injects it via {{client}}) and it works against any markup.
//
// Run: npm test   (from Templates/)

import { test } from "node:test";
import assert from "node:assert/strict";

import { TEMPLATE_CLIENT, TEMPLATE_STYLES } from "../../bridge/core/template-client.mjs";

test("client is pure, token-free JS (safe to paste or inject as-is)", () => {
  assert.equal(typeof TEMPLATE_CLIENT, "string");
  assert.ok(!/\{\{|\}\}/.test(TEMPLATE_CLIENT), "no {{tokens}} in the client");
});

test("base styles carry the bridge-required rules (reset + body shrink-to-fit)", () => {
  assert.equal(typeof TEMPLATE_STYLES, "string");
  assert.ok(TEMPLATE_STYLES.includes("<style>") && TEMPLATE_STYLES.includes("</style>"), "wrapped in <style>");
  // <body> (and optional [data-notify-root]) are inline-block so the window sizes to content
  assert.ok(/body[^{]*\{[^}]*inline-block/.test(TEMPLATE_STYLES), "body is inline-block (sizes to content)");
  assert.ok(TEMPLATE_STYLES.includes("[data-notify-root]"), "optional override element supported");
  assert.ok(TEMPLATE_STYLES.includes("overflow: hidden"), "scrollbar guard");
  assert.ok(!/\{\{|\}\}/.test(TEMPLATE_STYLES), "no {{tokens}}");
});

test("client has NO hardcoded markup coupling", () => {
  assert.ok(!TEMPLATE_CLIENT.includes(".card"), "must not reference .card");
  // no querySelector targeting a class/id literal (only the data-* attribute hooks)
  assert.ok(!/querySelector(All)?\(\s*['"][.#]/.test(TEMPLATE_CLIENT), "no class/id selector");
});

test("client sizes to <body> by default, [data-notify-root] as optional override", () => {
  assert.ok(TEMPLATE_CLIENT.includes("document.body"), "defaults to body");
  assert.ok(TEMPLATE_CLIENT.includes("[data-notify-root]"), "optional override");
  assert.ok(TEMPLATE_CLIENT.includes("[data-action]"), "actions via data-action");
  assert.ok(TEMPLATE_CLIENT.includes("data-href"), "links via data-href");
});

test("client wires every outbound bridge method", () => {
  for (const m of ["template:onReady", "template:onSize", "template:onAction", "template:onError"]) {
    assert.ok(TEMPLATE_CLIENT.includes(m), `client should emit ${m}`);
  }
  assert.ok(TEMPLATE_CLIENT.includes("window.jsBridgeCall"), "uses the bridge entry");
});

test("client re-measures dynamically (ResizeObserver + resize)", () => {
  assert.ok(TEMPLATE_CLIENT.includes("ResizeObserver"));
  assert.ok(TEMPLATE_CLIENT.includes('"resize"') || TEMPLATE_CLIENT.includes("'resize'"));
});
