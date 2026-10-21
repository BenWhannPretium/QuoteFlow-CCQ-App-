import type { EngineeringAnalyticsResponse, MetricInfo } from '@ccq/contracts';
import { schema } from '@ccq/db';
import {
  cycleByStage,
  decisionsAtGate,
  engineeringMedians,
  openInStage,
  reworkReasons,
} from '@ccq/db/repos';
import { ENG_QUEUE_STAGE_KEY } from '@ccq/domain';
import { inArray } from 'drizzle-orm';

import { secondsToDays, type AnalyticsWithTx, type ResolvedAnalytics } from './analytics';
import { queueHealth } from './dashboards';
import { loadEngQueueSettings } from './engineering-view';

const DAY_MS = 86_400_000;
const info = (definition: string, window: string): MetricInfo => ({ definition, window });
const range = (r: ResolvedAnalytics) => `${r.window.from} to ${r.window.to}`;

const SNAPSHOT = 'Open quotes right now; the date range does not apply';

/**
 * B-26 (A5): the Engineering lens of /analytics, for the engineering lead running the queue. Snapshot
 * blocks (queue, load, capacity sign-off) ignore the dates; the rest use the window. Nothing
 * commercial: no capital or capacity figures, only counts and days.
 */
export async function engineeringAnalytics(
  withTx: AnalyticsWithTx,
  r: ResolvedAnalytics,
): Promise<EngineeringAnalyticsResponse> {
  const now = r.asOf;
  return withTx(async (tx) => {
    const [settings, rows, cycle, medians, returned, decided] = await Promise.all([
      loadEngQueueSettings(tx),
      openInStage(tx, ENG_QUEUE_STAGE_KEY),
      cycleByStage(tx, r.filters),
      engineeringMedians(tx, r.filters.from),
      reworkReasons(tx, r.filters, ['G2'], 50),
      decisionsAtGate(tx, 'G2', r.filters.from),
    ]);
    const ids = rows.map((x) => x.quote_id);
    const signoffs = ids.length
      ? await tx
          .select({
            quoteId: schema.engReview.quoteId,
            status: schema.engReview.capacitySignoffStatus,
          })
          .from(schema.engReview)
          .where(inArray(schema.engReview.quoteId, ids))
      : [];
    const status = new Map(signoffs.map((s) => [s.quoteId, s.status]));
    const capacity = { pending: 0, approved: 0, blocked: 0 };
    for (const id of ids) {
      const s = status.get(id);
      if (s === 'approved') capacity.approved += 1;
      else if (s === 'blocked') capacity.blocked += 1;
      else capacity.pending += 1;
    }

    const load = new Map<
      string | null,
      { name: string; open: number; onHold: number; oldest: number | null }
    >();
    for (const x of rows) {
      const key = x.assigned_engineer_id;
      const entry = load.get(key) ?? {
        name: key ? (x.engineer_name ?? 'Unknown') : 'Unassigned',
        open: 0,
        onHold: 0,
        oldest: null,
      };
      entry.open += 1;
      if (x.status === 'on_hold') entry.onHold += 1;
      if (x.stage_entered_at) {
        const days = Math.max(
          0,
          Math.floor((now.getTime() - x.stage_entered_at.getTime()) / DAY_MS),
        );
        entry.oldest = Math.max(entry.oldest ?? 0, days);
      }
      load.set(key, entry);
    }

    const inWindow = decided.filter((d) => d.decided_at < r.filters.to);
    const byOutcome = new Map<string, { label: string; count: number }>();
    for (const d of inWindow) {
      const e = byOutcome.get(d.outcome_key) ?? { label: d.outcome_label, count: 0 };
      e.count += 1;
      byOutcome.set(d.outcome_key, e);
    }
    const stay = cycle.find((s) => s.stage_key === ENG_QUEUE_STAGE_KEY);

    return {
      window: r.window,
      queue: queueHealth(
        rows,
        settings.agingDays,
        now,
        'Quotes sitting in Engineering Review: the total, how many have no engineer yet, how many are on hold, and how long they have waited (business days since entering the stage, holds included). The bucket edges are configuration, not an SLA.',
        SNAPSHOT,
        true,
      ),
      load: {
        info: info(
          'Open Engineering Review quotes per assigned engineer, how many of them are on hold, and the calendar days the oldest has been in the stage. Reassign from the engineering queue.',
          SNAPSHOT,
        ),
        items: [...load.entries()]
          .map(([engineerId, v]) => ({
            engineerId,
            name: v.name,
            open: v.open,
            onHold: v.onHold,
            oldestDays: v.oldest,
          }))
          .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
      },
      capacity: {
        info: info(
          'The capacity owner’s sign-off on the open Engineering Review quotes. G2 cannot advance a quote until capacity is signed off; a blocked sign-off needs a capacity decision or a reroute.',
          SNAPSHOT,
        ),
        ...capacity,
      },
      g2Outcomes: {
        info: info(
          'G2 feasibility decisions by outcome (advance, advance with risk, capital required, hold, rework, redirect, stop).',
          `G2 decisions ${range(r)}`,
        ),
        total: inWindow.length,
        byOutcome: [...byOutcome.entries()]
          .map(([key, v]) => ({ key, ...v }))
          .sort((a, b) => b.count - a.count),
      },
      stageTime: {
        info: info(
          'Median and 75th percentile days a quote spent in Engineering Review, excluding recorded holds. One value per stay: a rework creates a new stay.',
          `Stays that ended ${range(r)}`,
        ),
        n: stay?.n ?? 0,
        medianDays: secondsToDays(stay?.median_active_s),
        p75Days: secondsToDays(stay?.p75_active_s),
      },
      timeToAssign: {
        info: info(
          'Median days from a quote entering Engineering Review to its engineer assignment, excluding holds.',
          `Assignments made since ${r.window.from}`,
        ),
        medianDays: secondsToDays(medians.assign.median_s),
        n: medians.assign.n,
      },
      assignToG2: {
        info: info(
          'Median days from the engineer assignment to the G2 feasibility decision (a Hold does not count), excluding holds.',
          `G2 decisions since ${r.window.from}`,
        ),
        medianDays: secondsToDays(medians.toG2.median_s),
        n: medians.toG2.n,
      },
      returned: {
        info: info(
          'Why Engineering sent requests back to the KAM at G2 (top 5 reasons): what intake is not capturing.',
          `Returns ${range(r)}`,
        ),
        total: returned.reduce((n, x) => n + x.count, 0),
        reasons: returned.slice(0, 5).map((x) => ({ label: x.label, count: x.count })),
      },
    };
  });
}
