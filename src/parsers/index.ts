import type { Marketplace } from '@/shared/types';
import type { Parser } from './base';
import { ozonParser } from './ozon';

const REGISTRY: Partial<Record<Marketplace, Parser>> = {
  ozon: ozonParser,
};

export function getParser(marketplace: Marketplace): Parser | null {
  return REGISTRY[marketplace] ?? null;
}

export const allParsers: Parser[] = Object.values(REGISTRY).filter(
  (p): p is Parser => Boolean(p),
);
