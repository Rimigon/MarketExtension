import { v7 as uuidv7 } from 'uuid';
import { db } from './db';
import type { Marketplace, ParserDiagnostic, ParserStatus } from '@/shared/types';

/** Strip the query string. CLAUDE.md forbids logging full URLs into diagnostics. */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

export const parserDiagnosticsRepo = {
  async record(args: {
    marketplace: Marketplace;
    parserVersion: number;
    status: ParserStatus;
    url: string;
    missingFields: string[];
  }): Promise<ParserDiagnostic> {
    const row: ParserDiagnostic = {
      id: uuidv7(),
      marketplace: args.marketplace,
      parserVersion: args.parserVersion,
      status: args.status,
      url: maskUrl(args.url),
      missingFields: args.missingFields,
      timestamp: Date.now(),
    };
    await db().parserDiagnostics.put(row);
    return row;
  },
};
