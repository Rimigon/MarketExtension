import { describe, expect, it } from 'vitest';
import { buildPayload, validatePayload, EXPORT_VERSION } from '@/services/import-export';

describe('import-export', () => {
  it('round-trips a payload via JSON', () => {
    const built = buildPayload({
      products: [],
      pricePoints: [],
      events: [],
      collections: [],
      notificationRules: [],
      notifications: [],
    });
    const json = JSON.stringify(built);
    const parsed = validatePayload(JSON.parse(json));
    expect(parsed.app).toBe('pricewatch');
    expect(parsed.version).toBe(EXPORT_VERSION);
    expect(parsed.products).toEqual([]);
  });

  it('rejects unknown app marker', () => {
    expect(() => validatePayload({ app: 'other', version: EXPORT_VERSION })).toThrow();
  });

  it('rejects mismatched version', () => {
    expect(() => validatePayload({ app: 'pricewatch', version: 999 })).toThrow();
  });

  it('tolerates missing arrays by filling with empty', () => {
    const parsed = validatePayload({ app: 'pricewatch', version: EXPORT_VERSION });
    expect(parsed.products).toEqual([]);
    expect(parsed.pricePoints).toEqual([]);
  });
});
