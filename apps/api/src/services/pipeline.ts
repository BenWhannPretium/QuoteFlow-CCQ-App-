import {
  PIPELINE_PROBLEM_CODES,
  QUOTE_EXPORT_MAX_ROWS,
  QUOTE_LIST_COLUMN_KEYS,
  QUOTE_LIST_COLUMNS,
  QUOTE_LIST_DEFAULT_COLUMNS,
  QUOTE_SORT_DEFAULT_DIR,
  type BoardAction,
  type BoardCard,
  type BoardColumn,
  type BoardParams,
  type BoardResponse,
  type CapitalReadiness,
  type QuoteExportParams,
  type QuoteFilters,
  type QuoteListColumnKey,
  type QuoteListItem,
  type QuoteListParams,
  type QuoteListResponse,
  type QuoteSortKey,
} from '@ccq/contracts';
import type { Tx } from '@ccq/db';
import {
  listPipelineKeys,
  listPipelinePeople,
  listPipelineRows,
  loadQuoteStates,
  loadWorkflowConfigInput,
  type PipelineKey,
  type PipelineRow,
  type PipelineSqlFilter,
} from '@ccq/db/repos';
import {
  availableActions,
  can,
  canSeeCommercialFields,
  compareSfStage,
  daysSince,
  exportColumnsFor,
  hasPermission,
  holdsPermission,
  isValidityLapsed,
  parseWorkflowConfig,
  personInitials,
  qualificationWarnings,
  seesPeerPriority,
  type Actor,
  type WorkflowConfig,
} from '@ccq/domain';

import { csvCell } from './auditAdmin';
import { productSummary } from './final-review';
import { ServiceProblem } from './problem';
import { summaryDto, type QuoteReadService, type QuoteViewContext } from './quotes';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type PipelineWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;

export interface PipelineServiceOptions {
  quotes: QuoteReadService;
  now?: () => Date;
}

interface Scope {
  ctx: QuoteViewContext;
  workflow: WorkflowConfig;
  terminal: string[];
}

/**
 * B-14 pipeline views (F-07): the quote list and prioritization view (`GET /quotes`), the kanban board
 * (`GET /quotes/board`) and the CSV export (`GET /quotes/export.csv`). All three share one filter set and
 * one query, so a shared link shows the same quotes everywhere.
 *
 * Scope is enforced twice: RLS in SQL, then the domain policy (`can(actor, 'quote.read', quote)`) row by
 * row. Priority is withheld per `kam_can_see_peer_scores` (and can't be filtered or sorted on for peers),
 * and commercial columns are stripped for roles without `quote.read.commercialFields`.
 */
export class PipelineService {
  private readonly now: () => Date;

  constructor(private readonly opts: PipelineServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  private async scope(tx: Tx, actor: Actor, now: Date): Promise<Scope> {
    const [ctx, workflowInput] = await Promise.all([
      this.opts.quotes.context(tx, actor, now),
      loadWorkflowConfigInput(tx),
    ]);
    const workflow = parseWorkflowConfig(workflowInput);
    return { ctx, workflow, terminal: workflow.stages.filter((s) => s.terminal).map((s) => s.key) };
  }

  /** The URL filters as SQL filters: `me`, `unassigned`, ids checked, aging as an instant. */
  private sqlFilter(actor: Actor, f: QuoteFilters, now: Date): PipelineSqlFilter {
    const people = (values: string[] | undefined, key: string, extra: string[] = []) => {
      if (!values?.length) return undefined;
      const ids = values
        .filter((v) => !extra.includes(v))
        .map((v) => (v === 'me' ? actor.userId : v));
      const bad = ids.find((v) => !UUID.test(v));
      if (bad) {
        throw new ServiceProblem(400, PIPELINE_PROBLEM_CODES.badFilter, `Unknown ${key}: ${bad}`);
      }
      return ids;
    };
    return {
      q: f.q,
      stageKeys: f.stage,
      tiers: f.tier,
      kamUserIds: people(f.kam, 'KAM'),
      engineerIds: people(f.engineer, 'engineer', ['unassigned']),
      includeUnassigned: f.engineer?.includes('unassigned'),
      productFamilies: f.productFamily,
      markets: f.market,
      resins: f.resin,
      status: f.status,
      enteredStageBefore:
        f.agedOverDays !== undefined
          ? new Date(now.getTime() - f.agedOverDays * DAY_MS)
          : undefined,
      closeDateFrom: f.closeDateFrom,
      closeDateTo: f.closeDateTo,
    };
  }

  /**
   * Every matching quote the caller may read, in order: SQL (RLS) → domain policy → the filters only
   * the domain can compute (qualification warnings, SF mismatch).
   */
  private async matching(
    tx: Tx,
    actor: Actor,
    s: Scope,
    filters: QuoteFilters,
    sort: QuoteSortKey,
    dir: 'asc' | 'desc',
  ): Promise<PipelineKey[]> {
    const { ctx, terminal } = s;
    const keys = await listPipelineKeys(tx, {
      filter: this.sqlFilter(actor, filters, ctx.now),
      sort,
      dir,
      priorityOwnerOnly: seesPeerPriority(actor, ctx.kamCanSeePeerScores)
        ? undefined
        : actor.userId,
      tierOrder: [...(ctx.model?.tiers ?? [])].sort((a, b) => b.min - a.min).map((t) => t.key),
    });
    return keys.filter((k) => {
      const resource = {
        kamUserId: k.kamUserId as Actor['userId'],
        assignedEngineerId: k.assignedEngineerId as Actor['userId'] | null,
        stageKey: k.stageKey,
        ...(k.region ? { region: k.region } : {}),
        ...(k.accountId ? { accountId: k.accountId } : {}),
      };
      if (!can(actor, 'quote.read', resource)) return false;
      if (filters.hasWarnings !== undefined) {
        const warned =
          qualificationWarnings(ctx.qualification, {
            quote: { est_annual_revenue: k.estAnnualRevenue, est_annual_volume: k.estAnnualVolume },
            eng_review: { process_type: k.processType },
          }).length > 0;
        if (warned !== filters.hasWarnings) return false;
      }
      if (filters.sfMismatch !== undefined) {
        const mismatch = compareSfStage({
          ccqStageKey: k.stageKey,
          sfStage: k.sfStage,
          map: ctx.outcome.sfStageMap,
          terminalStageKeys: terminal,
        }).mismatch;
        if (mismatch !== filters.sfMismatch) return false;
      }
      return true;
    });
  }

  /** Wide rows for `keys`, in `keys`' order. */
  private static async rows(tx: Tx, keys: readonly PipelineKey[]): Promise<PipelineRow[]> {
    const rows = await listPipelineRows(
      tx,
      keys.map((k) => k.id),
    );
    const byId = new Map(rows.map((r) => [r.quote.id, r]));
    return keys.map((k) => byId.get(k.id)).filter((r): r is PipelineRow => !!r);
  }

  private static item(row: PipelineRow, s: Scope): QuoteListItem {
    const { ctx, workflow, terminal } = s;
    const q = row.quote;
    const entered = row.stageEnteredAt ? new Date(row.stageEnteredAt) : q.updatedAt;
    const label = (key: string) => workflow.stages.find((st) => st.key === key)?.label ?? key;
    return {
      ...summaryDto(row, ctx),
      amount: row.amount,
      accountName: row.accountName ?? row.customerName ?? null,
      productSummary: productSummary(q),
      assignedEngineerId: q.assignedEngineerId,
      assignedEngineerName: row.engineerName ?? null,
      stageEnteredAt: entered.toISOString(),
      daysInStage: daysSince(entered, ctx.now),
      sfStage: row.sfStage ?? null,
      sfMismatch: compareSfStage({
        ccqStageKey: q.stageKey,
        sfStage: row.sfStage,
        map: ctx.outcome.sfStageMap,
        terminalStageKeys: terminal,
        stageLabel: label,
      }).mismatch,
      validityUntil: q.validityUntil,
      validityExpired: q.status !== 'closed' && isValidityLapsed(q.validityUntil, ctx.now),
      updatedAt: q.updatedAt.toISOString(),
      commercial: canSeeCommercialFields(ctx.actor)
        ? {
            prelimCapitalUsd: row.prelimCapitalUsd ?? null,
            capitalReadiness: (row.capitalReadiness ?? null) as CapitalReadiness | null,
          }
        : null,
    };
  }

  /** `GET /quotes`: one page of the list (also the prioritization view, sorted by score). */
  async list(
    withTx: PipelineWithTx,
    actor: Actor,
    params: QuoteListParams,
  ): Promise<QuoteListResponse> {
    const now = this.now();
    const sort = params.sort ?? 'updated';
    const dir = params.dir ?? QUOTE_SORT_DEFAULT_DIR[sort];
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
    return withTx(async (tx) => {
      const s = await this.scope(tx, actor, now);
      const keys = await this.matching(tx, actor, s, params, sort, dir);
      const pageKeys = keys.slice((page - 1) * pageSize, page * pageSize);
      const rows = await PipelineService.rows(tx, pageKeys);
      return {
        items: rows.map((r) => PipelineService.item(r, s)),
        total: keys.length,
        page,
        pageSize,
        sort,
        dir,
        canExport: hasPermission(actor, 'export.csv'),
        commercialVisible: canSeeCommercialFields(actor),
        peerPriorityVisible: seesPeerPriority(actor, s.ctx.kamCanSeePeerScores),
        filterOptions: await listPipelinePeople(tx),
      };
    });
  }

  /**
   * `GET /quotes/board`: one column per stage (config order). Terminal stages are summed into the
   * "Closed" lane and their cards are only loaded with `includeClosed`. Each open card carries the gate
   * actions the caller may take on it now (the domain's `availableActions`); the board offers a column
   * as a drop target only when one of them leads there.
   */
  async board(withTx: PipelineWithTx, actor: Actor, params: BoardParams): Promise<BoardResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const s = await this.scope(tx, actor, now);
      const { workflow, terminal, ctx } = s;
      const keys = await this.matching(tx, actor, s, params, 'tier', 'desc');
      const isTerminal = new Set(terminal);
      const includeClosed = params.includeClosed ?? false;
      const shown = keys.filter((k) => includeClosed || !isTerminal.has(k.stageKey));
      const rows = await PipelineService.rows(tx, shown);

      // Gate actions only where the caller decides the gate of the card's stage (cheap pre-filter),
      // then the domain decides with the full state (scope, own/assigned, segregation, approver tier).
      const decidable = new Set(
        workflow.gates
          .filter((g) => g.enabled && holdsPermission(actor, g.deciderPermission))
          .map((g) => g.stageKey),
      );
      const candidates = rows.filter(
        (r) => r.quote.status !== 'closed' && decidable.has(r.quote.stageKey),
      );
      const states = await loadQuoteStates(
        tx,
        candidates.map((r) => r.quote.id),
      );
      const actionsFor = (id: string): BoardAction[] => {
        const state = states.get(id);
        if (!state) return [];
        return availableActions(workflow, state, actor, {
          approverTiers: ctx.release.approverTiers,
        }).map((a) => ({
          gateKey: a.gateKey,
          gateLabel: a.gateLabel,
          outcomeKey: a.outcomeKey,
          outcomeLabel: a.outcomeLabel,
          targetStageKeys: a.targetStageKeys,
          nextStatus: a.nextStatus,
        }));
      };

      const cardsBy = new Map<string, BoardCard[]>();
      for (const row of rows) {
        const item = PipelineService.item(row, s);
        const card: BoardCard = {
          id: item.id,
          quoteNumber: item.quoteNumber,
          stageKey: item.stageKey,
          status: item.status,
          priorityVisible: item.priority.visible,
          score: item.priority.score,
          tier: item.priority.tier,
          tierLabel: item.priority.tierLabel,
          tierOverridden: item.priority.tierOverridden,
          accountName: item.accountName,
          productSummary: item.productSummary,
          estAnnualVolume: item.estAnnualVolume,
          amount: item.amount,
          kamUserId: item.kamUserId,
          kamName: item.kamName,
          kamInitials: personInitials(item.kamName),
          stageEnteredAt: item.stageEnteredAt,
          daysInStage: item.daysInStage,
          warnings: [
            ...item.warnings.map((w) => w.message),
            ...(item.validityExpired ? ['The proposal’s validity has passed'] : []),
            ...(item.sfMismatch ? [`Salesforce stage “${item.sfStage}” disagrees`] : []),
          ],
          actions: actionsFor(item.id),
        };
        const list = cardsBy.get(card.stageKey);
        if (list) list.push(card);
        else cardsBy.set(card.stageKey, [card]);
      }

      const totals = new Map<string, { count: number; amount: number }>();
      for (const k of keys) {
        const t = totals.get(k.stageKey) ?? { count: 0, amount: 0 };
        t.count += 1;
        t.amount += k.amount ?? 0;
        totals.set(k.stageKey, t);
      }
      const columns: BoardColumn[] = workflow.stages.map((st) => ({
        stageKey: st.key,
        label: st.label,
        terminal: st.terminal,
        count: totals.get(st.key)?.count ?? 0,
        totalAmount: round2(totals.get(st.key)?.amount ?? 0),
        cards: cardsBy.get(st.key) ?? [],
      }));
      const closed = columns.filter((c) => c.terminal);
      return {
        columns,
        closed: {
          count: closed.reduce((n, c) => n + c.count, 0),
          totalAmount: round2(closed.reduce((n, c) => n + c.totalAmount, 0)),
          included: includeClosed,
        },
        gates: workflow.gates
          .filter((g) => g.key !== 'SUBMIT')
          .map((g) => ({ key: g.key, stageKey: g.stageKey, label: g.label, enabled: g.enabled })),
        filterOptions: await listPipelinePeople(tx),
      };
    });
  }

  /**
   * `GET /quotes/export.csv`: the filtered list as CSV, in the list's order, with the caller's visible
   * columns (commercial ones only for roles allowed to see them). More than QUOTE_EXPORT_MAX_ROWS
   * matching quotes is a 422; the export itself is audited (`action = 'export'`, filters + row count)
   * in the same transaction.
   */
  async exportCsv(
    withTx: PipelineWithTx,
    actor: Actor,
    params: QuoteExportParams,
    meta: AuditMeta,
  ): Promise<{ lines: string[]; rows: number; columns: QuoteListColumnKey[] }> {
    const now = this.now();
    const sort = params.sort ?? 'updated';
    const dir = params.dir ?? QUOTE_SORT_DEFAULT_DIR[sort];
    const columns = exportColumnsFor(
      actor,
      params.columns?.length ? params.columns : QUOTE_LIST_DEFAULT_COLUMNS,
      QUOTE_LIST_COLUMN_KEYS,
    ) as QuoteListColumnKey[];
    if (columns.length === 0) {
      throw new ServiceProblem(400, PIPELINE_PROBLEM_CODES.badFilter, 'No exportable columns');
    }
    return withTx(async (tx) => {
      const s = await this.scope(tx, actor, now);
      const keys = await this.matching(tx, actor, s, params, sort, dir);
      if (keys.length > QUOTE_EXPORT_MAX_ROWS) {
        throw new ServiceProblem(
          422,
          PIPELINE_PROBLEM_CODES.exportTooLarge,
          `${keys.length.toLocaleString('en-US')} quotes match; the export is limited to ${QUOTE_EXPORT_MAX_ROWS.toLocaleString('en-US')}. Narrow the filters and try again.`,
          { matched: keys.length, limit: QUOTE_EXPORT_MAX_ROWS },
        );
      }
      const rows = await PipelineService.rows(tx, keys);
      const label = (key: string) => s.workflow.stages.find((st) => st.key === key)?.label ?? key;
      const lines = [
        columns.map((c) => csvCell(QUOTE_LIST_COLUMNS[c])).join(','),
        ...rows.map((r) => {
          const item = PipelineService.item(r, s);
          return columns.map((c) => csvCell(exportValue(item, c, label))).join(',');
        }),
      ];
      const { columns: _c, ...filters } = params;
      await recordAudit(tx, actor, meta, {
        at: now,
        action: 'export',
        entity: 'quote',
        after: { format: 'csv', view: 'quotes', filters, columns, rows: rows.length },
      });
      return { lines, rows: rows.length, columns };
    });
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function exportValue(
  item: QuoteListItem,
  column: QuoteListColumnKey,
  stageLabel: (key: string) => string,
): unknown {
  switch (column) {
    case 'stage':
      return stageLabel(item.stageKey);
    case 'tier':
      return item.priority.tierLabel;
    case 'score':
      return item.priority.score;
    case 'warnings':
      return item.warnings.map((w) => w.message).join('; ');
    case 'prelimCapitalUsd':
      return item.commercial?.prelimCapitalUsd ?? null;
    case 'capitalReadiness':
      return item.commercial?.capitalReadiness ?? null;
    default:
      return item[column];
  }
}
