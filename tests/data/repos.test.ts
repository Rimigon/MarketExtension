import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { resetDb } from '@/data/db';
import { productsRepo } from '@/data/products.repo';
import { pricesRepo } from '@/data/prices.repo';
import { eventsRepo } from '@/data/events.repo';
import type { ParsedProduct } from '@/shared/types';

const sample: ParsedProduct = {
  marketplace: 'ozon',
  url: 'https://www.ozon.ru/product/x-1/',
  canonicalUrl: 'https://ozon.ru/product/x-1/',
  sku: '1',
  title: 'Sample',
  currentPrice: 1000,
  oldPrice: 1500,
  discountPct: 33,
  availability: 'in_stock',
  parserVersion: 1,
  parserStatus: 'ok',
};

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  await resetDb();
});

describe('productsRepo + pricesRepo + eventsRepo', () => {
  it('creates a product and finds it by canonicalUrl', async () => {
    const created = await productsRepo.create(sample);
    expect(created.id).toBeTruthy();
    const fetched = await productsRepo.getByCanonicalUrl(sample.canonicalUrl);
    expect(fetched?.title).toBe('Sample');
  });

  it('records and retrieves price points and events', async () => {
    const product = await productsRepo.create(sample);
    await pricesRepo.record({
      productId: product.id,
      price: 1000,
      oldPrice: 1500,
      availability: 'in_stock',
      source: 'visit',
    });
    await eventsRepo.record(product.id, 'added', { source: 'page' });

    const points = await pricesRepo.listForProduct(product.id);
    expect(points).toHaveLength(1);
    expect(points[0]!.price).toBe(1000);

    const events = await eventsRepo.listForProduct(product.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('added');
  });

  it('cascade-deletes price points and events on remove()', async () => {
    const product = await productsRepo.create(sample);
    await pricesRepo.record({
      productId: product.id,
      price: 1000,
      oldPrice: null,
      availability: 'in_stock',
      source: 'manual',
    });
    await eventsRepo.record(product.id, 'added');

    await productsRepo.remove(product.id);

    expect(await pricesRepo.listForProduct(product.id)).toHaveLength(0);
    expect(await eventsRepo.listForProduct(product.id)).toHaveLength(0);
    expect(await productsRepo.getById(product.id)).toBeUndefined();
  });
});
