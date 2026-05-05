---
name: yandex-market-parser
description: Знания по парсингу Яндекс Маркета. Используй когда трогаешь src/parsers/yandex-market/* или src/content/yandex-market.ts. Stage 2.
---

# Yandex Market parser — что знать

## URL карточки товара

Форматы:
- `https://market.yandex.ru/product--<slug>/<numeric-id>` (новый)
- `https://market.yandex.ru/product/<numeric-id>` (старый, ещё встречается)

Регекс: `/^\/product(?:--[^/]+)?\/(\d+)/`. Числовой ID — `sku`.

## Источники данных

1. **JSON-LD** — самый надёжный для базовых полей (name, brand, image, sku). Тип `Product`.
2. **DOM** — для актуальной цены и рейтинга.
3. **`window.__PRELOADED_STATE__`** существует, но формат меняется и сложно надёжно вытащить нужные данные. **Не использовать.**

## Селекторы DOM

На 2025 год (всё через `data-zone-name` и `data-auto`):
- Цена: `[data-zone-name="price"] [data-auto="price"]`. Или `[data-auto-themes="price"]`.
- Старая цена: `[data-auto="old-price"]`.
- Заголовок: `[data-additional-zone="title"] h1`, или `h1[data-baobab-name="title"]`.
- Рейтинг: `[data-zone-name="ProductSnippetGallery"] [data-baobab-name="rating"]`, либо в JSON-LD.
- Продавец: `[data-baobab-name="shopName"]`.

**Я.М. часто меняет имена `data-baobab-name`** — добавляем кандидаты, не заменяем.

## Оффер-агрегатор (важно)

Я.М. — это маркетплейс агрегатор: одна карточка может иметь множество предложений от разных продавцов. JSON-LD в этом случае возвращает:

```json
"offers": [
  { "@type": "Offer", "price": "1990", "seller": { "name": "Магазин 1" } },
  { "@type": "Offer", "price": "2090", "seller": { "name": "Магазин 2" } }
]
```

или

```json
"offers": {
  "@type": "AggregateOffer",
  "lowPrice": "1990",
  "highPrice": "2490",
  "offerCount": 12
}
```

**Стратегия**: берём минимальную цену (`lowPrice` для AggregateOffer, `min(price)` для массива). Сохраняем `sellerName` того оффера, у которого минимальная цена.

В DOM Я.М. показывает «лучшую» цену пользователю — обычно это та же `lowPrice`. Если расходится — DOM приоритетнее (это то, что видит юзер).

## Капча

Я.М. использует Я.Captcha. Срабатывает на:
- Слишком частые переходы между карточками.
- Любые подозрительные fetch-запросы из расширений.

Поэтому:
- **Никогда не делаем фоновых HTTP-запросов** к market.yandex.ru.
- Scheduled-обновление — через `chrome.tabs.create({ active:false, pinned:true })` с jitter ±20%.
- Если страница содержит `<form id="captcha-form">` или текст «Подтвердите, что запросы не автоматические» — `parserStatus: 'failed'`, не перезаписываем цену, диагностика.

## SPA-навигация

Я.М. — SPA на React. `makeSpaWatcher()` работает.

## Где инжектить кнопку

Якорь: `[data-zone-name="price"]` (родитель блока цены). Вставка `afterend`. Shadow DOM.

## Доступность

JSON-LD: `availability: schema.org/InStock`. Если нет offers / `lowPrice == null` → `out_of_stock`.

## Региональные цены

Я.М. определяет регион по `yp` cookie или query-параметру. Дефолт MVP — оставляем как есть, что показывает пользователю — то и фиксируем. В V1: поле `regionHint` на `PricePoint`.

## Типичные регрессии

- `[data-zone-name="price"]` исчез — глобальный редизайн. Добавь кандидат, проверь свежую фикстуру.
- `availability` показывает «скоро в продаже» / «ожидается» — мапим на `'limited'`, не `'out_of_stock'`.
- JSON-LD блок есть, но `offers` отсутствует — товар без активных предложений → `out_of_stock`.
