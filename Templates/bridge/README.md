# Notification bridge (Sciter ↔ WebView)

Reusable, unit-tested bridge for rendering HTML notifications. **JS-only**: it runs
on the Sciter host (runtime A) and drives the embedded WebView (runtime B). Data
originates in host JS; no C++ changes (the `NotificationSpec` data is plain JSON,
so a future C++ integration plugs into `makeSciterDeps` + `on.onAction` without
touching the contract — see [the contract doc](../../.claude/docs/notification-bridge-contract.md)).

## Layout

This `bridge/` folder is **the deliverable** — copy it to the real app as-is. It is plain
**`.mjs` source (ESM by extension)** with no `package.json`/manifest, so it drops into any
app regardless of that app's module setup. Everything that is only scaffolding for this
demo lives in a sibling `demo/` folder.

```
Templates/
  bridge/          ── SHIPS to the real app (this folder; just .mjs, no manifest)
    core/          portable bridge logic (no Sciter/C++)
    sciter/        Sciter/C++ integration glue (the C++ boundary)
    README.md
  demo/            ── auxiliary, NOT shipped (specific to this test project)
    templates/     DEMO templates — in production these arrive from the backend/C++ service
    build/         build-bundle.mjs + generated bundle.js (the demo host loads it)
    test/          the test suite
    package.json   test runner ("npm test" runs from here)
  index.html       demo host (pinned by C++ to this path)
```

| File | Role | Layer |
| --- | --- | --- |
| `bridge/core/contract.mjs` | types (JSDoc) + frozen protocol enums | ships |
| `bridge/core/inject.mjs` | `injectTemplate` — data/i18n/actions/client → HTML, auto-escaped | ships |
| `bridge/core/render.mjs` | `renderNotification` — inject → load → wait-ready | ships |
| `bridge/core/notification.mjs` | `createNotification` — show/hide lifecycle, actions, i18n, errors | ships |
| `bridge/core/template-client.mjs` | `TEMPLATE_CLIENT` — template-agnostic runtime-B glue (no selectors) | ships (runtime B) |
| `bridge/sciter/sciter-host.mjs` | `makeSciterDeps` / `showNotification` — real Sciter adapters (**C++ boundary**) | ships (Sciter) |
| `demo/templates/*.js` | `skeletonTemplate` (author base) + `notificationTemplate` (worked demo) | demo |
| `demo/build/build-bundle.mjs` + `bundle.js` | generate / hold the import-free bundle | demo tooling |

## Authoring a template (external service)

Templates and their data arrive from another service; the host binds them with
`injectTemplate(spec)` and the bridge client handles everything at runtime. A template
is **plain author HTML/CSS** plus a tiny, fixed contract — there is **no coupling to a
specific class/markup**:

1. `{{styles}}` in `<head>` — the host injects the required base CSS. It makes `<body>`
   shrink-to-fit so **the window auto-sizes to your content — no wrapper element needed**;
   write your markup straight into `<body>`. (Advanced: add `data-notify-root` to an element
   to size the window to *it* instead of the whole body.)
2. `<script>{{client}}</script>` once — the host injects [`core/template-client.mjs`](./core/template-client.mjs)
   (the bridge glue). Authors never write or maintain bridge code.
3. Host-bound text: `{{text.key}}` (localized, from `spec.i18n`) and `{{data.field}}` (raw, from
   `spec.data`). `{{lang}}` for `<html lang>`. All auto-escaped.
4. `data-action="..."` (+ optional `data-href="<url>"`) on clickable elements → emits
   `on.onAction({ id, data })`. Any number of distinct ids — all handled uniformly, no
   magic names. An action closes the window only if `spec.actions` marks it `closes: true`.
   To keep the template generic, don't hardcode the id — reference an action by **name**
   with `{{action.NAME}}`, and let the backend supply the real id:
   `<button data-action="{{action.cta}}">{{text.cta}}</button>` with
   `spec.actions: [{ name: "cta", id: "cta_click" }, …]`. (Unknown name → injection error.)

Start from [`demo/templates/skeleton-template.js`](../demo/templates/skeleton-template.js);
[`demo/templates/notification-template.js`](../demo/templates/notification-template.js) is a worked
example. The client reports ready/size (incl. dynamic re-measure via ResizeObserver)/
actions/errors automatically — no `document.querySelector` in author code.

## Loading in Sciter (the bundle)

`index.html` imports `demo/build/bundle.js` — a generated, **import-free** concatenation
of `bridge/core` + `bridge/sciter` (ship) and `demo/templates`, loaded by absolute path.
Sciter can't resolve relative module imports when the document path contains a space
(`web-view-test 2`), so a single leaf file with no inner imports is the reliable way in.
Source stays multi-file (for Node tests); **rebuild after any change**:

```
node demo/build/build-bundle.mjs
```

`test/bundle.test.mjs` fails if `bundle.js` is stale. (Node tests import the individual
modules directly, not the bundle.)

## Public API

```js
import { showNotification } from "./bridge/sciter/sciter-host.mjs";

const handle = showNotification(
  { elemWebView: document.$("webview"), win: Window },
  {
    template,                 // from ./bridge/notification-template.js (or your own token HTML)
    data: { programName: "WinZip", count: 12 },
    i18n: { en: {...}, uk: {...}, ru: {...} },
    lang: "en",
    actions: [{ name: "cta", id: "cta_click" }, { name: "close", id: "close_webview", closes: true }],
    hideAfterMs: 8000,        // optional auto-hide
    on: {
      onReady: ({ lang, width, height }) => {},
      onAction: ({ id, data }) => {},      // forward to C++ here if needed
      onClose: (reason) => {},             // user | action | auto-hide | host
      onLocalizationChanged: ({ lang }) => {},
      onError: ({ stage, message, cause }) => {},
    },
  },
);

handle.setLang("uk");          // re-render in another language
handle.update({ count: 27 });  // merge data + re-render
handle.setI18n({ en: {...} }); // merge dictionaries + re-render
handle.close();                // close (onClose reason "host")
```

For tests / non-Sciter hosts, call the core directly with your own adapters:
`createNotification({ bridge, windowCtl, scheduler }, spec)` (see `core/notification.mjs` typedefs).

## Extending

- **New action**: add a `data-action="my_action"` element to the template and include
  `{ id: "my_action" }` in `spec.actions` (add `closes: true` to auto-close). It arrives
  in `on.onAction`. No controller change needed.
- **New template token**: `{{text.KEY}}` / `{{data.FIELD}}` already cover localized + data values;
  add the key to `i18n` / `data`. New token *kinds* go in `core/inject.mjs`.
- **New protocol method/message**: add it to `core/contract.mjs` (`TO_HOST` / `TO_TEMPLATE`),
  wire a `bridge.on(...)` in `core/notification.mjs`, and emit it from the template.

## Tests

`npm test` (from `Templates/demo/`) — Node's built-in runner, zero dependencies. Manual QA:
[../../.claude/docs/notification-qa-checklist.md](../../.claude/docs/notification-qa-checklist.md).
