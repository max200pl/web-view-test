# jsBridge: Sciter ↔ WebView

> ⚠️ **ИСТОРИЧЕСКИЙ ДОКУМЕНТ (legacy mechanics).** Описывает старый self-render-поток
> (`index.html` + `Templates.js`), которые **удалены** при чистке (2026-06-09). Живой путь —
> унифицированный мост в [`Templates/bridge/`](../../Templates/bridge/) (см.
> [bridge/README.md](../../Templates/bridge/README.md) и
> [notification-bridge-contract.md](./notification-bridge-contract.md)). Этот файл сохранён
> как справка по механике маршалинга Sciter↔WebView (она не изменилась); ссылки вида
> `Templates.js:NNN` указывают на уже удалённый код — читать как историю, не как факт.

Справочный документ о том, как был устроен обмен между Sciter-хостом и встроенным
WebView в легаси-потоке. Механика маршалинга подтверждена по исходникам SDK (ниже).

Внутренняя механика маршалинга подтверждена по исходникам Sciter SDK **5.0.3.21**
(`%AVANQUEST_LIBRARIES_ROOT%\third_parties\sciter\5.0.3.21`), которые совпадают с
поставляемыми `sciter.dll` / `sciter-webview.dll`.

---

## 1. Два разных JS-рантайма

В приложении работают **два независимых движка JavaScript**. Это ключ к пониманию всего
остального — у них нет общих объектов, DOM или глобалей.

| | Рантайм **A** — Sciter | Рантайм **B** — Browser |
|---|---|---|
| Движок | `sciter.dll` (собственный JS Sciter) | `sciter-webview.dll` → WebView2 / Edge (Chromium) |
| Что исполняет | `Templates/index.html` (host-страница) | строку `templateHtml` из `Templates/Templates.js` |
| Характерные API | `document.$`, `document.on`, `Window.this.move/close/screenBox`, `elemWebView.webview.evaluateJavaScript` | стандартный DOM: `document.getElementById`, `addEventListener`, `offsetWidth`, `setInterval`, `window.jsBridgeCall`, `window.__fromSciter` |

Мост соединяет их **ровно двумя каналами**:

- **B → A** (web → Sciter): `window.jsBridgeCall(method, payload)` → обработчик `elemWebView.jsBridgeCall`
- **A → B** (Sciter → web): `elemWebView.webview.evaluateJavaScript("window.__fromSciter(<json>)")` → функция `window.__fromSciter(msg)`

Данные через границу передаются **только как JSON**. Никакие объекты/функции не шарятся.

---

## 2. Канонические файлы и эксперименты

Живой код моста — это **пара файлов**:

- [Templates/index.html](../../Templates/index.html) — host-страница Sciter (рантайм A)
- [Templates/Templates.js](../../Templates/Templates.js) — содержимое WebView, экспорт `templateHtml` (рантайм B)
- [web-view-test/projects/desktop/main-window.cpp](../../web-view-test/projects/desktop/main-window.cpp) + [desktop.cpp](../../web-view-test/projects/desktop/desktop.cpp) — C++ bootstrap

`main-window.cpp:13` жёстко грузит `Templates/index.html`, а тот импортирует `Templates.js`
(`index.html:56`). Это единственный исполняемый путь.

**НЕ канонические** (мокапы/эксперименты, не загружаются приложением, но повторяют тот же паттерн):
`Templates/index2..8.html`, `Templates/Templates.html`, `Templates/Templates2.js`,
`web-view-test/projects/desktop/index.html`, `web-view-test/projects/desktop/popup.html`.
`popup.html` полезен как референс: он показывает «правильную» сторону контракта — разбирает
ответ моста через `tryParseJson(res)`.

---

## 3. Bootstrap (C++)

1. `desktop.cpp:8` — `SciterSetOption(NULL, SCITER_SET_SCRIPT_RUNTIME_FEATURES, ALLOW_FILE_IO | ALLOW_SOCKET_IO | ALLOW_EVAL | ALLOW_SYSINFO)`. Флаги применяются к **рантайму A (Sciter)**, не к WebView. (См. §9 — они шире, чем нужно.)
2. `desktop.cpp:9` — `SCITER_SET_PX_AS_DIP = TRUE`. Влияет на единицы в `Window.this.move` (см. §8).
3. `main-window.cpp:7` — окно создаётся с флагами `SW_TITLEBAR | SW_RESIZEABLE | SW_CONTROLS | SW_MAIN | SW_ENABLE_DEBUG` (нет `SW_HIDDEN`).
4. `main-window.cpp:16-21` — `show()`: `loadHtml()` → `bind()` → `expand()`. **`expand()` делает окно видимым сразу**, ещё до того как WebView отрисуется и мост спозиционирует окно.

C++ **не определяет** `jsBridgeCall` — это целиком JS-конвенция, которую предоставляет
behavior `webview library(sciter-webview)` (`index.html:39`).

---

## 4. Канал A → B (Sciter → WebView)

Однонаправленный «выполни строку JS» pipe.

**Отправка (рантайм A), `index.html:62-66`:**
```js
function sendToTemplate(msg) {
  const js = `window.__fromSciter(${JSON.stringify(msg)})`;
  elemWebView.webview.evaluateJavaScript(js);   // fire-and-forget
}
```
`evaluateJavaScript` — **асинхронный, fire-and-forget**: возвращаемое значение
игнорируется, нет колбэка завершения, нет гарантии что `__fromSciter` уже отработал к
моменту возврата. (Подтверждено: WebView2 `ExecuteScript(js, nullptr)`.)

**Приём (рантайм B), `Templates.js:271-300`:**
```js
window.__fromSciter = function (msg) {
  if (msg?.type === "init")    { mergeI18n(msg.i18n); state.lang = msg.lang; state.payload = {...}; render(); return; }
  if (msg?.type === "setI18n") { if (mergeI18n(msg.i18n)) render(); return; }
  if (msg?.type === "setLang") { state.lang = msg.lang; render(); return; }
  if (msg?.type === "update")  { applyPayload(msg.payload); return; }
};
```
Диспетчеризация по `msg.type`. Каждая ветка мутирует локальный `state` и (кроме no-op для
неизвестного типа) вызывает `render()`. Функция всегда возвращает `undefined` — обратного
канала по этому направлению нет.

---

## 5. Канал B → A (WebView → Sciter)

**Вызов (рантайм B), `Templates.js:243-251`:**
```js
async function safeCall(method, payload) {
  if (!window.jsBridgeCall) { log("❌ jsBridgeCall not found"); return; }
  const res = await window.jsBridgeCall(method, payload);   // ДВА позиционных аргумента
  log("➡️ " + method + " " + JSON.stringify(payload));
  log("⬅️ " + JSON.stringify(res));
}
```
`window.jsBridgeCall` **не определён в коде** — его инжектит shim `sciter-webview`. Возвращает
Promise, поэтому `await` работает.

**Обработчик (рантайм A), `index.html:69-177`:**
```js
elemWebView.jsBridgeCall = (params) => {        // ОДИН аргумент — массив!
  try {
    const method  = params?.[0];                // index.html:71
    const payload = params?.[1];                // index.html:72
    switch (method) {
      case "template:onReady": /* … setTimeout(0) → sendToTemplate(init) */ return JSON.stringify({ ok: true });
      case "template:onAction": /* close_webview → Window.this.close(); cta_click → log */ return JSON.stringify({ ok: true });
      case "template:onSize":   /* screenBox + clamp → Window.this.move(); state = WINDOW_SHOWN */ return JSON.stringify({ ok: true });
      default: return JSON.stringify({ ok: false, error: "Unknown method", method });
    }
  } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); }
};
```

⚠️ **Важная асимметрия аргументов.** Web вызывает с **двумя** позиционными аргументами
`(method, payload)`, а обработчик получает **один** массив `params`, где `params[0]=method`,
`params[1]=payload`. Это не баг — так документировано в SDK: shim пакует **все** аргументы
вызова в один массив (`Array.prototype.slice.call(arguments)`), а Sciter передаёт этот
массив целиком как единственный аргумент. Поэтому `params?.[0]`/`params?.[1]` — корректный
паттерн.

---

## 6. Внутренняя механика маршалинга (по SDK 5.0.3.21)

Полный путь одного `window.jsBridgeCall("m", p)`:

1. **B:** shim строит `window.external.invoke(JSON.stringify({id:seq, method:"m", params:[<все аргументы>]}))` и возвращает Promise, сохраняя `resolve/reject` в `window._rpc[seq]` (`sciter_webview.h:526-571`).
2. **Транспорт:** `window.external.invoke` = `window.chrome.webview.postMessage(...)` (Edge backend, `sciter_edgewebview.cpp:254`).
3. **Native:** сообщение приходит в `WebMessageReceived` → `on_message`, который парсит `id/method/params` (`sciter_webview.h:649-658`).
4. **В рантайм A:** `bindSciterJSCall` (`behavior_webview.cpp:161-173`) парсит массив `params` в `sciter::value` и вызывает `self.call_method("jsBridgeCall", <массив>)` — **весь массив одним аргументом**. Это и есть `params` в обработчике.
5. Обработчик исполняется **синхронно** относительно native-вызова; его возврат берётся через `.to_string()`.
6. **Назад в B:** `resolve(seq, …, result)` (`sciter_webview.h:591-614`, `dispatch_async=true`) **асинхронно** выполняет `window._rpc[seq].resolve(<result>)`. Это и резолвит `await` на стороне web.

🔑 **Следствие для возвращаемых значений.** В шаге 6 `result` подставляется в eval **как есть,
без `JSON.parse`**. Обработчик возвращает `JSON.stringify({ok:true})` → web получает
**строку** `"{\"ok\":true}"`, а **не** объект. Чтобы прочитать `res.ok`, web-сторона обязана
сделать `JSON.parse(res)` (как делает `popup.html` через `tryParseJson`). Текущий
`safeCall` этого не делает — только логирует, поэтому `{ok/error}`-контракт фактически
не используется (см. §9, пункт 1).

Транспорт на Windows — **Edge WebView2 (Chromium)**, не IE. Поэтому в рантайме B
безопасны современные `async/await`, `Promise`, `addEventListener`.

---

## 7. Контракт сообщений

### B → A — через `window.jsBridgeCall(method, payload)`
Обработчик: `index.html:69-177`. Все ветки возвращают строку `JSON.stringify({ ok: … })`.

| method | payload | Эффект на стороне Sciter |
|---|---|---|
| `template:onReady` | `{ lang, ts }` | Планирует `setTimeout(0)` → `sendToTemplate({type:"init", …})`. Возвращает `{ok:true}`. (`index.html:77-112`) |
| `template:onSize` | `{ width, height }` (CSS-px карточки `.card`) | `screenBox("workarea")` → clamp (`w≥200, h≥120`) → bottom-right → `Window.this.move(x,y,w,h)` + `state = WINDOW_SHOWN`. (`index.html:127-162`) |
| `template:onAction` | `{ action: "close_webview" }` | `Window.this.close()`. (`index.html:115-118`) |
| `template:onAction` | `{ action: "cta_click", lang }` | Только `console.log`. (`index.html:120-123`) |
| *(любой другой)* | — | `{ ok: false, error: "Unknown method", method }`. |

### A → B — через `evaluateJavaScript("window.__fromSciter(<json>)")`
Сборка: `sendToTemplate`, `index.html:62-66`. Приём: `Templates.js:271-300`. Тегированный
union по `msg.type`.

| type | поля | Эффект на стороне WebView |
|---|---|---|
| `init` | `{ lang, i18n:{en,uk,ru:{title,subtitle,counter,switch}}, payload:{programName,count} }` | `mergeI18n` + set `lang` + merge `payload` + `render()`. (`Templates.js:274-280`) |
| `setLang` | `{ lang }` | `state.lang = lang` + `render()`. (`Templates.js:290-294`) |
| `setI18n` | `{ i18n:{…} }` | `mergeI18n` (поверхностный merge по языкам/ключам) + `render()`. (`Templates.js:282-288`) |
| `update` | `{ payload:{…} }` | `applyPayload` (поверхностный merge) + `render()`. (`Templates.js:296-299`) |

Источники A → B сообщений: ветка `template:onReady` (init) и кнопки панели
`#langEN/#langUK/#langRU` (setLang), `#updatePayload` (update), `#updateI18n` (setI18n) —
`index.html:190-226`.

---

## 8. Жизненный цикл (happy path)

Каждая стрелка — асинхронная граница:

```
expand() [окно уже ВИДИМО]                                  (C++, main-window.cpp:20)
  → webview-ready                                           (index.html:180)
  → webview.loadHtml(templateHtml)                          (index.html:182)
  → [B] eval скрипта: определяется window.__fromSciter      (Templates.js:271)
  → [B] window 'load'                                       (Templates.js:253)
  → B→A  jsBridgeCall("template:onReady")                   (Templates.js:254)
  → [A] setTimeout(0)                                       (index.html:81)
  → A→B  evaluateJavaScript → __fromSciter({type:"init"})   (index.html:63)
  → [B] render()                                            (Templates.js:278)
  → [B] requestMeasure → setTimeout(0) → reportCardSize     (Templates.js:195-203)
  → B→A  jsBridgeCall("template:onSize", {w,h})             (Templates.js:192)
  → [A] Window.this.move(...) + state = WINDOW_SHOWN        (index.html:158-159)
```

Окно **видимо с первого шага** (из-за `expand()`), но **корректно спозиционировано/
размерено только на последнем**. См. диаграмму: [.claude/sequences/jsbridge-flow.mmd](../sequences/jsbridge-flow.mmd).

**Почему порядок надёжен:** `window.__fromSciter` присваивается при синхронном выполнении
inline-скрипта (`Templates.js:271`), которое всегда завершается **до** события `load`,
которое и инициирует `onReady` → `init`. Поэтому к приходу `init` функция уже определена.
RPC-shim (`window.jsBridgeCall`) инжектится через `AddScriptToExecuteOnDocumentCreated`,
т.е. до `window.onload`, поэтому вызов из `load`-хендлера безопасен.

---

## 9. Sizing и позиционирование окна

`reportCardSize` (`Templates.js:181-193`) читает `card.offsetWidth/offsetHeight`, дедуплицирует
по `__lastSizeKey` (`"WxH"`) и шлёт `template:onSize`. На стороне Sciter
(`index.html:127-162`) вычисляется bottom-right позиция в рабочей области и вызывается
`Window.this.move`.

**Единицы измерения смешаны** (актуально для не-100% DPI / нескольких мониторов):
- `card.offsetWidth` — **CSS-px** WebView;
- `Window.this.screenBox("workarea","dimension", true)` — третий аргумент `true` → **физические пиксели**;
- `Window.this.move(...)` без флага ppx — **DIP** (т.к. `SET_PX_AS_DIP=TRUE`).

При 100% DPI все три совпадают численно; при 150/200% или мультимониторе позиционирование
поплывёт. `margin`/`framePad` захардкожены в `0`, рамка/тень окна не учитываются. Верхней
границы у `w/h` нет (только нижняя `200×120`).

---

## 10. Известные ограничения и подводные камни

Все пункты подтверждены по исходникам (с учётом скорректированных формулировок и severity).

1. **Возврат моста — строка, web её не парсит (low).** Обработчик возвращает
   `JSON.stringify(...)`; мост доставляет это как **строку**; `safeCall` (`Templates.js:248-250`)
   только логирует `JSON.stringify(res)` (двойное кодирование) и никогда не делает
   `JSON.parse`. Контракт `{ok/error}` (включая `Unknown method` и ветку `catch`) фактически
   мёртв. Чинится одним из двух способов: вернуть из обработчика нативный объект **или**
   делать `JSON.parse(await …)` на web-стороне (как `popup.html`). Не оба сразу.

2. **Вспышка/прыжок окна при старте (high — UX).** `expand()` (`main-window.cpp:20`) показывает
   окно сразу, на дефолтной геометрии (`window-width/height="max-content"`); реальная позиция
   bottom-right применяется только в конце цепочки в `onSize` (`index.html:158`). Пользователь
   видит, как окно появляется и затем «прыгает». `state = WINDOW_SHOWN` (`index.html:159`) —
   избыточно, окно уже показано. Фикс: создавать окно скрытым и показывать только в `onSize`.
   ⚠️ Это **не** «окно невидимо навсегда» — оно всегда видимо; дефект в неправильной геометрии
   до завершения цепочки (и если цепочка прервётся — окно останется на дефолтной геометрии).

3. **`evaluateJavaScript` инжектит данные в исходник JS (latent, потенциально high).**
   `index.html:63` интерполирует `JSON.stringify(msg)` прямо в исполняемую строку.
   `JSON.stringify` **не является безопасным экранированием для JS-исходника**: U+2028/U+2029
   не экранируются (на ES2019+/Chromium это легально и не ломает парсинг, но это
   анти-паттерн). Сейчас **не эксплуатируется** — все значения захардкожены. Но **до** того
   как через `sendToTemplate` пойдёт любое динамическое/недоверенное значение (имя программы
   из ОС, строка из файла, данные с сервера), нужно: либо структурированный канал, либо
   экранировать U+2028/U+2029, либо передавать как один JSON-аргумент с `JSON.parse` внутри.
   Инъекция исполнялась бы в рантайме B; до хоста достижимы только `close()`/`move()`.

4. **Слишком широкие `SCRIPT_RUNTIME_FEATURES` (medium).** `desktop.cpp:8` глобально даёт
   рантайму A `ALLOW_FILE_IO | ALLOW_SOCKET_IO | ALLOW_EVAL | ALLOW_SYSINFO`, хотя host-страница
   ничего из этого не использует. Нарушение least-privilege. Снимать по одному и тестировать
   (особенно `ALLOW_EVAL` — может задеть внутренние пути движка).

5. **Web-контент управляет окном хоста при слабой валидации (medium).** `close_webview` →
   `Window.this.close()`; `onSize` → `move()` с `width/height` от web. Только нижняя граница
   (`200×120`), нет верхней; нет rate-limit. Сейчас latent (контент статичный, first-party).

6. **Тихие ошибки / нет наблюдаемости (low).** Хост сворачивает исключения в `{ok:false}`-строку
   (`index.html:171-176`), web её игнорирует; `evaluateJavaScript` результат отбрасывает.
   Любой сбой (плохой payload, исключение в `move/screenBox`, неизвестный метод, ошибка eval)
   превращается в строку лога, и поток продолжается как будто всё ок. **Исключения, брошенные
   внутри `setTimeout(0)`-колбэка инициализации (`index.html:81-110`), вообще вне `try/catch`.**

7. **`setLang` без валидации (low).** `Templates.js:291` присваивает `state.lang = msg.lang`
   без проверки по `state.i18n`. UI слать не может (только en/uk/ru), но любой будущий вызов
   с неизвестным кодом тихо упадёт на английский fallback (`Templates.js:171-172`). Бланка/raw-ключей
   не будет, пока существует `en`.

8. **`setI18n` — поверхностный merge (low, by-design).** `mergeI18n` (`Templates.js:166`)
   сохраняет старые значения для отсутствующих ключей; языки, не пришедшие в апдейте (напр.
   `uk` из кнопки `#updateI18n`), остаются со старым текстом. Для полной замены — слать полный
   набор ключей или заменять словарь целиком. (Перерисовка при этом **происходит** — это не
   баг отсутствующего render.)

9. **Нет teardown / correlation-id / версии протокола (info).** Оба направления без id,
   sequence, версии; нет сообщения «webview закрывается» в паре с `close()`. `setInterval`
   (`Templates.js:225`) и resize-listener живут весь lifetime страницы, не снимаются.

10. **Перезагрузка WebView повторяет onReady/onSize, репозиционирует окно (low, latent).**
    `webview-ready` грузит `templateHtml` без once-guard; повторный `onSize` снова двигает окно
    в bottom-right, перекрывая позицию, куда пользователь его перетащил. Сейчас нет канонического
    триггера перезагрузки (Ctrl+F5 в `main-window.cpp:25-30` — пустая заглушка).

11. **`height: 100%%` — невалидный CSS (low).** `index.html:31` содержит двойной процент —
    опечатка (не format-escape, форматирования строки в проекте нет). Sciter игнорирует правило;
    замаскировано тем, что лэйаут держится на `size:*`. Исправить на `100%` или `*`.

> Опровергнутые при проверке «баги» (мифы — не вносить как дефекты): «окно невидимо навсегда»;
> «дедуп `__lastSizeKey` рвёт легитимные ресайзы / приводит к рассинхрону»; «первый замер
> перманентно дедуплицируется и блокирует показ / Apply payload не растит окно / контент
> клипается»; «params ломается при 0/не-массив аргументах» (массив гарантирован SDK);
> «init race: eval до определения `__fromSciter`» (порядок гарантирован синхронным eval).

---

## 11. Как добавить новый метод/сообщение

**Новый вызов web → Sciter:**
1. В рантайме B: `await safeCall("template:myMethod", { … })`.
2. В рантайме A: добавить `case "template:myMethod":` в `switch` (`index.html:76`); вернуть
   `JSON.stringify({ ok: true, … })`.
3. Если нужен результат — на web-стороне разобрать его `JSON.parse(res)` (см. §10.1).

**Новое сообщение Sciter → web:**
1. В рантайме A: `sendToTemplate({ type: "myType", … })`.
2. В рантайме B: добавить ветку `if (msg?.type === "myType") { …; render(); return; }` в
   `window.__fromSciter` (`Templates.js:271`).
3. Помнить: это fire-and-forget, подтверждения доставки нет.
