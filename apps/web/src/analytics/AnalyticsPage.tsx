import {
  ANALYTICS_DISCLAIMER,
  type AdoptionResponse,
  type AnalyticsFiltersResponse,
  type CycleTimeResponse,
  type FirstPassResponse,
  type FlowResponse,
  type G1YieldResponse,
  type GateComplianceResponse,
  type OutcomeSplitRow,
  type OutcomesResponse,
  type OverridesResponse,
  type PipelineResponse,
  type PriorityResponse,
} from '@ccq/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { FilterXIcon } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { canFromMe, useCurrentUser } from '@/auth';
import {
  Bars,
  COLORS,
  ChartCard,
  SmallMultiples,
  Stat,
  Trend,
  dayRange,
  fmtCount,
  fmtDays,
  fmtPct,
  fmtUsd,
  fmtUsdCompact,
  weekLabel,
  type Series,
} from '@/components/charts';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonCard } from '@/components/Skeletons';
import { Button } from '@/components/ui/button';
import {
  activeFilterCount,
  analyticsApiQuery,
  drillDown,
  lastDays,
  type AnalyticsSearch,
} from '@/lib/analytics-search';
import { api } from '@/lib/api';
import type { PipelineSearch } from '@/lib/pipeline-search';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

import { RatePair } from './RatePair';

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

/** Every chart's data is fetched server-side: the page only draws it. */
function useChart<T>(
  name: string,
  search: AnalyticsSearch,
  fn: (q: ReturnType<typeof analyticsApiQuery>) => Promise<T>,
  enabled = true,
): UseQueryResult<T> {
  return useQuery({
    queryKey: ['analytics', name, search],
    queryFn: () => fn(analyticsApiQuery(search)),
    enabled,
    staleTime: 60_000,
  });
}

function Boundary<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <SkeletonCard />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-h`} id={id} className="grid scroll-mt-20 gap-4">
      <div className="grid gap-1">
        <h2 id={`${id}-h`} className="font-display text-xl">
          {title}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

const quotesLink = (search: PipelineSearch) => (
  <Link
    to="/quotes"
    search={search}
    className="text-emphasis text-sm font-medium underline-offset-2 hover:underline"
  >
    View quotes
  </Link>
);

// ── Filter bar ─────────────────────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 12 months', days: 365 },
] as const;

const selectClass =
  'bg-card border-input focus-visible:ring-ring min-h-11 w-full rounded-lg border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none sm:min-h-9';

function FilterBar({
  search,
  filters,
  onChange,
}: {
  search: AnalyticsSearch;
  filters: AnalyticsFiltersResponse | undefined;
  onChange: (next: AnalyticsSearch) => void;
}) {
  const set = (key: keyof AnalyticsSearch, value: string) =>
    onChange({ ...search, [key]: value || undefined });
  const labelOf = (map: Record<string, string> | undefined, code: string) => map?.[code] ?? code;
  const from = search.from ?? filters?.window.from ?? '';
  const to = search.to ?? filters?.window.to ?? '';
  const count = activeFilterCount(search);
  return (
    <form
      aria-label="Analytics filters"
      className="bg-card rounded-card grid gap-3 border p-4"
      onSubmit={(e) => e.preventDefault()}
      data-testid="analytics-filters"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="grid gap-1 text-xs font-medium">
          From
          <input
            type="date"
            className={selectClass}
            value={from}
            max={to || undefined}
            onChange={(e) => set('from', e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          To
          <input
            type="date"
            className={selectClass}
            value={to}
            min={from || undefined}
            onChange={(e) => set('to', e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Market
          <select
            className={selectClass}
            value={search.market ?? ''}
            onChange={(e) => set('market', e.target.value)}
          >
            <option value="">All markets</option>
            {filters?.markets.map((m) => (
              <option key={m} value={m}>
                {labelOf(filters.labels.market, m)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Product family
          <select
            className={selectClass}
            value={search.productFamily ?? ''}
            onChange={(e) => set('productFamily', e.target.value)}
          >
            <option value="">All families</option>
            {filters?.productFamilies.map((m) => (
              <option key={m} value={m}>
                {labelOf(filters.labels.productFamily, m)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          KAM
          <select
            className={selectClass}
            value={search.kam ?? ''}
            onChange={(e) => set('kam', e.target.value)}
          >
            <option value="">All KAMs</option>
            {filters?.kams.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name ?? k.id}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Region
          <select
            className={selectClass}
            value={search.region ?? ''}
            onChange={(e) => set('region', e.target.value)}
          >
            <option value="">All regions</option>
            {filters?.regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.days}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange({ ...search, ...lastDays(p.days, today()) })}
          >
            {p.label}
          </Button>
        ))}
        {count > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
            <FilterXIcon className="size-4" aria-hidden="true" />
            Clear filters ({count})
          </Button>
        )}
        <p className="text-muted-foreground ml-auto text-xs">
          Dates are US Central days. The pipeline is a snapshot of open quotes and ignores them.
        </p>
      </div>
    </form>
  );
}

// ── Sections ───────────────────────────────────────────────────────────────────────────────────

function PipelineSection({ search }: { search: AnalyticsSearch }) {
  const q = useChart('pipeline', search, api.analyticsPipeline);
  const navigate = useNavigate();
  return (
    <Boundary query={q}>
      {(p: PipelineResponse) => {
        const rows = p.stages.map((s) => ({ ...s }));
        const go = (row: { stageKey?: unknown }) =>
          void navigate({
            to: '/quotes',
            search: drillDown(search, { stage: String(row.stageKey), status: 'open' }),
          });
        const link = (stageKey: string) =>
          quotesLink(drillDown(search, { stage: stageKey, status: 'open' }));
        return (
          <SmallMultiples>
            <ChartCard
              testId="chart-pipeline-count"
              title="Open quotes by stage"
              info={p.info}
              summary={`${p.totals.count} open quotes across ${p.stages.length} stages.`}
              empty={p.totals.count === 0}
              emptyHint="There are no open quotes for these filters."
              table={{
                caption: 'Open quotes and SF opportunity amount (as entered) by stage',
                columns: [
                  { key: 'label', label: 'Stage' },
                  { key: 'count', label: 'Quotes', numeric: true },
                  { key: 'onHold', label: 'On hold', numeric: true },
                  { key: 'sfAmount', label: p.amountLabel, numeric: true },
                  { key: 'missing', label: 'No amount', numeric: true },
                  { key: 'view', label: 'Drill down' },
                ],
                rows: p.stages.map((s) => ({
                  label: s.label,
                  count: fmtCount(s.count),
                  onHold: fmtCount(s.onHold),
                  sfAmount: fmtUsd(s.sfAmount),
                  missing: fmtCount(s.amountMissing),
                  view: link(s.stageKey),
                })),
              }}
            >
              <Bars
                data={rows}
                xKey="label"
                orientation="horizontal"
                series={[{ key: 'count', label: 'Open quotes', color: COLORS.primary }]}
                labels
                onBarClick={go}
              />
            </ChartCard>
            <ChartCard
              testId="chart-pipeline-amount"
              title={p.amountLabel}
              info={p.info}
              summary={`${fmtUsd(p.totals.sfAmount)} of SF opportunity amount across open quotes.`}
              empty={p.totals.count === 0}
              emptyHint="There are no open quotes for these filters."
              note={
                p.totals.amountMissing > 0
                  ? `${p.totals.amountMissing} open quotes have no SF amount, so these totals understate the pipeline.`
                  : undefined
              }
              table={{
                caption: `${p.amountLabel} by stage`,
                columns: [
                  { key: 'label', label: 'Stage' },
                  { key: 'sfAmount', label: p.amountLabel, numeric: true },
                  { key: 'missing', label: 'Quotes with no amount', numeric: true },
                ],
                rows: p.stages.map((s) => ({
                  label: s.label,
                  sfAmount: fmtUsd(s.sfAmount),
                  missing: fmtCount(s.amountMissing),
                })),
              }}
            >
              <Bars
                data={rows}
                xKey="label"
                orientation="horizontal"
                series={[{ key: 'sfAmount', label: p.amountLabel, color: COLORS.secondary }]}
                format={fmtUsdCompact}
                labels
                onBarClick={go}
              />
            </ChartCard>
          </SmallMultiples>
        );
      }}
    </Boundary>
  );
}

function CycleSection({ search }: { search: AnalyticsSearch }) {
  const q = useChart('cycle', search, api.analyticsCycleTime);
  return (
    <Boundary query={q}>
      {(c: CycleTimeResponse) => {
        const thin = c.stages.filter((s) => s.n < c.thinBelow);
        const series: Series[] = [
          { key: 'median', label: 'Median days', color: COLORS.primary },
          { key: 'p75', label: '75th percentile days', color: COLORS.secondary },
        ];
        return (
          <SmallMultiples>
            <ChartCard
              testId="chart-cycle-stage"
              title="Days in each stage (holds excluded)"
              info={c.info}
              summary="Median and 75th percentile days per stage."
              empty={c.stages.length === 0}
              note={
                thin.length > 0
                  ? `Thin samples (fewer than ${c.thinBelow} stays): ${thin.map((s) => `${s.label} (${s.n})`).join(', ')}. Treat those medians as a rough guide.`
                  : undefined
              }
              table={{
                caption: 'Days in each stage, holds excluded',
                columns: [
                  { key: 'label', label: 'Stage' },
                  { key: 'n', label: 'Stays', numeric: true },
                  { key: 'median', label: 'Median', numeric: true },
                  { key: 'p75', label: 'p75', numeric: true },
                  { key: 'elapsed', label: 'Median incl. holds', numeric: true },
                  { key: 'held', label: 'Stays with holds', numeric: true },
                ],
                rows: c.stages.map((s) => ({
                  label: s.label,
                  n: fmtCount(s.n),
                  median: fmtDays(s.medianDays),
                  p75: fmtDays(s.p75Days),
                  elapsed: fmtDays(s.medianElapsedDays),
                  held: fmtCount(s.heldStays),
                })),
              }}
            >
              <Bars
                data={c.stages.map((s) => ({
                  label: s.label,
                  median: s.medianDays,
                  p75: s.p75Days,
                }))}
                xKey="label"
                orientation="horizontal"
                series={series}
                format={(v) => `${v} d`}
              />
            </ChartCard>
            <ChartCard
              testId="chart-cycle-e2e"
              title="Intake to G4 approval, by week"
              info={c.endToEndInfo}
              summary={`Median ${fmtDays(c.endToEnd.medianDays)} across ${c.endToEnd.n} quotes.`}
              empty={c.endToEnd.n === 0}
              emptyHint="No quote has been approved at G4 in this window yet."
              note={`Overall: median ${fmtDays(c.endToEnd.medianDays)}, p75 ${fmtDays(c.endToEnd.p75Days)} across ${c.endToEnd.n} quotes. Wall-clock median including holds: ${fmtDays(c.endToEnd.medianElapsedDays)}.`}
              table={{
                caption: 'Intake to G4 approval by week of approval',
                columns: [
                  { key: 'week', label: 'Week of' },
                  { key: 'n', label: 'Quotes', numeric: true },
                  { key: 'median', label: 'Median', numeric: true },
                  { key: 'p75', label: 'p75', numeric: true },
                ],
                rows: c.endToEnd.weekly.map((w) => ({
                  week: weekLabel(w.week),
                  n: fmtCount(w.n),
                  median: fmtDays(w.medianDays),
                  p75: fmtDays(w.p75Days),
                })),
              }}
            >
              <Trend
                data={c.endToEnd.weekly.map((w) => ({
                  week: w.week,
                  median: w.medianDays,
                  p75: w.p75Days,
                }))}
                xKey="week"
                xFormat={weekLabel}
                format={(v) => `${v} d`}
                series={[
                  { key: 'median', label: 'Median days', color: COLORS.primary },
                  {
                    key: 'p75',
                    label: '75th percentile days',
                    color: COLORS.secondary,
                    dashed: true,
                  },
                ]}
              />
            </ChartCard>
          </SmallMultiples>
        );
      }}
    </Boundary>
  );
}

function FlowSection({ search }: { search: AnalyticsSearch }) {
  const q = useChart('flow', search, api.analyticsFlow);
  return (
    <Boundary query={q}>
      {(f: FlowResponse) => {
        const total = f.weekly.reduce((n, w) => n + w.created + w.closed, 0);
        const wipSeries: Series[] = f.wip.stages.map((s, i) => ({
          key: s.stageKey,
          label: s.label,
          color: COLORS.ramp[Math.min(i, COLORS.ramp.length - 1)]!,
        }));
        const wipTotal = f.wip.weeks.reduce(
          (n, w) => n + Object.values(w.counts).reduce((a, b) => a + b, 0),
          0,
        );
        return (
          <SmallMultiples>
            <ChartCard
              testId="chart-flow"
              title="Quotes created and closed per week"
              info={f.info}
              summary="Weekly count of quotes created and quotes closed."
              empty={total === 0}
              table={{
                caption: 'Quotes created and closed per week',
                columns: [
                  { key: 'week', label: 'Week of' },
                  { key: 'created', label: 'Created', numeric: true },
                  { key: 'closed', label: 'Closed', numeric: true },
                ],
                rows: f.weekly.map((w) => ({
                  week: weekLabel(w.week),
                  created: fmtCount(w.created),
                  closed: fmtCount(w.closed),
                })),
              }}
            >
              <Trend
                data={f.weekly.map((w) => ({ ...w }))}
                xKey="week"
                xFormat={weekLabel}
                series={[
                  { key: 'created', label: 'Created', color: COLORS.primary },
                  { key: 'closed', label: 'Closed', color: COLORS.emphasis },
                ]}
              />
            </ChartCard>
            <ChartCard
              testId="chart-wip"
              title="Work in progress by stage"
              info={f.wipInfo}
              summary="Open quotes per stage at the end of each week."
              empty={wipTotal === 0}
              table={{
                caption: 'Work in progress by stage at the end of each week',
                columns: [
                  { key: 'week', label: 'Week of' },
                  ...f.wip.stages.map((s) => ({ key: s.stageKey, label: s.label, numeric: true })),
                ],
                rows: f.wip.weeks.map((w) => ({
                  week: weekLabel(w.week),
                  ...Object.fromEntries(
                    f.wip.stages.map((s) => [s.stageKey, fmtCount(w.counts[s.stageKey] ?? 0)]),
                  ),
                })),
              }}
            >
              <Bars
                data={f.wip.weeks.map((w) => ({
                  week: w.week,
                  ...Object.fromEntries(
                    f.wip.stages.map((s) => [s.stageKey, w.counts[s.stageKey] ?? 0]),
                  ),
                }))}
                xKey="week"
                xFormat={weekLabel}
                series={wipSeries}
                stacked
              />
            </ChartCard>
          </SmallMultiples>
        );
      }}
    </Boundary>
  );
}

function SplitCard({
  title,
  rows,
  info,
  search,
  dimension,
  amountLabel,
}: {
  title: string;
  rows: OutcomeSplitRow[];
  info: OutcomesResponse['info'];
  search: AnalyticsSearch;
  dimension: 'market' | 'productFamily' | 'kam';
  amountLabel: string;
}) {
  const data = [...rows]
    .sort((a, b) => b.recorded + b.awaiting + b.goneDark - (a.recorded + a.awaiting + a.goneDark))
    .map((r) => ({ label: r.label, win: r.winRate, capture: r.captureRate }));
  return (
    <ChartCard
      testId={`chart-outcomes-${dimension}`}
      title={title}
      info={info}
      summary="Win rate and outcome capture rate side by side for each group."
      empty={rows.length === 0}
      emptyHint="No proposals were issued in this window."
      note="Each win rate is shown with its own capture rate. A group with low capture has a win rate that may mislead."
      table={{
        caption: `${title}: win rate and outcome capture rate`,
        columns: [
          { key: 'label', label: 'Group' },
          { key: 'win', label: 'Win rate', numeric: true },
          { key: 'capture', label: 'Outcome capture', numeric: true },
          { key: 'decided', label: 'Awarded / lost', numeric: true },
          { key: 'expired', label: 'Expired', numeric: true },
          { key: 'amount', label: `Awarded ${amountLabel}`, numeric: true },
          { key: 'view', label: 'Drill down' },
        ],
        rows: rows.map((r) => ({
          label: r.label,
          win: fmtPct(r.winRate),
          capture: (
            <span className={r.lowCapture ? 'text-emphasis font-medium' : undefined}>
              {fmtPct(r.captureRate)}
              {r.lowCapture ? ' (low)' : ''}
            </span>
          ),
          decided: `${fmtCount(r.awarded)} / ${fmtCount(r.lost)}`,
          expired: fmtCount(r.expired),
          amount: fmtUsd(r.awardedAmount),
          view: quotesLink(drillDown(search, { [dimension]: r.key, status: 'closed' })),
        })),
      }}
    >
      <SmallMultiples>
        <div className="grid gap-1">
          <p className="text-foreground-2 text-xs font-medium">Win rate (decided only)</p>
          <Bars
            data={data}
            xKey="label"
            orientation="horizontal"
            series={[{ key: 'win', label: 'Win rate', color: COLORS.primary }]}
            format={fmtPct}
            unit
            labels
            categoryWidth={150}
            height={120}
          />
        </div>
        <div className="grid gap-1">
          <p className="text-foreground-2 text-xs font-medium">Outcome capture rate</p>
          <Bars
            data={data}
            xKey="label"
            orientation="horizontal"
            series={[{ key: 'capture', label: 'Outcome capture', color: COLORS.secondary }]}
            format={fmtPct}
            unit
            labels
            categoryWidth={150}
            height={120}
          />
        </div>
      </SmallMultiples>
    </ChartCard>
  );
}

function OutcomesSection({ search }: { search: AnalyticsSearch }) {
  const q = useChart('outcomes', search, api.analyticsOutcomes);
  return (
    <Boundary query={q}>
      {(o: OutcomesResponse) => (
        <div className="grid gap-4">
          <RatePair
            rates={o.total}
            info={o.info}
            captureInfo={o.captureInfo}
            lowCaptureBelow={o.lowCaptureBelow}
          />
          <p className="text-muted-foreground text-xs">
            Amounts are the {o.amountLabel}, not price or booked revenue. Window:{' '}
            {dayRange(o.window.from, o.window.to)}.
          </p>
          <SplitCard
            title="By market"
            rows={o.byMarket}
            info={o.info}
            search={search}
            dimension="market"
            amountLabel={o.amountLabel}
          />
          <SplitCard
            title="By product family"
            rows={o.byProductFamily}
            info={o.info}
            search={search}
            dimension="productFamily"
            amountLabel={o.amountLabel}
          />
          <SplitCard
            title="By KAM"
            rows={o.byKam}
            info={o.info}
            search={search}
            dimension="kam"
            amountLabel={o.amountLabel}
          />
          <ChartCard
            testId="chart-loss-reasons"
            title="Why quotes are lost"
            info={o.lossReasonsInfo}
            summary="Lost quotes by reason, biggest first, with the running share of all losses."
            empty={o.lossReasons.length === 0}
            emptyHint="No lost quotes in this window, so there are no reasons to rank."
            table={{
              caption: 'Loss reasons (Pareto)',
              columns: [
                { key: 'label', label: 'Reason' },
                { key: 'count', label: 'Lost quotes', numeric: true },
                { key: 'amount', label: o.amountLabel, numeric: true },
                { key: 'cum', label: 'Cumulative share', numeric: true },
              ],
              rows: o.lossReasons.map((l) => ({
                label: l.label,
                count: fmtCount(l.count),
                amount: fmtUsd(l.amount),
                cum: fmtPct(l.cumulativeShare),
              })),
            }}
          >
            <SmallMultiples>
              <div className="grid gap-1">
                <p className="text-foreground-2 text-xs font-medium">Lost quotes</p>
                <Bars
                  data={o.lossReasons.map((l) => ({ label: l.label, count: l.count }))}
                  xKey="label"
                  orientation="horizontal"
                  series={[{ key: 'count', label: 'Lost quotes', color: COLORS.primary }]}
                  labels
                  categoryWidth={110}
                  height={140}
                />
              </div>
              <div className="grid gap-1">
                <p className="text-foreground-2 text-xs font-medium">Cumulative share of losses</p>
                <Trend
                  data={o.lossReasons.map((l) => ({ label: l.label, share: l.cumulativeShare }))}
                  xKey="label"
                  series={[{ key: 'share', label: 'Cumulative share', color: COLORS.emphasis }]}
                  format={fmtPct}
                  unit
                  height={160}
                />
              </div>
            </SmallMultiples>
          </ChartCard>
        </div>
      )}
    </Boundary>
  );
}

function QualitySection({ search }: { search: AnalyticsSearch }) {
  const fp = useChart('first-pass', search, api.analyticsFirstPass);
  const g1 = useChart('g1', search, api.analyticsG1Yield);
  const ov = useChart('overrides', search, api.analyticsOverrides);
  const gc = useChart('gate-compliance', search, api.analyticsGateCompliance);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Boundary query={fp}>
          {(d: FirstPassResponse) => (
            <Stat
              testId="stat-first-pass"
              label="First-pass intake completeness"
              value={fmtPct(d.rate)}
              hint={
                d.resolved === 0
                  ? 'No resolved intakes in this window.'
                  : `${fmtCount(d.firstPass)} of ${fmtCount(d.resolved)} resolved intakes needed no rework.`
              }
              info={d.info}
            />
          )}
        </Boundary>
        <Boundary query={gc}>
          {(d: GateComplianceResponse) => (
            <Stat
              testId="stat-gate-compliance"
              label="Gate compliance"
              value={fmtPct(d.rate)}
              hint={
                d.proposals === 0
                  ? 'No proposals issued in this window.'
                  : `${fmtCount(d.compliant)} of ${fmtCount(d.proposals)} issued proposals have G1–G4 recorded.`
              }
              info={d.info}
            />
          )}
        </Boundary>
        <Boundary query={ov}>
          {(d: OverridesResponse) => (
            <Stat
              testId="stat-overrides"
              label="Override requests per quote"
              value={d.perQuote === null ? '–' : String(Math.round(d.perQuote * 100) / 100)}
              hint={`${fmtCount(d.total)} requests, ${fmtCount(d.quotesCreated)} quotes created.`}
              info={d.info}
            />
          )}
        </Boundary>
      </div>
      <SmallMultiples>
        <Boundary query={g1}>
          {(d: G1YieldResponse) => (
            <ChartCard
              testId="chart-g1-yield"
              title="G1 qualification yield by outcome"
              info={d.info}
              summary="Share of G1 decisions by outcome."
              empty={d.total === 0}
              emptyHint="No G1 decisions in this window yet."
              table={{
                caption: 'G1 decisions by outcome',
                columns: [
                  { key: 'label', label: 'Outcome' },
                  { key: 'count', label: 'Decisions', numeric: true },
                  { key: 'share', label: 'Share', numeric: true },
                ],
                rows: d.outcomes.map((o) => ({
                  label: o.label,
                  count: fmtCount(o.count),
                  share: fmtPct(o.share),
                })),
              }}
            >
              <Bars
                data={d.outcomes.map((o) => ({ label: o.label, share: o.share }))}
                xKey="label"
                orientation="horizontal"
                series={[{ key: 'share', label: 'Share of decisions', color: COLORS.primary }]}
                format={fmtPct}
                unit
                labels
              />
            </ChartCard>
          )}
        </Boundary>
        <Boundary query={fp}>
          {(d: FirstPassResponse) => (
            <ChartCard
              testId="chart-rework-reasons"
              title="Why work is sent back to the KAM"
              info={d.reworkReasonsInfo}
              summary="Top reasons for G1 and G2 rework."
              empty={d.reworkReasons.length === 0}
              emptyHint="No rework decisions in this window."
              table={{
                caption: 'Top rework reasons',
                columns: [
                  { key: 'label', label: 'Reason' },
                  { key: 'gate', label: 'Gate' },
                  { key: 'count', label: 'Decisions', numeric: true },
                ],
                rows: d.reworkReasons.map((r) => ({
                  label: r.label,
                  gate: r.gateKey,
                  count: fmtCount(r.count),
                })),
              }}
            >
              <Bars
                data={d.reworkReasons.map((r) => ({
                  label: `${r.label} (${r.gateKey})`,
                  count: r.count,
                }))}
                xKey="label"
                orientation="horizontal"
                series={[{ key: 'count', label: 'Decisions', color: COLORS.emphasis }]}
                labels
                categoryWidth={130}
              />
            </ChartCard>
          )}
        </Boundary>
        <Boundary query={ov}>
          {(d: OverridesResponse) => (
            <ChartCard
              testId="chart-overrides"
              title="Overrides by field and approver"
              info={d.info}
              summary="Override requests by field."
              empty={d.total === 0}
              emptyHint="No override requests in this window."
              table={{
                caption: 'Override requests by field, then by approver',
                columns: [
                  { key: 'label', label: 'Field or approver' },
                  { key: 'count', label: 'Requests', numeric: true },
                  { key: 'applied', label: 'Applied', numeric: true },
                ],
                rows: [
                  ...d.byField.map((f) => ({
                    label: `Field: ${f.field}`,
                    count: fmtCount(f.count),
                    applied: fmtCount(f.applied),
                  })),
                  ...d.byApprover.map((a) => ({
                    label: `Approver: ${a.approver}`,
                    count: fmtCount(a.count),
                    applied: '–',
                  })),
                ],
              }}
            >
              <div className="grid gap-3">
                <Bars
                  data={d.byField.map((f) => ({ label: f.field, count: f.count }))}
                  xKey="label"
                  orientation="horizontal"
                  series={[{ key: 'count', label: 'Requests by field', color: COLORS.primary }]}
                  labels
                  categoryWidth={110}
                  height={110}
                />
                <Bars
                  data={d.byApprover.map((a) => ({ label: a.approver, count: a.count }))}
                  xKey="label"
                  orientation="horizontal"
                  series={[
                    { key: 'count', label: 'Requests by approver', color: COLORS.secondary },
                  ]}
                  labels
                  categoryWidth={110}
                  height={110}
                />
              </div>
            </ChartCard>
          )}
        </Boundary>
        <Boundary query={gc}>
          {(d: GateComplianceResponse) => (
            <ChartCard
              testId="chart-gate-compliance"
              title="Gate decisions recorded on issued proposals"
              info={d.info}
              summary="How many issued proposals have a decision at each gate."
              empty={d.proposals === 0}
              emptyHint="No proposals were issued in this window."
              table={{
                caption: 'Issued proposals with a recorded decision at each gate',
                columns: [
                  { key: 'label', label: 'Gate' },
                  { key: 'recorded', label: 'Recorded', numeric: true },
                  { key: 'of', label: 'Of proposals', numeric: true },
                ],
                rows: d.gates.map((g) => ({
                  label: g.label,
                  recorded: fmtCount(g.recorded),
                  of: fmtCount(d.proposals),
                })),
              }}
            >
              <Bars
                data={d.gates.map((g) => ({
                  label: g.label,
                  share: d.proposals === 0 ? null : g.recorded / d.proposals,
                }))}
                xKey="label"
                orientation="horizontal"
                series={[{ key: 'share', label: 'Share with a decision', color: COLORS.primary }]}
                format={fmtPct}
                unit
                labels
                categoryWidth={130}
              />
            </ChartCard>
          )}
        </Boundary>
      </SmallMultiples>
    </div>
  );
}

const VERDICT: Record<PriorityResponse['queueHonoursPriority'], string> = {
  yes: 'Higher tiers are being assigned no later than lower ones.',
  no: 'A lower tier is being assigned sooner than a higher one: the queue is not honouring priority.',
  unknown: 'Not enough assignments in two tiers to judge whether the queue honours priority.',
};

function PrioritySection({ search }: { search: AnalyticsSearch }) {
  const q = useChart('priority', search, api.analyticsPriority);
  return (
    <Boundary query={q}>
      {(p: PriorityResponse) => (
        <div className="grid gap-4">
          <p
            role="status"
            data-testid="priority-verdict"
            className="bg-card rounded-card border p-3 text-sm"
          >
            <span className="font-medium">Is the queue honouring priority? </span>
            {VERDICT[p.queueHonoursPriority]}
          </p>
          <SmallMultiples>
            <ChartCard
              testId="chart-tiers"
              title="Quotes by priority tier"
              info={p.info}
              summary="Number of quotes created in the window, by priority tier."
              empty={p.tiers.length === 0}
              table={{
                caption: 'Quotes by priority tier',
                columns: [
                  { key: 'tier', label: 'Tier' },
                  { key: 'count', label: 'Quotes', numeric: true },
                  { key: 'share', label: 'Share', numeric: true },
                  { key: 'view', label: 'Drill down' },
                ],
                rows: p.tiers.map((t) => ({
                  tier: t.tier,
                  count: fmtCount(t.count),
                  share: fmtPct(t.share),
                  view: quotesLink(
                    drillDown(search, { tier: t.tier.toUpperCase(), status: 'open' }),
                  ),
                })),
              }}
            >
              <Bars
                data={p.tiers.map((t) => ({ label: t.tier, count: t.count }))}
                xKey="label"
                series={[{ key: 'count', label: 'Quotes', color: COLORS.primary }]}
              />
            </ChartCard>
            <ChartCard
              testId="chart-tier-assign"
              title="Tier vs actual time to assign"
              info={p.assignInfo}
              summary="Median and 75th percentile days to assignment, by tier."
              empty={p.assignByTier.length === 0}
              emptyHint="No engineering assignments were made in this window."
              note="A tier with fewer than 3 assignments is too thin to read much into."
              table={{
                caption: 'Days from entering the engineering queue to assignment, by tier',
                columns: [
                  { key: 'tier', label: 'Tier' },
                  { key: 'n', label: 'Assignments', numeric: true },
                  { key: 'median', label: 'Median', numeric: true },
                  { key: 'p75', label: 'p75', numeric: true },
                ],
                rows: p.assignByTier.map((t) => ({
                  tier: t.tier,
                  n: fmtCount(t.n),
                  median: fmtDays(t.medianDays),
                  p75: fmtDays(t.p75Days),
                })),
              }}
            >
              <Bars
                data={p.assignByTier.map((t) => ({
                  label: t.tier,
                  median: t.medianDays,
                  p75: t.p75Days,
                }))}
                xKey="label"
                format={(v) => `${v} d`}
                series={[
                  { key: 'median', label: 'Median days', color: COLORS.primary },
                  { key: 'p75', label: '75th percentile days', color: COLORS.secondary },
                ]}
              />
            </ChartCard>
          </SmallMultiples>
        </div>
      )}
    </Boundary>
  );
}

function AdoptionSection({ search }: { search: AnalyticsSearch }) {
  const q = useChart('adoption', search, api.analyticsAdoption);
  return (
    <Boundary query={q}>
      {(a: AdoptionResponse) => (
        <div className="grid gap-4">
          <ChartCard
            testId="chart-adoption"
            title="Weekly active users by role"
            info={a.info}
            summary="Distinct active people per week, one small chart per role."
            empty={a.roles.length === 0}
            emptyHint="No recorded activity in this window."
            table={{
              caption: 'Weekly active users by role',
              columns: [
                { key: 'week', label: 'Week of' },
                ...a.roles.map((r) => ({ key: r, label: r, numeric: true })),
              ],
              rows: a.weeklyActive.map((w) => ({
                week: weekLabel(w.week),
                ...Object.fromEntries(a.roles.map((r) => [r, fmtCount(w.byRole[r] ?? 0)])),
              })),
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {a.roles.map((role) => (
                <div key={role} className="grid gap-1">
                  <p className="text-foreground-2 text-xs font-medium">{role}</p>
                  <Trend
                    data={a.weeklyActive.map((w) => ({ week: w.week, users: w.byRole[role] ?? 0 }))}
                    xKey="week"
                    xFormat={weekLabel}
                    series={[{ key: 'users', label: role, color: COLORS.primary }]}
                    height={120}
                  />
                </div>
              ))}
            </div>
          </ChartCard>
          <ChartCard
            testId="chart-intakes"
            title="Intakes created in QuoteFlow"
            info={a.intakesInfo}
            summary="Intakes submitted per week."
            empty={a.intakes.every((i) => i.count === 0)}
            emptyHint="No intakes were submitted in QuoteFlow in this window."
            table={{
              caption: 'Intakes created per week',
              columns: [
                { key: 'week', label: 'Week of' },
                { key: 'count', label: 'Intakes', numeric: true },
              ],
              rows: a.intakes.map((i) => ({ week: weekLabel(i.week), count: fmtCount(i.count) })),
            }}
          >
            <Bars
              data={a.intakes.map((i) => ({ ...i }))}
              xKey="week"
              xFormat={weekLabel}
              series={[{ key: 'count', label: 'Intakes', color: COLORS.primary }]}
              height={180}
            />
          </ChartCard>
        </div>
      )}
    </Boundary>
  );
}

const NAV = [
  ['pipeline', 'Pipeline'],
  ['cycle', 'Cycle time'],
  ['flow', 'Flow'],
  ['outcomes', 'Outcomes'],
  ['quality', 'Quality and governance'],
  ['priority', 'Priority'],
  ['adoption', 'Adoption'],
] as const;

/**
 * F-17 operational analytics (B-17): pipeline, cycle time, flow, outcomes with capture rate, quality
 * and governance, priority and adoption. Everything is computed on the server from the analytics
 * views; this page draws it. Each chart states its definition and window, and has a table view.
 */
export function AnalyticsPage({
  search,
  onSearchChange,
}: {
  search: AnalyticsSearch;
  onSearchChange: (next: AnalyticsSearch) => void;
}) {
  useDocumentTitle('Analytics');
  const me = useCurrentUser();
  const filters = useQuery({
    queryKey: ['analytics', 'filters'],
    queryFn: api.analyticsFilters,
    staleTime: 5 * 60_000,
  });
  const showAdoption = canFromMe(me, 'audit.read');
  const nav = useMemo(
    () => NAV.filter(([id]) => id !== 'adoption' || showAdoption),
    [showAdoption],
  );
  return (
    <div className="grid gap-8" data-testid="analytics-page">
      <PageHeader
        className="mb-0"
        eyebrow="Insights"
        title="Analytics"
        description="Where quotes are, how long each step takes, what happens to the proposals, and how well intake and governance are working. Every chart says how it is defined and what period it covers."
      />
      <FilterBar search={search} filters={filters.data} onChange={onSearchChange} />
      <nav aria-label="Sections" className="flex flex-wrap gap-2">
        {nav.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-pill bg-card text-foreground-2 hover:bg-accent inline-flex min-h-11 items-center border px-4 text-sm font-medium sm:min-h-9"
          >
            {label}
          </a>
        ))}
      </nav>
      <Section
        id="pipeline"
        title="Pipeline"
        description="Open quotes right now. The amount is the Salesforce opportunity amount as entered, so read it as size of opportunity, not price."
      >
        <PipelineSection search={search} />
      </Section>
      <Section
        id="cycle"
        title="Cycle time"
        description="How many days a quote spends in each stage and from intake to release. Time on a recorded customer or internal hold is taken out."
      >
        <CycleSection search={search} />
      </Section>
      <Section
        id="flow"
        title="Flow"
        description="Whether work is arriving faster than it is being closed, and where it is sitting."
      >
        <FlowSection search={search} />
      </Section>
      <Section
        id="outcomes"
        title="Outcomes"
        description="What happens to the proposals we issue. The win rate only counts decided quotes, so it always sits next to how many outcomes were actually recorded."
      >
        <OutcomesSection search={search} />
      </Section>
      <Section
        id="quality"
        title="Quality and governance"
        description="How complete intake is, how G1 qualification lands, how often defaults are overridden, and whether every issued proposal went through every gate."
      >
        <QualitySection search={search} />
      </Section>
      <Section
        id="priority"
        title="Priority"
        description="How quotes spread across tiers, and whether the manual engineering queue treats higher tiers first."
      >
        <PrioritySection search={search} />
      </Section>
      {showAdoption && (
        <Section
          id="adoption"
          title="Adoption"
          description="Who is using QuoteFlow each week, from the audit log."
        >
          <AdoptionSection search={search} />
        </Section>
      )}
      <footer
        className="text-muted-foreground border-t pt-4 text-sm"
        data-testid="analytics-footer"
      >
        {ANALYTICS_DISCLAIMER}
      </footer>
    </div>
  );
}
