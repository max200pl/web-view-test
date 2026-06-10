// Behavioural unit tests for the template injection layer (Step 3).
// These test the REAL pure module bridge/inject.js (no DOM / no Sciter needed).
//
// Run: npm test   (from Templates/)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  escapeHtml,
  escapeJsonForScript,
  translate,
  interpolate,
  injectTemplate,
  InjectionError,
} from "../../bridge/core/inject.mjs";
import { ERROR_STAGE } from "../../bridge/core/contract.mjs";

const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

// ---- escapeHtml -------------------------------------------------------------

test("escapeHtml escapes the five HTML-significant chars", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("escapeHtml leaves plain text and coerces non-strings", () => {
  assert.equal(escapeHtml("WinZip 12"), "WinZip 12");
  assert.equal(escapeHtml(12), "12");
});

// ---- escapeJsonForScript ----------------------------------------------------

test("escapeJsonForScript neutralises </script> and line separators", () => {
  const raw = `a${LINE_SEP}b${PARA_SEP}c</script>`;
  const out = escapeJsonForScript(raw);
  assert.ok(!out.includes(LINE_SEP), "raw U+2028 must be gone");
  assert.ok(!out.includes(PARA_SEP), "raw U+2029 must be gone");
  assert.ok(!out.includes("</script"), "raw </script must be gone");
  assert.ok(out.includes("\\u2028") && out.includes("\\u2029"), "separators escaped");
  // still valid JSON describing the original value
  assert.equal(JSON.parse(out), raw);
});

// ---- translate --------------------------------------------------------------

test("translate: active lang -> fallback en -> key", () => {
  const i18n = { en: { title: "EN" }, uk: { title: "UK" } };
  assert.equal(translate(i18n, "uk", "title"), "UK");
  assert.equal(translate(i18n, "ru", "title"), "EN"); // ru missing -> en
  assert.equal(translate(i18n, "ru", "missing"), "missing"); // -> key
  assert.equal(translate(undefined, "en", "x"), "x"); // no dict -> key
});

// ---- interpolate ------------------------------------------------------------

test("interpolate substitutes {field}, blanks missing, escapes data", () => {
  assert.equal(interpolate("Hi {name}", { name: "WinZip" }), "Hi WinZip");
  assert.equal(interpolate("n={count}", {}), "n="); // missing -> ""
  assert.equal(interpolate("{x}", { x: "<b>" }), "&lt;b&gt;"); // escaped
});

// ---- injectTemplate: happy path --------------------------------------------

test("injectTemplate resolves text / data / lang / actions tokens", () => {
  const html = injectTemplate({
    template: "<h1>{{text.title}}</h1> n={{data.count}} L={{lang}} A={{actions}}",
    data: { programName: "WinZip", count: 12 },
    i18n: { en: { title: "Removed: {programName}" } },
    lang: "en",
    actions: [{ id: "cta_click" }, { id: "close_webview", closes: true }],
  });
  assert.equal(html, '<h1>Removed: WinZip</h1> n=12 L=en A=["cta_click","close_webview"]');
});

test("injectTemplate injects the template-agnostic client for {{client}}", () => {
  const html = injectTemplate({ template: "<body><div data-notify-root></div><script>{{client}}</script></body>" });
  assert.ok(!/\{\{client\}\}/.test(html), "token replaced");
  assert.ok(html.includes("template:onReady"), "bridge glue injected");
  assert.ok(html.includes("[data-notify-root]") && html.includes("[data-action]"), "agnostic glue");
});

test("injectTemplate injects the required base CSS for {{styles}}", () => {
  const html = injectTemplate({ template: "<head>{{styles}}</head>" });
  assert.ok(!/\{\{styles\}\}/.test(html), "token replaced");
  assert.ok(html.includes("<style>"), "emits a <style> block");
  assert.ok(html.includes("[data-notify-root]") && html.includes("inline-block"), "sizing rule present");
  assert.ok(html.includes("overflow: hidden"), "scrollbar guard present");
});

test("injectTemplate resolves {{action.NAME}} to the named action's id (escaped)", () => {
  const html = injectTemplate({
    template: '<button data-action="{{action.cta}}">x</button>',
    actions: [{ name: "cta", id: "cta_click" }, { name: "close", id: "dismiss", closes: true }],
  });
  assert.equal(html, '<button data-action="cta_click">x</button>');
});

test("injectTemplate throws on {{action.NAME}} with an unknown action name", () => {
  expectInjectionError(() => injectTemplate({ template: "{{action.ghost}}", actions: [{ name: "cta", id: "x" }] }));
  expectInjectionError(() => injectTemplate({ template: "{{action.cta}}" })); // no actions at all
});

test("injectTemplate uses uk dict when lang=uk", () => {
  const html = injectTemplate({
    template: "{{text.title}}",
    i18n: { en: { title: "Removed" }, uk: { title: "Видалено" } },
    lang: "uk",
  });
  assert.equal(html, "Видалено");
});

test("injectTemplate defaults lang to en", () => {
  const html = injectTemplate({
    template: "{{text.title}}",
    i18n: { en: { title: "EN" }, uk: { title: "UK" } },
  });
  assert.equal(html, "EN");
});

test("injectTemplate soft-falls-back on a missing i18n key (no throw)", () => {
  const html = injectTemplate({ template: "{{text.ghost}}", i18n: { en: {} }, lang: "en" });
  assert.equal(html, "ghost");
});

// ---- injectTemplate: safety -------------------------------------------------

test("injectTemplate HTML-escapes interpolated data (no markup injection)", () => {
  const html = injectTemplate({
    template: "<div>{{data.x}}</div>",
    data: { x: '<img src=x onerror="alert(1)">' },
  });
  assert.ok(html.includes("&lt;img"), "data must be escaped");
  assert.ok(!html.includes("<img"), "no live markup");
});

test("injectTemplate is single-pass (data cannot smuggle a token)", () => {
  const html = injectTemplate({
    template: "{{data.a}}",
    data: { a: "{{data.b}}", b: "SECRET" },
  });
  assert.equal(html, "{{data.b}}"); // NOT "SECRET"
});

test("injectTemplate leaves a token-free template unchanged", () => {
  const tpl = "<html><body>plain { single } braces</body></html>";
  assert.equal(injectTemplate({ template: tpl }), tpl);
});

test("injectTemplate leaves a token-free template byte-for-byte unchanged", () => {
  const tpl = "<html><body><div>no tokens here { single } braces</div></body></html>";
  assert.equal(injectTemplate({ template: tpl }), tpl);
});

// ---- injectTemplate: error handling ----------------------------------------

const expectInjectionError = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof InjectionError, "should be InjectionError");
    assert.equal(e.stage, ERROR_STAGE.INJECTION, "stage must be injection");
    return;
  }
  assert.fail("expected an InjectionError to be thrown");
};

test("injectTemplate throws InjectionError on unknown token", () => {
  expectInjectionError(() => injectTemplate({ template: "{{x.y}}" }));
  expectInjectionError(() => injectTemplate({ template: "{{bogus}}" }));
});

test("injectTemplate throws on a non-string template", () => {
  expectInjectionError(() => injectTemplate({ template: 123 }));
  expectInjectionError(() => injectTemplate(null));
});

test("injectTemplate throws on structurally invalid data / i18n / actions", () => {
  expectInjectionError(() => injectTemplate({ template: "x", data: [] }));
  expectInjectionError(() => injectTemplate({ template: "x", i18n: "nope" }));
  expectInjectionError(() => injectTemplate({ template: "x", actions: {} }));
});
