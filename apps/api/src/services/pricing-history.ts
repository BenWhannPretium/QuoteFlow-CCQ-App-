import type { Readable } from 'node:stream';

import {
  PRICING_APP_PROBLEM_CODES,
  type PricingContext,
  type PricingErf,
  type PricingErfResponse,
  type PricingHistoryImportResponse,
  type PricingHistoryKind,
  type PricingHistorySearchQuery,
  type PricingHistorySearchResponse,
  type PricingHistorySheetSummary,
  type PricingHistorySource,
  type PricingHistoryStatusResponse,
} from '@ccq/contracts';
import { withSystemContext, type Database, type DbOrTx, type Tx } from '@ccq/db';
import {
  countPricingHistory,
  existingPricingHistoryIds,
  finishIntegrationRun,
  getCustomer,
  getPricingHistoryByNumber,
  getPricingRecord,
  getQuoteByNumber,
  getSfOpportunity,
  listIntegrationRuns,
  listPricingHistoryByNumbers,
  listPricingHistoryForCustomer,
  loadQuoteState,
  searchPricingHistory,
  startIntegrationRun,
  upsertPricingHistory,
  type PricingHistoryRecordRow,
} from '@ccq/db/repos';
import { canEditQuoting, redact, type Actor } from '@ccq/domain';
import {
  PricingExportError,
  customerKey,
  mapExportRow,
  readPricingExport,
  requestNumberKey,
  toErf,
  toHistoryRecord,
  toSpr,
  type PricingHistoryRow,
} from '@ccq/integrations';

import { recordValues } from './pricing-view';
import { ServiceProblem } from './problem';
import { erfLinkage } from './salesforce';
import { recordAudit, type AuditMeta } from '../plugins/audit';

/**
 * B-15 (F-11), revised 2026-10-22: **pricing history**. There is no live connection to the legacy
 * pricing app (unsupported .NET, being retired as QuoteFlow takes over its job). An Admin imports
 * Cory McGahan's export (ERF, BPR, SPR sheets) and CCQ reads it from its own database:
 *
 * - lookups and search for the commercial roles (RLS also limits the table to them);
 * - a quote's pricing context: its legacy ERF numbers resolved, the customer's other ERFs and SPR
 *   history (matched by customer name: the export has no Salesforce id). No BPR on a quote (B-26);
 *   BPRs show only in the Pricing history search;
 * - the import: check (dry run) or apply, upsert by kind + request id, one integration_run and one
 *   audit row per applied import. Nothing is deleted.
 *
 * Logs carry counts and codes only, never row contents.
 */

export const PRICING_HISTORY_SOURCE = 'pricing';
export const MAX_CONTEXT_REFS = 10;
export const CUSTOMER_ERFS = 10;
export const CUSTOMER_SPRS = 20;
const BATCH = 500;

export type PricingWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export class PricingHistoryError extends ServiceProblem {
  override name = 'PricingHistoryError';
}

type Log = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
};

const kindOf = (r: PricingHistoryRecordRow) => r.kind as PricingHistoryKind;
const stored = (r: PricingHistoryRecordRow) => ({
  ...r,
  kind: kindOf(r),
  status: r.status as PricingHistoryRow['status'],
  fields: r.fields as PricingHistoryRow['fields'],
});

/** Unique references by lookup key; the first spelling is kept. */
function uniqueRefs(values: (string | null | undefined)[]): { ref: string; key: string }[] {
  const seen = new Set<string>();
  const out: { ref: string; key: string }[] = [];
  for (const v of values) {
    const ref = v?.trim();
    if (!ref) continue;
    const key = requestNumberKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ref, key });
  }
  return out;
}

export class PricingHistoryService {
  private readonly now: () => Date;

  constructor(
    private readonly opts: {
      log: Log;
      /** For recording a failed import after its transaction rolled back. */
      database?: Database | undefined;
      now?: () => Date;
    },
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /** What is loaded (as the caller may see it) and when it was last imported. */
  private async source(tx: DbOrTx): Promise<PricingHistorySource> {
    const [counts, runs] = await Promise.all([
      countPricingHistory(tx),
      listIntegrationRuns(tx, { source: PRICING_HISTORY_SOURCE, limit: 10 }),
    ]);
    const last = runs.find((r) => r.status === 'succeeded');
    return {
      imported: counts.erf + counts.bpr + counts.spr > 0,
      importedAt: last ? (last.finishedAt ?? last.startedAt).toISOString() : null,
      counts,
    };
  }

  /** GET /pricing/erf/:erfNumber: the newest ERF with this number. */
  async erf(withTx: PricingWithTx, actor: Actor, erfNumber: string): Promise<PricingErfResponse> {
    return withTx(async (tx) => {
      const rows = await getPricingHistoryByNumber(tx, 'erf', requestNumberKey(erfNumber));
      if (rows.length === 0) {
        throw new PricingHistoryError(
          404,
          PRICING_APP_PROBLEM_CODES.notFound,
          'The pricing history has no ERF with this number',
        );
      }
      return redact(
        {
          source: await this.source(tx),
          erfRecord: toErf(stored(rows[0]!)),
          sameNumber: rows.length - 1,
        },
        actor,
      );
    });
  }

  /** GET /pricing/history?kind=&customer=&q=: newest first, at most `limit`. */
  async search(
    withTx: PricingWithTx,
    actor: Actor,
    q: PricingHistorySearchQuery,
  ): Promise<PricingHistorySearchResponse> {
    return withTx(async (tx) => {
      const rows = await searchPricingHistory(tx, {
        kind: q.kind,
        customer: q.customer,
        q: q.q,
        fiscalYearFrom: q.fiscalYearFrom,
        fiscalYearTo: q.fiscalYearTo,
        limit: q.limit,
      });
      return redact(
        {
          source: await this.source(tx),
          historyRecords: rows.map((r) => toHistoryRecord(stored(r))),
          truncated: rows.length >= q.limit,
        },
        actor,
      );
    });
  }

  /**
   * GET /quotes/:qn/pricing-context: the quote's legacy ERF numbers (quote.erf_number, the pricing
   * record's Legacy ERF #, the SF ERF number) resolved in the history, the customer's other ERFs and
   * SPR history. The quote is read under RLS (404 when out of scope). Before the first import the
   * lists are empty and `source.imported` is false.
   */
  async context(
    withTx: PricingWithTx,
    actor: Actor,
    quoteNumber: string,
  ): Promise<{ quoteId: string; context: PricingContext }> {
    return withTx(async (tx) => {
      const q = await getQuoteByNumber(tx, quoteNumber);
      if (!q) {
        throw new PricingHistoryError(
          404,
          PRICING_APP_PROBLEM_CODES.notFound,
          `No quote ${quoteNumber}`,
        );
      }
      const [state, record, opportunity, customer] = await Promise.all([
        loadQuoteState(tx, q.id),
        getPricingRecord(tx, q.id),
        getSfOpportunity(tx, q.sfOpportunityId),
        q.customerId ? getCustomer(tx, q.customerId) : Promise.resolve(undefined),
      ]);
      const values = recordValues(record);
      const refs = {
        quoteErfNumber: q.erfNumber,
        sfErfNumber: opportunity?.erfNumberSf ?? null,
        erfRefs: values?.erfRefs ?? [],
      };
      const linkageStatus = erfLinkage(refs.sfErfNumber, refs.quoteErfNumber);
      const wanted = uniqueRefs([refs.quoteErfNumber, ...refs.erfRefs, refs.sfErfNumber]).slice(
        0,
        MAX_CONTEXT_REFS,
      );
      const keys = wanted.map((w) => w.key);
      const found = await listPricingHistoryByNumbers(tx, 'erf', keys);
      // Newest row per number (numbers repeat in the export), in the order the refs were given.
      const byKey = new Map<string, PricingHistoryRecordRow>();
      for (const r of found) if (!byKey.has(r.requestNumberKey)) byKey.set(r.requestNumberKey, r);
      const erfRecords: PricingErf[] = wanted
        .map((w) => byKey.get(w.key))
        .filter((r): r is PricingHistoryRecordRow => !!r)
        .map((r) => toErf(stored(r)));

      const matchName = customer?.name ?? opportunity?.accountName ?? null;
      const key = customerKey(matchName);
      const [customerErfs, sprHistory] = key
        ? await Promise.all([
            listPricingHistoryForCustomer(tx, 'erf', key, CUSTOMER_ERFS, keys),
            listPricingHistoryForCustomer(tx, 'spr', key, CUSTOMER_SPRS),
          ])
        : [[], []];

      const context: PricingContext = {
        source: await this.source(tx),
        refs,
        linkage: { status: linkageStatus, mismatch: linkageStatus === 'mismatch' },
        erfRecords,
        notFound: { erf: wanted.filter((w) => !byKey.has(w.key)).map((w) => w.ref) },
        customerMatch: key ? matchName : null,
        customerErfs: customerErfs.map((r) => toErf(stored(r))),
        sprHistory: sprHistory.map((r) => toSpr(stored(r))),
        canUseAsReference: state ? canEditQuoting(actor, state) : false,
      };
      return { quoteId: q.id, context: redact(context, actor) };
    });
  }

  /** GET /admin/pricing-history */
  async status(withTx: PricingWithTx): Promise<PricingHistoryStatusResponse> {
    return withTx(async (tx) => ({
      source: await this.source(tx),
      imports: (await listIntegrationRuns(tx, { source: PRICING_HISTORY_SOURCE, limit: 10 })).map(
        (r) => ({
          runId: r.id,
          at: (r.finishedAt ?? r.startedAt).toISOString(),
          status: r.status,
          counts: r.counts as Record<string, number>,
          error: r.error,
        }),
      ),
    }));
  }

  /**
   * POST /admin/pricing-history/import: read the export (streamed), map every row, and either report
   * (`apply` false: nothing is written) or upsert it all in one transaction with one integration_run
   * and one audit row. A file error is a 422; a failed apply rolls back and records a failed run.
   */
  async import(
    withTx: PricingWithTx,
    actor: Actor,
    meta: AuditMeta,
    file: { fileName: string; stream: Readable },
    apply: boolean,
  ): Promise<PricingHistoryImportResponse> {
    const started = this.now();
    const t0 = Date.now();
    try {
      return await withTx(async (tx) => {
        const run = apply ? await startIntegrationRun(tx, PRICING_HISTORY_SOURCE, started) : null;
        const sheets: PricingHistorySheetSummary[] = [];
        const written = { inserted: 0, updated: 0, unchanged: 0 };

        for await (const sheet of readPricingExport(file.stream)) {
          const summary: PricingHistorySheetSummary = {
            kind: sheet.kind,
            sheet: sheet.sheet,
            rows: 0,
            valid: 0,
            skipped: 0,
            duplicateNumbers: 0,
            zeroAsUnknown: 0,
            fiscalYears: { from: null, to: null },
            missingColumns: sheet.missingColumns,
            newRows: 0,
            existingRows: 0,
          };
          const numbers = new Map<string, number>();
          let batch: PricingHistoryRow[] = [];
          const flush = async () => {
            if (batch.length === 0) return;
            const existing = await existingPricingHistoryIds(
              tx,
              sheet.kind,
              batch.map((r) => r.requestId),
            );
            summary.existingRows += existing.size;
            summary.newRows += batch.length - existing.size;
            if (run) {
              const counts = await upsertPricingHistory(
                tx,
                batch.map((r) => ({ ...r, importRunId: run.id, createdBy: actor.userId })),
              );
              written.inserted += counts.inserted;
              written.updated += counts.updated;
              written.unchanged += counts.unchanged;
            }
            batch = [];
          };
          const seenIds = new Set<number>();
          for await (const raw of sheet.rows) {
            summary.rows++;
            const { row, zeroAsUnknown } = mapExportRow(sheet.kind, raw);
            if (!row || seenIds.has(row.requestId)) {
              summary.skipped++;
              continue;
            }
            seenIds.add(row.requestId);
            summary.valid++;
            summary.zeroAsUnknown += zeroAsUnknown;
            numbers.set(row.requestNumberKey, (numbers.get(row.requestNumberKey) ?? 0) + 1);
            const fy = summary.fiscalYears;
            fy.from = fy.from === null ? row.fiscalYear : Math.min(fy.from, row.fiscalYear);
            fy.to = fy.to === null ? row.fiscalYear : Math.max(fy.to, row.fiscalYear);
            batch.push(row);
            if (batch.length >= BATCH) await flush();
          }
          await flush();
          summary.duplicateNumbers = [...numbers.values()].filter((n) => n > 1).length;
          sheets.push(summary);
        }

        const counts: Record<string, number> = { ...written };
        for (const s of sheets) {
          counts[`${s.kind}Rows`] = s.valid;
          counts[`${s.kind}Skipped`] = s.skipped;
        }
        if (run) {
          await finishIntegrationRun(tx, run.id, {
            status: 'succeeded',
            finishedAt: this.now(),
            counts,
          });
          await recordAudit(tx, actor, meta, {
            action: 'upload',
            entity: 'pricing_history_import',
            entityId: run.id,
            after: { fileName: file.fileName, counts },
            at: this.now(),
          });
        }
        this.opts.log.info(
          { applied: apply, ...counts, ms: Date.now() - t0 },
          apply ? 'pricing history imported' : 'pricing history checked',
        );
        return {
          applied: apply,
          fileName: file.fileName,
          sheets,
          written: run ? written : null,
          runId: run?.id ?? null,
          durationMs: Date.now() - t0,
        };
      });
    } catch (err) {
      const code = err instanceof PricingExportError ? err.code : 'IMPORT_FAILED';
      // The cause's name / code only (a message can echo file contents).
      const cause = (err instanceof PricingExportError ? err.cause : err) as
        { name?: unknown; code?: unknown } | undefined;
      this.opts.log.warn(
        { applied: apply, code, cause: { name: cause?.name, code: cause?.code } },
        'pricing history import failed',
      );
      if (apply && this.opts.database) {
        // The transaction rolled back: record the failure on its own so Admin → Integrations shows it.
        await withSystemContext(this.opts.database, async (tx) => {
          const run = await startIntegrationRun(tx, PRICING_HISTORY_SOURCE, started);
          await finishIntegrationRun(tx, run.id, {
            status: 'failed',
            finishedAt: this.now(),
            error: code,
          });
        }).catch(() => {});
      }
      if (err instanceof PricingExportError) {
        throw new PricingHistoryError(422, PRICING_APP_PROBLEM_CODES.invalidFile, err.message);
      }
      throw err;
    }
  }
}
