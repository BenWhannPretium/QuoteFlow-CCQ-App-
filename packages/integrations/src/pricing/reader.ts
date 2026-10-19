import {
  PRICING_APP_MAX_RESULTS,
  type PricingAppMode,
  type PricingBpr,
  type PricingErf,
  type PricingSpr,
} from '@ccq/contracts';

import { sfErrorCode } from '../salesforce/retry';

/**
 * Read-only access to the legacy pricing application (F-11, B-15): ERF and BPR records, SPR as
 * history. There are deliberately no write methods: CCQ never writes back to the pricing app, never
 * edits a figure and never rebuilds the pricing engine (CLAUDE.md rule 5). The real readers only ever
 * send a parameterized `SELECT` (`assertSelectOnly`), and `readonly.test.ts` greps this folder for
 * write statements.
 *
 * Which route (A: SQL login to views on a replica; B: the D&A copy in Fabric) is decided at M5; both
 * sit behind this interface and `PRICING_MODE` picks one.
 */
export interface PricingReader {
  readonly mode: PricingAppMode;

  /** One ERF by number. Null when the pricing app has no such ERF. */
  getErf(erfNumber: string): Promise<PricingErf | null>;

  /** ERFs matching every filter given, newest first, at most `limit` (capped at 50). */
  findErfs(params: FindErfsParams): Promise<PricingErf[]>;

  /** One BPR by number. Null when unknown. */
  getBpr(bprNumber: string): Promise<PricingBpr | null>;

  /** Every BPR that follows the ERF (many: ERF↔BPR is not 1:1), newest first, at most 50. */
  findBprsForErf(erfNumber: string): Promise<PricingBpr[]>;

  /** SPR history for a customer and/or item text, newest first, at most 50. History only. */
  getSprHistory(params: SprHistoryParams): Promise<PricingSpr[]>;
}

export interface FindErfsParams {
  /** Customer name contains this (case-insensitive). */
  customerName?: string | undefined;
  /** The SF opportunity id the pricing app carries. */
  sfOpportunityId?: string | undefined;
  /** ERF number, title or customer name contains this. */
  text?: string | undefined;
  limit: number;
}

export interface SprHistoryParams {
  customerName?: string | undefined;
  /** Item description contains this. */
  itemText?: string | undefined;
}

/** Per-query timeout (B-15: 10 s). */
export const PRICING_TIMEOUT_MS = 10_000;
/** Re-exported cap: no query returns more rows. */
export const PRICING_MAX_RESULTS = PRICING_APP_MAX_RESULTS;

/** A requested limit inside [1, 50]. */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return PRICING_MAX_RESULTS;
  return Math.min(PRICING_MAX_RESULTS, Math.max(1, Math.trunc(limit)));
}

/** True when a search has at least one filter (an unfiltered search would scan the whole app). */
export const hasErfFilter = (p: FindErfsParams) =>
  [p.customerName, p.sfOpportunityId, p.text].some((v) => v !== undefined && v.trim() !== '');

/**
 * The lookup key for an ERF or BPR number as typed: trimmed, upper case, inner spaces removed and an
 * "ERF"/"BPR" prefix dropped ("ERF-26367", "erf 26367" and "26367" all become "26367"). The pricing
 * app's own key format is confirmed at M5 (`pricing_ref_formats`); this only tolerates prefixes.
 */
export function refKey(value: string, kind: 'erf' | 'bpr'): string {
  const compact = value.trim().toUpperCase().replace(/\s+/g, '');
  const prefix = kind === 'erf' ? /^ERF[-_#]?/ : /^BPR[-_#]?/;
  return compact.replace(prefix, '');
}

/** Minimal logger: operation, timings, row counts and error codes only. Never row contents. */
export interface PricingLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export const silentPricingLogger: PricingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export class PricingTimeoutError extends Error {
  readonly code = 'ETIMEOUT';
  constructor(ms: number) {
    super(`Pricing app query timed out after ${ms} ms`);
    this.name = 'PricingTimeoutError';
  }
}

/** The reader is not configured (e.g. a real mode without a server): fails every call. */
export class PricingNotConfiguredError extends Error {
  readonly code = 'NOT_CONFIGURED';
  constructor(missing: string) {
    super(`Pricing reader not configured: ${missing}`);
    this.name = 'PricingNotConfiguredError';
  }
}

/**
 * A short, data-free code for a reader error (safe to log, store and show): a tedious / mssql code
 * (ETIMEOUT, ELOGIN, ESOCKET), a network code, or the error name. Messages are never used: SQL Server
 * messages can echo values.
 */
export const pricingErrorCode = (err: unknown): string => sfErrorCode(err);

export function withPricingTimeout<T>(
  promise: Promise<T>,
  ms: number = PRICING_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PricingTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
