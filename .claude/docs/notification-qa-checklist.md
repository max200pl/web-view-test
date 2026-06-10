# Notification Window — Manual QA Checklist

Companion to the automated tests (`Templates/demo/test/`, run with `npm test` from `Templates/demo/`).
Together these are the "notification window tests" the bridge plan validates against
at every step: **automated** = contract surface + (from Step 3) protocol logic;
**manual** = this checklist, run against the real `desktop.exe`.

Reference: bridge contract [notification-bridge-contract.md](./notification-bridge-contract.md)
and mechanics [jsbridge.md](./jsbridge.md).
Flow diagram (live bridge path): [../sequences/notification-bridge-flow.mmd](../sequences/notification-bridge-flow.mmd)
(legacy raw handshake: [jsbridge-flow.mmd](../sequences/jsbridge-flow.mmd)).

---

## How to run

`main-window.cpp` (`loadHtml()` → `locate_index_html()`) loads `index.html` from disk by
walking UP from the `.exe` folder until it finds `Templates\index.html` (portable: any clone
path / build config). JS-only changes need **no rebuild** — just relaunch. (A change to the C++
loader itself needs a one-time VS rebuild.)

1. Close any running instance.
2. Launch `web-view-test\x64\Debug\desktop.exe`.
3. Observe the notification window (dev panel buttons + WebView card).

Since **Step 9b**, `index.html` is the **bridge host**: it imports the generated
`demo/build/bundle.js` and calls `showNotification`. (The legacy self-render demo + experiment
files were removed in the 2026-06-09 cleanup; `Templates/` now holds only `bridge/`,
`test/`, `index.html`, `package.json`.) `SW_ENABLE_DEBUG` (`main-window.cpp:7`) gives the
Sciter inspector plus `console.log` from both runtimes — the bridge logs
`bridge onReady/onAction/onClose/onError` there.

---

## ⚠️ First-run integration check (Step 9b)

`index.html` loads **`demo/build/bundle.js`** (a generated, import-free concatenation of
`bridge/core` + `bridge/sciter` (ship) and `demo/templates`) via
`await import(document.url("demo/build/bundle.js"))` — an ABSOLUTE url resolved against the page's
own location. This is both **portable** (works from any clone path — no hardcoded `C:\…`) and a
workaround for Sciter not resolving relative module specifiers under a path containing a space
(`web-view-test 2`) — `./x.js` would stay literal ("Unknown module 'file:./x.js'"); an absolute
url sidesteps it. The bundle has no inner imports, so the single leaf loads cleanly. Confirm on launch:

+ **Card renders + console `webview init success` then `bridge onReady …`** → ✅ working.
+ **Blank card / `Unknown module …` in console** → the bundle didn't load. Re-generate it
  (`node demo/build/build-bundle.mjs`) and confirm `index.html` resolves `demo/build/bundle.js` via `document.url(...)`.

> After any change to a `bridge/{core,sciter}` or `demo/templates` module, rebuild: `node demo/build/build-bundle.mjs`
> (the `test/bundle.test.mjs` drift guard fails if the committed bundle is stale).

---

## Baseline checklist (new bridge path — `index.html`)

Mark PASS/FAIL each run. Reflects the token template `bridge/notification-template.js`
(simpler than the legacy demo: no ticking counter, no in-card language button, no dot
recolor — those were legacy-only).

| # | Check | Action | Expected |
| --- | --- | --- | --- |
| 1 | App launches | Run `desktop.exe` | Window appears; card renders within ~1s |
| 2 | Initial render | — | Title "Program removed: WinZip", "Live counter" 12, subtitle "Leftover files: 12", buttons CTA + Close |
| 3 | Window position | — | Window settles **bottom-right** of the work area, sized to the card |
| 4 | Lang switch (panel) | click `EN`/`UK`/`RU` | Card re-renders in that language (title/subtitle/counter/close translate; CTA stays "CTA") |
| 5 | Payload update (panel) | click "Update payload" | Title→"Adobe Reader", count→27, subtitle "Leftover files: 27" |
| 6 | i18n update (panel) | click "Update i18n" | en/ru titles gain the "🚀 … from Sciter" prefix |
| 7 | CTA action | click card "CTA" | console `bridge onAction {id:"cta_click"}`; window stays open |
| 8 | Close action | click card "Close" | window closes; console `bridge onClose action` |
| 9 | No errors | watch console | `bridge onReady` logged; **no** `bridge onError` |
| 10 | Repeat launch | relaunch | Fresh notification renders identically (no stale state) |

---

## Known issues — do NOT report as regressions

+ **Hidden until rendered (shown off-screen)** — ✅ user-confirmed working. `index.html` moves the
  window **off-screen** in a synchronous inline `<script>` before C++ `expand()` shows it. The window stays SHOWN
  (so WebView2 actually paints — a `window-state="hidden"` window never paints → blank webview,
  do NOT use it), but off the visible area; the bridge moves it **on-screen bottom-right at the
  exact size** on first onSize → nothing visible until rendered, no centered flash, no settle.
  No C++ change needed (expand stays). See [jsbridge.md §10.2](./jsbridge.md).
+ **Non-100% DPI (125/150%)** — ✅ user-confirmed working (2026-06-10). `index.html` imports
  `devicePixels` from `@sciter` and passes it into `showNotification`; the bridge converts the
  WebView's CSS-px size to the physical px `window.move()` requires. Without it the window was sized
  1/scale too small → the card clipped at the bottom (and could mis-position at extreme scale). The
  converter is injected, so `bridge/` stays import-free.
+ **Multi-monitor** — position may still drift across monitors with different DPI ([§9](./jsbridge.md)).

---

## Per-step verification log

Append one row per plan step as it lands. New rows added by later steps go here so the
baseline table above stays a stable reference.

| Step | Date | New/changed checks | Automated result | Manual result | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 — Analyze current flow | 2026-06-09 | Established harness + this checklist | 18/18 pass | *pending first manual run* | No code behaviour changed; baseline only |
| 2 — Define bridge contract | 2026-06-09 | +7 contract-module checks (bridge/contract.js) | 25/25 pass | n/a (no runtime change) | Contract defined + documented; `showNotification` still a stub. No change to live runtimes, so baseline rows 1–12 unaffected |
| 3 — Template injection layer | 2026-06-09 | +16 behavioural unit tests (bridge/inject.js) | 41/41 pass | n/a (not yet wired) | Pure `injectTemplate`; auto-escapes injected values (closes §10.3 hazard). Not wired into live app — that's Step 4. Baseline rows 1–12 unaffected |
| 4 — WebView render layer | 2026-06-09 | +9 tests (render.js mock-adapter ordering, notification-template injectability) | 50/50 pass | n/a (parallel path, not user-visible until show lands in Step 5) | New token template + `renderNotification` run parallel to legacy demo. `index.html` still loads `Templates.js`, so baseline rows 1–12 unaffected |
| 5 — Show/hide lifecycle | 2026-06-09 | +11 tests (createNotification: show-after-render, auto-hide, close reasons, idempotency, instance independence) | 61/61 pass | n/a (real Sciter `windowCtl` adapter wired at Step 9 integration) | Lifecycle validated via mock adapters. New path still not loaded by the exe — visual confirmation of the new bridge comes at Step 9 (when `index.html` becomes the bridge host). Baseline rows 1–12 unaffected |
| 6 — Click callbacks | 2026-06-09 | +6 tests (action routing: primary/secondary/close/link/after-close + template data-href) | 67/67 pass | n/a (wired at Step 9) | `onAction` forwarded as `{id,data}`; closing actions close. Baseline rows 1–12 unaffected |
| 7 — Localization update | 2026-06-09 | +7 tests (setLang/setI18n/update re-render, no reposition, fallback, after-close) | 74/74 pass | n/a (wired at Step 9) | Relocalize = re-inject + reload via existing `loadHtml`; window not closed/moved. Baseline rows 1–12 unaffected |
| 8 — Error handling | 2026-06-09 | +9 tests (errors.test: all 6 stages, no-show-on-broken, throwing-onError safe, benign inputs; +template onError check) | 83/83 pass | n/a (wired at Step 9) | Full onError taxonomy; `template:onError` channel activated for the new path. Baseline rows 1–12 unaffected |
| 9a — API cleanup + Sciter glue | 2026-06-09 | +5 tests (sciter-host: jsBridgeCall unpack, adapters, full-path show); contract.js → types-only; bridge README | 87/87 pass | n/a (live not touched) | `makeSciterDeps`/`showNotification` glue (mock-tested). Live convergence is 9b |
| 9b — Live convergence (index.html) | 2026-06-09 | contract test repointed to `index-legacy.html` + live-wiring check; `bridge/bundle.js` + drift guard | 91/91 pass | **✅ PASS — renders in desktop.exe** (user-confirmed) | `index.html` → bridge host via `bridge/bundle.js`. First module attempt failed (Sciter can't resolve relative imports under a path with a space); fixed by the import-free bundle. Detailed rows 1–10 left for ad-hoc ticking |
