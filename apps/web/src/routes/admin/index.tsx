import { createFileRoute, Link } from '@tanstack/react-router';
import { ConstructionIcon } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { StubPage } from '@/shell/StubPage';

export const Route = createFileRoute('/admin/')({
  component: () => (
    <StubPage
      title="Admin"
      eyebrow="Configuration"
      description="Stages, gates, reason codes, value lists, scoring and settings."
      buildStep="B-19"
    >
      <EmptyState
        icon={ConstructionIcon}
        title="Coming soon"
        description="Configuration screens are built in B-19."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/admin/integrations" className={buttonVariants({ variant: 'outline' })}>
              Integrations
            </Link>
            <Link
              to="/admin/reports/erf-linkage"
              className={buttonVariants({ variant: 'outline' })}
            >
              ERF linkage report
            </Link>
            <Link to="/admin/reports/outcomes" className={buttonVariants({ variant: 'outline' })}>
              Outcomes report
            </Link>
            <Link to="/admin/audit" className={buttonVariants({ variant: 'outline' })}>
              Audit log
            </Link>
            <Link to="/admin/reports/usage" className={buttonVariants({ variant: 'outline' })}>
              Usage report
            </Link>
            <Link to="/admin/override-log" className={buttonVariants({ variant: 'outline' })}>
              Override log
            </Link>
            <Link to="/admin/ui-kit" className={buttonVariants({ variant: 'outline' })}>
              Open the UI kit
            </Link>
          </div>
        }
      />
    </StubPage>
  ),
});
