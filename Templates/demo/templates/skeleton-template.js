// Minimal notification template — the starting point a template author (in the
// external service) copies and builds inside. Maximally simple, minimal coupling.
//
// The whole bridge contract for a template is just:
//   1. `{{styles}}` in <head> (host injects the required base CSS — the window sizes
//      to content automatically; NO wrapper element needed);
//   2. `{{client}}` once before </body> (host injects the bridge glue);
//   3. host-bound text via {{text.key}} (localized) / {{data.field}} (raw data); {{lang}} on <html>;
//   4. `data-action="<id>"` (+ optional `data-href`) on clickable elements.
//
// Write your content straight into <body>. (Advanced: add `data-notify-root` to an
// element to size the window to it instead of the whole body.) Template + data arrive
// from the external service and the host injects them (see inject.mjs / README).

export const skeletonTemplate = `
<html lang="{{lang}}">
  <head>
    <meta charset="utf-8" />
    {{styles}}
    <!-- add your own content styles here -->
  </head>
  <body>
    <!-- Your notification markup goes here. Bind values with tokens (do NOT write
         token examples with real double-braces in comments — the injector resolves
         them anyway). See bridge/README.md "Authoring a template":
           text.KEY   = localized text       data.FIELD = raw data value
           action.NAME = an action id, for data-action="...". E.g. a button is
           <button data-action=" action.cta "> text.cta </button>  (drop the spaces, add braces) -->

    <!-- Bridge client (host-injected; do not edit). -->
    <script>{{client}}</script>
  </body>
</html>
`;
