import { createFileRoute } from '@tanstack/react-router';

import { StubPage } from '@/shell/StubPage';

export const Route = createFileRoute('/intake/new')({
  component: () => (
    <StubPage
      title="New intake"
      eyebrow="Intake"
      description="Start a quote from a Salesforce opportunity."
      buildStep="B-07"
      permission="quote.create"
    />
  ),
});
