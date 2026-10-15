import { createFileRoute } from '@tanstack/react-router';

import { StubPage } from '@/shell/StubPage';

interface QuotesSearch {
  /** Global search text from the header (B-14 searches with it). */
  q?: string;
}

export const Route = createFileRoute('/quotes/')({
  validateSearch: (search: Record<string, unknown>): QuotesSearch =>
    typeof search.q === 'string' && search.q.trim() ? { q: search.q.trim() } : {},
  component: QuotesPage,
});

function QuotesPage() {
  const { q } = Route.useSearch();
  return (
    <StubPage
      title="Pipeline"
      eyebrow="Quotes"
      description={q ? `Search: “${q}”` : 'Every quote you can see, as a list.'}
      buildStep="B-14"
      permission="quote.read"
    />
  );
}
