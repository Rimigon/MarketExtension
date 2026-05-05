---
name: wildberries-parser
description: Знания по парсингу Wildberries. Используй когда трогаешь src/parsers/wildberries/* или src/content/wildberries.ts.
---

# Wildberries parser — что знать

## URL карточки товара

Формат: `https://www.wildberries.ru/catalog/<numeric-id>/detail.aspx?...`

- Числовой ID — это `nm` (nomenclature) — главный идентификатор товара. Регекс: `/^\/catalog\/(\d+)\/detail\.aspx/i`.
- Это и `sku`, и ключ для public API.

## Главный путь — публичный API (используется сейчас)

WB отдаёт всю карточку JSON-эндпоинтом:

```
https://u-card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&hide_dtype=10;13;14&ab_testing=false&nm=<id>
```

- Без авторизации, без CORS-проблем при вызове из content-script (origin = wildberries.ru, эндпоинт CORS-allowed).
- `card.wb.ru/cards/v2/detail` — устаревший, на 2026-05 отдаёт 404. Используем v4 на `u-card.wb.ru`.
- В `manifest.config.ts → host_permissions` добавлен `https://*.wb.ru/*`, чтобы `fetch` точно проходил через права расширения.

Структура ответа (важные поля):

```json
{
  "products": [{
    "id": 205296637,
    "name": "Шкаф с книгами Антистресс…",
    "brand": "SorGame`s",
    "rating": 5,
    "reviewRating": 4.7,
    "feedbacks": 91,
    "totalQuantity": 9,
    "sizes": [{
      "stocks": [{ "qty": 8 }],
      "price": { "basic": 335000, "product": 196100 }
    }]
  }]
}
```

- `price.product` — финальная цена покупателя в **сотых долях рубля** (÷ 100 → ₽). `price.basic` — без скидки.
- `totalQuantity > 0` → `availability: 'in_stock'`, иначе `out_of_stock`.
- `reviewRating` обычно точнее чем `rating`.
- `feedbacks` (или `nmFeedbacks`) → `reviewCount`.

Реализация — `src/parsers/wildberries/api.ts → fetchWbProductFromApi`. Парсер DOM остаётся как fallback (на случай блокировки API).

## Подключение API в content-script

WB-парсер сам по себе чистый (`extract.ts`), всё сетевое — в `api.ts`. Содержимое `src/content/wildberries.ts`:

```ts
runContentScript(wildberriesParser, 'wildberries', {
  enrich: async (url) => {
    const nm = extractNmFromUrl(url);
    if (nm == null) return null;
    return fetchWbProductFromApi(nm, url);
  },
});
```

`runContentScript` сам кеширует результат `enrich` по pathname (чтобы не дёргать API на каждое срабатывание MutationObserver) и шарит in-flight промис.

## DOM-fallback

WB всё чаще отдаёт хешированные CSS-modules классы — селекторы с `.product-page__*` ломаются. Поэтому в `index.ts → findAnchor` мы:
1. Пробуем `WB_SELECTORS.priceAnchor` (`.product-page__price-block` и пр.).
2. Потом `[class*="priceBlock"], [class*="price-block"]` — ловит CSS-modules.
3. Последний фолбэк — любой `<h1>`. Кнопка вставится под заголовком.

В `selectors.ts` хранятся «легаси»-селекторы для DOM-парсинга (на случай если API вернёт null). Не убираем их; добавляем новые кандидаты, не заменяем старые.

JSON-LD на WB ограниченный — не самый стабильный источник, но `extract.ts` его честно пробует.

## Изображения

`pics` в API — число (количество фото). Главное изображение строится по формуле:

```
https://basket-<basket>.wbbasket.ru/vol<vol>/part<part>/<id>/images/big/1.webp
```

`vol = floor(id / 1e5)`, `part = floor(id / 1e3)`. `basket` определяется по диапазону `vol`. Таблица — в `api.ts → buildImageUrl`. При появлении новых basket'ов — расширяем таблицу.

## SPA-навигация

WB чаще, чем Ozon, делает полные перезагрузки между карточками. Но History API тоже встречается. Используем общий `makeSpaWatcher()` из `parsers/base.ts` через `wildberriesParser.watchSpa`. На SPA-смену URL `runContentScript` сбрасывает кеш `cachedEnrich`.

## Антибот

WB менее агрессивен, чем Ozon/Я.М. Публичный API — официальный, нет смысла его прятать. Но: rate-limit имитация — соблюдаем. Не более 1 запроса в 5 секунд per nm.

## Регионы

WB-цена зависит от региона (параметр `dest=-<id>`). MVP — берём `dest=-1257786` (Москва) как дефолт. В V1 можно подтягивать из cookie пользователя.

## Доступность

В API: `data.products[0].totalQuantity` + `sizes[].stocks[]`. Если `totalQuantity === 0` — `out_of_stock`. Иначе `in_stock`. Цвета/размеры в MVP игнорируем.

## Типичные регрессии

- API вернул `data.products: []` — товар удалён или скрыт. Помечаем `availability: 'out_of_stock'`, событие `removed`.
- `price.product == null` — товар архивный. Возвращаем `null` из `fetchWbProductFromApi`, content-script фолбечится на DOM-парсер.
- `card.wb.ru` снова заработал и возвращает другую схему — обновить URL и тесты, не трогая API-парсер до подтверждения.

## Где инжектить кнопку

Якорь по приоритету: `.product-page__price-block` → `.product-page__price` → `.product-page__title` → `[class*="priceBlock"]` → `h1`. Вставка через `injector.tsx → injectTrackButton` (`insertAdjacentElement('afterend', host)`). Shadow DOM как обычно.
