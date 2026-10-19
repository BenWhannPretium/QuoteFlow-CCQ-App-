import { createFileRoute } from '@tanstack/react-router';

import { StubPage } from '@/shell/StubPage';

/** Any /admin/* path without a screen (B-19 built the configuration sections). */
export const Route = createFileRoute('/admin/$')({
  component: AdminSection,
});

function AdminSection() {
  const { _splat } = Route.useParams();
  return (
    <StubPage
      title="Admin"
      eyebrow={`Configuration · ${_splat ?? ''}`}
      description="There is no admin screen at this address. Go back to Admin for the configuration sections."
      buildStep="B-19"
    />
  );
}
