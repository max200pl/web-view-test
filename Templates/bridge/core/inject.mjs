// Template injection layer — Step 3.
//
// PURE, runtime-agnostic. Takes the data half of a NotificationSpec (template,
// data, i18n, lang, actions) and returns fully-rendered HTML. No DOM, no Sciter,
// no WebView — so it is unit-testable in Node and reusable by the render layer
// (Step 4) which feeds the result to webview.loadHtml.
//
// Token convention in a template string:
//   {{ text.KEY }}    -> i18n[lang][KEY] (fallback en, then KEY) with {field} data
//                     interpolation applied, HTML-escaped.
//   {{ data.FIELD }}  -> data[FIELD] (missing -> ""), HTML-escaped.
//   {{ action.NAME }}   -> id of the spec.actions entry named NAME (for data-action="..."),
//                     HTML-escaped. Unknown name -> InjectionError.
//   {{ lang }}     -> active language code, HTML-escaped.
//   {{ actions }}  -> JSON array of declared action ids, escaped for a <script> context.
//   {{ client }}   -> the bridge client JS (template-client), raw — inject inside a <script>.
//   {{ styles }}   -> the required base <style> (reset + data-notify-root sizing), raw — in <head>.
//   anything else  -> InjectionError (fail loud: caller shows nothing — see plan Step 3 validation).
//
// Two safety properties:
//   1. All injected values are escaped (HTML, or script-context for {{actions}}),
//      closing the latent injection hazard from jsbridge.md §10.3.
//   2. Replacement is a single left-to-right pass, so a data value that happens
//      to look like a token (e.g. "{{data.x}}") is NOT re-processed.

import { DEFAULTS, ERROR_STAGE } from "./contract.mjs";
import { TEMPLATE_CLIENT, TEMPLATE_STYLES } from "./template-client.mjs";

/** Error raised by the injection layer. Maps to onError({ stage: "injection" }). */
export class InjectionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "InjectionError";
    this.stage = ERROR_STAGE.INJECTION;
    if (cause !== undefined) this.cause = cause;
  }
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// U+2028 / U+2029 built via code point — a raw one inside a /regex/ or quoted
// string is itself a line terminator and risks a SyntaxError, so never inline it.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

/** Escape a value for HTML text / attribute context. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * JSON-encode a value safely for embedding inside a <script> block. Guards the
 * `</script>` breakout and the U+2028/U+2029 line/paragraph separators that are
 * legal in JS source but can break parsing — the exact concern from jsbridge.md §10.3.
 */
export function escapeJsonForScript(value) {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(LINE_SEP)
    .join("\\u2028")
    .split(PARA_SEP)
    .join("\\u2029");
}

/**
 * Resolve an i18n key: i18n[lang][key] -> i18n[fallback][key] -> key.
 */
export function translate(i18n, lang, key, fallbackLang = DEFAULTS.LANG) {
  const dict = i18n || {};
  return dict[lang]?.[key] ?? dict[fallbackLang]?.[key] ?? key;
}

/**
 * Replace single-brace `{field}` placeholders with data values. Missing fields
 * become "". Values are escaped (default HTML).
 */
export function interpolate(str, data = {}, escape = escapeHtml) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => escape(data[k] ?? ""));
}

function assertObject(value, label) {
  if (value !== undefined && (value === null || typeof value !== "object" || Array.isArray(value))) {
    throw new InjectionError(`${label} must be an object`);
  }
}

/**
 * Render a template by injecting localization, data and actions.
 * @param {{template:string, data?:Object, i18n?:Object, lang?:string, actions?:Array}} spec
 * @returns {string} rendered HTML
 * @throws {InjectionError} on a structurally invalid spec or an unknown token
 */
export function injectTemplate(spec) {
  if (!spec || typeof spec !== "object") {
    throw new InjectionError("spec must be an object");
  }
  const { template, data = {}, i18n = {}, lang = DEFAULTS.LANG, actions = [] } = spec;

  if (typeof template !== "string") throw new InjectionError("spec.template must be a string");
  assertObject(data, "spec.data");
  assertObject(i18n, "spec.i18n");
  if (actions !== undefined && !Array.isArray(actions)) {
    throw new InjectionError("spec.actions must be an array");
  }

  const actionIds = actions.map((a) => (a && typeof a === "object" ? a.id : a));
  // name -> id, so a template can reference an action's id by a stable name ({{action.cta}}).
  const actionIdByName = {};
  for (const a of actions) {
    if (a && typeof a === "object" && a.name) actionIdByName[a.name] = a.id;
  }

  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, tokenRaw) => {
    const token = tokenRaw.trim();

    if (token === "lang") return escapeHtml(lang);
    if (token === "actions") return escapeJsonForScript(actionIds);
    if (token === "client") return TEMPLATE_CLIENT; // trusted bridge glue (raw)
    if (token === "styles") return TEMPLATE_STYLES; // required base CSS (raw <style>)

    const dotted = /^([a-z]+)\.(\w+)$/.exec(token);
    if (dotted) {
      const [, ns, key] = dotted;
      if (ns === "text") return interpolate(translate(i18n, lang, key), data);
      if (ns === "data") return escapeHtml(data[key] ?? "");
      if (ns === "action") {
        // {{action.NAME}} -> the id of the spec.actions entry named NAME (backend-defined,
        // so templates stay generic). Unknown name = structural mismatch -> fail loud.
        if (!(key in actionIdByName)) {
          throw new InjectionError(`{{action.${key}}}: no action named "${key}" in spec.actions`);
        }
        return escapeHtml(actionIdByName[key]);
      }
    }

    throw new InjectionError(`unknown template token "{{${token}}}"`);
  });
}
