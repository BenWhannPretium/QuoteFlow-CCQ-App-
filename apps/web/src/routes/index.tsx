import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>System health</CardTitle>
        <CardDescription>Live status from GET /api/v1/health</CardDescription>
      </CardHeader>
      <CardContent>
        {health.isPending && <p>Checking…</p>}
        {health.isError && (
          <p role="alert" className="text-destructive">
            API unreachable: {health.error.message}
          </p>
        )}
        {health.data && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">status</dt>
            <dd data-testid="health-status">{health.data.status}</dd>
            <dt className="text-muted-foreground">db</dt>
            <dd data-testid="health-db">{health.data.db}</dd>
            <dt className="text-muted-foreground">version</dt>
            <dd data-testid="health-version" className="font-mono">
              {health.data.version}
            </dd>
            <dt className="text-muted-foreground">time</dt>
            <dd>{new Date(health.data.time).toLocaleString()}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
