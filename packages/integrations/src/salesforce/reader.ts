import type { SfAccount, SfOpportunity, SfProductSpec } from '@ccq/contracts';

/**
 * Read-only access to Salesforce (DEC-12). There are deliberately no write methods: the reader never
 * writes (CLAUDE.md rule 5). The one governed write is a separate interface, `SalesforceWriter`
 * (writer.ts, FB-29), off by default. `readonly.test.ts` and an ESLint rule fail the build if any SF write
 * call (`create`, `update`, `upsert`, `destroy`, …) appears in this folder outside the writer files, and
 * `writeGuard.test.ts` checks the writer files are the only ones with one.
 */
export interface SalesforceReader {
  readonly mode: 'fake' | 'live';

  /** Fuzzy search on opportunity and account name. Every search term must match one of them. */
  searchOpportunities(params: SearchOpportunitiesParams): Promise<SfOpportunity[]>;

  /** One opportunity with its account (from the Account relationship). Null when SF doesn't return it. */
  getOpportunity(id: string): Promise<SfOpportunityRecord | null>;

  getAccount(id: string): Promise<SfAccount | null>;

  /**
   * Opportunities with `SystemModstamp > since` (all of them when `since` is null), oldest first,
   * one page at a time so a full load never sits in memory.
   */
  listChangedOpportunities(since: Date | null): AsyncIterable<SfOpportunityRecord[]>;

  /** Ids of opportunities deleted in `[start, end]`. SF keeps ~30 days; older starts are clamped. */
  listDeletedOpportunityIds(start: Date, end: Date): Promise<string[]>;

  /** Rows of the custom Opportunity Product Specification object for one opportunity. */
  getProductSpecs(opportunityId: string): Promise<SfProductSpec[]>;
}

export interface SearchOpportunitiesParams {
  q: string;
  /** Only opportunities whose SF owner has this email. */
  ownerEmail?: string | undefined;
  openOnly: boolean;
  limit: number;
}

/** An opportunity as read, with its account and the raw SF payload (kept in the snapshot `raw`). */
export interface SfOpportunityRecord {
  opportunity: SfOpportunity;
  account: SfAccount | null;
  raw: Record<string, unknown>;
}

/** Minimal logger: ids, counts and field names only. Never pass record contents. */
export interface SfLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export const silentLogger: SfLogger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Search terms from free text: lower-cased words, at least 2 characters, at most 6 terms.
 * Opportunity names look like "Berlin CHI / Puckered Pickle / 1 gallon HDPE Natural 110-400", so
 * slashes, commas and brackets separate words; hyphens and dots stay inside them (110-400, 1.5).
 */
export function searchTerms(q: string): string[] {
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}.-]+/u)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, 6);
}
