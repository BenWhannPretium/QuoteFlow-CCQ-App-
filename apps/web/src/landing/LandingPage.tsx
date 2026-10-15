import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { LayoutDashboardIcon } from 'lucide-react';

import { canFromMe, useCurrentUser } from '@/auth';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KeyValueGrid } from '@/components/KeyValueGrid';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonCard } from '@/components/Skeletons';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

import { LANDINGS, landingFor, landingRolesFor, type LandingDefinition } from './landings';

/**
 * F-02 role landing: the dashboard for the user's primary role (multi-role users get tabs).
 * Cards are placeholders until B-17 connects them to data.
 */
export function LandingPage({ requestedRole }: { requestedRole: string | undefined }) {
  const me = useCurrentUser();
  const landing = landingFor(me.roles, requestedRole);
  const roles = landingRolesFor(me.roles);
  useDocumentTitle(landing?.title ?? 'Home');

  if (!landing) {
    return (
      <EmptyState
        title="No dashboard for your role yet"
        description="Your QuoteFlow role has no home page. Ask an admin to check your roles."
      />
    );
  }

  const action =
    landing.action && canFromMe(me, landing.action.permission) ? landing.action : undefined;

  return (
    <div data-testid="landing" data-role={landing.role}>
      <PageHeader
        eyebrow={`Home · ${landing.roleLabel}`}
        title={landing.title}
        description={landing.description}
        actions={
          action && (
            <Link to={action.to} className={buttonVariants({ variant: 'action' })}>
              {action.label}
            </Link>
          )
        }
      />
      {roles.length > 1 && <RoleTabs roles={roles} current={landing} />}
      <section aria-label="Dashboard" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {landing.cards.map((card) => (
          <Card key={card.title} data-testid="landing-card">
            <CardHeader>
              <CardTitle>
                <h2 className="text-base font-semibold">{card.title}</h2>
              </CardTitle>
              <CardDescription>{card.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <LayoutDashboardIcon className="size-4" aria-hidden="true" />
                Live figures arrive in B-17.
              </div>
            </CardContent>
          </Card>
        ))}
        {landing.role === 'Admin' && <SystemStatusCard />}
      </section>
    </div>
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
