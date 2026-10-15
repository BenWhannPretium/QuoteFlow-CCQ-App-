import { ConstructionIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { RequirePermission } from '@/auth';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

import { useDocumentTitle } from './useDocumentTitle';

/** A route that exists (and is permission-guarded) but whose screen arrives in a later step. */
export function StubPage({
  title,
  eyebrow,
  description,
  buildStep,
  permission,
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  buildStep: string;
  /** UI guard only; the API enforces the same permission on every call the page makes. */
  permission?: string;
  children?: ReactNode;
}) {
  useDocumentTitle(title);
  const page = (
    <div data-testid="page" data-page-title={title}>
      <PageHeader title={title} eyebrow={eyebrow} description={description} />
      {children ?? (
        <EmptyState
          icon={ConstructionIcon}
          title="Coming soon"
          description={`This screen is built in ${buildStep}.`}
        />
      )}
    </div>
  );
  return permission ? <RequirePermission permission={permission}>{page}</RequirePermission> : page;
}
