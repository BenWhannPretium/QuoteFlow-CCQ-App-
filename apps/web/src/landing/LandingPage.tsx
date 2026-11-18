import { ANALYTICS_DISCLAIMER, DASHBOARD_ROLES, type DashboardRole } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { AnalyticsPage } from '@/analytics/AnalyticsPage';
import { RequirePermission, canFromMe, useCurrentUser } from '@/auth';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KeyValueGrid } from '@/components/KeyValueGrid';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonCard } from '@/components/Skeletons';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AnalyticsSearch } from '@/lib/analytics-search';
import { api } from '@/lib/api';
import {
  COMMAND_CENTER,
  COMMAND_CENTER_VIEW_LABEL,
  analyticsSearchOf,
  commandCenterTitle,
  readCommandCenterView,
  rememberCommandCenterView,
  resolveCommandCenterView,
  type CommandCenterSearch,
  type CommandCenterView,
} from '@/lib/command-center';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

import { RoleDashboard } from './Dashboards';
import { LANDINGS, landingFor, landingRolesFor, type LandingDefinition } from './landings';
import { quickstartHref } from './quickstart';
import { readWelcomeDismissed, rememberWelcomeDismissed, welcomeJobsFor } from './welcome';
import { WelcomeCard } from './WelcomeCard';

/**
 * The Command Center (FB-18, W13-29; it was "Home"). Two views:
 * - **My work**: the F-02 role landing, the dashboard for the user's primary role (multi-role users get
 *   tabs). The blocks are computed by `GET /api/v1/dashboards/:role` (B-17); Admin and Post-award keep
 *   static cards.
 * - **Analytics**: the role's analytics lens, the page that used to live at `/analytics`, with the same
 *   component and filters. Offered only to users with `analytics.read`; a URL that asks for it without
 *   the permission gets the 403 page, and the API enforces the permission on every analytics route.
 *
 * The view is in the URL (`?view=analytics`, `?view=work`). Without it the Command Center opens on the
 * view the user last chose (kept per user in `localStorage`), My work the first time.
 */
const isDashboardRole = (role: string): role is DashboardRole =>
  (DASHBOARD_ROLES as readonly string[]).includes(role);

interface LandingPageProps {
  search: CommandCenterSearch;
  /** The Analytics view's filters changed: put them in the URL. */
  onAnalyticsSearchChange: (next: AnalyticsSearch) => void;
}

export function LandingPage(props: LandingPageProps) {
  const me = useCurrentUser();
  // Keyed by user, so the remembered view is read afresh for whoever is signed in.
  return <CommandCenter key={me.user.id} {...props} />;
}

function CommandCenter({ search, onAnalyticsSearchChange }: LandingPageProps) {
  const me = useCurrentUser();
  const landing = landingFor(me.roles, search.as);
  const canReadAnalytics = canFromMe(me, 'analytics.read');
  // Read once, then changed only by a choice made here: a choice made in another tab does not move
  // this one, and the choice is still known when the menu brings the user back to `/`.
  const [remembered, setRemembered] = useState(() => readCommandCenterView(me.user.id));
  const view = resolveCommandCenterView(search, remembered, canReadAnalytics);
  const choose = (next: CommandCenterView) => {
    rememberCommandCenterView(me.user.id, next);
    setRemembered(next);
  };

  if (!landing) return <NoLanding />;

  const eyebrow = `${COMMAND_CENTER} · ${landing.roleLabel}`;
  // Only for people who may read analytics: everyone else has one view and no switch.
  const views = canReadAnalytics ? (
    <ViewSwitch view={view} role={search.as} onChoose={choose} />
  ) : null;

  return (
    <div data-testid="landing" data-role={landing.role} data-view={view}>
      {view === 'analytics' ? (
        <RequirePermission permission="analytics.read">
          <AnalyticsPage
            search={analyticsSearchOf(search)}
            onSearchChange={onAnalyticsSearchChange}
            eyebrow={eyebrow}
            documentTitle={commandCenterTitle('Analytics')}
            actions={views}
          />
        </RequirePermission>
      ) : (
        <MyWork landing={landing} eyebrow={eyebrow} views={views} />
      )}
    </div>
  );
}

function NoLanding() {
  useDocumentTitle(COMMAND_CENTER);
  return (
    <EmptyState
      title="No Command Center for your role yet"
      description="Your role has no Command Center view yet. Ask an admin to check your roles."
    />
  );
}

// 44 px tall on a phone (mobile.spec.ts), 36 px from 641 px.
const VIEW_LINK =
  'rounded-pill inline-flex min-h-11 items-center px-4 text-sm font-medium sm:min-h-9';
const VIEW_OPEN = 'bg-primary text-primary-foreground';
const VIEW_CLOSED = 'text-foreground-2 hover:bg-accent';

// A click the browser handles itself (a new tab or window) leaves this tab's view alone.
const opensElsewhere = (e: MouseEvent) =>
  e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

/**
 * The two views as a segmented control in the page header. They are links (each view is a URL), so they
 * work with the keyboard like any link; `aria-current` marks the open one. Choosing one is remembered.
 *
 * Each link names its view (`view=work`, `view=analytics`). The router marks a link `aria-current` by
 * itself when the address matches the link's search, and a link without a view would match every
 * address of `/`; with the view named, the router and `view` always agree.
 */
function ViewSwitch({
  view,
  role,
  onChoose,
}: {
  view: CommandCenterView;
  role: string | undefined;
  onChoose: (view: CommandCenterView) => void;
}) {
  return (
    <nav
      aria-label="Command Center view"
      className="bg-card rounded-pill inline-flex gap-0.5 border p-0.5"
      data-testid="command-center-views"
    >
      {(['work', 'analytics'] as const).map((v) => (
        <Link
          key={v}
          to="/"
          search={{ ...(role ? { as: role } : {}), view: v }}
          aria-current={v === view ? 'page' : undefined}
          data-testid={`view-${v}`}
          onClick={(e: MouseEvent) => {
            if (!opensElsewhere(e)) onChoose(v);
          }}
          className={cn(VIEW_LINK, v === view ? VIEW_OPEN : VIEW_CLOSED)}
        >
          {COMMAND_CENTER_VIEW_LABEL[v]}
        </Link>
      ))}
    </nav>
  );
}

function MyWork({
  landing,
  eyebrow,
  views,
}: {
  landing: LandingDefinition;
  eyebrow: string;
  views: ReactNode;
}) {
  const me = useCurrentUser();
  const roles = landingRolesFor(me.roles);
  useDocumentTitle(commandCenterTitle(landing.title));
  // First run: the welcome card, until this person puts it away (remembered per user).
  const [welcomed, setWelcomed] = useState(() => readWelcomeDismissed(me.user.id));
  const showWelcome = !welcomed && welcomeJobsFor(landing.role) !== null;
  const quickstartLink = useRef<HTMLAnchorElement>(null);
  const dismissWelcome = () => {
    rememberWelcomeDismissed(me.user.id);
    setWelcomed(true);
    // The button is gone: put focus on the quick-start link that takes the card's place.
    setTimeout(() => quickstartLink.current?.focus(), 0);
  };

  const action =
    landing.action && canFromMe(me, landing.action.permission) ? landing.action : undefined;

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={landing.title}
        description={landing.description}
        actions={
          (views || action) && (
            <>
              {views}
              {action && (
                <Link to={action.to} className={buttonVariants({ variant: 'action' })}>
                  {action.label}
                </Link>
              )}
            </>
          )
        }
      />
      {showWelcome ? (
        <WelcomeCard role={landing.role} roleLabel={landing.roleLabel} onDismiss={dismissWelcome} />
      ) : (
        <p className="text-muted-foreground -mt-2 mb-5 text-sm" data-testid="quickstart-link">
          New here?{' '}
          <a
            ref={quickstartLink}
            href={quickstartHref(landing.role)}
            target="_blank"
            rel="noreferrer"
            // 44 px tap target on phones (mobile.spec.ts).
            className="text-emphasis inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline sm:min-h-0"
          >
            Read the one-page quick-start for {landing.roleLabel}
          </a>
        </p>
      )}
      {roles.length > 1 && <RoleTabs roles={roles} current={landing} />}
      <section aria-label="Dashboard" className="stagger grid gap-5 lg:grid-cols-2">
        {isDashboardRole(landing.role) ? (
          <RoleDashboard role={landing.role} />
        ) : (
          <>
            {landing.cards?.map((card) => (
              <Card key={card.title} data-testid="landing-card">
                <CardHeader>
                  <CardTitle>
                    <h2 className="text-base font-semibold">{card.title}</h2>
                  </CardTitle>
                  <CardDescription>{card.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
            {landing.role === 'Admin' && <SystemStatusCard />}
          </>
        )}
      </section>
      {isDashboardRole(landing.role) && (
        // 05 §4 / M6: dashboard figures are labelled operational until D&A certifies them.
        <p className="text-muted-foreground mt-6 text-sm" data-testid="dashboard-disclaimer">
          {ANALYTICS_DISCLAIMER}
        </p>
      )}
    </>
  );
}

function RoleTabs({ roles, current }: { roles: string[]; current: LandingDefinition }) {
  return (
    <nav aria-label="Dashboard role" className="mb-5 flex flex-wrap gap-2">
      {roles.map((role) => {
        const def = LANDINGS[role as keyof typeof LANDINGS];
        const active = role === current.role;
        return (
          <Link
            key={role}
            to="/"
            search={{ as: role }}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-pill inline-flex min-h-11 items-center border px-4 text-sm font-medium sm:min-h-9',
              active
                ? 'bg-primary text-primary-foreground border-transparent'
                : 'bg-card text-foreground-2 hover:bg-accent',
            )}
          >
            {def.roleLabel}
          </Link>
        );
      })}
    </nav>
  );
}

function SystemStatusCard() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">System status</h2>
        </CardTitle>
        <CardDescription>Live from the API health check.</CardDescription>
      </CardHeader>
      <CardContent>
        {health.isPending && <SkeletonCard className="border-0 p-0 shadow-none" />}
        {health.isError && (
          <ErrorState error={health.error} onRetry={() => void health.refetch()} />
        )}
        {health.data && (
          <KeyValueGrid
            items={[
              {
                label: 'Status',
                value: <span data-testid="health-status">{health.data.status}</span>,
              },
              { label: 'Database', value: <span data-testid="health-db">{health.data.db}</span> },
              {
                label: 'Version',
                value: (
                  <span data-testid="health-version" className="font-mono">
                    {health.data.version}
                  </span>
                ),
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
