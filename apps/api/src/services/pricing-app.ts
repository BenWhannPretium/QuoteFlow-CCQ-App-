import {
  PRICING_APP_PROBLEM_CODES,
  type PricingAppSource,
  type PricingContext,
  type PricingErf,
  type PricingErfResponse,
  type PricingErfSearchQuery,
  type PricingErfSearchResponse,
  type PricingSpr,
} from '@ccq/contracts';
import { withSystemContext, type Database, type Tx } from '@ccq/db';
import {
  addPricingUsage,
  getCustomer,
  getPricingRecord,
  getQuoteByNumber,
  getSfOpportunity,
  loadQuoteState,
} from '@ccq/db/repos';
import { canEditQuoting, redact, type Actor } from '@ccq/domain';
import {
  pricingErrorCode,
  refKey,
  type PricingLogger,
  type PricingReader,
} from '@ccq/integrations';

import { recordValues } from './pricing-view';
import { ServiceProblem } from './problem';
import { erfLinkage } from './salesforce';

/**
 * B-15 (F-11): read-only pricing-app context for a quote, and ERF/BPR lookups. Nothing here writes
 * to the pricing app or edits a figure (CLAUDE.md rule 5); "Use as reference" goes through the B-11
 * pricing-record route.
 *
 * - Successful reads are cached in memory for 5 minutes (failures are not cached, so the next view
 *   retries).
 * - Usage is counted per hour, not per call: one `integration_run` row (source `pricing`) per hour,
 *   flushed about once a minute and on shutdown.
 * - Logs carry operation, counts and error codes only, never row contents.
 */

export const PRICING_CACHE_MS = 5 * 60_000;
export const PRICING_CACHE_MAX = 1_000;
export const USAGE_FLUSH_MS = 60_000;

export type PricingWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export class PricingAppError extends ServiceProblem {
  override name = 'PricingAppError';
}

/** Counters for the current hour (see `addPricingUsage`). */
export type UsageCounter = 'requests' | 'cacheHits' | 'calls' | 'rows' | 'failed';

/**
 * Hourly `integration_run` counts for pricing-app reads. Counters accumulate in memory and are added
 * to the hour's row (one per hour, unique index) by `flush`. A flush failure is logged and the counts
 * are kept for the next try; they are never per call.
 */
export class PricingUsage {
  private counts = new Map<number, { counts: Record<string, number>; error: string | null }>();
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly opts: {
      database?: Database | undefined;
      now: () => Date;
      logger: PricingLogger;
    },
  ) {}

  static hourOf(at: Date): Date {
    const hour = new Date(at);
    hour.setUTCMinutes(0, 0, 0);
    return hour;
  }

  add(counter: UsageCounter, n = 1, error: string | null = null): void {
    if (n === 0 && !error) return;
    const hour = PricingUsage.hourOf(this.opts.now()).getTime();
    const bucket = this.counts.get(hour) ?? { counts: {}, error: null };
    bucket.counts[counter] = (bucket.counts[counter] ?? 0) + n;
    if (error) bucket.error = error;
    this.counts.set(hour, bucket);
    this.schedule();
  }

  /** Pending counts (tests). */
  pending(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const { counts } of this.counts.values()) {
      for (const [k, v] of Object.entries(counts)) out[k] = (out[k] ?? 0) + v;
    }
    return out;
  }

  private schedule() {
    if (this.timer || !this.opts.database) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, USAGE_FLUSH_MS);
    this.timer.unref();
  }

  /** Write the pending counts (one upsert per hour bucket). */
  flush(): Promise<void> {
    const database = this.opts.database;
    if (!database || this.counts.size === 0) return this.flushing ?? Promise.resolve();
    if (this.flushing) return this.flushing.then(() => this.flush());
    const batch = this.counts;
    this.counts = new Map();
    this.flushing = (async () => {
      try {
        await withSystemContext(database, async (tx) => {
          for (const [hour, { counts, error }] of batch) {
            await addPricingUsage(tx, new Date(hour), counts, this.opts.now(), error);
          }
        });
      } catch (err) {
        // Keep the counts for the next flush.
        for (const [hour, b] of batch) {
          const cur = this.counts.get(hour) ?? { counts: {}, error: null };
          for (const [k, v] of Object.entries(b.counts)) cur.counts[k] = (cur.counts[k] ?? 0) + v;
          cur.error ??= b.error;
          this.counts.set(hour, cur);
        }
        this.opts.logger.warn({ code: pricingErrorCode(err) }, 'pricing usage flush failed');
        this.schedule();
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
  }
}

interface Cached<T> {
  at: number;
  value: T;
}

const unavailableMessage = (code: string) => `Pricing app unavailable (${code})`;

/** De-duplicated references, compared by their prefix-free key; the first spelling is kept. */
function uniqueRefs(values: (string | null | undefined)[], kind: 'erf'): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v?.trim();
    if (!trimmed) continue;
    const key = refKey(trimmed, kind);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Most references resolved per quote (each costs up to two reader calls on a cold cache). */
export const MAX_CONTEXT_REFS = 10;

export class PricingAppService {
  private readonly cache = new Map<string, Cached<unknown>>();
  private readonly now: () => Date;

  constructor(
    private readonly opts: {
      reader: PricingReader;
      usage: PricingUsage;
      logger: PricingLogger;
      now?: () => Date;
    },
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  get mode() {
    return this.opts.reader.mode;
  }

  /** A reader call through the 5-minute cache. Failures are counted and rethrown, never cached. */
  private async read<T>(
    key: string,
    fn: (reader: PricingReader) => Promise<T>,
    rows: (value: T) => number,
  ): Promise<{ value: T; at: number }> {
    const nowMs = this.now().getTime();
    const hit = this.cache.get(key) as Cached<T> | undefined;
    if (hit && nowMs - hit.at < PRICING_CACHE_MS) {
      this.opts.usage.add('cacheHits');
      return { value: hit.value, at: hit.at };
    }
    this.opts.usage.add('calls');
    try {
      const value = await fn(this.opts.reader);
      this.opts.usage.add('rows', rows(value));
      this.cache.set(key, { at: nowMs, value });
      if (this.cache.size > PRICING_CACHE_MAX) {
        for (const [k, v] of this.cache) {
          if (nowMs - v.at >= PRICING_CACHE_MS || this.cache.size > PRICING_CACHE_MAX) {
            this.cache.delete(k);
          }
        }
      }
      return { value, at: nowMs };
    } catch (err) {
      this.opts.usage.add('failed', 1, pricingErrorCode(err));
      throw err;
    }
  }

  private getErf = (n: string) =>
    this.read(
      `erf:${refKey(n, 'erf')}`,
      (r) => r.getErf(n),
      (v) => (v ? 1 : 0),
    );
  private sprHistory = (customerName: string) =>
    this.read(
      `spr:${customerName.toLowerCase()}`,
      (r) => r.getSprHistory({ customerName }),
      (v) => v.length,
    );

  private source(readAt: number | null, error: string | null): PricingAppSource {
    return {
      mode: this.opts.reader.mode,
      available: error === null,
      error,
      readAt: readAt === null ? null : new Date(readAt).toISOString(),
    };
  }

  /** A reader failure on a direct lookup: 503, with the manual-reference hint. */
  private unavailable(err: unknown, op: string): never {
    const code = pricingErrorCode(err);
    this.opts.logger.warn({ op, code }, 'pricing app read failed');
    throw new PricingAppError(
      503,
      PRICING_APP_PROBLEM_CODES.unavailable,
      `${unavailableMessage(code)}. Enter legacy ERF numbers manually.`,
    );
  }

  /** GET /pricing/erf/:erfNumber */
  async erf(actor: Actor, erfNumber: string): Promise<PricingErfResponse> {
    this.opts.usage.add('requests');
    try {
      const erf = await this.getErf(erfNumber);
      if (!erf.value) {
        throw new PricingAppError(
          404,
          PRICING_APP_PROBLEM_CODES.notFound,
          'The pricing app has no ERF with this number',
        );
      }
      return redact({ source: this.source(erf.at, null), erfRecord: erf.value }, actor);
    } catch (err) {
      if (err instanceof ServiceProblem) throw err;
      return this.unavailable(err, 'erf');
    }
  }

  /** GET /pricing/erf?customer=&q=&opportunity= (not cached: searches are typed live). */
  async searchErfs(actor: Actor, q: PricingErfSearchQuery): Promise<PricingErfSearchResponse> {
    this.opts.usage.add('requests');
    this.opts.usage.add('calls');
    try {
      const rows = await this.opts.reader.findErfs({
        customerName: q.customer,
        text: q.q,
        sfOpportunityId: q.opportunity,
        limit: q.limit,
      });
      this.opts.usage.add('rows', rows.length);
      return redact(
        {
          source: this.source(this.now().getTime(), null),
          erfRecords: rows,
          truncated: rows.length >= q.limit,
        },
        actor,
      );
    } catch (err) {
      this.opts.usage.add('failed', 1, pricingErrorCode(err));
      return this.unavailable(err, 'searchErfs');
    }
  }

  /**
   * GET /quotes/:qn/pricing-context: resolves the legacy `quote.erf_number`, the current pricing
   * record's legacy ERF numbers and the SF opportunity's ERF number (B-26: no BPR). The quote is read under RLS (404 when out of
   * scope). A reader failure is not an error here: the response says the pricing app is unavailable
   * and the UI falls back to manual references.
   */
  async context(
    withTx: PricingWithTx,
    actor: Actor,
    quoteNumber: string,
  ): Promise<{ quoteId: string; context: PricingContext }> {
    this.opts.usage.add('requests');
    const loaded = await withTx(async (tx) => {
      const q = await getQuoteByNumber(tx, quoteNumber);
      if (!q) return null;
      const [state, record, opportunity, customer] = await Promise.all([
        loadQuoteState(tx, q.id),
        getPricingRecord(tx, q.id),
        getSfOpportunity(tx, q.sfOpportunityId),
        q.customerId ? getCustomer(tx, q.customerId) : Promise.resolve(undefined),
      ]);
      return { q, state: state!, record: recordValues(record), opportunity, customer };
    });
    if (!loaded) {
      throw new PricingAppError(404, PRICING_APP_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
    }
    const { q, state, record, opportunity, customer } = loaded;
    const refs = {
      quoteErfNumber: q.erfNumber,
      sfErfNumber: opportunity?.erfNumberSf ?? null,
      erfRefs: record?.erfRefs ?? [],
    };
    const linkageStatus = erfLinkage(refs.sfErfNumber, refs.quoteErfNumber);
    const erfNumbers = uniqueRefs(
      [refs.quoteErfNumber, ...refs.erfRefs, refs.sfErfNumber],
      'erf',
    ).slice(0, MAX_CONTEXT_REFS);
    const customerName = customer?.name ?? opportunity?.accountName ?? null;

    const base = {
      refs,
      linkage: { status: linkageStatus, mismatch: linkageStatus === 'mismatch' },
      canUseAsReference: canEditQuoting(actor, state),
    };
    try {
      let oldest = this.now().getTime();
      const seen = (at: number) => {
        oldest = Math.min(oldest, at);
      };
      const erfs = await Promise.all(
        erfNumbers.map(async (n) => {
          const erf = await this.getErf(n);
          seen(erf.at);
          return { n, erf: erf.value };
        }),
      );
      let spr: PricingSpr[] = [];
      if (customerName) {
        const history = await this.sprHistory(customerName);
        seen(history.at);
        spr = history.value;
      }

      const erfRecords = erfs.map((e) => e.erf).filter((e): e is PricingErf => e !== null);
      const context: PricingContext = {
        source: this.source(oldest, null),
        ...base,
        erfRecords,
        sprHistory: spr,
        notFound: { erf: erfs.filter((e) => !e.erf).map((e) => e.n) },
      };
      return { quoteId: q.id, context: redact(context, actor) };
    } catch (err) {
      const code = pricingErrorCode(err);
      this.opts.logger.warn({ op: 'context', code }, 'pricing app read failed; manual references');
      const context: PricingContext = {
        source: this.source(null, unavailableMessage(code)),
        ...base,
        erfRecords: [],
        sprHistory: [],
        notFound: { erf: [] },
      };
      return { quoteId: q.id, context: redact(context, actor) };
    }
  }
}
