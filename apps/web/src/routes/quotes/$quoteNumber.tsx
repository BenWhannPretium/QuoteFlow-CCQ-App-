import { createFileRoute } from '@tanstack/react-router';

import { StubPage } from '@/shell/StubPage';

export const Route = createFileRoute('/quotes/$quoteNumber')({
  component: QuotePage,
});

function QuotePage() {
  const { quoteNumber } = Route.useParams();
  return (
    <StubPage
      title={quoteNumber}
      eyebrow="Quote"
      description="The quote record: intake, engineering, quoting, decisions and timeline."
      buildStep="B-09 to B-13"
      permission="quote.read"
    />
  );
}
