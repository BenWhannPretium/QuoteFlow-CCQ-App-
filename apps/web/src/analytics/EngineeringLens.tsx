import type { EngineeringAnalyticsResponse } from '@ccq/contracts';
import { Link } from '@tanstack/react-router';

import {
  Bars,
  COLORS,
  ChartCard,
  SmallMultiples,
  Stat,
  dayRange,
  fmtCount,
  fmtDays,
} from '@/components/charts';
import type { AnalyticsSearch } from '@/lib/analytics-search';
import { api } from '@/lib/api';

import { Boundary, Section, useChart } from './shared';

const queueLink = (
  <Link
    to="/queue/engineering"
    className="text-emphasis text-sm font-medium underline-offset-2 hover:underline"
  >
    Open the engineering queue
  </Link>
);

/**
 * B-26 (A5): the Engineering lens of /analytics, for the engineering lead running upfront
 * engineering: who has what and how old it is, what is waiting on a capacity sign-off, how G2 is
 * landing and how long Engineering Review takes. One request (`/analytics/engineering`); nothing
 * commercial. The leadership report stays one tab away.
 */
export function EngineeringLens({ search }: { search: AnalyticsSearch }) {
  const q = useChart('engineering', search, api.analyticsEngineering);
  return (
    <Boundary query={q}>
      {(e: EngineeringAnalyticsResponse) => (
        <div className="grid gap-8" data-testid="engineering-lens">
          <Section
            id="eng-queue"
            title="The queue right now"
            description="Open Engineering Review quotes, who has them and how long they have waited. A snapshot: the date range does not apply."
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat
                testId="stat-eng-open"
                label="In Engineering Review"
                value={fmtCount(e.queue.total)}
                info={e.queue.info}
              />
              <Stat
                testId="stat-eng-unassigned"
                label="No engineer yet"
                value={fmtCount(e.queue.unassigned ?? 0)}
                tone={(e.queue.unassigned ?? 0) > 0 ? 'alert' : 'default'}
              />
              <Stat testId="stat-eng-hold" label="On hold" value={fmtCount(e.queue.onHold)} />
              <Stat
                testId="stat-eng-old"
                label={e.queue.buckets.find((b) => b.key === 'old')?.label ?? 'Oldest bucket'}
                value={fmtCount(e.queue.buckets.find((b) => b.key === 'old')?.count ?? 0)}
                hint="Business days in the stage"
              />
            </div>
            <SmallMultiples>
              <ChartCard
                testId="chart-eng-load"
                title="Open load per engineer"
                info={e.load.info}
                summary="Open Engineering Review quotes per engineer, and those with no engineer."
                empty={e.load.items.length === 0}
                emptyHint="The queue is empty."
                note={queueLink}
                table={{
                  caption: 'Open Engineering Review quotes per engineer',
                  columns: [
                    { key: 'name', label: 'Engineer' },
                    { key: 'open', label: 'Open', numeric: true },
                    { key: 'hold', label: 'On hold', numeric: true },
                    { key: 'oldest', label: 'Oldest (days in stage)', numeric: true },
                  ],
                  rows: e.load.items.map((l) => ({
                    name: l.name,
                    open: fmtCount(l.open),
                    hold: fmtCount(l.onHold),
                    oldest: l.oldestDays === null ? '–' : fmtCount(l.oldestDays),
                  })),
                }}
              >
                <Bars
                  data={e.load.items.map((l) => ({
                    label: l.name,
                    active: l.open - l.onHold,
                    hold: l.onHold,
                  }))}
                  xKey="label"
                  orientation="horizontal"
                  series={[
                    { key: 'active', label: 'Active', color: COLORS.primary },
                    { key: 'hold', label: 'On hold', color: COLORS.secondary },
                  ]}
                  labels
                  categoryWidth={130}
                />
              </ChartCard>
              <ChartCard
                testId="chart-eng-aging"
                title="How long quotes have waited"
                info={e.queue.info}
                summary="Open Engineering Review quotes by business days in the stage."
                empty={e.queue.total === 0}
                emptyHint="The queue is empty."
                table={{
                  caption: 'Open Engineering Review quotes by age',
                  columns: [
                    { key: 'label', label: 'Age' },
                    { key: 'count', label: 'Quotes', numeric: true },
                  ],
                  rows: e.queue.buckets.map((b) => ({ label: b.label, count: fmtCount(b.count) })),
                }}
              >
                <Bars
                  data={e.queue.buckets.map((b) => ({ label: b.label, count: b.count }))}
                  xKey="label"
                  series={[{ key: 'count', label: 'Quotes', color: COLORS.primary }]}
                  labels
                />
              </ChartCard>
            </SmallMultiples>
          </Section>

          <Section
            id="eng-capacity"
            title="Capacity sign-off"
            description="G2 needs the capacity owner's sign-off. Pending ones are waiting on capacity evidence; blocked ones need a capacity decision or a reroute."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                testId="stat-capacity-pending"
                label="Waiting for sign-off"
                value={fmtCount(e.capacity.pending)}
                info={e.capacity.info}
              />
              <Stat
                testId="stat-capacity-blocked"
                label="Blocked"
                value={fmtCount(e.capacity.blocked)}
                tone={e.capacity.blocked > 0 ? 'alert' : 'default'}
              />
              <Stat
                testId="stat-capacity-approved"
                label="Signed off, ready for G2"
                value={fmtCount(e.capacity.approved)}
              />
            </div>
          </Section>

          <Section
            id="eng-g2"
            title="G2 and time in Engineering Review"
            description={`How feasibility decisions are landing and how long the work takes. Window: ${dayRange(e.window.from, e.window.to)}. Time on a recorded hold is taken out.`}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                testId="stat-eng-stage-median"
                label="Median days in Engineering Review"
                value={fmtDays(e.stageTime.medianDays)}
                hint={`p75 ${fmtDays(e.stageTime.p75Days)} · ${fmtCount(e.stageTime.n)} stays`}
                info={e.stageTime.info}
              />
              <Stat
                testId="stat-eng-time-to-assign"
                label="Median time to assign"
                value={fmtDays(e.timeToAssign.medianDays)}
                hint={`${fmtCount(e.timeToAssign.n)} assignments`}
                info={e.timeToAssign.info}
              />
              <Stat
                testId="stat-eng-assign-to-g2"
                label="Median assign to G2"
                value={fmtDays(e.assignToG2.medianDays)}
                hint={`${fmtCount(e.assignToG2.n)} decisions`}
                info={e.assignToG2.info}
              />
            </div>
            <SmallMultiples>
              <ChartCard
                testId="chart-g2-outcomes"
                title="G2 decisions by outcome"
                info={e.g2Outcomes.info}
                summary="G2 feasibility decisions in the window, by outcome."
                empty={e.g2Outcomes.total === 0}
                emptyHint="No G2 decisions in this window."
                table={{
                  caption: 'G2 decisions by outcome',
                  columns: [
                    { key: 'label', label: 'Outcome' },
                    { key: 'count', label: 'Decisions', numeric: true },
                  ],
                  rows: e.g2Outcomes.byOutcome.map((o) => ({
                    label: o.label,
                    count: fmtCount(o.count),
                  })),
                }}
              >
                <Bars
                  data={e.g2Outcomes.byOutcome.map((o) => ({ label: o.label, count: o.count }))}
                  xKey="label"
                  orientation="horizontal"
                  series={[{ key: 'count', label: 'Decisions', color: COLORS.primary }]}
                  labels
                  categoryWidth={150}
                />
              </ChartCard>
              <ChartCard
                testId="chart-g2-returns"
                title="Why Engineering sends work back"
                info={e.returned.info}
                summary="Top reasons for G2 rework, back to the KAM."
                empty={e.returned.reasons.length === 0}
                emptyHint="Nothing was returned to a KAM at G2 in this window."
                table={{
                  caption: 'Top G2 rework reasons',
                  columns: [
                    { key: 'label', label: 'Reason' },
                    { key: 'count', label: 'Returns', numeric: true },
                  ],
                  rows: e.returned.reasons.map((r) => ({
                    label: r.label,
                    count: fmtCount(r.count),
                  })),
                }}
              >
                <Bars
                  data={e.returned.reasons.map((r) => ({ label: r.label, count: r.count }))}
                  xKey="label"
                  orientation="horizontal"
                  series={[{ key: 'count', label: 'Returns', color: COLORS.emphasis }]}
                  labels
                  categoryWidth={150}
                />
              </ChartCard>
            </SmallMultiples>
          </Section>
        </div>
      )}
    </Boundary>
  );
}
