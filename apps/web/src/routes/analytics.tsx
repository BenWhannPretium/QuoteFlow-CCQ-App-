import { createFileRoute } from '@tanstack/react-router';

import { StubPage } from '@/shell/StubPage';

export const Route = createFileRoute('/analytics')({
  component: () => (
    <StubPage
      title="Analytics"
      eyebrow="Insights"
      description="Throughput, aging, win rates and capital exposure."
      buildStep="B-17"
      permission="analytics.read"
    />
  ),
});
