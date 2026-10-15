import { createFileRoute } from '@tanstack/react-router';

import { useCan } from '@/auth';
import { StubPage } from '@/shell/StubPage';

export const Route = createFileRoute('/queue/engineering')({
  component: EngineeringQueue,
});

function EngineeringQueue() {
  const ownsQueue = useCan('queue.assign');
  return (
    <StubPage
      title={ownsQueue ? 'Engineering queue' : 'My assignments'}
      eyebrow="Engineering"
      description={
        ownsQueue
          ? 'Assign and track upfront engineering reviews.'
          : 'The engineering reviews assigned to you.'
      }
      buildStep="B-10"
      permission="engReview.edit"
    />
  );
}
