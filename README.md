# MarketExtension — PriceWatch

Браузерное расширение (Manifest V3) для отслеживания цен на Ozon, Wildberries и Яндекс Маркете прямо со страницы товара.

**Статус:** MVP. Работает Ozon end-to-end. WB и Я.Маркет — заглушки (Stage 2).

## Возможности

- Авто-инжект кнопки «★ Следить за ценой» под заголовком товара на Ozon (Shadow DOM, не ломает вёрстку, переживает SPA-навигацию и переключение вариантов).
- Извлечение трёх ценовых тиров: «С банками», «С другими банками», «Без скидки» — с фолбэком на min/max когда CSS зачёркивание не определяется.
- Полное название товара, описание, характеристики (`<dl>`/`<table>`/key-value pairs), рейтинг, число отзывов.
- Дедупликация по canonical URL (без UTM и трекинговых параметров).
- IndexedDB / Dexie — local-first, без бэкенда.
- Popup со статусом активной вкладки и быстрым доступом к Dashboard.
- Dashboard с раскрывающимися деталями каждого товара.
- Pasive-обновление цены при заходе на карточку (фоновое расписание — Stage 5).

## Стек

Manifest V3 · TypeScript 5 (strict) · React 18 · Vite + @crxjs/vite-plugin · Dexie 4 · Zustand · Tailwind 3 · Recharts · Vitest.

## Команды

```bash
pnpm install
pnpm dev            # vite dev с auto-reload расширения
pnpm build          # production сборка в dist/
pnpm typecheck
pnpm test           # 27 тестов: парсер Ozon, repos на fake-indexeddb, утилиты
```

## Локальная установка

1. `pnpm install && pnpm build`
2. Открыть `chrome://extensions`, включить Developer mode, Load unpacked → выбрать `dist/`.
3. Открыть карточку товара на Ozon — кнопка появится под заголовком.

## Структура

См. `CLAUDE.md` (полная инструкция, ≤500 строк) и `.claude/skills/` (специфические знания: парсеры Ozon/WB/Я.М., MV3 lifecycle, Dexie schema).

## Roadmap

- **Stage 2** — парсеры Wildberries и Яндекс Маркета.
- **Stage 3** — расширенный dashboard с графиками истории цен (Recharts).
- **Stage 5** — фоновое обновление по расписанию (`chrome.alarms` + очередь задач).
- **V2** — кросс-маркетплейс матчинг, опциональная облачная синхронизация, Firefox-порт.
