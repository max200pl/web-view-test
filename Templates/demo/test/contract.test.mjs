// Contract tests: the protocol enums stay internally valid, and the live host
// page (index.html) wires the bridge bundle. (Cross-runtime consistency for the
// live path is covered by template-client/notification-template/sciter-host tests.)
//
// Run: npm test   (from Templates/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TO_HOST, TO_TEMPLATE, CLOSE_REASON, ERROR_STAGE, DEFAULTS } from "../../bridge/core/contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const liveHostSrc = readFileSync(join(HERE, "..", "..", "index.html"), "utf8");

// ---- contract enums internal validity --------------------------------------

test("contract enums are frozen", () => {
  for (const e of [TO_HOST, TO_TEMPLATE, CLOSE_REASON, ERROR_STAGE, DEFAULTS]) {
    assert.ok(Object.isFrozen(e), "enum must be frozen");
  }
});

test("wire method/type values are unique within each channel", () => {
  const host = Object.values(TO_HOST);
  const tmpl = Object.values(TO_TEMPLATE);
  assert.equal(new Set(host).size, host.length, "duplicate TO_HOST value");
  assert.equal(new Set(tmpl).size, tmpl.length, "duplicate TO_TEMPLATE value");
});

test("CLOSE_REASON / ERROR_STAGE cover the documented set", () => {
  assert.deepEqual(Object.values(CLOSE_REASON).sort(), ["action", "auto-hide", "host", "user"]);
  for (const stage of [
    "window-create",
    "injection",
    "render",
    "callback",
    "localization",
    "auto-hide",
    "unknown-method",
  ]) {
    assert.ok(Object.values(ERROR_STAGE).includes(stage), `missing stage ${stage}`);
  }
});

test("DEFAULTS are sane", () => {
  assert.equal(DEFAULTS.LANG, "en");
  assert.ok(DEFAULTS.MIN_WIDTH > 0 && DEFAULTS.MIN_HEIGHT > 0, "positive size floors");
});

// ---- live host page wires the bridge ---------------------------------------

test("live index.html wires the bridge (bundle + showNotification)", () => {
  assert.match(liveHostSrc, /demo[\\/]+build[\\/]+bundle\.js/, "imports the demo bundle");
  assert.ok(liveHostSrc.includes("showNotification("), "calls showNotification");
  assert.ok(liveHostSrc.includes("notificationTemplate"), "uses the token template");
  assert.ok(!liveHostSrc.includes("window.__fromSciter("), "no legacy __fromSciter sender");
});
