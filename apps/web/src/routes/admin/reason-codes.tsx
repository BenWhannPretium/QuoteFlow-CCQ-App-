import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { ListEditor } from '@/admin/ListEditor';
import { adminKey, BackToAdmin, ReadOnlyNotice, useCanEditConfig } from '@/admin/shared';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonRows } from '@/components/Skeletons';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/reason-codes')({ component: ReasonCodesPage });

/** B-19 screen 2: reason codes per decision context (lost, decline, stop, hold, …). */
function ReasonCodesPage() {
  useDocumentTitle('Reason codes');
  const canEdit = useCanEditConfig();
  const codes = useQuery({ queryKey: adminKey('reason-codes'), queryFn: api.admin.reasonCodes });
  const [context, setContext] = useState('lost');

  return (
    <div data-testid="page" data-page-title="Reason codes">
      <BackToAdmin />
      <PageHeader
        eyebrow="Configuration"
        title="Reason codes"
        description="The reasons offered at each decision (D-15). An outcome that requires a reason keeps at least one active code."
      />
      {!canEdit && <ReadOnlyNotice />}
      {codes.isError ? (
        <ErrorState error={codes.error} onRetry={() => void codes.refetch()} />
      ) : !codes.data ? (
        <SkeletonRows rows={6} />
      ) : (
        <ListEditor
          groupLabel="Context"
          groups={codes.data.contexts}
          group={context}
          onGroupChange={setContext}
          withRequiresNote
          items={codes.data.items.filter((i) => i.context === context)}
          onCreate={({ code, label, requiresNote }, s) =>
            api.admin.createReasonCode({
              context,
              code,
              label,
              requiresNote,
              changeReason: s.changeReason,
            })
          }
          onUpdate={(item, patch, s) =>
            api.admin.updateReasonCode(item.id, {
              version: item.version,
              changeReason: s.changeReason,
              ...(s.approved !== undefined ? { approved: s.approved } : {}),
              ...patch,
            })
          }
          onReorder={(items, s) =>
            api.admin.reorderReasonCodes(context, {
              items: items.map((i) => ({ id: i.id, version: i.version })),
              changeReason: s.changeReason,
            })
          }
        />
      )}
    </div>
  );
}
