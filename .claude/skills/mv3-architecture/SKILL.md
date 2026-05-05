---
name: mv3-architecture
description: Manifest V3 lifecycle, alarms, message passing, persisted state, Shadow DOM injection. Используй когда работаешь с background SW, content scripts или RPC.
---

# Manifest V3 — что знать для PriceWatch

## Service worker lifecycle

- SW в MV3 **не персистентный**. Засыпает после ~30 секунд бездействия. Просыпается на событие (`onMessage`, `alarms.onAlarm`, `runtime.onInstalled` и т.д.).
- **Никаких `setInterval`/`setTimeout` для долгоживущих штук.** Они умрут вместе со SW.
- Глобальные переменные модуля **не сохраняются** между «жизнями» SW. Если состояние нужно — пиши в `chrome.storage.session` (быстро, in-memory) или `chrome.storage.local` / IndexedDB (на диск).

В коде:
- `src/background/index.ts` — entrypoint. Только регистрация listener'ов.
- `src/background/handlers.ts` — обработчики RPC. Чистые функции от состояния (Dexie). При первом обращении Dexie откроет соединение.
- `db()` в `src/data/db.ts` — singleton, ленивый. Безопасно вызывать после "пробуждения".

## Message passing

Пользуемся типизированной обёрткой `sendRpc<K>(...)` из `src/shared/rpc.ts`. Не вызывай `chrome.runtime.sendMessage` напрямую — потеряешь типы.

Правила:
- Handler в background **должен вернуть Promise**. Слушатель в `index.ts` возвращает `true`, чтобы канал не закрылся (см. реализацию).
- Никогда не передавай функции / DOM-узлы / классы в payload — только сериализуемое.
- Ошибки оборачиваем в `{ ok: false, error: string }`. Не throws через runtime.

## Content scripts

- Запускаются в **isolated world** — JS не пересекается со страницей, но DOM общий.
- Стили страницы влияют на твои узлы, твои стили могут сломать страницу. Решение — **Shadow DOM**.
- `chrome.runtime.sendMessage` и `chrome.runtime.onMessage` доступны.
- Не пиши в `chrome.storage.sync` из content script — это внешний контекст, лучше через RPC.

## Shadow DOM injection (наш паттерн)

```ts
const host = document.createElement('div');
host.style.all = 'initial';        // полный сброс наследуемых стилей
const shadow = host.attachShadow({ mode: 'open' });
const mount = document.createElement('div');
shadow.appendChild(mount);
anchor.insertAdjacentElement('afterend', host);
createRoot(mount).render(<Component />);
```

`mode: 'open'` — чтобы тестировать через `host.shadowRoot.querySelector(...)`. Безопасностно это нормально, мы не прячем секреты.

`style.all = 'initial'` — критично, иначе сайт может задать `display: none` / `position: absolute` нашему хосту.

## Tailwind в Shadow DOM

Tailwind работает в Shadow DOM, **но только если ты импортируешь CSS внутрь shadow root**. Снаружи стили Shadow не видят. Варианты:

1. **Inline-styles** в компоненте (как в `TrackButton.tsx`) — самое простое, без зависимости от build pipeline. Подходит для одного-двух компонентов.
2. **Импорт CSS как строки** через `?inline` в Vite, потом `shadow.appendChild(<style>{css}</style>)`. Подходит когда компонентов много.

В MVP пользуемся inline-styles. При росте сложности UI — переходим на вариант 2.

## SPA-навигация (history API)

Большинство современных сайтов — SPA. URL меняется через `history.pushState`/`replaceState` без перезагрузки. Content script загружается **один раз** на старте — нужно отслеживать смены URL вручную.

Решение в `src/parsers/base.ts`:
- `ensureSpaPatched()` патчит `history.pushState`/`replaceState` (один раз) и эмитит `pricewatch:locationchange` событие.
- Также слушает `popstate`.
- `makeSpaWatcher()` — фабрика подписчиков на это событие.

Между «деинжектом» старой кнопки и инжектом новой — **жди ~600 мс**, чтобы сайт успел отрендерить новую цену. Иначе поймаешь старую цену с предыдущей карточки.

## Alarms (для V1)

```ts
chrome.alarms.create('pricewatch:tick', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'pricewatch:tick') return;
  await processQueue();
});
```

- Минимальный интервал — 1 минута (в продакшене). В dev — 0.5.
- Alarm пробуждает SW, даже если он спал.
- НЕ опираемся на «alarm точно сработает в N минут» — это лучше-чем-ничего гарантия, может задержаться.

## Persisted state для очереди задач

Когда дойдём до scheduler:
- `chrome.storage.session` — RAM-storage, доступен только воркеру + UI этого расширения, теряется при перезапуске Chrome. Идеально для очереди в работе.
- `chrome.storage.local` — на диске, переживает перезапуск. Используем для конфига очереди (последний tick и т.п.).
- IndexedDB — для собственно `Product` / `PricePoint`. Не для оперативного состояния очереди.

## Permissions (минимум)

Текущие в `manifest.config.ts`:
- `storage` — настройки.
- `alarms` — для scheduler V1.
- `notifications` — `chrome.notifications.create`.
- `tabs` — для `chrome.tabs.create({active:false})` в scheduler V1 + чтения активной вкладки в popup.

Не добавляй permission'ы «на всякий случай». Каждый — это galочка в Web Store review и в UX user trust.

## Host permissions

```
https://*.ozon.ru/*
https://*.wildberries.ru/*
https://market.yandex.ru/*
```

Ничего больше. Никаких `<all_urls>` или `https://*/*` — это сразу красный флаг для review.

## Тестирование расширения локально

1. `pnpm build` → создаст `dist/`.
2. `chrome://extensions` → Developer mode → Load unpacked → выбрать папку `dist/`.
3. `pnpm dev` тоже работает: CRXJS делает HMR + auto-reload расширения.
4. После изменения `manifest.config.ts` — придется снять/поставить расширение заново.

## Дебаг

- **Background SW**: chrome://extensions → ваше расширение → Service worker (link).
- **Content script**: DevTools открытой страницы → Sources → Content scripts.
- **Popup**: правый клик на иконку → Inspect popup.
- **Dashboard**: открой `chrome-extension://<id>/src/dashboard/index.html` → DevTools как обычная страница.

## Что НЕ делаем в MV3

- Не используем `chrome.extension.getBackgroundPage()` — нет в MV3.
- Не пихаем библиотеки, которые требуют `eval` / `new Function()` (CSP запретит).
- Не используем remote-loaded code (запрещено в MV3 Web Store).
