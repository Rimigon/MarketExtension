# PriceWatch — рабочая инструкция для Claude Code

Browser extension (Manifest V3) для отслеживания цен на Ozon / Wildberries / Яндекс Маркете.
Подробный PRD — `~/.claude/plans/senior-product-prancy-beaver.md`. Этот файл — операционная инструкция для самой работы с кодом.

## Быстрая сводка

- **Цель**: добавление товара в отслеживание прямо со страницы карточки + локальная история цен + аналитика и уведомления.
- **Принцип**: local-first. IndexedDB через Dexie. Никакого бэкенда в MVP.
- **MVP scope**: сначала Ozon end-to-end → потом Wildberries + Я.Маркет. Сейчас сделано: Ozon (DOM/JSON-LD парсер), Wildberries (через JSON-API `u-card.wb.ru`), Я.Маркет (DOM/JSON-LD).
- **Локализация**: RU-only в MVP (i18n-структура заложена).
- **Дистрибуция**: dev/unpacked. Web Store — после стабилизации.
- **Стек**: Manifest V3 · TypeScript 5 (strict) · React 18 · Vite + @crxjs/vite-plugin · Dexie 4 · Zustand · Tailwind 3 · Recharts · Vitest.
- **Шрифты**: Manrope (sans) + JetBrains Mono (data/prices) лежат локально в `public/fonts/` (latin + cyrillic, 400/500/700). Никаких runtime-запросов к CDN.

## Команды

```bash
pnpm install        # установка
pnpm dev            # vite dev с auto-reload расширения
pnpm build          # production-сборка в dist/
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run (unit + parsers)
pnpm lint           # eslint
```

## Архитектура

```
content scripts (per site)  →  background service worker  →  Dexie / IndexedDB
                                       ↑
                       popup / dashboard / options (React)
```

- **Parsers** (`src/parsers/<mp>/`) — чистые функции `(doc, url) → ParsedProduct | null`. Каскад источников: JSON-LD → SSR-state → DOM-селекторы → regex. Без сайд-эффектов.
- **API-обогащение** (`src/parsers/<mp>/api.ts`, опционально) — асинхронный путь, обходящий DOM, когда у маркетплейса есть надёжный публичный JSON-эндпоинт (см. WB → `u-card.wb.ru`). Подключается через `RunOptions.enrich` в `runContentScript`.
- **Repository** (`src/data/*.repo.ts`) — единственный путь к IndexedDB. UI напрямую в Dexie не лезет.
- **Services** (`src/services/*.ts`) — чистая бизнес-логика поверх типов из `shared/types`: агрегаты, расчёты, форматтеры. Без Dexie, без DOM, без `chrome.*`. Тестируется без моков.
- **Background** (`src/background/`) — оркестратор. Принимает RPC-сообщения, дёргает repos и services, эмитит события.
- **UI** (`src/{popup,dashboard,options}`) — React-приложения. Общаются с background через `sendRpc<K>(...)` из `src/shared/rpc.ts`.
- **Content scripts** (`src/content/<mp>.ts`) — тонкий бутстрап на `runContentScript()` из `src/content/run.ts`. Общая orchestration-логика (детект SPA, MutationObserver, инжект `TrackButton` через Shadow DOM, popup-bridge) живёт в `run.ts`. Каждый content-script-файл — 3 строки: импорт парсера + `runContentScript(parser, label, opts?)`.

## Слойные правила

1. UI не импортирует Dexie напрямую. Только через RPC к background.
2. Парсеры (`extract.ts`, `selectors.ts`) — чистые: никаких `fetch`/Dexie. Если нужен сетевой источник, кладём его в `<mp>/api.ts` и подключаем через `enrich` content-script'а — это сохраняет тестируемость парсера на HTML-фикстурах.
3. `src/shared/types.ts` — единый источник правды по моделям. Все слои импортируют отсюда.
4. Изменения в `src/data/db.ts` — это миграция. Поднимаем версию (`this.version(N).stores(...)`), не меняем существующую схему.
5. Никаких `setInterval` в service worker. Только `chrome.alarms`.

## Соглашения

- **Файлы**: kebab-case (`price-history.ts`). Типы и компоненты — PascalCase в коде.
- **Repos**: суффикс `.repo.ts`, экспорт объекта-namespace (`productsRepo.create(...)`).
- **Services**: без суффикса (`price-history.ts` экспортирует `priceHistory.compute(...)`).
- **RPC types**: `'<entity>/<action>'` (например `'product/add'`). Добавляются в `RpcMap` + handler в `background/handlers.ts`.
- **Парсеры**: каждый — отдельная папка `<mp>/{index.ts, extract.ts, selectors.ts}`. `index.ts` экспортирует объект, реализующий `Parser`.
- **Магические числа**: в `src/shared/constants.ts` или рядом с использованием как именованная константа.

## Дизайн-система

Базовый язык — Receipt brutalist: высокая плотность, 1px бордюры, никаких теней и скруглений, моноширинные цифры. Применяется ко всем UI-слоям независимо от выбранной цветовой схемы.

- **Темы** (`src/styles/global.css`, каталог в `src/shared/themes.ts`): `receipt-light` + `receipt-dark` — дефолтная пара, переключается по `prefers-color-scheme` ещё до того, как JS успеет проставить `data-theme` (`:root` + `@media (prefers-color-scheme: dark)` на `:root:not([data-theme])`). 10 «классических» палитр (`light-default`, `dark-slate`, и т.д.) остались как опции в Settings — все они шарят те же CSS-токены (`--pw-bg-*`, `--pw-text-*`, `--pw-accent-*`, `--pw-signal*`).
- **Tailwind override** (`tailwind.config.ts`): `borderRadius` и `boxShadow` забиты в `0` / `none` для всех ключей, чтобы существующие `rounded-md` / `shadow-sm` в компонентах автоматически становились плоскими — без правки каждого className. Сделано осознанно: новый `rounded-*` в коде не даст «мягкого» эффекта, и это правильно.
- **Сигнал-красный** (`--pw-signal: #E63946` в receipt-light, `#FF5A67` в receipt-dark): единственный цветовой акцент, на который дизайн повышает голос. Утилиты `rose-*` ремаппятся в `--pw-signal` через `global.css`, так что «destructive» / drop-индикаторы в коде остаются на привычных `text-rose-600` / `bg-rose-50`.
- **Моноширинные цифры**: helper `.pw-num` (`font-mono` + `tabular-nums` + tracking -0.01em) клеится на любой элемент с ценой/количеством. Заголовочные цены в `ProductDetail`, цены в `ProductList`/`popup`, тултипы и тики Y-axis в `PriceChart`, summary-тосты — везде через `pw-num`.
- **Графики** (`PriceChart`, `Sparkline`): step-чарты по умолчанию — цена меняется дискретными скачками, и линия их не интерполирует. Sparkline рисует `<path>` с `H/V`-командами и `strokeLinecap="square"`.
- **Логотип**: `<Logo>` (`src/dashboard/components/Logo.tsx`) — inline SVG (charcoal-квадрат + ниспадающий step-chart paper-цвета + signal-red маркер на последней ступени) + Manrope Bold "PriceWatch" wordmark. Используется в хедере popup и сайдбаре dashboard. Browser-action иконки 16/32/48/128 растеризуются из `public/icons/icon.svg` через `node scripts/build-icons.mjs` (Playwright Chromium).
- **Цветовая маркировка маркетплейсов** (`MARKETPLACE_ACCENT` в `src/shared/constants.ts`): inset-полоска слева + цветной бейдж маркетплейса. Тоггл `marketplaceColorCoding` в Settings; popup и dashboard читают одно и то же поле, поведение синхронно.

## Storage и миграции

- Версия схемы — в `src/data/db.ts`. Текущая: `v1`.
- При изменении полей: `this.version(N+1).stores({...}).upgrade(async (tx) => { ... })`.
- `parserVersion` хранится на каждом `Product` — растёт при существенном изменении парсера, чтобы можно было отделить старые/новые записи.

## Добавление нового маркетплейса

Чек-лист (подробности — в `.claude/skills/<mp>-parser/SKILL.md` если он есть):

1. Создать `src/parsers/<mp>/{index.ts, extract.ts, selectors.ts}`. Реализовать `Parser` интерфейс.
2. Зарегистрировать в `src/parsers/index.ts` (REGISTRY).
3. Создать `src/content/<mp>.ts` — три строки: импорт парсера + вызов `runContentScript(parser, label, opts?)`. Якорь, MutationObserver, popup-bridge приходят из `src/content/run.ts`. Если у маркетплейса есть надёжный JSON-API — добавить `<mp>/api.ts` и передать `{ enrich: (url) => fetchFromApi(...) }` в `runContentScript` (см. `wildberries.ts` как пример).
4. Добавить в `manifest.config.ts`: новый `content_scripts` matcher и `host_permissions` (если API-эндпоинт на отдельном поддомене — добавить и его).
5. Добавить hosts в `src/shared/constants.ts → MARKETPLACE_HOSTS`.
6. Положить 2–3 HTML-фикстуры в `tests/parsers/fixtures/<mp>/`.
7. Написать `tests/parsers/<mp>.test.ts` по образцу `ozon.test.ts`.
8. (опционально) Создать `.claude/skills/<mp>-parser/SKILL.md` с конкретными селекторами и нюансами.

## Парсеры: правила устойчивости

- **Каскад источников**: публичный JSON-API (если есть) → JSON-LD → embedded state (`__NEXT_DATA__` и подобные) → DOM-селекторы → regex по тексту. Никогда не зависим от одного источника.
- **Несколько селекторов на каждое поле** в `selectors.ts`. Когда что-то ломается — добавляем новый кандидат, не заменяем старый.
- **Якорь для инжекта**: 2-3 целевых селектора + всегда `h1` как последний фолбэк. Маркетплейсы часто хешируют классы; h1 у карточки товара есть всегда.
- **Не падаем на отсутствии полей** — собираем `missingFields[]` и пишем в `parserDiagnostics`. Возвращаем `parserStatus: 'partial'`. `'failed'` — только когда нет ни title, ни цены.
- **При `parserStatus === 'failed'`** — не перезаписываем `currentPrice` существующего продукта (см. `productsRepo.updateFromParsed`).
- **Фикстуры** в `tests/parsers/fixtures/<mp>/` обновляются при изменении вёрстки сайта. Каждый PR, ломающий парсер, должен сопровождаться обновлёнными фикстурами.

## Update scheduler

Реализовано в этапе 5 для лёгкого пути (WB через JSON-API). Tab-based путь для Ozon/Я.М. — V2.

- **Pure logic** (`src/services/scheduler.ts`) — `pickReady`, `computeBackoff`, `applyJitter`, `resolveTask`. Тестируется без моков.
- **Driver** (`src/background/scheduler/index.ts`) — `startScheduler()` создаёт `chrome.alarms` `pricewatch:scheduler-tick` с периодом 5 мин. На каждый tick: `pickReady` → `dispatch` → `resolveTask` → save state.
- **Queue** (`src/background/scheduler/queue.ts`) — хранится в `chrome.storage.session`. Очищается при перезапуске браузера; восстанавливается через `reconcileQueue()` из активных products.
- **Executor** (`src/background/scheduler/executor.ts`) — `wildberries` → `fetchWbProductFromApi`; `ozon` / `yandex-market` возвращают `not_implemented:tab_refresh` (drop'аются после `MAX_ATTEMPTS`).
- **Параметры**: rate limit `8с/marketplace`, max `5 задач/tick`, jitter ±20%, backoff `30с → 2м → 10м → 1ч`, MAX_ATTEMPTS=4.
- **Hooks**: `applySettings()` дёргается из `settings/update` handler — включает/выключает scheduler динамически. `reconcileQueue()` — после `product/add`/`product/remove`.
- **Settings UI** (`src/dashboard/components/SettingsPage.tsx`): `scheduledUpdates` toggle, `updateInterval` (15/30/60/180), `passiveUpdates`, `maxNotificationsPerHour`, `quietHours`, `digestEnabled`.

## Уведомления

- **NotificationService** (`src/services/notifications.ts`) — чистая функция `evaluate(product, transition, rules) → matches[]`. Триггеры: `priceBelow`, `dropPct`, `dropAbs`, `discountAppeared`, `backInStock`, `historicalLow`, `sellerChanged` (заглушка).
- **Notifier** (`src/background/notifier.ts`) — оркестратор: применяет evaluate, проверяет cooldown по (productId, ruleId) через `notificationsRepo.lastFiredAt`, пишет AppNotification, дёргает `chrome.notifications.create` и обновляет badge через `chrome.action.setBadgeText`.
- **Defaults** — при первом старте SW (`bootstrap()`) сидим три глобальных правила: drop ≥ 5% (cooldown 12ч), backInStock (24ч), historicalLow (24ч).
- **Триггер** — вызывается из `product/add` handler после записи pricePoint. Транзишен включает `historyMinBefore` (минимум до текущего апдейта) для historicalLow.
- **Глобальные vs per-product** — `notificationRulesRepo.listForProduct(id)` возвращает глобальные + правила scope=product этого id.
- **Quiet hours** + **excludedDomains** + **maxNotificationsPerHour** — три «приглушающих» канала: AppNotification и badge продолжают писаться, но `chrome.notifications.create` пропускается.
- **Digest mode** (`src/background/digest.ts`): `digestEnabled` × `scheduledUpdates` → `digestSuppressesIndividualToast()` глушит per-rule toasts. Сводный тост — это уже существующее post-bulk-refresh уведомление scheduler-а («Обновлено 5/8 · 2 ↓, 1 ↑»), отдельного таймера/alarm нет. Когда `scheduledUpdates` off, `digestEnabled` — no-op.
- **Клик по chrome notification** — открывает dashboard в новой вкладке (`#notifications/<id>` для rule-toast, `#notifications` для bulk/digest).

## Тестирование

- **Unit (Vitest)**: парсеры на HTML-фикстурах через `DOMParser` (happy-dom).
- **Repo-тесты**: на `fake-indexeddb/auto`. Перед каждым — `db().delete()`.
- **E2E (Playwright, V1)**: headed Chromium с `--load-extension`. Golden path: открыть Ozon → клик «Следить» → товар в Dexie → popup статус.
- **Манульный smoke** перед релизом: 5 сценариев из §4 PRD.

## Бюджеты производительности

- Popup TTI: ≤ 60ms.
- Content script bundle (gzipped): ≤ 80KB.
- Время до инжекта кнопки: ≤ 1.5s после `document_idle`.
- Главный поток на инжекте: ≤ 50ms.

## Приватность и permissions

- Никаких внешних доменов кроме самих маркетплейсов в `host_permissions`.
- Никакой аналитики. Никакой телеметрии без opt-in.
- Не логируем URL целиком в `parserDiagnostics` — маскируем query-string.
- Любая будущая синхронизация — opt-in.

## Release checklist (когда дойдём)

1. Бамп `version` в `package.json` (manifest подтянет автоматически).
2. CHANGELOG в `CHANGELOG.md`.
3. `pnpm typecheck && pnpm test && pnpm build`.
4. Загрузить `dist/` как unpacked → ручной smoke на 5 живых страницах каждого маркетплейса.
5. (Когда стор) скриншоты, описание, политики приватности.

## Что не делаем

- Не имитируем действия пользователя (клики «Купить», добавление в корзину).
- Не пытаемся обходить капчу — помечаем `parserDiagnostic.status = 'failed'` и ждём.
- Не используем приватные API маркетплейсов кроме явно публичных (WB `card.wb.ru` — ок).
- Не храним персональные данные сверх минимума (URL + таймстемпы + цена). Ничего об аккаунте пользователя на маркетплейсе.

## Структура проекта (коротко)

```
src/
  shared/        # типы, RPC, форматтеры, константы — общее для всех слоёв
  data/          # Dexie + repos
  services/      # бизнес-логика (price-history.ts и т.п.) — pure, тестируется без моков
  parsers/       # один subfolder на marketplace + base.ts
  background/    # service worker + handlers
  content/       # per-site content scripts + Shadow DOM injector
  popup/         # action popup
  dashboard/     # full-page UI
  options/       # настройки
  styles/        # tailwind entrypoints + @font-face + theme tokens
tests/
  parsers/       # fixtures + unit-тесты парсеров
  data/          # repos на fake-indexeddb
  shared/        # утилиты (url, format, ...)
public/icons/    # PNG-иконки 16/32/48/128 + icon.svg исходник
public/fonts/    # Manrope + JetBrains Mono (latin + cyrillic, 400/500/700)
scripts/         # одноразовые скрипты (build-icons.mjs — растеризация SVG)
.claude/skills/  # специфичные знания (парсеры, MV3, Dexie)
```

## Когда что-то ломается

- **Кнопка не появляется на странице**: открыть DevTools → Console, фильтр `[PriceWatch:`. Должно быть `content script loaded`. Если нет — скрипт не загрузился (проверить `host_permissions` и matchers в `manifest.config.ts`). Если есть, но идёт `no anchor element found yet` — каждые 8 попыток в консоль выпадет `DOM probe (anchor missing)` со списком h1 и price-like элементов; по нему добавляем новые кандидаты в `<mp>/index.ts → findAnchor`.
- **Popup-кнопка «Добавить» молчит**: ошибка должна показываться красным под кнопкой (`addError`). Если ошибка `Receiving end does not exist` — content script не подключён к вкладке (открыть до загрузки расширения). Просим F5 страницы.
- **Service worker не отвечает / `Status code: 3`**: на Windows ошибка чаще всего из-за **non-ASCII пути** в директории расширения. Создать junction в ASCII-путь и грузить оттуда: `New-Item -ItemType Junction -Path C:\Users\<u>\pricewatch-dist -Target <full-path>\dist`. Помимо этого — chrome://extensions → «Inspect service worker». В MV3 SW засыпает; первый RPC после идла может быть медленным (норма).
- **Service worker грузится с `localhost:5173`**: `dist/` в dev-режиме после `pnpm dev`. Перебилдить `pnpm build` для production-distrib.
- **IndexedDB растёт**: DevTools → Application → IndexedDB → `pricewatch`. Старые `pricePoints` периодически прореживаем (V1: TTL по политике).
- **Парсер выдает `partial`**: `parserDiagnostics` таблица. `missingFields` укажет, какой селектор устарел.
