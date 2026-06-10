// WebView render layer — Step 4.
//
// Orchestrates "inject -> load -> wait for ready", keeping RENDER separate from
// SHOW (Step 5). The Sciter/WebView specifics are isolated behind a small
// WebViewAdapter, so this orchestration is pure and unit-testable in Node with a
// mock adapter — and the real adapter (elemWebView.webview.loadHtml + the
// jsBridgeCall "template:onReady" handler) is the only Sciter-coupled glue.
//
// Lifecycle guarantee (the testable part of "render first, show after success"):
//   - the ready listener is registered BEFORE loadHtml (no missed handshake);
//   - the returned promise resolves ONLY after the template reports ready;
//   - an injection failure rejects WITHOUT loading anything (caller shows nothing).
// This module never shows/positions the window — that is Step 5's job.

import { injectTemplate } from "./inject.mjs";
import { DEFAULTS } from "./contract.mjs";

/**
 * @typedef {Object} WebViewAdapter
 * @property {(html: string) => void} loadHtml - load prepared HTML into the WebView.
 * @property {(cb: (info: {lang?: string, width?: number, height?: number}) => void) => (() => void)} onReady
 *   register a listener for the template's ready handshake; returns an unsubscribe fn.
 */

/**
 * Inject the spec into HTML, load it, and resolve once the template reports ready.
 * @param {WebViewAdapter} adapter
 * @param {import("./contract.mjs").NotificationSpec} spec
 * @returns {Promise<{lang: string}>} resolves when rendered (NOT shown)
 */
export function renderNotification(adapter, spec) {
  if (!adapter || typeof adapter.loadHtml !== "function" || typeof adapter.onReady !== "function") {
    return Promise.reject(new TypeError("renderNotification: invalid WebViewAdapter"));
  }

  let html;
  try {
    html = injectTemplate(spec); // InjectionError -> reject, nothing loaded
  } catch (err) {
    return Promise.reject(err);
  }

  const fallbackLang = (spec && spec.lang) || DEFAULTS.LANG;

  return new Promise((resolve) => {
    const off = adapter.onReady((info) => {
      if (typeof off === "function") off();
      resolve({ lang: (info && info.lang) || fallbackLang });
    });
    adapter.loadHtml(html); // registered listener first, so the handshake can't be missed
  });
}
