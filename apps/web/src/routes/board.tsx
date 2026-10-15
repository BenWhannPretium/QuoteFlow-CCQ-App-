import { createFileRoute } from '@tanstack/react-router';

import { StubPage } from '@/shell/StubPage';

export const Route = createFileRoute('/board')({
  component: () => (
    <StubPage
      title="Pipeline board"
      eyebrow="Quotes"
      description="Quotes by stage."
      buildStep="B-14"
      permission="quote.read"
    />
  ),
});
