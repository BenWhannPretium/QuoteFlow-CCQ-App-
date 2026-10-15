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
          <Link to="/admin/ui-kit" className={buttonVariants({ variant: 'outline' })}>
            Open the UI kit
          </Link>
        }
      />
    </StubPage>
  ),
});
