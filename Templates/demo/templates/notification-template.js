// Demo notification template — a worked example built on the skeleton contract
// (see skeleton-template.js). Shows the minimal coupling in practice:
//   - one `data-notify-root` element (window sizes to it),
//   - host-bound text via {{text.*}} / {{data.*}},
//   - `data-action` on buttons,
//   - required base CSS via {{styles}} + bridge glue via {{client}} (NO hardcoded selectors here).
//
// Tokens consumed by injectTemplate: {{lang}} {{styles}} {{text.title}} {{text.subtitle}}
// {{text.counter}} {{text.cta}} {{text.close}} {{data.count}} {{action.cta}} {{action.close}} {{client}}.

export const notificationTemplate = `
<html lang="{{lang}}">
  <head>
    <meta charset="utf-8" />
    {{styles}}
    <style>
      html, body { font-family: system-ui; color: black; }
      .card { border: 1px solid #ddd; border-radius: 12px; padding: 16px; width: 450px; background: white; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }
      .row { display: flex; gap: 10px; flex-wrap: wrap; }
      button { padding: 10px 12px; border-radius: 10px; cursor: pointer; }
      .badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; background: #efefef; font-size: 12px; }
      .dot { width: 10px; height: 10px; border-radius: 999px; background: #10b04a; }
      .title { margin: 0; color: black; }
      .subtitle { margin: 0; font-size: 14px; color: #333; }
    </style>
  </head>
  <body>
    <!-- content straight in <body> (no wrapper); body is shrink-to-fit via {{styles}} -->
    <div class="card">
      <h3 class="title">{{text.title}}</h3>
      <div class="badge"><span class="dot"></span><span>{{text.counter}}</span> <b>{{data.count}}</b></div>
      <p class="subtitle">{{text.subtitle}}</p>
      <div class="row">
        <button data-action="{{action.cta}}">{{text.cta}}</button>
        <button data-action="{{action.close}}">{{text.close}}</button>
      </div>
    </div>

    <script>{{client}}</script>
  </body>
</html>
`;
