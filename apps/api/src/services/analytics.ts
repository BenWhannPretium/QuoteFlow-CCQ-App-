import {
  ANALYTICS_DISCLAIMER,
  LOW_CAPTURE_BELOW,
  SF_AMOUNT_LABEL,
  type AdoptionResponse,
  type AnalyticsFiltersResponse,
  type AnalyticsParams,
  type AnalyticsWindow,
  type CycleTimeResponse,
  type FirstPassResponse,
  type FlowResponse,
  type G1YieldResponse,
  type GateComplianceResponse,
  type MetricInfo,
  type OutcomeRates,
  type OutcomeSplitRow,
  type OutcomesResponse,
  type OverridesResponse,
  type PipelineResponse,
  type PriorityResponse,
} from '@ccq/contracts';
import type { Tx } from '@ccq/db';
import {
  adoption,
  cycleByStage,
  cycleEndToEndTotal,
  cycleEndToEndWeekly,
  filterOptions,
  flowWeekly,
  g1Yield,
  gateCompliance,
  getScoringModel,
  intakeFirstPass,
  lossReasons,
  openStages,
  outcomeCohort,
  overrideFrequency,
  pipelineByStage,
  reworkReasons,
  tierCounts,
  tierVsAssign,
  valueLabels,
  wipWeekly,
  type AnalyticsFilters,
  type OutcomeRow,
} from '@ccq/db/repos';
import { COMMIT_STAGE_KEY } from '@ccq/domain';

import { REPORT_TIME_ZONE, dayIn, startOfDay } from './auditAdmin';
import { ServiceProblem } from './problem';

export type AnalyticsWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const ANALYTICS_PROBLEM_CODES = { badRange: 'analytics_bad_range' } as const;

const DAY_MS = 86_400_000;
/** Default window: the last 90 days, today included. */
export const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 731;
/** Below this many completed stays a median is shown but flagged as thin. */
export const THIN_BELOW = 5;

const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export const secondsToDays = (s: number | null | undefined): number | null =>
  s === null || s === undefined ? null : Math.round((s / 86_400) * 100) / 100;

export const ratio = (n: number, d: number): number | null =>
  d === 0 ? null : Math.round((n / d) * 1000) / 1000;

/** One resolved request: the SQL filters and the US Central days they came from. */
export interface ResolvedAnalytics {
  filters: AnalyticsFilters;
  window: AnalyticsWindow;
  asOf: Date;
}

export function resolveFilters(params: AnalyticsParams, now: Date): ResolvedAnalytics {
  const today = dayIn(now, REPORT_TIME_ZONE);
  const to = params.to ?? today;
  const from = params.from ?? addDays(to, -(DEFAULT_WINDOW_DAYS - 1));
  if (from > to) {
    throw new ServiceProblem(400, ANALYTICS_PROBLEM_CODES.badRange, '`from` is after `to`');
  }
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS + 1 > MAX_WINDOW_DAYS) {
    throw new ServiceProblem(
      400,
      ANALYTICS_PROBLEM_CODES.badRange,
      'The range is longer than two years',
    );
  }
  return {
    filters: {
      from: startOfDay(from, REPORT_TIME_ZONE),
      to: startOfDay(addDays(to, 1), REPORT_TIME_ZONE),
      market: params.market ?? [],
      productFamily: params.productFamily ?? [],
      kam: params.kam ?? [],
      region: params.region ?? [],
    },
    window: { from, to },
    asOf: now,
  };
}

const range = (w: AnalyticsWindow) => `${w.from} to ${w.to}`;
const info = (definition: string, window: string): MetricInfo => ({ definition, window });

/** Win and capture rates from one cohort row, always computed together. */
export function outcomeRates(r: OutcomeRow | undefined): OutcomeRates {
  const awarded = r?.awarded ?? 0;
  const lost = r?.lost ?? 0;
  const expired = r?.expired ?? 0;
  const goneDark = r?.gone_dark ?? 0;
  const recorded = awarded + lost + expired;
  const awardedAmount = r?.awarded_amount ?? 0;
  const lostAmount = r?.lost_amount ?? 0;
  const captureRate = ratio(recorded, recorded + goneDark);
  return {
    awarded,
    lost,
    expired,
    awaiting: r?.awaiting ?? 0,
    goneDark,
    recorded,
    winRate: ratio(awarded, awarded + lost),
    captureRate,
    awardedAmount,
    lostAmount,
    winRateByAmount: ratio(awardedAmount, awardedAmount + lostAmount),
    lowCapture: captureRate !== null && captureRate < LOW_CAPTURE_BELOW,
  };
}

export const OUTCOME_DEFINITION =
  'Of the proposals issued in the window: win rate = awarded ÷ (awarded + lost), decided quotes only (a proposal that expired with no answer is not a loss, and one still waiting is not decided). Shown only beside the outcome capture rate, because a win rate on few recorded outcomes misleads.';
export const CAPTURE_DEFINITION =
  'Outcome capture rate = recorded customer outcomes (awarded, lost, expired) ÷ (recorded + gone dark). Gone dark = still open in Customer Decision after the proposal validity date. Proposals still inside their validity are waiting, not missing, so they are left out.';

export const outcomeWindow = (w: AnalyticsWindow) =>
  `Proposals issued ${range(w)}; open proposals judged as of today`;

export class AnalyticsService {
  private readonly now: () => Date;
  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  resolve(params: AnalyticsParams): ResolvedAnalytics {
    return resolveFilters(params, this.now());
  }

  async filters(withTx: AnalyticsWithTx): Promise<AnalyticsFiltersResponse> {
    const today = dayIn(this.now(), REPORT_TIME_ZONE);
    return withTx(async (tx) => {
      const [options, market, productFamily] = await Promise.all([
        filterOptions(tx),
        valueLabels(tx, 'market'),
        valueLabels(tx, 'product_family'),
      ]);
      return {
        ...options,
        kams: options.kams.map((k) => ({ id: k.id, name: k.name })),
        labels: { market, productFamily },
        window: { from: addDays(today, -(DEFAULT_WINDOW_DAYS - 1)), to: today },
      };
    });
  }

  async pipeline(withTx: AnalyticsWithTx, params: AnalyticsParams): Promise<PipelineResponse> {
    const r = this.resolve(params);
    const rows = await withTx((tx) => pipelineByStage(tx, r.filters));
    const stages = rows.map((s) => ({
      stageKey: s.stage_key,
      label: s.stage_label,
      count: s.count,
      sfAmount: s.sf_amount,
      amountMissing: s.amount_missing,
      onHold: s.on_hold,
    }));
    return {
      info: info(
        `Open quotes by workflow stage. Amount is the Salesforce opportunity amount as entered by the KAM or synced from Salesforce: it is not a price, a margin or validated revenue. "No amount" counts quotes whose amount is missing or 0, so the total understates by that many quotes.`,
        'Open quotes right now; the date range does not apply',
      ),
      amountLabel: SF_AMOUNT_LABEL,
      stages,
      totals: {
        count: stages.reduce((n, s) => n + s.count, 0),
        sfAmount: stages.reduce((n, s) => n + s.sfAmount, 0),
        amountMissing: stages.reduce((n, s) => n + s.amountMissing, 0),
      },
    };
  }

  async cycleTime(withTx: AnalyticsWithTx, params: AnalyticsParams): Promise<CycleTimeResponse> {
    const r = this.resolve(params);
    const [stages, total, weekly] = await withTx((tx) =>
      Promise.all([
        cycleByStage(tx, r.filters),
        cycleEndToEndTotal(tx, r.filters),
        cycleEndToEndWeekly(tx, r.filters),
      ]),
    );
    return {
      info: info(
        'Median and 75th percentile of the days a quote spent in each stage, excluding time recorded on customer or internal hold (CR-57). One value per stay: a rework creates a new stay. The median wall-clock days are shown beside it so the effect of holds is visible.',
        `Stays in the stage that ended ${range(r.window)}`,
      ),
      endToEndInfo: info(
        'Days from the quote entering Intake to the first G4 approval, excluding recorded holds, by the week of approval. Time back with the KAM after a rework stays in. Customer decision time is excluded by design.',
        `Quotes approved at G4 ${range(r.window)}, by week`,
      ),
      window: r.window,
      stages: stages.map((s) => ({
        stageKey: s.stage_key,
        label: s.stage_label,
        n: s.n,
        medianDays: secondsToDays(s.median_active_s),
        p75Days: secondsToDays(s.p75_active_s),
        medianElapsedDays: secondsToDays(s.median_elapsed_s),
        heldStays: s.held_stays,
      })),
      endToEnd: {
        n: total.n,
        medianDays: secondsToDays(total.median_active_s),
        p75Days: secondsToDays(total.p75_active_s),
        medianElapsedDays: secondsToDays(total.median_elapsed_s),
        weekly: weekly.map((w) => ({
          week: w.week,
          n: w.n,
          medianDays: secondsToDays(w.median_active_s),
          p75Days: secondsToDays(w.p75_active_s),
        })),
      },
      thinBelow: THIN_BELOW,
    };
  }

  async flow(withTx: AnalyticsWithTx, params: AnalyticsParams): Promise<FlowResponse> {
    const r = this.resolve(params);
    const [weekly, wip, stages] = await withTx((tx) =>
      Promise.all([flowWeekly(tx, r.filters), wipWeekly(tx, r.filters, r.asOf), openStages(tx)]),
    );
    const byWeek = new Map<string, Record<string, number>>(weekly.map((w) => [w.week, {}]));
    for (const row of wip) {
      const counts = byWeek.get(row.week) ?? {};
      counts[row.stage_key] = row.count;
      byWeek.set(row.week, counts);
    }
    return {
      info: info(
        'Quotes created (a request submitted from Intake) and quotes closed (any outcome) per week, weeks starting Monday in US Central time.',
        `Weeks from ${range(r.window)}`,
      ),
      wipInfo: info(
        'Work in progress: quotes sitting in each open stage at the end of each week (a quote on hold is still in progress; closed quotes are not). The latest week is as of now.',
        `Week-end snapshots, ${range(r.window)}`,
      ),
      window: r.window,
      weekly: weekly.map((w) => ({ week: w.week, created: w.created, closed: w.closed })),
      wip: {
        stages: stages.map((s) => ({ stageKey: s.key, label: s.label })),
        weeks: [...byWeek.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([week, counts]) => ({ week, counts })),
      },
    };
  }

  async outcomes(withTx: AnalyticsWithTx, params: AnalyticsParams): Promise<OutcomesResponse> {
    const r = this.resolve(params);
    const [total, byMarket, byFamily, byKam, losses, marketLabels, familyLabels, open] =
      await withTx((tx) =>
        Promise.all([
          outcomeCohort(tx, r.filters, 'total', r.asOf),
          outcomeCohort(tx, r.filters, 'market', r.asOf),
          outcomeCohort(tx, r.filters, 'productFamily', r.asOf),
          outcomeCohort(tx, r.filters, 'kam', r.asOf),
          lossReasons(tx, r.filters),
          valueLabels(tx, 'market'),
          valueLabels(tx, 'product_family'),
          pipelineByStage(tx, r.filters),
        ]),
      );
    const split = (rows: OutcomeRow[], labels: Record<string, string> = {}): OutcomeSplitRow[] =>
      rows.map((row) => ({
        ...outcomeRates(row),
        key: row.key ?? 'unknown',
        label: row.key ? (row.label ?? labels[row.key] ?? row.key) : 'Not set',
      }));
    const lossTotal = losses.reduce((n, l) => n + l.count, 0);
    let running = 0;
    return {
      info: info(OUTCOME_DEFINITION, outcomeWindow(r.window)),
      captureInfo: info(CAPTURE_DEFINITION, outcomeWindow(r.window)),
      window: r.window,
      amountLabel: SF_AMOUNT_LABEL,
      lowCaptureBelow: LOW_CAPTURE_BELOW,
      total: outcomeRates(total[0]),
      byMarket: split(byMarket, marketLabels),
      byProductFamily: split(byFamily, familyLabels),
      byKam: split(byKam),
      commitmentPending: {
        info: info(
          'Quotes the customer awarded (G5) that are still in Commit & Hand Off: the CER and the receiving team’s acceptance are not recorded yet. The customer said yes, so they already count as awarded in the win rate; G6 closes them Won or Not authorized.',
          'Open quotes right now; the date range does not apply',
        ),
        count: open.find((s) => s.stage_key === COMMIT_STAGE_KEY)?.count ?? 0,
      },
      lossReasonsInfo: info(
        'Lost quotes by the reason the KAM recorded, biggest first, with the running share of all losses (Pareto). Expired proposals are not losses and are not here.',
        `Proposals issued ${range(r.window)} that are recorded as lost`,
      ),
      lossReasons: losses.map((l) => {
        running += l.count;
        return {
          code: l.code,
          label: l.label,
          count: l.count,
          amount: l.amount,
          cumulativeShare: ratio(running, lossTotal) ?? 0,
        };
      }),
    };
  }

  async firstPass(withTx: AnalyticsWithTx, params: AnalyticsParams): Promise<FirstPassResponse> {
    const r = this.resolve(params);
    const [fp, reasons] = await withTx((tx) =>
      Promise.all([intakeFirstPass(tx, r.filters), reworkReasons(tx, r.filters, ['G1', 'G2'], 5)]),
    );
    return {
      info: info(
        'First-pass intake completeness (S-03): the share of resolved intakes that never needed a Rework at G1 or G2. Resolved = it reached Engineering Review or was sent back for rework; requests still waiting for G1 are not counted yet.',
        `Quotes created ${range(r.window)} whose intake is resolved`,
      ),
      window: r.window,
      resolved: fp.resolved,
      firstPass: fp.first_pass,
      rate: ratio(fp.first_pass, fp.resolved),
      reworkReasonsInfo: info(
        'Why work was sent back to the KAM at G1 or G2, most common reason first (top 5): a signal of what intake is missing.',
        `Rework decisions ${range(r.window)}`,
      ),
      reworkReasons: reasons.map((x) => ({
        gateKey: x.gate_key,
        code: x.code,
        label: x.label,
        count: x.count,
      })),
    };
  }

  async g1Yield(withTx: AnalyticsWithTx, params: AnalyticsParams): Promise<G1YieldResponse> {
    const r = this.resolve(params);
    const rows = await withTx((tx) => g1Yield(tx, r.filters));
    const total = rows.reduce((n, x) => n + x.count, 0);
    return {
      info: info(
        'G1 qualification yield (S-04): how G1 decisions split by outcome (advance, hold, rework, redirect, stop). Every decision counts, so a request reworked then advanced appears twice.',
        `G1 decisions ${range(r.window)}`,
      ),
      window: r.window,
      total,
      outcomes: rows.map((x) => ({
        key: x.outcome_key,
        label: x.label,
        count: x.count,
        share: ratio(x.count, total) ?? 0,
      })),
    };
  }

  async overrides(withTx: AnalyticsWithTx, params: AnalyticsParams): Promise<OverridesResponse> {
    const r = this.resolve(params);
    const o = await withTx((tx) => overrideFrequency(tx, r.filters));
    return {
      info: info(
        'Override requests (priority tier, ship-to, queue position) by field and by the person who decided them, against the quotes created in the same window. A high rate means the defaults are not matching how work is really prioritised.',
        `Override requests ${range(r.window)}; quotes created ${range(r.window)}`,
      ),
      window: r.window,
      quotesCreated: o.quotes_created,
      total: o.total,
      perQuote: ratio(o.total, o.quotes_created),
      byField: o.by_field,
      byApprover: o.by_approver,
    };
  }

  async gateCompliance(
    withTx: AnalyticsWithTx,
    params: AnalyticsParams,
  ): Promise<GateComplianceResponse> {
    const r = this.resolve(params);
    const g = await withTx((tx) => gateCompliance(tx, r.filters));
    return {
      info: info(
        'Gate compliance (S-08): the share of issued proposals that have a recorded decision at every gate G1 to G4. Quotes created in QuoteFlow cannot skip a gate, so anything below 100% is imported or backfilled data.',
        `Proposals issued ${range(r.window)}`,
      ),
      window: r.window,
      proposals: g.proposals,
      compliant: g.compliant,
      rate: ratio(g.compliant, g.proposals),
      gates: [
        { gateKey: 'G1', label: 'G1 Qualify', recorded: g.has_g1 },
        { gateKey: 'G2', label: 'G2 Feasibility', recorded: g.has_g2 },
        { gateKey: 'G3', label: 'G3 Price & capital', recorded: g.has_g3 },
        { gateKey: 'G4', label: 'G4 Release', recorded: g.has_g4 },
      ],
    };
  }

  async priority(withTx: AnalyticsWithTx, params: AnalyticsParams): Promise<PriorityResponse> {
    const r = this.resolve(params);
    const [counts, assign, model] = await withTx((tx) =>
      Promise.all([
        tierCounts(tx, r.filters),
        tierVsAssign(tx, r.filters),
        getScoringModel(tx, this.now()),
      ]),
    );
    const tiers = tiersOf(model?.tierThresholds);
    const label = (key: string | null) =>
      key === null ? 'No tier' : (tiers.find((t) => t.key === key)?.label ?? key);
    const order = (key: string | null) => {
      const i = tiers.findIndex((t) => t.key === key);
      return i === -1 ? tiers.length : i;
    };
    const total = counts.reduce((n, c) => n + c.count, 0);
    const byTier = assign
      .map((a) => ({ key: a.tier, a }))
      .sort((x, y) => order(x.key) - order(y.key));
    // "Honouring priority": among tiers with enough data, median time to assign never falls as the tier
    // gets lower. Fewer than two usable tiers (or thin samples) is "unknown", not "yes".
    const usable = byTier.filter((t) => t.key !== null && t.a.n >= 3);
    let honours: PriorityResponse['queueHonoursPriority'] = 'unknown';
    if (usable.length >= 2) {
      honours = usable.every((t, i) => i === 0 || t.a.median_s >= usable[i - 1]!.a.median_s)
        ? 'yes'
        : 'no';
    }
    return {
      info: info(
        'Quotes created in the window by priority tier (advisory score, or the approved override).',
        `Quotes created ${range(r.window)}`,
      ),
      assignInfo: info(
        'Median and 75th percentile days from a quote entering Engineering Review to its current engineer assignment, excluding holds, by priority tier. If the manual queue honours priority, higher tiers are assigned no later than lower ones. Needs at least 3 assignments in two tiers to judge.',
        `Assignments made ${range(r.window)}`,
      ),
      window: r.window,
      tiers: counts
        .map((c) => ({ key: c.tier, c }))
        .sort((x, y) => order(x.key) - order(y.key))
        .map(({ key, c }) => ({
          tier: label(key),
          count: c.count,
          share: ratio(c.count, total) ?? 0,
        })),
      assignByTier: byTier.map(({ key, a }) => ({
        tier: label(key),
        n: a.n,
        medianDays: secondsToDays(a.median_s),
        p75Days: secondsToDays(a.p75_s),
      })),
      queueHonoursPriority: honours,
    };
  }

  async adoption(withTx: AnalyticsWithTx, params: AnalyticsParams): Promise<AdoptionResponse> {
    const r = this.resolve(params);
    const a = await withTx((tx) => adoption(tx, r.filters));
    const roles = [...new Set(a.weekly_active.map((x) => x.role))].sort();
    const weeks = new Map<string, Record<string, number>>();
    for (const row of a.weekly_active) {
      const w = weeks.get(row.week) ?? {};
      w[row.role] = row.users;
      weeks.set(row.week, w);
    }
    for (const i of a.intakes) if (!weeks.has(i.week)) weeks.set(i.week, {});
    return {
      info: info(
        'Weekly active users by role (S-10 adoption): distinct people with at least one recorded action (a view, a create or a decision) in the week. A person with two roles counts once under each.',
        `Weeks from ${range(r.window)}`,
      ),
      intakesInfo: info(
        'Intakes submitted in QuoteFlow per week (from the audit log). Intakes still raised outside QuoteFlow are not visible here.',
        `Weeks from ${range(r.window)}`,
      ),
      window: r.window,
      roles,
      weeklyActive: [...weeks.entries()]
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([week, byRole]) => ({ week, byRole })),
      intakes: a.intakes,
    };
  }
}

/** Scoring-model tiers, highest first. */
function tiersOf(thresholds: unknown): { key: string; label: string; min: number }[] {
  const tiers = (thresholds as { tiers?: unknown } | null | undefined)?.tiers;
  if (!Array.isArray(tiers)) return [];
  const isTier = (t: unknown): t is { key: string; label: string; min: number } => {
    const o = t as Record<string, unknown> | null;
    return typeof o?.key === 'string' && typeof o.label === 'string' && typeof o.min === 'number';
  };
  return (tiers as unknown[]).filter(isTier).sort((a, b) => b.min - a.min);
}

export { ANALYTICS_DISCLAIMER };
