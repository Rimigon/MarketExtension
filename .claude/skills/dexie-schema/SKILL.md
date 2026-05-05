---
name: dexie-schema
description: Схема Dexie/IndexedDB, индексы, миграции и паттерны выборки. Используй когда меняешь src/data/db.ts или пишешь сложные запросы.
---

# Dexie / IndexedDB schema для PriceWatch

## Где живёт схема

`src/data/db.ts`. Класс `PriceWatchDB extends Dexie`, экземпляр через `db()` (lazy singleton).

## Текущая схема (v1)

```
products            id, marketplace, canonicalUrl, [marketplace+sku], updatedAt, isArchived, isFavorite, *tags, *collectionIds
pricePoints         id, productId, timestamp, [productId+timestamp]
events              id, productId, timestamp, type
notifications      id, productId, createdAt, readAt
collections         id, name, sortOrder
notificationRules  id
settings            id
parserDiagnostics  id, marketplace, timestamp, status
```

## Как читать схему Dexie

Строка `'id, marketplace, canonicalUrl, [marketplace+sku]'` означает:
- `id` — primary key (первое поле всегда).
- `marketplace`, `canonicalUrl` — обычные индексы.
- `[marketplace+sku]` — composite-индекс (можно искать `where('[marketplace+sku]').equals(['ozon', '12345'])`).
- `*tags` — multi-entry индекс (поле — массив, индексируется каждый элемент).
- Поля без индекса — есть в объекте, но искать по ним только через `.filter(fn)` (в JS, медленно для больших объёмов).

## Зачем какой индекс

| Индекс | Зачем |
|---|---|
| `canonicalUrl` (на products) | Дедуп при добавлении: `getByCanonicalUrl()`. Самый частый query. |
| `[marketplace+sku]` | Поиск товара по площадке + артикулу. Полезно для bulk-import + кросс-маркетплейс матчинга. |
| `updatedAt` | Сортировка списка по «недавним» в popup/dashboard. |
| `isArchived` | Быстрая фильтрация активных vs архивных. |
| `*tags`, `*collectionIds` | Фильтрация по тегу/коллекции в dashboard (V1). |
| `[productId+timestamp]` (на pricePoints) | Главный паттерн: история цен одного товара за период. **Без этого индекса история на 1000 точек — тормоза.** |
| `productId` (на events) | Таймлайн событий товара. |
| `marketplace, status` (на parserDiagnostics) | Здоровье парсеров за период. |

## Паттерны запросов

**Получить историю цен товара за последние 30 дней:**
```ts
const since = Date.now() - 30 * 86_400_000;
const points = await db().pricePoints
  .where('[productId+timestamp]')
  .between([productId, since], [productId, Date.now() + 1])
  .toArray();
```

**Последняя цена:**
```ts
const last = await db().pricePoints
  .where('[productId+timestamp]')
  .between([productId, 0], [productId, Date.now() + 1])
  .reverse()
  .limit(1)
  .toArray();
```

**Все товары, недавно обновлённые:**
```ts
await db().products.orderBy('updatedAt').reverse().limit(50).toArray();
```

**Каскадное удаление (через транзакцию):**
```ts
await db().transaction('rw', db().products, db().pricePoints, db().events, async () => {
  await db().products.delete(productId);
  await db().pricePoints.where('productId').equals(productId).delete();
  await db().events.where('productId').equals(productId).delete();
});
```

## Миграции

Когда меняем схему — **всегда новая версия**, никогда не правим старую:

```ts
this.version(1).stores({...});

// Добавить новую колонку (поле в объект — без миграции, индекс — нужна):
this.version(2).stores({
  products: 'id, marketplace, canonicalUrl, [marketplace+sku], updatedAt, isArchived, isFavorite, groupId, *tags, *collectionIds',
}).upgrade(async (tx) => {
  // если нужно бэкфиллить
  await tx.table('products').toCollection().modify((p) => { p.groupId ??= null; });
});
```

Правила:
- **Не удаляй версию `v1`** даже если она «устарела». Dexie прогоняет миграции последовательно.
- В `.upgrade(...)` пиши только идемпотентные операции — пользователь может перепрыгнуть несколько версий.
- Тяжёлые миграции (миллионы записей) разбивай на чанки или делай lazy (мигрируй на чтение).

## Производительность

- **Не загружай всю историю в JS для агрегатов.** Считай в воркере или используй Dexie's `.each()`.
- Для дашборда «общая статистика» — кэшируй агрегаты в отдельной таблице `productStats` (V1), пересчитывай только при `pricePoint` insert.
- IndexedDB транзакции серийны в рамках одного объекта. Параллельные writes → автоматическая очередь.
- `bulkPut(items)` в разы быстрее, чем `for (const it of items) put(it)`.

## Тестирование

`tests/` использует `fake-indexeddb/auto`. Перед каждым тестом — `await db().delete()` (чистый стейт).

Подключение в Vitest setup: `tests/setup.ts` импортирует `fake-indexeddb/auto`. `vitest.config.ts` ссылается на этот setup.

## Подводные камни

- **`Dexie.delete()` асинхронный**, после него нужно создавать новый instance ИЛИ просто продолжать — Dexie сам пересоздаст при первом запросе. В наших тестах работает.
- **Composite-индекс `[a+b]`** требует, чтобы оба поля присутствовали в объекте. Если `b` иногда `undefined` — индекс не сработает. Лучше явно `null`.
- **Строки в индексах** упорядочены lexicographically. Числа — numerically. **Не смешивай типы в одном поле**, иначе сравнения сломаются.
- **TTL автоматически нет.** Если хотим прореживать `pricePoints` после года — нужна задача в alarms (V1+).

## Размер хранилища

IndexedDB на современных Chrome — десятки гигабайт на профиль. Реальные ограничения — UX (медленный парс при 1М точек). Прикидка:
- 1 продукт ≈ 1 КБ.
- 1 PricePoint ≈ 100 байт.
- 1000 продуктов × 1 точка/день × 1 год ≈ 36 МБ. Ок.
- 10 000 продуктов × 5 точек/день × 1 год ≈ 1.8 ГБ. Уже border — нужна политика прореживания.

Для V1 запланировать: TTL 90 дней для `pricePoints`, кроме экстремумов (min/max за год).
