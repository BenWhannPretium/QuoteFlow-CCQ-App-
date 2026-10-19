import type {
  ApproverDashboard,
  DashboardResponse,
  DashboardRole,
  DashQuote,
  EngineeringDashboard,
  ExpiringProposal,
  KamDashboard,
  LeadershipDashboard,
  MetricInfo,
  PricingDashboard,
  QueueHealth,
  SalesLeaderDashboard,
  StagePipeline,
} from '@ccq/contracts';
import { SF_AMOUNT_LABEL, LOW_CAPTURE_BELOW } from '@ccq/contracts';
import type { Tx } from '@ccq/db';
import {
  awaitingG1,
  capitalPendingCount,
  decisionsAtGate,
  engineeringMedians,
  myOpenQuotes,
  openDrafts,
  openInStage,
  openStages,
  outcomeCohort,
  pendingOverrides,
  proposalsEndingBy,
  returnedToKam,
  reworkReasons,
  medianStageTime,
  type AnalyticsFilters,
  type DashboardQuoteRow,
} from '@ccq/db/repos';
import {
  agingBucket,
  agingBucketLabels,
  AGING_BUCKETS,
  businessDaysBetween,
  holdsPermission,
  type Actor,
  type EngQueueSettings,
  type Permission,
} from '@ccq/domain';

import { AnalyticsService, outcomeRates, secondsToDays } from './analytics';
import { REPORT_TIME_ZONE, dayIn } from './auditAdmin';
import { loadEngQueueSettings } from './engineering-view';
import { ServiceProblem } from './problem';

export type DashboardWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * Which permission opens each role's dashboard. The role dashboards are views, not roles: who may
 * open one follows the permission matrix (so a config change to who approves moves the dashboard
 * with it), and Admin, who holds those permissions, can open any of them.
 */
export const DASHBOARD_PERMISSION: Record<DashboardRole, Permission> = {
  KAM: 'quote.create',
  SalesLeader: 'gate.G1.decide',
  EngLead: 'engQueue.read',
  Engineer: 'engQueue.read',
  Pricing: 'pricingQueue.read',
  Approver: 'finalReview.read',
  Leadership: 'analytics.read',
};

const DAY_MS = 86_400_000;
/** Windows the dashboards state next to each number. */
export const WINDOWS = {
  medianDays: 30,
  reworkDays: 90,
  quotingDays: 90,
  decidedDays: 30,
  captureDays: 365,
  expiringDays: 7,
} as const;
const LIST_LIMIT = 10;
const MINI_BOARD_LIMIT = 5;

const info = (definition: string, window: string): MetricInfo => ({ definition, window });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Dimension-free filters over a trailing window, for the shared outcome and rework queries. */
const trailing = (
  now: Date,
  days: number,
  extra: Partial<AnalyticsFilters> = {},
): AnalyticsFilters => ({
  from: new Date(now.getTime() - days * DAY_MS),
  to: new Date(now.getTime() + DAY_MS),
  market: [],
  productFamily: [],
  kam: [],
  region: [],
  ...extra,
});

const calendarDays = (from: Date | null, now: Date): number | null =>
  from ? Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS)) : null;

function dashQuote(r: DashboardQuoteRow, now: Date): DashQuote {
  return {
    quoteNumber: r.quote_number,
    account: r.account,
    stageKey: r.stage_key,
    stageLabel: r.stage_label,
    tier: r.priority_tier,
    status: r.status,
    kamName: r.kam_name,
    daysInStage: calendarDays(r.stage_entered_at, now),
  };
}

/** Oldest in the stage first. */
const oldestFirst = (a: DashQuote, b: DashQuote) => (b.daysInStage ?? -1) - (a.daysInStage ?? -1);

function expiring(rows: DashboardQuoteRow[], now: Date): ExpiringProposal[] {
  const today = Date.parse(`${dayIn(now, REPORT_TIME_ZONE)}T00:00:00Z`);
  return rows.map((r) => {
    const daysLeft = Math.round((Date.parse(`${r.validity_until}T00:00:00Z`) - today) / DAY_MS);
    return {
      quoteNumber: r.quote_number,
      account: r.account,
      validityUntil: r.validity_until!,
      daysLeft,
      lapsed: daysLeft < 0,
      kamName: r.kam_name,
    };
  });
}

/** Business-day aging buckets (the engineering queue's buckets, from `eng_queue_aging_days`). */
function queueHealth(
  rows: DashboardQuoteRow[],
  edges: EngQueueSettings['agingDays'],
  now: Date,
  definition: string,
  window: string,
  withAssignment: boolean,
): QueueHealth {
  const counts = { fresh: 0, aging: 0, old: 0 };
  for (const r of rows) {
    const entered = r.stage_entered_at ?? r.submitted_at;
    counts[agingBucket(entered ? businessDaysBetween(entered, now) : 0, edges)] += 1;
  }
  const labels = agingBucketLabels(edges);
  return {
    info: info(definition, window),
    total: rows.length,
    unassigned: withAssignment ? rows.filter((r) => r.assigned_engineer_id === null).length : null,
    onHold: rows.filter((r) => r.status === 'on_hold').length,
    buckets: AGING_BUCKETS.map((key) => ({ key, label: labels[key], count: counts[key] })),
  };
}

const AGING_NOTE =
  'Age = business days (Mon–Fri, US Central) since the quote entered the stage, holds included. The bucket edges are configuration, not an SLA.';

export class DashboardService {
  private readonly now: () => Date;
  private readonly analytics: AnalyticsService;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
    this.analytics = new AnalyticsService({ now: this.now });
  }

  async get(
    withTx: DashboardWithTx,
    actor: Actor,
    role: DashboardRole,
  ): Promise<DashboardResponse> {
    if (!holdsPermission(actor, DASHBOARD_PERMISSION[role])) {
      throw new ServiceProblem(
        403,
        'dashboard_forbidden',
        `The ${role} dashboard needs the ${DASHBOARD_PERMISSION[role]} permission`,
      );
    }
    const now = this.now();
    switch (role) {
      case 'KAM':
        return withTx((tx) => this.kam(tx, actor, now));
      case 'SalesLeader':
        return withTx((tx) => this.salesLeader(tx, now));
      case 'EngLead':
      case 'Engineer':
        return withTx((tx) => this.engineering(tx, actor, role, now));
      case 'Pricing':
        return withTx((tx) => this.pricing(tx, now));
      case 'Approver':
        return withTx((tx) => this.approver(tx, actor, now));
      case 'Leadership':
        return this.leadership(withTx);
    }
  }

  private async stagePipeline(
    tx: Tx,
    rows: DashboardQuoteRow[],
    now: Date,
    definition: string,
    window: string,
  ): Promise<StagePipeline> {
    const stages = await openStages(tx);
    return {
      info: info(definition, window),
      total: rows.length,
      stages: stages.map((s) => {
        const inStage = rows.filter((r) => r.stage_key === s.key);
        return {
          stageKey: s.key,
          label: s.label,
          count: inStage.length,
          sfAmount: inStage.reduce((n, r) => n + (r.sf_amount ?? 0), 0),
          quotes: inStage
            .map((r) => dashQuote(r, now))
            .sort(oldestFirst)
            .slice(0, MINI_BOARD_LIMIT),
        };
      }),
    };
  }

  private async kam(tx: Tx, actor: Actor, now: Date): Promise<KamDashboard> {
    const [drafts, returned, open, ending, cohort] = await Promise.all([
      openDrafts(tx, actor.userId),
      returnedToKam(tx, actor.userId),
      myOpenQuotes(tx, actor.userId),
      proposalsEndingBy(tx, now, WINDOWS.expiringDays, actor.userId),
      outcomeCohort(tx, trailing(now, WINDOWS.captureDays, { kam: [actor.userId] }), 'total', now),
    ]);
    const pipeline = await this.stagePipeline(
      tx,
      open,
      now,
      'Your open quotes by workflow stage (a closed quote is not listed). Each stage shows your oldest quotes first.',
      'Your open quotes right now',
    );
    return {
      role: 'KAM',
      drafts: {
        info: info(
          'Intake drafts you have started and not submitted. Open one to carry on where you stopped.',
          'Right now',
        ),
        items: drafts.map((d) => ({
          draftId: d.draft_id,
          opportunity: d.opportunity,
          step: d.step,
          updatedAt: d.updated_at.toISOString(),
          reworkOfQuoteNumber: d.rework_of_quote_number,
        })),
      },
      returned: {
        info: info(
          'Quotes Sales Leadership or Engineering sent back to you for rework, with the reason they gave. Fix and resubmit to put them back in the queue.',
          'Right now',
        ),
        items: returned.map((r) => ({
          quoteNumber: r.quote_number,
          account: r.account,
          gateKey: r.gate_key,
          reason: r.reason_label ?? r.reason_code,
          note: r.note,
          returnedAt: iso(r.returned_at),
          returnedBy: r.returned_by,
          draftId: r.draft_id,
        })),
      },
      pipeline,
      expiring: {
        info: info(
          `Proposals waiting for the customer whose validity ends within ${WINDOWS.expiringDays} days, or has already passed. Record the outcome, or revalidate with a new date.`,
          `Validity ends by ${WINDOWS.expiringDays} days from today (lapsed ones included)`,
        ),
        withinDays: WINDOWS.expiringDays,
        items: expiring(ending, now),
      },
      capture: {
        info: info(
          'The share of your proposals that have a customer outcome recorded (awarded, lost or expired) rather than gone dark: still open after their validity date. Proposals still inside validity are not counted against you.',
          `Your proposals issued in the last ${WINDOWS.captureDays} days`,
        ),
        rates: outcomeRates(cohort[0]),
      },
    };
  }

  private async salesLeader(tx: Tx, now: Date): Promise<SalesLeaderDashboard> {
    const [toQualify, overrides, open, lapsed] = await Promise.all([
      awaitingG1(tx),
      pendingOverrides(tx),
      openAll(tx),
      proposalsEndingBy(tx, now, -1),
    ]);
    return {
      role: 'SalesLeader',
      toQualify: {
        info: info(
          'Submitted intakes waiting for the G1 qualification decision, oldest first. Quotes on hold or sent back for rework are not in this list.',
          'Right now',
        ),
        count: toQualify.length,
        items: toQualify.map((r) => dashQuote(r, now)).slice(0, LIST_LIMIT),
      },
      pendingOverrides: {
        info: info(
          'Override requests (priority tier, ship-to, queue position) waiting for an approver, oldest first.',
          'Right now',
        ),
        count: overrides.length,
        items: overrides.slice(0, LIST_LIMIT).map((o) => ({
          overrideId: o.override_id,
          quoteNumber: o.quote_number,
          field: o.field,
          requestedBy: o.requested_by,
          requestedAt: o.requested_at.toISOString(),
          justification: o.justification,
        })),
      },
      pipeline: await this.stagePipeline(
        tx,
        open,
        now,
        `The team's open quotes by workflow stage, with the ${SF_AMOUNT_LABEL} per stage.`,
        'Open quotes right now',
      ),
      lackingOutcomes: {
        info: info(
          'Proposals still open in Customer Decision after their validity date: no outcome has been recorded. These are the ones that pull the outcome capture rate down.',
          'Validity ended before today',
        ),
        count: lapsed.length,
        items: expiring(lapsed, now).slice(0, LIST_LIMIT),
      },
    };
  }

  private async engineering(
    tx: Tx,
    actor: Actor,
    role: 'EngLead' | 'Engineer',
    now: Date,
  ): Promise<EngineeringDashboard> {
    const since = new Date(now.getTime() - WINDOWS.medianDays * DAY_MS);
    const [settings, rows, medians, returned] = await Promise.all([
      loadEngQueueSettings(tx),
      openInStage(tx, 'ENG_REVIEW'),
      engineeringMedians(tx, since),
      reworkReasons(tx, trailing(now, WINDOWS.reworkDays), ['G2'], 50),
    ]);
    const load = new Map<string | null, { name: string; open: number }>();
    for (const r of rows) {
      const key = r.assigned_engineer_id;
      const entry = load.get(key) ?? {
        name: key ? (r.engineer_name ?? 'Unknown') : 'Unassigned',
        open: 0,
      };
      entry.open += 1;
      load.set(key, entry);
    }
    return {
      role,
      queue: queueHealth(
        rows,
        settings.agingDays,
        now,
        `Quotes sitting in Engineering Review: the total, how many have no engineer yet, and how long they have waited. ${AGING_NOTE}`,
        'Open quotes right now',
        true,
      ),
      load: {
        info: info(
          'Open Engineering Review quotes per assigned engineer (quotes on hold included), and the quotes with no engineer.',
          'Open quotes right now',
        ),
        items: [...load.entries()]
          .map(([engineerId, v]) => ({ engineerId, name: v.name, open: v.open }))
          .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
      },
      timeToAssign: {
        info: info(
          'Median days from a quote entering Engineering Review to its engineer assignment, excluding holds.',
          `Assignments made in the last ${WINDOWS.medianDays} days`,
        ),
        medianDays: secondsToDays(medians.assign.median_s),
        n: medians.assign.n,
      },
      assignToG2: {
        info: info(
          'Median days from the engineer assignment to the G2 feasibility decision (a Hold does not count), excluding holds.',
          `G2 decisions in the last ${WINDOWS.medianDays} days`,
        ),
        medianDays: secondsToDays(medians.toG2.median_s),
        n: medians.toG2.n,
      },
      returned: {
        info: info(
          'Why Engineering sent requests back to the KAM at G2 (top 5 reasons). A signal of what intake is not capturing.',
          `Returns in the last ${WINDOWS.reworkDays} days`,
        ),
        total: returned.reduce((n, x) => n + x.count, 0),
        reasons: returned.slice(0, 5).map((x) => ({ label: x.label, count: x.count })),
      },
      mine: {
        info: info(
          'Open Engineering Review quotes assigned to you, oldest first.',
          'Open quotes right now',
        ),
        items: rows
          .filter((r) => r.assigned_engineer_id === actor.userId)
          .map((r) => dashQuote(r, now))
          .sort(oldestFirst),
      },
    };
  }

  private async pricing(tx: Tx, now: Date): Promise<PricingDashboard> {
    const since = new Date(now.getTime() - WINDOWS.quotingDays * DAY_MS);
    const [settings, rows, pending, median] = await Promise.all([
      loadEngQueueSettings(tx),
      openInStage(tx, 'QUOTING'),
      capitalPendingCount(tx),
      medianStageTime(tx, 'QUOTING', since),
    ]);
    return {
      role: 'Pricing',
      queue: queueHealth(
        rows,
        settings.agingDays,
        now,
        `Quotes sitting in Quoting: the total and how long they have waited. ${AGING_NOTE} Pricing has no queue-specific buckets yet, so it borrows the engineering queue's.`,
        'Open quotes right now',
        false,
      ),
      capitalPending: {
        info: info(
          'Open Quoting quotes whose pricing record still has capital readiness "pending". They can be submitted only with a written justification.',
          'Open quotes right now',
        ),
        count: pending,
      },
      medianInQuoting: {
        info: info(
          'Median days a quote spent in Quoting, excluding recorded holds.',
          `Stays that ended in the last ${WINDOWS.quotingDays} days`,
        ),
        medianDays: secondsToDays(median.median_s),
        n: median.n,
      },
    };
  }

  private async approver(tx: Tx, actor: Actor, now: Date): Promise<ApproverDashboard> {
    const since = new Date(now.getTime() - WINDOWS.decidedDays * DAY_MS);
    const [pending, decided] = await Promise.all([
      openInStage(tx, 'FINAL_REVIEW'),
      decisionsAtGate(tx, 'G4', since),
    ]);
    const byOutcome = new Map<string, { label: string; count: number }>();
    for (const d of decided) {
      const e = byOutcome.get(d.outcome_key) ?? { label: d.outcome_label, count: 0 };
      e.count += 1;
      byOutcome.set(d.outcome_key, e);
    }
    const items = pending.map((r) => dashQuote(r, now)).sort(oldestFirst);
    return {
      role: 'Approver',
      pending: {
        info: info(
          'Quotes submitted to Final Review and waiting for a G4 decision (Approve, Decline or Return), oldest first. Age is calendar days in the stage.',
          'Right now',
        ),
        count: items.length,
        items: items.slice(0, LIST_LIMIT),
      },
      decided: {
        info: info(
          'G4 decisions recorded by all approvers, by outcome, and how many were yours.',
          `Decisions in the last ${WINDOWS.decidedDays} days`,
        ),
        total: decided.length,
        mine: decided.filter((d) => d.decided_by_id === actor.userId).length,
        byOutcome: [...byOutcome.entries()].map(([key, v]) => ({ key, ...v })),
        recent: decided.slice(0, 8).map((d) => ({
          quoteNumber: d.quote_number,
          outcomeLabel: d.outcome_label,
          decidedBy: d.decided_by,
          decidedAt: d.decided_at.toISOString(),
        })),
      },
    };
  }

  /** The leadership landing: headline numbers from the same endpoints as /analytics, default window. */
  private async leadership(withTx: DashboardWithTx): Promise<LeadershipDashboard> {
    const [pipeline, outcomes, cycle, firstPass] = await Promise.all([
      this.analytics.pipeline(withTx, {}),
      this.analytics.outcomes(withTx, {}),
      this.analytics.cycleTime(withTx, {}),
      this.analytics.firstPass(withTx, {}),
    ]);
    return {
      role: 'Leadership',
      openQuotes: {
        info: pipeline.info,
        count: pipeline.totals.count,
        sfAmount: pipeline.totals.sfAmount,
        amountLabel: pipeline.amountLabel,
      },
      outcomes: { info: outcomes.info, rates: outcomes.total, lowCaptureBelow: LOW_CAPTURE_BELOW },
      endToEnd: {
        info: cycle.endToEndInfo,
        n: cycle.endToEnd.n,
        medianDays: cycle.endToEnd.medianDays,
      },
      firstPass: { info: firstPass.info, rate: firstPass.rate, resolved: firstPass.resolved },
      pipeline: {
        info: pipeline.info,
        total: pipeline.totals.count,
        stages: pipeline.stages.map((s) => ({
          stageKey: s.stageKey,
          label: s.label,
          count: s.count,
          sfAmount: s.sfAmount,
          quotes: [],
        })),
      },
    };
  }
}

/** Every open quote the caller can see. */
async function openAll(tx: Tx): Promise<DashboardQuoteRow[]> {
  const stages = await openStages(tx);
  const rows = await Promise.all(stages.map((s) => openInStage(tx, s.key)));
  return rows.flat();
}
