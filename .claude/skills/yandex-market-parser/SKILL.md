---
name: yandex-market-parser
description: Знания по парсингу Яндекс Маркета. Используй когда трогаешь src/parsers/yandex-market/* или src/content/yandex-market.ts.
---

# Yandex Market parser — что знать

## URL карточки товара

Все три формата встречаются в живой природе:
- `https://market.yandex.ru/card/<slug>/<numeric-id>` — **новый формат**, ~2025+. Больше всего ссылок на сайте сейчас сюда.
- `https://market.yandex.ru/product--<slug>/<numeric-id>` — предыдущий формат, ещё генерится в части мест.
- `https://market.yandex.ru/product/<numeric-id>` — старый, всё ещё встречается.

Регекс: `/^\/(?:card\/[^/]+|product(?:--[^/]+)?)\/(\d+)/i`. Числовой ID — `sku`. См. `src/parsers/yandex-market/extract.ts → PRODUCT_PATH_RE`.

## Источники данных

1. **JSON-LD** — самый надёжный для базовых полей (name, brand, image, sku). Тип `Product`. Но на новой `/card/` вёрстке его может не быть в SSR (страница рендерится client-side).
2. **DOM** — для актуальной цены и рейтинга. Я.М. часто меняет `data-baobab-name`/`data-zone-name` — добавляем кандидаты, не заменяем.
3. **`window.__PRELOADED_STATE__`** существует, но формат меняется и сложно надёжно вытащить нужные данные. **Не использовать.**
4. **Публичного JSON-API нет** (как у WB) — Я.М. жёстко защищён капчой. Не делаем фоновых HTTP-запросов.

## Селекторы DOM (актуальные кандидаты)

В `selectors.ts` лежат списки. На 2026-05:
- Цена: `[data-zone-name="price"] [data-auto="price"]`, `[data-auto="snippet-price-current"]`, `[data-auto-themes="price"]`, `[data-auto="price"]`.
- Старая цена: `[data-auto="old-price"]`, `[data-auto="snippet-price-old"]`, `[data-baobab-name*="oldPrice"]`.
- Заголовок: `[data-additional-zone="title"] h1`, `h1[data-baobab-name*="title" i]`, `h1`.
- Рейтинг: `[data-baobab-name*="rating" i]`, `span[itemprop="ratingValue"]`.
- Продавец: `[data-baobab-name="shopName"]`.

**Важно**: селекторы могут не подходить под новую `/card/` разметку — нужно живое тестирование. `runContentScript` каждые 8 неудачных попыток дампит в консоль `DOM probe (anchor missing)` со списком h1 и `[class*="price"]/[data-auto*="price"]` элементов — по этому дампу обновляем `selectors.ts`.

Якорь для инжекта строится в `index.ts → findAnchor`: целевые селекторы → `[class*="price" i]` → `h1` (последний фолбэк всегда срабатывает).

## Оффер-агрегатор

Я.М. — маркетплейс-агрегатор: одна карточка может иметь много предложений от разных продавцов. JSON-LD возвращает либо массив `Offer`, либо `AggregateOffer`:

```json
"offers": [
  { "@type": "Offer", "price": "1990", "seller": { "name": "Магазин 1" } },
  { "@type": "Offer", "price": "2090", "seller": { "name": "Магазин 2" } }
]
```

```json
"offers": {
  "@type": "AggregateOffer",
  "lowPrice": "1990",
  "highPrice": "2490",
  "offerCount": 12
}
```

**Стратегия** (`extract.ts → summarizeOffers`): берём минимальную цену (`lowPrice` для AggregateOffer, `min(price)` для массива). Сохраняем `sellerName` оффера с минимальной ценой. Если `highPrice > lowPrice` — пишем `oldPrice = highPrice` (как «обычная цена в категории»).

В DOM Я.М. показывает «лучшую» цену пользователю — обычно совпадает с `lowPrice`. Если расходится — DOM приоритетнее (это то, что видит юзер).

## Капча

Я.М. использует Я.Captcha. Срабатывает на:
- Слишком частые переходы между карточками.
- Любые подозрительные fetch-запросы из расширений.

Поэтому:
- **Никогда не делаем фоновых HTTP-запросов** к market.yandex.ru.
- Scheduled-обновление — через `chrome.tabs.create({ active:false, pinned:true })` с jitter ±20%.
- Если страница содержит `<form id="captcha-form">` или текст «Подтвердите, что запросы не автоматические» — `extract.ts → isYandexCaptchaPage` возвращает true, `extractYandexMarketProduct` отдаёт `null`. Цена не перетирается, диагностика логируется.

## SPA-навигация

Я.М. — SPA на React. `makeSpaWatcher()` через `history.pushState` patch работает.

## Где инжектить кнопку

Якорь по приоритету: `[data-zone-name="price"]` → `[data-zone-name="HeaderPrice"]` → `[data-zone-name="ProductSnippetGallery"]` → `[class*="price" i]` → `h1`. Вставка `afterend`, Shadow DOM (через `injector.tsx`).

## Доступность

JSON-LD: `availability: schema.org/InStock`. Если нет offers / `lowPrice == null` → `out_of_stock`.

## Региональные цены

Я.М. определяет регион по `yp` cookie или query-параметру. Дефолт MVP — оставляем как есть, что показывает пользователю — то и фиксируем. В V1: поле `regionHint` на `PricePoint`.

## Типичные регрессии

- URL-формат поменяли (опять). Регекс расширяем: `card|product|product--<slug>`. Если будет `/p/<id>` или `/item/<id>` — добавляем варианты в `PRODUCT_PATH_RE`.
- `[data-zone-name="price"]` исчез — глобальный редизайн. Добавь новый кандидат, обнови фикстуру.
- `availability` показывает «скоро в продаже» / «ожидается» — мапим на `'limited'`, не `'out_of_stock'`.
- JSON-LD блок есть, но `offers` отсутствует — товар без активных предложений → `out_of_stock`.
- Я.М. ушёл полностью на client-side render `/card/`, JSON-LD в SSR-HTML отсутствует. В этом случае работает только DOM-путь — обновлять `selectors.ts` и тесты.
