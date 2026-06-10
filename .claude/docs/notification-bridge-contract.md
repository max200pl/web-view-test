# Контракт notification-моста (Sciter ↔ WebView)

Определение и документация API моста для показа HTML-уведомлений. **Шаг 2** плана.
Здесь — *что* мост принимает и отдаёт; *как* он это делает, добавляется по шагам 3–8.

- Канонические enum'ы + JSDoc-типы (single source of truth): [../../Templates/bridge/contract.js](../../Templates/bridge/contract.js)
- Целевая sequence-диаграмма: [../sequences/notification-bridge-flow.mmd](../sequences/notification-bridge-flow.mmd)
- Механика двух каналов (как уже работает сегодня): [jsbridge.md](./jsbridge.md)

**Scope = JS-only.** Мост живёт на стороне Sciter-хоста (рантайм A, `index.html`). Данные
уведомления приходят из host-JS; **C++ не меняется**. Внутри мост гоняет WebView-шаблон
(рантайм B) по тем же двум каналам, что и сейчас.

---

## Публичный API

```js
const handle = showNotification(spec); // spec: NotificationSpec -> NotificationHandle
```

### Вход — `NotificationSpec`

| Поле | Тип | Назначение | Wire-маппинг |
| --- | --- | --- | --- |
| `template` | `string` | HTML, который рендерится в WebView (рантайм B) | контент `loadHtml` |
| `data` | `Object` | значения для подстановки в i18n-строки через `{key}` | wire-поле `payload` |
| `actions` | `NotificationAction[]` | какие действия шаблон может прислать (+ флаг `closes`) | `template:onAction` |
| `i18n` | `I18nDict` | словари локализации `{ lang: { key: "…" } }` | `init.i18n` / `setI18n` |
| `lang` | `string` | стартовый язык (default `"en"`) | `init.lang` / `setLang` |
| `hideAfterMs` | `number` | авто-скрытие (мс); falsy = без авто-скрытия | **host-таймер**, без wire |
| `on` | `NotificationCallbacks` | колбэки жизненного цикла (выход моста) | — |

### Выход — `NotificationCallbacks`

| Колбэк | Когда | Аргумент |
| --- | --- | --- |
| `onReady` | шаблон загружен, отрисован и измерен | `{ lang, width, height }` |
| `onAction` | пользователь активировал действие | `{ id, data }` |
| `onClose` | окно закрылось | `reason` ∈ `user` / `action` / `auto-hide` / `host` |
| `onLocalizationChanged` | сменился активный язык | `{ lang }` |
| `onError` | сбой на любом этапе | `{ stage, message, cause? }` |

Каждый колбэк вызывается в `try/catch`: брошенное из него исключение уходит в `onError`
со `stage: "callback"`, а не ломает мост.

### Управление открытым уведомлением — `NotificationHandle`

| Метод | Эффект | Wire |
| --- | --- | --- |
| `setLang(lang)` | сменить язык | `setLang` (A→B) |
| `setI18n(i18n)` | merge/replace словарей | `setI18n` (A→B) |
| `update(data)` | merge данных + перерисовка | `update` (A→B) |
| `close()` | закрыть окно (→ `onClose("host")`) | host закрывает Window |

---

## Wire-протокол (два канала)

Полные значения — в `contract.js` (`TO_HOST`, `TO_TEMPLATE`). Что **уже живёт** сегодня —
в `LIVE` (тесты следят за соответствием реальным рантаймам).

**B → A** (`window.jsBridgeCall(method, payload)`): `template:onReady`, `template:onSize`,
`template:onAction`, `template:onError` *(планируется, Шаг 8 — пока не подключён)*.

**A → B** (`__fromSciter({type})`): `init`, `setLang`, `setI18n`, `update`.

---

## Injection-слой (Шаг 3 ✅)

Чистый модуль [../../Templates/bridge/inject.js](../../Templates/bridge/inject.js):
`injectTemplate(spec) -> HTML`. Подставляет локализацию, данные и действия в HTML по
токенам (двойные фигурные скобки), single-pass:

| Токен | Раскрывается в |
| --- | --- |
| `{{text.KEY}}` | `i18n[lang][KEY]` (fallback `en` → сам ключ) + интерполяция `{field}` из `data`, HTML-escape |
| `{{data.FIELD}}` | `data[FIELD]` (нет → `""`), HTML-escape |
| `{{lang}}` | активный язык, HTML-escape |
| `{{actions}}` | JSON-массив id действий, escape для `<script>` |
| `{{client}}` | код bridge-клиента (`template-client.js`) как есть — внутрь `<script>` |
| что-либо ещё | `InjectionError` (stage `injection`) → показать ничего |

**Внешние шаблоны + данные.** Шаблон и его данные приходят из другого сервиса; хост биндит
их через `injectTemplate(spec)` (`{{text.*}}` / `{{data.*}}`). Привязка шаблона к мосту —
**минимальная и без хардкод-селекторов**: один `data-notify-root` (по нему меряется окно),
`{{client}}` один раз в `<script>` (хост подставляет агностик-клиент `template-client.js`),
`data-action="<id>"` на кликабельных. Старт для авторов — `bridge/skeleton-template.js`
(см. `bridge/README.md` → «Authoring a template»).

Гарантии: (1) все подставляемые значения экранируются — закрыт латентный риск инъекции из
[jsbridge.md §10.3](./jsbridge.md); (2) замена в один проход, поэтому данные не могут протащить
токен. Живой `templateHtml` токенов не содержит → `injectTemplate` возвращает его без изменений
(подключение к рантайму — Шаг 4). Юнит-тесты: `Templates/test/inject.test.mjs`.

## Render-слой (Шаг 4 ✅)

[../../Templates/bridge/render.js](../../Templates/bridge/render.js):
`renderNotification(adapter, spec) -> Promise`. Делает `inject -> loadHtml -> ждать ready`,
**render отделён от show** (show — Шаг 5). Sciter-специфика спрятана за маленьким
`WebViewAdapter` (`loadHtml`, `onReady`), поэтому оркестрация юнит-тестируется в Node с
mock-адаптером. Гарантии: слушатель `ready` ставится **до** `loadHtml`; промис резолвится
**только** после ready; ошибка инъекции **отклоняет промис, ничего не загрузив**.

Pre-render-шаблон: [../../Templates/bridge/notification-template.js](../../Templates/bridge/notification-template.js)
(токены вместо in-WebView i18n/render). Работает **параллельно** легаси-демо (`index.html`
по-прежнему грузит `Templates.js`) — слияние в Шаге 9. Тесты: `Templates/test/render.test.mjs`,
`Templates/test/notification-template.test.mjs`.

## Lifecycle-контроллер (Шаг 5 ✅)

[../../Templates/bridge/notification.js](../../Templates/bridge/notification.js):
`createNotification({bridge, windowCtl, scheduler}, spec) -> NotificationHandle`. Инварианты:
**show только** после render-ready **и** первого `onSize`; позиция bottom-right с clamp
`200x120`; `hideAfterMs` → таймер авто-скрытия; `close(reason)` идемпотентен и всегда даёт
ровно один `onClose`. Реальные Sciter-вызовы (`Window.this.move/close/state`, `screenBox`)
и `setTimeout` спрятаны за `windowCtl` / `scheduler`, поэтому всё юнит-тестируется
(`Templates/test/notification.test.mjs`, 11 тестов: show-after-render, авто-скрытие,
manual/action/host close, идемпотентность, независимость инстансов).

## Action-routing (Шаг 6 ✅)

`template:onAction {action, href?, ...}` → контроллер шлёт `on.onAction({id, data})`
(где `data` = payload без `action`) для **любого** клика — **никаких зашитых/магических
id** (`cta_click`/`close_webview` — обычные пользовательские id, кликов может быть много
разных). Окно закрывается **только** если действие объявлено в спеке `actions[].closes:true`.
Действия после `close` игнорируются. `on.onAction` — это **JS-шов**, где будущая C++-интеграция перехватит
действие и вернёт его в нативный код («return action to C++»). Link-действия несут `href`
через `data-href` в шаблоне. Тесты: `Templates/test/actions.test.mjs`
(primary / secondary-closes / close / link / after-close).

## Локализация / обновление (Шаг 7 ✅)

В pre-render-модели контент — статичный HTML, поэтому смена языка/данных = **re-inject +
reload** через тот же `loadHtml` (новый канал не нужен). `handle`:

- `setLang(lang)` — сменить язык, перерисовать, `on.onLocalizationChanged({lang})`;
- `setI18n(i18n)` — per-language shallow merge словарей, перерисовать;
- `update(data)` — merge данных, перерисовать.

Гарантия «не сломать текущую нотификацию»: reload **не закрывает и не двигает** окно (guard
`shown` блокирует повторный show, `move` при reload не вызывается). Отсутствующий ключ/язык
— мягкий fallback (`lang → en → ключ`), без ошибки. Апдейты после `close` игнорируются.
Тесты: `Templates/test/localization.test.mjs`.

## Обработка ошибок (Шаг 8 ✅)

Каждый сбой уходит в `on.onError({stage, message, cause})` и **не пробрасывается** наружу
контроллера; broken-нотификация не показывается. Стадии и их источники:

| stage | когда |
| --- | --- |
| `injection` | `injectTemplate` упал на первичном рендере (невалидный шаблон/типы) |
| `render` | reject рендера; либо `template:onError` от runtime B (try/catch в шаблоне) |
| `window-create` | `windowCtl.move/show` бросил → окно НЕ помечается shown, авто-скрытие не ставится |
| `callback` | пользовательский колбэк (`onReady`/`onAction`/…) бросил |
| `localization` | reload при `setLang/setI18n/update` упал |
| `auto-hide` | `close` по таймеру упал (но `onClose` всё равно эмитится) |

Сам `on.onError` обёрнут — бросок из него не ломает мост. Benign-входы (пустой `data`,
отсутствующий ключ i18n) — **не** ошибка (мягкий fallback). Тесты: `Templates/test/errors.test.mjs`.

## Что есть сегодня vs. что добавляет контракт

| Возможность | Сейчас (`index.html`/`Templates.js`) | По контракту |
| --- | --- | --- |
| Источник данных | захардкожен в ветке `onReady` | приходит в `spec` |
| `template` | один импортированный `templateHtml` | произвольный HTML из `spec.template` |
| Локализация | inline-словари + кнопки панели | `spec.i18n` + `handle.setLang/setI18n` |
| Авто-скрытие | **нет** | `spec.hideAfterMs` (host-таймер, Шаг 5) |
| Колбэки наружу | нет (всё внутри обработчика) | `onReady/onAction/onClose/onLocalizationChanged/onError` |
| Ошибки | глотаются в `{ok:false}`-строку | структурно через `onError` (Шаг 8) |
| Возврат `{ok}` моста | строка, web её не парсит (мёртв) | внутренняя деталь; контракт — через колбэки |

---

## Статус реализации

| Шаг | Что | Статус |
| --- | --- | --- |
| 2 | Определение контракта + JSDoc + диаграмма | ✅ этот документ + `contract.js` |
| 3 | Injection: `template + data + i18n` → HTML | ✅ `inject.js` + 16 юнит-тестов |
| 4 | Render в WebView, ждать готовности | ✅ `render.js` + `notification-template.js` + 9 тестов |
| 5 | Show/hide lifecycle (+ `hideAfterMs`) | ✅ `notification.js` + 11 тестов |
| 6 | Click-колбэки (`onAction`) | ✅ routing в `notification.js` + 5 тестов |
| 7 | Обновление локализации | ✅ `setLang/setI18n/update` + 7 тестов |
| 8 | Обработка ошибок (`onError`, `template:onError`) | ✅ полная таксономия в `notification.js` + 8 тестов |
| 9a | Чистка API + `sciter-host.js` + README + регрессия | ✅ JS-финализация (live не тронут) |
| 9b | Слияние нового моста в `index.html` (live) | ✅ **подтверждено в desktop.exe** (грузится `bridge/bundle.js`) |

`showNotification` пока бросает `"not implemented"` — это намеренно (контракт без поведения).
