/**
 * Минимальный i18n-каркас.
 *
 * MVP-релиз идёт RU-only (PRD §19), но строки централизованы и в `t()` —
 * так EN-pack и переключение через `settings.locale` подключаются в V2 без
 * массовой правки JSX.
 *
 * Использование:
 *
 *   import { t } from '@/shared/i18n';
 *   <span>{t('common.save')}</span>
 *   <span>{t('product.priceTier.tiersOfN', { n: 3 })}</span>
 *
 * Параметры подставляются по шаблону `{name}` без эскейпов — для разметки
 * лучше собирать ноды вручную, чем пытаться размечать вложенные теги в строке.
 */

export type Locale = 'ru' | 'en';

export const SUPPORTED_LOCALES: Locale[] = ['ru'];

type Messages = Record<string, string>;

const RU: Messages = {
  // common
  'common.save': 'Сохранить',
  'common.cancel': 'Отмена',
  'common.remove': 'Удалить',
  'common.add': 'Добавить',
  'common.reset': 'Сбросить',
  'common.loading': 'Загрузка…',
  'common.saved': 'Сохранено',
  'common.dash': '—',

  // sidebar
  'sidebar.allProducts': 'Все товары',
  'sidebar.favorites': 'Избранное',
  'sidebar.archived': 'Архив',
  'sidebar.stats': 'Аналитика',
  'sidebar.notifications': 'Уведомления',
  'sidebar.settings': 'Настройки',
  'sidebar.collections': 'Коллекции',
  'sidebar.collectionsEdit': 'Изменить',
  'sidebar.collectionsDone': 'Готово',
  'sidebar.collectionsCreate': 'Новая коллекция',
  'sidebar.marketplaces': 'Маркетплейс',

  // list
  'list.searchPlaceholder': 'Поиск по названию, бренду, артикулу…',
  'list.sort': 'Сорт.:',
  'list.sortUpdated': 'Обновлено',
  'list.sortPriceAsc': 'Цена ↑',
  'list.sortPriceDesc': 'Цена ↓',
  'list.sortDiscount': 'Скидка',
  'list.sortTitle': 'Название',
  'list.filters': 'Фильтры',
  'list.priceRange': 'Цена, ₽',
  'list.priceFrom': 'от',
  'list.priceTo': 'до',
  'list.minDiscount': 'Скидка ≥, %',
  'list.inStockOnly': 'Только в наличии',
  'list.withGoalOnly': 'Только с целевой ценой',
  'list.resetFilters': 'Сбросить фильтры',
  'list.foundOf': 'Найдено: {found} из {total}',
  'list.empty': 'Ничего не найдено.',
  'list.goalShort': 'цель {price}',

  // product detail
  'detail.openPage': 'Открыть карточку ↗',
  'detail.refresh': 'Обновить цену',
  'detail.refreshing': 'Обновляю…',
  'detail.refreshOk': 'Цена обновлена',
  'detail.refreshNotSupported': 'Откройте карточку в браузере — цена подтянется автоматически',
  'detail.refreshFailed': 'Не удалось обновить: {message}',
  'detail.remove': 'Удалить',
  'detail.statsMin': 'Минимум',
  'detail.statsMax': 'Максимум',
  'detail.statsAvg': 'Средняя',
  'detail.statsCurrentVsAvg': 'Сейчас vs средняя',
  'detail.statsDelta24h': 'Δ за 24ч',
  'detail.statsDelta7d': 'Δ за 7д',
  'detail.statsDelta30d': 'Δ за 30д',
  'detail.statsLastChange': 'Последнее изменение',
  'detail.priceTiers': 'Цены',
  'detail.description': 'Описание',
  'detail.specs': 'Характеристики',
  'detail.details': 'Сведения',
  'detail.detailAvailability': 'Наличие',
  'detail.detailRating': 'Рейтинг',
  'detail.detailReviews': 'Отзывов',
  'detail.detailParser': 'Парсер',
  'detail.detailAddedAt': 'Добавлен',
  'detail.detailUpdatedAt': 'Обновлён',

  // meta
  'meta.management': 'Управление',
  'meta.favorite.on': '★ В избранном',
  'meta.favorite.off': '☆ В избранное',
  'meta.archive.on': 'В архив',
  'meta.archive.restore': 'Восстановить из архива',
  'meta.recommendation': 'Рекомендация',
  'meta.recommendation.loading': 'Загрузка…',
  'meta.tags': 'Теги',
  'meta.tags.empty': 'Нет тегов.',
  'meta.tags.placeholder': 'Добавить тег',
  'meta.collections': 'Коллекции',
  'meta.collections.empty': 'Создайте коллекцию в боковой панели слева.',
  'meta.goal': 'Цель по цене',
  'meta.goal.target': 'Целевая цена, ₽',
  'meta.goal.ideal': 'Идеальная цена, ₽',
  'meta.goal.deadline': 'Дедлайн',
  'meta.goal.achieved': 'Цель достигнута: текущая ≤ целевой',
  'meta.goal.hint': 'Уведомление сработает, когда цена опустится до целевой.',
  'meta.notes': 'Заметки',
  'meta.notes.placeholder': 'Добавьте заметку — комплектация, причина отслеживания, ссылки на конкурентов…',

  // recommendation verdicts
  'rec.buyNow': 'Покупать сейчас',
  'rec.goodPrice': 'Хорошая цена',
  'rec.fairPrice': 'Обычная цена',
  'rec.overpriced': 'Цена выше обычной',
  'rec.noData': 'Недостаточно данных',
  'rec.hint.buyNow': 'Цена в нижних 10% за всю историю наблюдений.',
  'rec.hint.goodPrice': 'Заметно ниже привычного уровня.',
  'rec.hint.fairPrice': 'Близко к историческому медианному уровню.',
  'rec.hint.overpriced': 'Сейчас выше, чем у большинства точек истории — есть смысл подождать.',
  'rec.hint.noData': 'Появится после нескольких обновлений цены.',

  // notifications
  'notifications.title': 'Уведомления',
  'notifications.markAllRead': 'Прочитать всё',
  'notifications.empty':
    'Уведомлений ещё нет. Они придут, когда сработает одно из правил — например, цена упадёт на 5% или товар вернётся в наличие.',

  // stats
  'stats.title': 'Аналитика',
  'stats.subtitle': 'Сводка по всем активным товарам, обновляется при открытии страницы.',
  'stats.totalActive': 'Всего отслеживается',
  'stats.totalFavorites': 'В избранном',
  'stats.totalArchived': 'В архиве',
  'stats.pricePoints': 'Точек истории',
  'stats.drops7d': 'Подешевело за 7д',
  'stats.rises7d': 'Подорожало за 7д',
  'stats.avgDiscount': 'Средняя скидка',
  'stats.stale': 'Не обновлялись > 7д',
  'stats.topDrops': 'Топ падений (7 дней)',
  'stats.topRises': 'Топ ростов (7 дней)',
  'stats.topDropsEmpty': 'Пока ни один товар не подешевел за неделю.',
  'stats.topRisesEmpty': 'Никто не подорожал — счастье.',
  'stats.byMarketplace': 'По маркетплейсам',
  'stats.savings': 'Потенциал экономии',
  'stats.savingsHint':
    'Сумма разниц «текущая цена − исторический минимум» по всем активным товарам. Это примерная оценка того, сколько вы могли бы сэкономить, если бы покупали все на минимуме.',
  'stats.computing': 'Считаем агрегаты…',

  // empty / global
  'app.emptyState':
    'Пока ничего не отслеживается. Зайдите на карточку товара Ozon / Wildberries / Я.Маркет — кнопка «Следить за ценой» появится автоматически рядом с ценой.',
  'app.notificationPickHint': 'Выберите уведомление слева, чтобы открыть товар.',
  'app.productPickHint': 'Выберите товар слева, чтобы увидеть детали и график цены.',
};

const PACKS: Record<Locale, Messages> = {
  ru: RU,
  // en pack — V2.
  en: RU,
};

let active: Locale = 'ru';

export function setLocale(loc: Locale): void {
  active = SUPPORTED_LOCALES.includes(loc) ? loc : 'ru';
}

export function getLocale(): Locale {
  return active;
}

export type TranslationKey = keyof typeof RU;

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const pack = PACKS[active] ?? RU;
  const raw = pack[key] ?? RU[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name) => {
    const v = params[name];
    return v == null ? `{${name}}` : String(v);
  });
}
