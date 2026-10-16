import type { PricingBpr, PricingErf, PricingSpr } from '@ccq/contracts';

import { BPR_COLUMNS, ERF_COLUMNS, SPR_COLUMNS } from './columnMap';
import {
  hashString,
  seededRandom,
  syntheticBprRow,
  syntheticErfRow,
  type PricingFixture,
  type PricingRow,
} from './fixtures';
import { dateValue, mapBpr, mapErf, mapRows, mapSpr } from './mapper';
import {
  PRICING_MAX_RESULTS,
  clampLimit,
  hasErfFilter,
  refKey,
  type FindErfsParams,
  type PricingReader,
  type SprHistoryParams,
} from './reader';

export interface FakePricingReaderOptions {
  /**
   * Local dev only: an ERF number the fixture doesn't have is made up on first lookup (deterministic,
   * with 0–2 BPRs), so any quote's references show something. Numbers ending in 0 stay "not found".
   * Off in tests.
   */
  synthesize?: boolean;
}

const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : '');
const keyOf = (v: unknown, kind: 'erf' | 'bpr') =>
  typeof v === 'string' || typeof v === 'number' ? refKey(String(v), kind) : '';
const newestFirst = (column: string) => (a: PricingRow, b: PricingRow) =>
  (dateValue(b[column]) ?? '').localeCompare(dateValue(a[column]) ?? '');

/**
 * In-memory PricingReader over a fixture (`PRICING_MODE=fake`: local dev and CI; tests). Same
 * filters, ordering and caps as the SQL readers, through the same mapper. Test helpers (`put`,
 * `failWith`, `delayMs`) simulate data and outages; there is still no way to write to the pricing app.
 */
export class FakePricingReader implements PricingReader {
  readonly mode = 'fake' as const;
  private readonly erf: PricingRow[];
  private readonly bpr: PricingRow[];
  private readonly spr: PricingRow[];
  /** Calls per method, so tests can assert the cache. */
  readonly calls: Record<string, number> = {};
  /** When set, every call rejects with it (to test the manual-reference fallback). */
  failWith: Error | null = null;
  /** Added latency per call (to test the timeout). */
  delayMs = 0;

  constructor(
    fixture: PricingFixture,
    private readonly options: FakePricingReaderOptions = {},
  ) {
    this.erf = [...fixture.erf];
    this.bpr = [...fixture.bpr];
    this.spr = [...fixture.spr];
  }

  private async enter(method: string) {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failWith) throw this.failWith;
  }

  private findErfRow(erfNumber: string): PricingRow | undefined {
    const k = keyOf(erfNumber, 'erf');
    const hit = this.erf.find((r) => keyOf(r[ERF_COLUMNS.erfNumber.column], 'erf') === k);
    if (hit || !this.options.synthesize || !/^\d{4,7}$/.test(k) || k.endsWith('0')) return hit;
    const rng = seededRandom(hashString(k));
    const row = syntheticErfRow(
      rng,
      k,
      { customerName: 'Synthetic customer (pricing fake)', sfOpportunityId: null, title: null },
      rng.int(2022, 2026),
    );
    this.erf.push(row);
    for (let i = rng.int(0, 2); i > 0; i--) {
      this.bpr.push(syntheticBprRow(rng, `BPR-${k}${i}`, k, null, 2026));
    }
    return row;
  }

  async getErf(erfNumber: string): Promise<PricingErf | null> {
    await this.enter('getErf');
    const row = this.findErfRow(erfNumber);
    return row ? mapErf(row) : null;
  }

  async findErfs(p: FindErfsParams): Promise<PricingErf[]> {
    await this.enter('findErfs');
    if (!hasErfFilter(p)) return [];
    const c = ERF_COLUMNS;
    const customer = p.customerName?.trim().toLowerCase();
    const opportunity = p.sfOpportunityId?.trim();
    const text = p.text?.trim().toLowerCase();
    const rows = this.erf
      .filter((r) => !customer || lower(r[c.customerName.column]).includes(customer))
      .filter((r) => !opportunity || r[c.sfOpportunityId.column] === opportunity)
      .filter(
        (r) =>
          !text ||
          [r[c.erfNumber.column], r[c.title.column], r[c.customerName.column]].some((v) =>
            lower(typeof v === 'number' ? String(v) : v).includes(text),
          ),
      )
      .sort(newestFirst(c.submittedOn.column));
    return mapRows(rows, mapErf).slice(0, clampLimit(p.limit));
  }

  async getBpr(bprNumber: string): Promise<PricingBpr | null> {
    await this.enter('getBpr');
    const k = keyOf(bprNumber, 'bpr');
    const row = this.bpr.find((r) => keyOf(r[BPR_COLUMNS.bprNumber.column], 'bpr') === k);
    return row ? mapBpr(row) : null;
  }

  async findBprsForErf(erfNumber: string): Promise<PricingBpr[]> {
    await this.enter('findBprsForErf');
    this.findErfRow(erfNumber); // a synthesized ERF brings its BPRs
    const k = keyOf(erfNumber, 'erf');
    const rows = this.bpr
      .filter((r) => keyOf(r[BPR_COLUMNS.erfNumber.column], 'erf') === k)
      .sort(newestFirst(BPR_COLUMNS.requestedOn.column));
    return mapRows(rows, mapBpr).slice(0, PRICING_MAX_RESULTS);
  }

  async getSprHistory(p: SprHistoryParams): Promise<PricingSpr[]> {
    await this.enter('getSprHistory');
    const customer = p.customerName?.trim().toLowerCase();
    const item = p.itemText?.trim().toLowerCase();
    if (!customer && !item) return [];
    const c = SPR_COLUMNS;
    const rows = this.spr
      .filter((r) => !customer || lower(r[c.customerName.column]).includes(customer))
      .filter((r) => !item || lower(r[c.itemDescription.column]).includes(item))
      .sort(newestFirst(c.requestedOn.column));
    return mapRows(rows, mapSpr).slice(0, PRICING_MAX_RESULTS);
  }

  // ── Test helpers ───────────────────────────────────────────────────────────────────────────────

  /** Add a raw row (keyed by columnMap.ts column names), as the pricing app would have it. */
  put(object: 'erf' | 'bpr' | 'spr', row: PricingRow): void {
    this[object].push(row);
  }

  get size(): { erf: number; bpr: number; spr: number } {
    return { erf: this.erf.length, bpr: this.bpr.length, spr: this.spr.length };
  }
}
