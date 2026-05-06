import type {
  AppNotification,
  Collection,
  NotificationRule,
  PricePoint,
  Product,
  ProductEvent,
} from '@/shared/types';

export const EXPORT_VERSION = 1;

export interface ExportPayload {
  app: 'pricewatch';
  version: typeof EXPORT_VERSION;
  exportedAt: number;
  products: Product[];
  pricePoints: PricePoint[];
  events: ProductEvent[];
  collections: Collection[];
  notificationRules: NotificationRule[];
  notifications: AppNotification[];
}

export interface ImportSummary {
  productsAdded: number;
  productsSkipped: number;
  pricePointsAdded: number;
  collectionsAdded: number;
  rulesAdded: number;
}

export function buildPayload(input: Omit<ExportPayload, 'app' | 'version' | 'exportedAt'>): ExportPayload {
  return {
    app: 'pricewatch',
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    ...input,
  };
}

/**
 * Validate the high-level shape of an imported payload. We deliberately keep
 * checks loose — repos do their own normalization at write-time. Throws on
 * unrecoverable shape mismatch.
 */
export function validatePayload(raw: unknown): ExportPayload {
  if (!raw || typeof raw !== 'object') throw new Error('Файл повреждён или не является PriceWatch-экспортом.');
  const obj = raw as Record<string, unknown>;
  if (obj.app !== 'pricewatch') throw new Error('Неверный формат файла (app ≠ "pricewatch").');
  if (obj.version !== EXPORT_VERSION) {
    throw new Error(`Несовместимая версия экспорта: ${String(obj.version)} (ожидаем ${EXPORT_VERSION}).`);
  }
  const arrays: (keyof ExportPayload)[] = [
    'products',
    'pricePoints',
    'events',
    'collections',
    'notificationRules',
    'notifications',
  ];
  for (const key of arrays) {
    if (!Array.isArray(obj[key])) {
      // tolerate missing — fill with empty array
      obj[key] = [];
    }
  }
  return obj as unknown as ExportPayload;
}
