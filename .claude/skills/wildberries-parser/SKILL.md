---
name: wildberries-parser
description: Знания по парсингу Wildberries. Используй когда трогаешь src/parsers/wildberries/* или src/content/wildberries.ts. Stage 2 (после Ozon).
---

# Wildberries parser — что знать

## URL карточки товара

Формат: `https://www.wildberries.ru/catalog/<numeric-id>/detail.aspx?...`

- Числовой ID — это `nm` (nomenclature) — главный идентификатор товара. Регекс: `/^\/catalog\/(\d+)\/detail\.aspx/i`.
- Это и `sku`, и ключ для public API.

## Главный путь — публичный API

WB отдаёт всю карточку JSON-эндпоинтом: `https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-<region>&spp=30&nm=<id>`

- Это **публичный API**, без авторизации. Пользоваться им из content-script — ок.
- Возвращает: `data.products[0]` с `id`, `name`, `brand`, `priceU` (цена в копейках × 100), `salePriceU`, `sale`, `rating`, `feedbacks`, `pics`, `supplier`, `supplierId`.
- **Цена в `priceU` — в "сотых рубля"**: чтобы получить рубли, делим на 100. То есть `priceU: 399000` → 3990 ₽.

Из background API недоступен (CORS-нет, но host_permissions могут помочь). Безопаснее — из content-script. Но если очень надо из BG — можно с `declarativeNetRequest` правилами; делать это только когда без альтернатив.

## DOM-fallback

На случай если API упал:
- Цена: `.product-page__price-block .price-block__final-price`.
- Старая цена: `.product-page__price-block .price-block__old-price del`.
- Заголовок: `.product-page__title`.
- Брэнд: `.product-page__header-brand`.
- Рейтинг: `[data-link*="rating"]`.

JSON-LD на WB ограниченный — не самый стабильный источник.

## Изображения

`pics` в API — это число (количество изображений). Главное изображение строится по формуле:
```
https://basket-<basket>.wbbasket.ru/vol<vol>/part<part>/<id>/images/big/1.webp
```
где `vol = floor(id / 1e5)`, `part = floor(id / 1e3)`, `basket` — номер бакета (определяется по диапазону `vol`). Подробности в коде ниже.

```ts
function wbImageUrl(id: number): string {
  const vol = Math.floor(id / 1e5);
  const part = Math.floor(id / 1e3);
  const basket = (() => {
    if (vol <= 143) return '01';
    if (vol <= 287) return '02';
    // ... таблица из реверс-инжиниринга, обновляется со временем
    return '15';
  })();
  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${id}/images/big/1.webp`;
}
```

При изменении схемы — лезть на github.com/erohina/wildberries или подобные ресурсы для актуальной таблицы.

## SPA-навигация

WB чаще, чем Ozon, делает полные перезагрузки между карточками. Но History API тоже встречается. Используем тот же `makeSpaWatcher()` из `parsers/base.ts`.

## Антибот

WB менее агрессивен, чем Ozon/Я.М. Публичный API — официальный, нет смысла его прятать. Но: rate limit имитация — соблюдаем. Не более 1 запроса в 5 секунд per nm.

## Регионы

WB-цена зависит от региона (параметр `dest=-<id>`). MVP — берём `dest=-1257786` (Москва) как дефолт. В V1 можно подтягивать из cookie пользователя.

## Доступность

В API: `data.products[0].sizes[].stocks[]`. Если массив пустой везде — `out_of_stock`. Иначе `in_stock`. Цвета/размеры в MVP игнорируем.

## Типичные регрессии

- API вернул `data.products: []` — товар удалён или скрыт. Помечаем `availability: 'out_of_stock'`, событие `removed`.
- `priceU == null` или `0` — товар архивный. То же.
- DOM поменялся — пишем диагностику, фолбечимся на API.

## Где инжектить кнопку

Якорь: `.product-page__price-block`. Вставка через `insertAdjacentElement('afterend', host)`. Shadow DOM как обычно.
