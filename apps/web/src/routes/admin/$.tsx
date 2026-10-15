import { createFileRoute } from '@tanstack/react-router';

import { StubPage } from '@/shell/StubPage';

/** /admin/* sections (stages, reason codes, users, …) arrive with B-19. */
export const Route = createFileRoute('/admin/$')({
  component: AdminSection,
});

function AdminSection() {
  const { _splat } = Route.useParams();
  return (
    <StubPage
      title="Admin"
      eyebrow={`Configuration · ${_splat ?? ''}`}
      description="Stages, gates, reason codes, value lists, scoring and settings."
      buildStep="B-19"
    />
  );
}
