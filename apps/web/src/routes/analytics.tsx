import { createFileRoute, Link } from '@tanstack/react-router';
import { ConstructionIcon } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { StubPage } from '@/shell/StubPage';

export const Route = createFileRoute('/analytics')({
  component: () => (
    <StubPage
      title="Analytics"
      eyebrow="Insights"
      description="Throughput, aging, win rates and capital exposure."
      buildStep="B-17"
      permission="analytics.read"
    >
      <EmptyState
        icon={ConstructionIcon}
        title="Coming soon"
        description="Dashboards are built in B-17. The outcomes report (B-13) is ready."
        action={
          <Link to="/admin/reports/outcomes" className={buttonVariants({ variant: 'outline' })}>
            Outcomes report
          </Link>
        }
      />
    </StubPage>
  ),
});
