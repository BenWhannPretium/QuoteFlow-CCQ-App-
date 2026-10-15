import { createFileRoute } from '@tanstack/react-router';

import { StubPage } from '@/shell/StubPage';

export const Route = createFileRoute('/approvals')({
  component: () => (
    <StubPage
      title="Approvals"
      eyebrow="Final review"
      description="Submitted quotes waiting for a decision."
      buildStep="B-12"
      permission="gate.G4.decide"
    />
  ),
});
