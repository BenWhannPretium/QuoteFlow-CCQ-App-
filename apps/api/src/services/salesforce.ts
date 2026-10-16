import type {
  ErfLinkageResponse,
  ErfLinkageRow,
  SfAccount,
  SfOpportunity,
  SfOpportunityDetail,
  SfOpportunitySearchResponse,
  SfOpportunitySummary,
  SfProductSpec,
} from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import {
  getCustomerBySfAccountId,
  getSetting,
  getSfOpportunity,
  listActiveQuotesForOpportunities,
  listQuoteErfLinkage,
  listSfStageMap,
  searchSfOpportunitySnapshots,
  upsertSfOpportunities,
  type SfOpportunitySnapshot,
} from '@ccq/db/repos';
import {
  DEFAULT_SUSPECT_AMOUNT_BELOW,
  opportunityQualityFlags,
  searchTerms,
  sfErrorCode,
  type SalesforceReader,
  type SfLogger,
  type SfOpportunityRecord,
} from '@ccq/integrations';

import { snapshotRow } from '../jobs/sfSync';

/**
 * Salesforce reads for the intake picker and the opportunity panel. Snapshot first (fast, works when
 * SF is down), SF live as the fallback/refresh. Read-only toward SF; the only write is refreshing the
 * local snapshot copy.
 */

/** Below this many snapshot hits, the search also asks SF live. */
export const LIVE_SEARCH_MIN_HITS = 5;
/** How long a live opportunity read is reused. */
export const DETAIL_CACHE_MS = 60_000;

export interface SfCaller {
  email: string | null;
  upn: string;
}

type WithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export async function suspectThreshold(db: DbOrTx): Promise<number> {
  const value = await getSetting<number | null>(db, 'sf_amount_suspect_below_usd');
  return typeof value === 'number' ? value : DEFAULT_SUSPECT_AMOUNT_BELOW;
}

/**
 * How the caller is matched to the SF opportunity owner for `mine=true`: their email and UPN
 * (lower case), and the UPN's local part as an alias (SF aliases are at most 8 characters).
 */
export function ownerMatch(caller: SfCaller) {
  const emails = [
    ...new Set([caller.email, caller.upn].filter(Boolean).map((e) => e!.toLowerCase())),
  ];
  const local = caller.upn.split('@')[0]?.toLowerCase() ?? '';
  return { emails, aliases: local ? [local.slice(0, 8)] : [] };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function opportunityFromSnapshot(
  row: SfOpportunitySnapshot,
  threshold: number,
): SfOpportunity {
  const base = {
    id: row.sfOpportunityId,
    name: row.name,
    accountId: row.accountId,
    accountName: row.accountName,
    ownerId: null,
    ownerName: row.ownerName,
    ownerAlias: row.ownerAlias,
    ownerEmail: row.ownerEmail,
    amount: row.amount,
    closeDate: row.closeDate,
    stage: row.sfStage,
    isClosed: row.isClosed,
    isWon: row.isWon,
    erfNumber: row.erfNumberSf,
    quoteSource: row.quoteSourceSf,
    systemModstamp: iso(row.systemModstamp),
  };
  return { ...base, dataQuality: opportunityQualityFlags(base, { suspectAmountBelow: threshold }) };
}

const summary = (
  o: SfOpportunity,
  source: SfOpportunitySummary['source'],
  threshold: number,
): SfOpportunitySummary => ({
  id: o.id,
  name: o.name,
  accountId: o.accountId,
  accountName: o.accountName,
  ownerAlias: o.ownerAlias,
  ownerEmail: o.ownerEmail,
  amount: o.amount,
  closeDate: o.closeDate,
  stage: o.stage,
  isClosed: o.isClosed,
  erfNumber: o.erfNumber,
  quoteSource: o.quoteSource,
  // Recomputed so the current threshold setting applies to live rows too.
  dataQuality: opportunityQualityFlags(o, { suspectAmountBelow: threshold }),
  source,
  activeQuote: null,
});

export interface SearchParams {
  q: string;
  mine: boolean;
  openOnly: boolean;
  limit: number;
}

/**
 * B-07: mark opportunities that already have an active CCQ quote the caller can see, so the intake
 * picker offers "Open existing" instead (one active quote per opportunity).
 */
async function withActiveQuotes(
  withTx: WithTx,
  res: SfOpportunitySearchResponse,
): Promise<SfOpportunitySearchResponse> {
  if (res.items.length === 0) return res;
  const active = await withTx((tx) =>
    listActiveQuotesForOpportunities(
      tx,
      res.items.map((i) => i.id),
    ),
  );
  const byOpp = new Map(active.map((q) => [q.sfOpportunityId, q]));
  return {
    ...res,
    items: res.items.map((i) => {
      const q = byOpp.get(i.id);
      return q
        ? {
            ...i,
            activeQuote: { quoteNumber: q.quoteNumber, stageKey: q.stageKey, status: q.status },
          }
        : i;
    }),
  };
}

export class SalesforceService {
  private readonly cache = new Map<
    string,
    { at: number; record: SfOpportunityRecord | null; specs: SfProductSpec[] }
  >();

  constructor(
    private readonly reader: SalesforceReader,
    private readonly logger: SfLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Snapshot search (trigram on name + account); SF live when there are fewer than 5 hits. */
  async search(
    withTx: WithTx,
    caller: SfCaller,
    p: SearchParams,
  ): Promise<SfOpportunitySearchResponse> {
    const terms = searchTerms(p.q);
    const owner = p.mine ? ownerMatch(caller) : undefined;
    const { rows, threshold } = await withTx(async (tx) => ({
      rows: await searchSfOpportunitySnapshots(tx, {
        terms,
        owner,
        openOnly: p.openOnly,
        limit: p.limit,
      }),
      threshold: await suspectThreshold(tx),
    }));
    const items = rows.map((r) =>
      summary(opportunityFromSnapshot(r, threshold), 'snapshot', threshold),
    );
    if (items.length >= LIVE_SEARCH_MIN_HITS || items.length >= p.limit) {
      return withActiveQuotes(withTx, { items, liveSearched: false, liveError: null });
    }
    // SF filters owners by email only; with no email on the caller, `mine` can't be asked live.
    if (p.mine && !owner?.emails[0]) {
      return withActiveQuotes(withTx, { items, liveSearched: false, liveError: null });
    }

    try {
      const live = await this.reader.searchOpportunities({
        q: p.q,
        ownerEmail: p.mine ? owner!.emails[0] : undefined,
        openOnly: p.openOnly,
        limit: p.limit,
      });
      const seen = new Set(items.map((i) => i.id));
      for (const o of live) {
        if (items.length >= p.limit) break;
        if (!seen.has(o.id)) items.push(summary(o, 'live', threshold));
      }
      return withActiveQuotes(withTx, { items, liveSearched: true, liveError: null });
    } catch (err) {
      const code = sfErrorCode(err);
      this.logger.warn(
        { code, hits: items.length },
        'sf live search failed; snapshot results only',
      );
      return withActiveQuotes(withTx, {
        items,
        liveSearched: true,
        liveError: `Salesforce search unavailable (${code})`,
      });
    }
  }

  /** Live read, cached for 60 s per opportunity. */
  private async live(id: string) {
    const hit = this.cache.get(id);
    const nowMs = this.now().getTime();
    if (hit && nowMs - hit.at < DETAIL_CACHE_MS) return { ...hit, cached: true };
    const [record, specs] = await Promise.all([
      this.reader.getOpportunity(id),
      this.reader.getProductSpecs(id),
    ]);
    const entry = { at: nowMs, record, specs };
    this.cache.set(id, entry);
    if (this.cache.size > 500) {
      for (const [key, value] of this.cache) {
        if (nowMs - value.at >= DETAIL_CACHE_MS) this.cache.delete(key);
      }
    }
    return { ...entry, cached: false };
  }

  /** Snapshot + live refresh. Null when neither the snapshot nor SF knows the id. */
  async detail(withTx: WithTx, id: string): Promise<SfOpportunityDetail | null> {
    let live: Awaited<ReturnType<SalesforceService['live']>> | null = null;
    let liveError: string | null = null;
    try {
      live = await this.live(id);
    } catch (err) {
      const code = sfErrorCode(err);
      liveError = `Salesforce unavailable (${code}); showing the last synced copy`;
      this.logger.warn({ code, sfOpportunityId: id }, 'sf live read failed; using snapshot');
    }

    return withTx(async (tx) => {
      const threshold = await suspectThreshold(tx);
      // A fresh live read refreshes the local copy (skipped when SystemModstamp is unchanged).
      if (live?.record && !live.cached) {
        await upsertSfOpportunities(tx, [snapshotRow(live.record, this.now(), threshold)]);
      }
      const snapshot = await getSfOpportunity(tx, id);
      const opportunity = live?.record
        ? live.record.opportunity
        : snapshot
          ? opportunityFromSnapshot(snapshot, threshold)
          : null;
      if (!opportunity) return null;

      let account: SfAccount | null = live?.record?.account ?? null;
      if (!account && opportunity.accountId) {
        const customer = await getCustomerBySfAccountId(tx, opportunity.accountId);
        if (customer) {
          account = {
            id: opportunity.accountId,
            name: customer.name,
            shipTo: (customer.defaultShipTo as SfAccount['shipTo']) ?? null,
          };
        }
      }
      const stageMap = await listSfStageMap(tx);
      const hint = stageMap.find((m) => m.sfStage === opportunity.stage)?.ccqStageHint ?? null;
      return {
        opportunity: {
          ...opportunity,
          dataQuality: opportunityQualityFlags(opportunity, { suspectAmountBelow: threshold }),
        },
        account,
        productSpecs: live?.specs ?? [],
        ccqStageHint: hint,
        snapshotSyncedAt: iso(snapshot?.syncedAt ?? null),
        liveRefreshedAt: live ? new Date(live.at).toISOString() : null,
        liveError,
        deletedInSf: (live !== null && live.record === null) || snapshot?.deletedInSfAt != null,
      };
    });
  }
}

/** Compare ERF numbers ignoring case, spacing, punctuation and an "ERF" prefix ("ERF-123" = "erf 123"). */
export function normaliseErf(value: string | null): string | null {
  if (!value) return null;
  const n = value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^erf/, '');
  return n === '' ? null : n;
}

export function erfLinkage(sf: string | null, ccq: string | null): ErfLinkageRow['linkage'] {
  const a = normaliseErf(sf);
  const b = normaliseErf(ccq);
  if (!a && !b) return 'both_missing';
  if (a && !b) return 'sf_only';
  if (!a && b) return 'ccq_only';
  return a === b ? 'match' : 'mismatch';
}

export async function erfLinkageReport(tx: DbOrTx): Promise<ErfLinkageResponse> {
  const rows = await listQuoteErfLinkage(tx);
  const items: ErfLinkageRow[] = rows.map((r) => {
    const linkage = erfLinkage(r.sfErfNumber, r.ccqErfNumber);
    return { ...r, linkage, mismatch: linkage === 'mismatch' };
  });
  const quotes = items.length;
  const sfLinked = items.filter((i) => normaliseErf(i.sfErfNumber)).length;
  return {
    items,
    summary: {
      quotes,
      sfLinked,
      sfLinkedPct: quotes === 0 ? 0 : sfLinked / quotes,
      ccqLinked: items.filter((i) => normaliseErf(i.ccqErfNumber)).length,
      mismatches: items.filter((i) => i.mismatch).length,
    },
  };
}
