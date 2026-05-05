---
name: ozon-parser
description: Глубокие знания о парсинге карточек товара Ozon. Используй когда трогаешь src/parsers/ozon/* или src/content/ozon.ts.
---

# Ozon parser — что знать

## URL карточки товара

Формат: `https://www.ozon.ru/product/<slug>-<numeric-id>/[...]`

- Числовой ID в конце slug — это и есть `sku`. Регекс: `/^\/product\/[^/]*-(\d+)\/?$/i`.
- Бывают варианты с query-параметрами для регионов/трекинга — выкидываем через `canonicalizeUrl`.
- Категории и поиск (`/category/...`, `/search/...`) — НЕ карточка товара.

## Источники данных по приоритету

1. **JSON-LD** (`<script type="application/ld+json">`, `@type: "Product"`):
   - Самый стабильный источник для `name`, `brand`, `sku`, `aggregateRating`.
   - **Цена в JSON-LD часто базовая, а не та что видит пользователь** (без скидок Ozon Premium и т.п.). Поэтому current price берем из DOM, oldPrice из DOM, а sku/title/rating — из JSON-LD.
2. **DOM `[data-widget="webPrice"]`** — главный якорь. Здесь живёт текущая цена и (если есть) перечёркнутая старая.
3. **Эвристика по тексту**: `parsePriceText` нормализует строки вида `«3 990 ₽»` или `«3 990,00»` в число.

## CSS-селекторы

Основные собраны в `src/parsers/ozon/selectors.ts`. Принцип — массив кандидатов, первый match выигрывает. **Никогда не заменяй селектор — добавляй новый кандидат.** Старые остаются как fallback на случай A/B-теста.

Текущие якорные элементы (на 2025 год):
- `[data-widget="webPrice"]` — блок цены (туда инжектим кнопку).
- `[data-widget="webProductHeading"]` — заголовок.
- `[data-widget="webGallery"]` — галерея с главным изображением.
- `[data-widget="webCurrentSeller"]` — продавец.

## Где инжектить кнопку

`extractAnchorElement` находит `[data-widget="webPrice"]`. Кнопка вставляется через `anchor.insertAdjacentElement('afterend', host)` — **после** блока цены, не внутрь. Внутрь нельзя: Ozon-овский React-компонент управляет содержимым блока и при гидрации может выкинуть наш узел.

Контейнер кнопки — Shadow DOM (`mode: 'open'`) с `style.all = 'initial'` на хосте. Это полностью изолирует наш React от стилей Ozon.

## SPA-навигация

Ozon — Next.js / похоже-на-Nuxt SPA. При переходе с одной карточки на другую URL меняется через `history.pushState` без полной перезагрузки. Решение:
- `ensureSpaPatched()` (см. `parsers/base.ts`) патчит `pushState`/`replaceState` один раз и эмитит синтетическое событие `pricewatch:locationchange`.
- Контент-скрипт слушает событие, делает `teardownInjection()` (снимает старую кнопку), ждёт ~600 мс (пока Ozon отрендерит новую цену), вызывает `tryInject()` заново.

## Антибот / капча

Ozon агрессивно ставит капчу при подозрении на автоматику. Поэтому:
- **Никогда не делаем фоновых HTTP-запросов** к Ozon из background. Все цены пассивно — когда пользователь сам открыл карточку.
- Когда дойдём до scheduled-обновлений (этап 5): через `chrome.tabs.create({ active: false, pinned: true })` с jitter ±20% и rate-limit 1 задача / 8 секунд / Ozon.
- Если 5 подряд парсингов вернули `failed` за час — отключаем scheduled для Ozon на час. Лог в `parserDiagnostics`.

## Доступность (`availability`)

JSON-LD: `https://schema.org/InStock` / `OutOfStock`. Маппим грубо — содержит «InStock» → `in_stock`, иначе `out_of_stock`.
Если в DOM не нашлась цена и в JSON-LD `OutOfStock` — `availability: 'out_of_stock'`, `currentPrice: null`.

## Региональные цены

Ozon показывает разные цены в разных регионах (определяет по `__Secure-ext_xcid` cookie или подобным). MVP это игнорирует — просто фиксирует цену, которую видит пользователь. В V1 можно добавить `regionHint` поле на `PricePoint`.

## Типичные регрессии и как их ловить

- **«Не нашёлся price anchor»** → `[data-widget="webPrice"]` переименовали (бывает раз в год). Добавляем кандидат в `OZON_SELECTORS.priceAnchor`. Фикстуру в `tests/parsers/fixtures/ozon/` обновляем.
- **Цена пустая (`currentPrice: null`)** при `parserStatus: 'partial'` → не нашли в DOM. Проверь `OZON_SELECTORS.currentPrice`. JSON-LD скорее всего отдаёт цену без скидок Ozon, поэтому DOM приоритетнее.
- **`title === undefined`** → JSON-LD исчез или DOM-селектор `h1` сломался. Очень редко, но бывает на A/B.

## Чем НЕ парсим

- Не используем `window.__NUXT__` или подобные глобальные SSR-state объекты — формат меняется без предупреждения.
- Не делаем fetch к каким-либо endpoint'ам Ozon. Только то, что есть в DOM открытой пользователем страницы.
- Не дёргаем `getComputedStyle` для определения «перечеркнут или нет» — медленно. Полагаемся на класс/data-атрибут.

## Тестирование

`tests/parsers/fixtures/ozon/`:
- `with-jsonld.html` — нормальный товар со скидкой и JSON-LD.
- `dom-only.html` — товар без JSON-LD (бывает редко, но бывает).
- `not-product.html` — категорийная страница.

При обновлении селекторов:
1. Скачать актуальный HTML карточки (через DevTools → Copy outer HTML на `<html>`, либо `view-source:`).
2. Минимизировать до релевантных блоков, чтобы фикстура не была мегабайтом.
3. Убедиться, что `pnpm test tests/parsers/ozon.test.ts` зелёный.
