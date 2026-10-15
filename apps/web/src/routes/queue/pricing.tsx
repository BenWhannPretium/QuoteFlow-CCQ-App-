import { createFileRoute } from '@tanstack/react-router';

import { StubPage } from '@/shell/StubPage';

export const Route = createFileRoute('/queue/pricing')({
  component: () => (
    <StubPage
      title="Pricing queue"
      eyebrow="Pricing"
      description="Quotes cleared by engineering and ready to price."
      buildStep="B-11"
      permission="quoting.edit"
    />
  ),
});
