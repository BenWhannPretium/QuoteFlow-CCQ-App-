import type {
  ApproverDashboard,
  DashQuote,
  DashboardResponse,
  DashboardRole,
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
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { RatePair } from '@/analytics/RatePair';
import { Stat, fmtCount, fmtDays, fmtPct, fmtUsd, fmtUsdCompact } from '@/components/charts';
import { InfoTip } from '@/components/charts/InfoTip';
import { ErrorState } from '@/components/ErrorState';
import { SkeletonCard } from '@/components/Skeletons';
import { TierChip } from '@/components/TierChip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { cn } from '@/lib/utils';

/**
 * F-02 role dashboards (B-17). Every number is computed by `GET /api/v1/dashboards/:role`; these
 * components only lay it out. Each block carries an info tooltip with its definition and time window.
 */

function Block({
  title,
  info,
  testId,
  action,
  children,
  className,
}: {
  title: string;
  info: MetricInfo;
  testId: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('min-w-0', className)} data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2">
          <div className="grid gap-0.5">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-muted-foreground text-xs font-normal">{info.window}</p>
          </div>
          <InfoTip label={title} info={info} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {children}
        {action}
      </CardContent>
    </Card>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-muted-foreground text-sm" data-testid="block-empty">
    {children}
  </p>
);

const quoteLink = (quoteNumber: string) => (
  <Link
    to="/quotes/$quoteNumber"
    params={{ quoteNumber }}
    className="text-foreground font-medium underline-offset-2 hover:underline"
  >
    {quoteNumber}
  </Link>
);

const MoreLink = ({
  to,
  search,
  children,
}: {
  to: string;
  search?: object;
  children: ReactNode;
}) => (
  <Link
    to={to}
    {...(search ? { search } : {})}
    className="text-emphasis inline-flex min-h-9 items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
  >
    {children}
    <ArrowRightIcon className="size-4" aria-hidden="true" />
  </Link>
);

function QuoteList({ items, ageLabel = 'in stage' }: { items: DashQuote[]; ageLabel?: string }) {
  return (
    <ul className="divide-y">
      {items.map((q) => (
        <li
          key={q.quoteNumber}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm"
        >
          <span className="grid min-w-0">
            {quoteLink(q.quoteNumber)}
            <span className="text-muted-foreground truncate text-xs">{q.account}</span>
          </span>
          <span className="flex items-center gap-2">
            {q.tier && <TierChip tier={q.tier} />}
            {q.daysInStage !== null && (
              <span className="text-muted-foreground text-xs tabular-nums">
                {q.daysInStage} d {ageLabel}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Expiring({ items }: { items: ExpiringProposal[] }) {
  return (
    <ul className="divide-y">
      {items.map((p) => (
        <li
          key={p.quoteNumber}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm"
        >
          <span className="grid min-w-0">
            {quoteLink(p.quoteNumber)}
            <span className="text-muted-foreground truncate text-xs">
              {p.account}
              {p.kamName ? ` · ${p.kamName}` : ''}
            </span>
          </span>
          <span
            className={cn(
              'text-xs tabular-nums',
              p.lapsed ? 'text-emphasis font-semibold' : 'text-muted-foreground',
            )}
          >
            {p.lapsed
              ? `Lapsed ${Math.abs(p.daysLeft)} d ago`
              : p.daysLeft === 0
                ? 'Ends today'
                : `${p.daysLeft} d left`}{' '}
            · {p.validityUntil}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Aging buckets as labelled bars; the oldest bucket is copper and says "oldest" in text too. */
function Buckets({ q }: { q: QueueHealth }) {
  const max = Math.max(1, ...q.buckets.map((b) => b.count));
  return (
    <ul className="grid gap-2" aria-label="Waiting time">
      {q.buckets.map((b, i) => {
        const oldest = i === q.buckets.length - 1;
        return (
          <li
            key={b.key}
            className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-sm"
            data-testid={`bucket-${b.key}`}
          >
            <span className="text-foreground-2 text-xs">
              {b.label}
              {oldest && <span className="sr-only"> (oldest)</span>}
            </span>
            <span className="bg-muted h-3 rounded-full" aria-hidden="true">
              <span
                className="block h-3 rounded-full"
                style={{
                  width: `${(b.count / max) * 100}%`,
                  background: oldest ? 'var(--dv-emphasis)' : 'var(--dv-primary)',
                }}
              />
            </span>
            <span className="text-right font-medium tabular-nums">{b.count}</span>
          </li>
        );
      })}
    </ul>
  );
}

function QueueBlock({ q, title, testId }: { q: QueueHealth; title: string; testId: string }) {
  return (
    <Block title={title} info={q.info} testId={testId}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="In the queue" value={fmtCount(q.total)} />
        {q.unassigned !== null && <Stat label="Unassigned" value={fmtCount(q.unassigned)} />}
        <Stat label="On hold" value={fmtCount(q.onHold)} />
      </div>
      <Buckets q={q} />
    </Block>
  );
}

/** Stage columns with counts and the oldest quotes; stacks to one column on a phone. */
function StageBoard({ p, drill }: { p: StagePipeline; drill?: boolean }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="mini-board">
      {p.stages.map((s) => (
        <li key={s.stageKey} className="bg-muted/50 rounded-lg border p-3" data-stage={s.stageKey}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{s.label}</h3>
            <span className="font-display text-xl tabular-nums">{s.count}</span>
          </div>
          {s.sfAmount > 0 && (
            <p className="text-muted-foreground text-xs">{fmtUsdCompact(s.sfAmount)} SF amount</p>
          )}
          {s.quotes.length > 0 && (
            <ul className="mt-2 grid gap-1 text-xs">
              {s.quotes.map((q) => (
                <li key={q.quoteNumber} className="flex justify-between gap-2">
                  {quoteLink(q.quoteNumber)}
                  <span className="text-muted-foreground tabular-nums">
                    {q.daysInStage === null ? '' : `${q.daysInStage} d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {drill && s.count > 0 && (
            <Link
              to="/quotes"
              search={{ stage: s.stageKey, status: 'open' }}
              className="text-emphasis mt-2 inline-block text-xs font-medium underline-offset-2 hover:underline"
            >
              View {s.count}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Roles ──────────────────────────────────────────────────────────────────────────────────────

function Kam({ d }: { d: KamDashboard }) {
  const r = d.capture.rates;
  return (
    <>
      <Block title="Returned to me" info={d.returned.info} testId="dash-returned">
        {d.returned.items.length === 0 ? (
          <Empty>Nothing has been sent back to you.</Empty>
        ) : (
          <ul className="divide-y">
            {d.returned.items.map((i) => (
              <li key={i.quoteNumber} className="grid gap-1 py-2 text-sm">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    {quoteLink(i.quoteNumber)}{' '}
                    <span className="text-muted-foreground text-xs">{i.account}</span>
                  </span>
                  <span className="text-emphasis text-xs font-semibold">
                    {i.reason ?? 'Reason not recorded'}
                    {i.gateKey ? ` · ${i.gateKey}` : ''}
                  </span>
                </span>
                {i.note && <span className="text-foreground-2">{i.note}</span>}
                <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-xs">
                  {i.returnedBy && <span>By {i.returnedBy}</span>}
                  {i.returnedAt && <span>{absoluteTime(i.returnedAt)}</span>}
                  {i.draftId ? (
                    <Link
                      to="/intake/new"
                      search={{ draft: i.draftId }}
                      className="text-emphasis font-medium hover:underline"
                    >
                      Continue the rework draft
                    </Link>
                  ) : (
                    <Link
                      to="/quotes/$quoteNumber"
                      params={{ quoteNumber: i.quoteNumber }}
                      className="text-emphasis font-medium hover:underline"
                    >
                      Open to start the rework
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="My drafts" info={d.drafts.info} testId="dash-drafts">
        {d.drafts.items.length === 0 ? (
          <Empty>
            No unfinished intakes. Start a new one when a Salesforce opportunity is ready.
          </Empty>
        ) : (
          <ul className="divide-y">
            {d.drafts.items.map((i) => (
              <li
                key={i.draftId}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="grid min-w-0">
                  <span className="truncate font-medium">
                    {i.opportunity ?? 'Untitled draft'}
                    {i.reworkOfQuoteNumber ? ` · rework of ${i.reworkOfQuoteNumber}` : ''}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Step {i.step} of 4 · saved {absoluteTime(i.updatedAt)}
                  </span>
                </span>
                <Link
                  to="/intake/new"
                  search={{ draft: i.draftId }}
                  className="text-emphasis text-sm font-medium hover:underline"
                >
                  Resume
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block
        title="My open quotes by stage"
        info={d.pipeline.info}
        testId="dash-my-pipeline"
        className="lg:col-span-2"
        action={
          <MoreLink to="/quotes" search={{ kam: 'me', status: 'open' }}>
            See all my quotes
          </MoreLink>
        }
      >
        {d.pipeline.total === 0 ? (
          <Empty>You have no open quotes.</Empty>
        ) : (
          <StageBoard p={d.pipeline} />
        )}
      </Block>
      <Block
        title="Proposals expiring soon"
        info={d.expiring.info}
        testId="dash-expiring"
        action={<MoreLink to="/proposals">Open my proposals</MoreLink>}
      >
        {d.expiring.items.length === 0 ? (
          <Empty>No proposals end within {d.expiring.withinDays} days.</Empty>
        ) : (
          <Expiring items={d.expiring.items} />
        )}
      </Block>
      <Block title="My outcome capture rate" info={d.capture.info} testId="dash-capture">
        <Stat
          label="Outcome capture rate"
          value={fmtPct(r.captureRate)}
          hint={
            r.recorded + r.goneDark === 0
              ? 'No proposals are past their validity yet, so there is nothing to measure.'
              : `${fmtCount(r.recorded)} recorded, ${fmtCount(r.goneDark)} gone dark, ${fmtCount(r.awaiting)} still waiting.`
          }
          {...(r.lowCapture ? { tone: 'alert' as const } : {})}
        />
        {r.goneDark > 0 && (
          <p className="text-foreground-2 text-sm">
            {r.goneDark} {r.goneDark === 1 ? 'proposal is' : 'proposals are'} past validity with no
            outcome. Record what happened to bring the rate up.
          </p>
        )}
      </Block>
    </>
  );
}

function SalesLeader({ d }: { d: SalesLeaderDashboard }) {
  return (
    <>
      <Block
        title="To qualify (G1)"
        info={d.toQualify.info}
        testId="dash-to-qualify"
        action={
          <MoreLink to="/approvals" search={{ tab: 'to-qualify' }}>
            Open the qualification queue
          </MoreLink>
        }
      >
        <Stat label="Waiting for your decision" value={fmtCount(d.toQualify.count)} />
        {d.toQualify.items.length === 0 ? (
          <Empty>No intakes are waiting for qualification.</Empty>
        ) : (
          <QuoteList items={d.toQualify.items} ageLabel="waiting" />
        )}
      </Block>
      <Block
        title="Pending override requests"
        info={d.pendingOverrides.info}
        testId="dash-overrides"
        action={
          <MoreLink to="/approvals" search={{ tab: 'overrides' }}>
            Review overrides
          </MoreLink>
        }
      >
        <Stat label="Waiting for an approver" value={fmtCount(d.pendingOverrides.count)} />
        {d.pendingOverrides.items.length === 0 ? (
          <Empty>No override requests are waiting.</Empty>
        ) : (
          <ul className="divide-y">
            {d.pendingOverrides.items.map((o) => (
              <li key={o.overrideId} className="grid gap-0.5 py-2 text-sm">
                <span>
                  {quoteLink(o.quoteNumber)}{' '}
                  <span className="text-muted-foreground text-xs">· {o.field}</span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {o.requestedBy ?? 'Unknown'} · {absoluteTime(o.requestedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block
        title="Team pipeline by stage"
        info={d.pipeline.info}
        testId="dash-team-pipeline"
        className="lg:col-span-2"
      >
        {d.pipeline.total === 0 ? (
          <Empty>No open quotes.</Empty>
        ) : (
          <StageBoard p={d.pipeline} drill />
        )}
      </Block>
      <Block
        title="Proposals with no outcome past validity"
        info={d.lackingOutcomes.info}
        testId="dash-lacking"
        className="lg:col-span-2"
      >
        <Stat
          label="Past validity, no outcome"
          value={fmtCount(d.lackingOutcomes.count)}
          tone={d.lackingOutcomes.count > 0 ? 'alert' : 'default'}
        />
        {d.lackingOutcomes.items.length === 0 ? (
          <Empty>Every proposal past its validity date has an outcome.</Empty>
        ) : (
          <Expiring items={d.lackingOutcomes.items} />
        )}
      </Block>
    </>
  );
}

function Engineering({ d }: { d: EngineeringDashboard }) {
  return (
    <>
      <QueueBlock q={d.queue} title="Queue health" testId="dash-queue" />
      <Block title="Open load per engineer" info={d.load.info} testId="dash-load">
        {d.load.items.length === 0 ? (
          <Empty>The queue is empty.</Empty>
        ) : (
          <ul className="divide-y">
            {d.load.items.map((l) => (
              <li
                key={l.engineerId ?? 'none'}
                className="flex items-center justify-between gap-2 py-2 text-sm"
              >
                <span className={cn(l.engineerId === null && 'text-emphasis font-medium')}>
                  {l.name}
                </span>
                <span className="font-medium tabular-nums">{l.open}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="Time to assign and to G2" info={d.timeToAssign.info} testId="dash-medians">
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Median time to assign"
            value={fmtDays(d.timeToAssign.medianDays)}
            hint={`${d.timeToAssign.n} assignments`}
            info={d.timeToAssign.info}
            testId="stat-time-to-assign"
          />
          <Stat
            label="Median assign to G2"
            value={fmtDays(d.assignToG2.medianDays)}
            hint={`${d.assignToG2.n} decisions`}
            info={d.assignToG2.info}
            testId="stat-assign-to-g2"
          />
        </div>
      </Block>
      <Block
        title="Returned to the KAM: top reasons"
        info={d.returned.info}
        testId="dash-returned-reasons"
      >
        {d.returned.reasons.length === 0 ? (
          <Empty>Nothing has been returned to a KAM in this period.</Empty>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-display text-2xl tabular-nums">{d.returned.total}</span>{' '}
              returned. Most common reasons:
            </p>
            <ol className="divide-y">
              {d.returned.reasons.map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>{r.label}</span>
                  <span className="font-medium tabular-nums">{r.count}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </Block>
      {d.role === 'Engineer' && (
        <Block
          title="Assigned to me"
          info={d.mine.info}
          testId="dash-mine"
          className="lg:col-span-2"
        >
          {d.mine.items.length === 0 ? (
            <Empty>Nothing is assigned to you.</Empty>
          ) : (
            <QuoteList items={d.mine.items} />
          )}
        </Block>
      )}
    </>
  );
}

function Pricing({ d }: { d: PricingDashboard }) {
  return (
    <>
      <QueueBlock q={d.queue} title="Quoting queue" testId="dash-queue" />
      {d.load && (
        <Block
          title="Open load per pricer"
          info={d.load.info}
          testId="dash-pricer-load"
          action={<MoreLink to="/queue/pricing">Assign in the queue</MoreLink>}
        >
          {d.load.items.length === 0 ? (
            <Empty>The queue is empty.</Empty>
          ) : (
            <ul className="divide-y">
              {d.load.items.map((l) => (
                <li
                  key={l.pricerId ?? 'none'}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className={cn(l.pricerId === null && 'text-emphasis font-medium')}>
                    {l.name}
                  </span>
                  <span className="font-medium tabular-nums">{l.open}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      )}
      <Block
        title="Capital readiness pending"
        info={d.capitalPending.info}
        testId="dash-capital-pending"
      >
        <Stat
          label="Quotes waiting on capital"
          value={fmtCount(d.capitalPending.count)}
          tone={d.capitalPending.count > 0 ? 'alert' : 'default'}
        />
      </Block>
      <Block
        title="Median time in Quoting"
        info={d.medianInQuoting.info}
        testId="dash-median-quoting"
      >
        <Stat
          label="Median days in Quoting"
          value={fmtDays(d.medianInQuoting.medianDays)}
          hint={`${d.medianInQuoting.n} completed stays`}
        />
      </Block>
    </>
  );
}

function Approver({ d }: { d: ApproverDashboard }) {
  return (
    <>
      <Block
        title="Pending final review (G4)"
        info={d.pending.info}
        testId="dash-pending"
        action={
          <MoreLink to="/approvals" search={{ tab: 'final-review' }}>
            Open final review
          </MoreLink>
        }
      >
        <Stat label="Waiting for a decision" value={fmtCount(d.pending.count)} />
        {d.pending.items.length === 0 ? (
          <Empty>Nothing is waiting for you.</Empty>
        ) : (
          <QuoteList items={d.pending.items} ageLabel="waiting" />
        )}
      </Block>
      <Block title="Decided recently" info={d.decided.info} testId="dash-decided">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="G4 decisions" value={fmtCount(d.decided.total)} />
          <Stat label="Yours" value={fmtCount(d.decided.mine)} />
        </div>
        {d.decided.byOutcome.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-sm">
            {d.decided.byOutcome.map((o) => (
              <li
                key={o.key}
                className="rounded-pill bg-secondary text-secondary-foreground px-3 py-1"
              >
                {o.label}: <span className="font-semibold tabular-nums">{o.count}</span>
              </li>
            ))}
          </ul>
        )}
        {d.decided.recent.length === 0 ? (
          <Empty>No final review decisions in this period.</Empty>
        ) : (
          <ul className="divide-y">
            {d.decided.recent.map((r) => (
              <li
                key={`${r.quoteNumber}-${r.decidedAt}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  {quoteLink(r.quoteNumber)}{' '}
                  <span className="text-muted-foreground text-xs">· {r.outcomeLabel}</span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {r.decidedBy ?? 'Unknown'} · {absoluteTime(r.decidedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </>
  );
}

function Leadership({ d }: { d: LeadershipDashboard }) {
  return (
    <>
      <div
        className="grid gap-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-4"
        data-testid="dash-kpis"
      >
        <Stat
          label="Open quotes"
          value={fmtCount(d.openQuotes.count)}
          hint={`${fmtUsd(d.openQuotes.sfAmount)} ${d.openQuotes.amountLabel}`}
          info={d.openQuotes.info}
        />
        <Stat
          label="Median intake to G4"
          value={fmtDays(d.endToEnd.medianDays)}
          hint={`${d.endToEnd.n} quotes, holds excluded`}
          info={d.endToEnd.info}
        />
        <Stat
          label="First-pass intake completeness"
          value={fmtPct(d.firstPass.rate)}
          hint={`${d.firstPass.resolved} resolved intakes`}
          info={d.firstPass.info}
        />
        <Stat
          label="Win rate pairs with capture"
          value={fmtPct(d.outcomes.rates.winRate)}
          hint="See the pair below"
          info={d.outcomes.info}
        />
      </div>
      <Block
        title="Win rate and outcome capture"
        info={d.outcomes.info}
        testId="dash-outcomes"
        className="lg:col-span-2"
      >
        <RatePair
          rates={d.outcomes.rates}
          info={d.outcomes.info}
          captureInfo={d.outcomes.info}
          lowCaptureBelow={d.outcomes.lowCaptureBelow}
          testId="dash-rate-pair"
        />
      </Block>
      <Block
        title="Pipeline by stage"
        info={d.pipeline.info}
        testId="dash-pipeline"
        className="lg:col-span-2"
        action={<MoreLink to="/analytics">Open full analytics</MoreLink>}
      >
        {d.pipeline.total === 0 ? (
          <Empty>No open quotes.</Empty>
        ) : (
          <StageBoard p={d.pipeline} drill />
        )}
      </Block>
    </>
  );
}

export function RoleDashboard({ role }: { role: DashboardRole }) {
  const q = useQuery<DashboardResponse>({
    queryKey: ['dashboard', role],
    queryFn: () => api.dashboard(role),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  if (q.isPending) {
    return (
      <>
        <SkeletonCard />
        <SkeletonCard />
      </>
    );
  }
  if (q.error) {
    return (
      <div className="lg:col-span-2">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const d = q.data;
  switch (d.role) {
    case 'KAM':
      return <Kam d={d} />;
    case 'SalesLeader':
      return <SalesLeader d={d} />;
    case 'EngLead':
    case 'Engineer':
      return <Engineering d={d} />;
    case 'Pricing':
    case 'PricingLead':
      return <Pricing d={d} />;
    case 'Approver':
      return <Approver d={d} />;
    case 'Leadership':
      return <Leadership d={d} />;
  }
}
