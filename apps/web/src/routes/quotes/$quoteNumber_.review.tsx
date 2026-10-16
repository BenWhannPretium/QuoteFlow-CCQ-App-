import { createFileRoute } from '@tanstack/react-router';

import { ReviewScreen } from '@/components/final-review/ReviewScreen';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

/**
 * `/quotes/:quoteNumber/review` (B-12): the Final Review one-page snapshot with a sticky decision
 * bar. The `$quoteNumber_` segment keeps it a sibling of the quote page rather than a child route.
 */
export const Route = createFileRoute('/quotes/$quoteNumber_/review')({
  component: ReviewPage,
});

function ReviewPage() {
  const { quoteNumber } = Route.useParams();
  useDocumentTitle(`Final Review · ${quoteNumber}`);
  return <ReviewScreen quoteNumber={quoteNumber} />;
}
