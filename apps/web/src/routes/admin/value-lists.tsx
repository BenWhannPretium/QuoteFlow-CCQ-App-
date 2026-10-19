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

export const Route = createFileRoute('/admin/value-lists')({ component: ValueListsPage });

/** B-19 screen 1: pick lists for intake and engineering (resins, markets, plants, …). */
function ValueListsPage() {
  useDocumentTitle('Value lists');
  const canEdit = useCanEditConfig();
  const lists = useQuery({ queryKey: adminKey('value-lists'), queryFn: api.admin.valueLists });
  const [listKey, setListKey] = useState('resin');

  return (
    <div data-testid="page" data-page-title="Value lists">
      <BackToAdmin />
      <PageHeader
        eyebrow="Configuration"
        title="Value lists"
        description="The pick lists on intake and Engineering Review. Entries are never deleted: deactivate one and quotes that use it keep it."
      />
      {!canEdit && <ReadOnlyNotice />}
      {lists.isError ? (
        <ErrorState error={lists.error} onRetry={() => void lists.refetch()} />
      ) : !lists.data ? (
        <SkeletonRows rows={6} />
      ) : (
        <ListEditor
          groupLabel="Value list"
          groups={lists.data.listKeys}
          group={listKey}
          onGroupChange={setListKey}
          items={lists.data.items.filter((i) => i.listKey === listKey)}
          onCreate={({ code, label }, s) =>
            api.admin.createValueListEntry({ listKey, code, label, changeReason: s.changeReason })
          }
          onUpdate={(item, patch, s) =>
            api.admin.updateValueListEntry(item.id, {
              version: item.version,
              changeReason: s.changeReason,
              ...(s.approved !== undefined ? { approved: s.approved } : {}),
              ...(patch.label !== undefined ? { label: patch.label } : {}),
              ...(patch.active !== undefined ? { active: patch.active } : {}),
              ...(s.confirm ? { confirmInUse: true } : {}),
            })
          }
          onReorder={(items, s) =>
            api.admin.reorderValueList(listKey, {
              items: items.map((i) => ({ id: i.id, version: i.version })),
              changeReason: s.changeReason,
            })
          }
        />
      )}
    </div>
  );
}
