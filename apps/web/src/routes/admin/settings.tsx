import type { AdminSetting } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { PencilIcon } from 'lucide-react';
import { useState } from 'react';

import {
  draftValue,
  formatSetting,
  initialDraft,
  SettingEditor,
  settingProblem,
  type Draft,
} from '@/admin/SettingEditor';
import {
  adminKey,
  ApprovalBadge,
  BackToAdmin,
  ChangeDialog,
  ReadOnlyNotice,
  useCanEditConfig,
} from '@/admin/shared';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonRows } from '@/components/Skeletons';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/settings')({ component: SettingsPage });

const GROUP_LABEL: Record<string, string> = {
  workflow: 'Workflow',
  proposal: 'Proposals and validity',
  qualification: 'Qualification warnings (G1)',
  intake: 'Intake',
  engineering: 'Engineering queue',
  final_review: 'Final Review',
  overrides: 'Overrides',
  scoring: 'Scoring visibility',
  notifications: 'Notifications',
  integrations: 'Integrations and data',
  other: 'Other',
};

/**
 * B-19 screen 4: every open business value held in `app_setting` (validity days, warning thresholds,
 * aging buckets, peer-score visibility, intake required fields, backup assigners, G4 tiers, override
 * approvers, …). Each editor writes a value the feature's own parser accepts.
 */
function SettingsPage() {
  useDocumentTitle('App settings');
  const canEdit = useCanEditConfig();
  const settings = useQuery({ queryKey: adminKey('settings'), queryFn: api.admin.settings });
  const users = useQuery({ queryKey: adminKey('users'), queryFn: api.admin.users });
  const workflow = useQuery({ queryKey: adminKey('workflow'), queryFn: api.admin.workflow });
  const [editing, setEditing] = useState<AdminSetting | null>(null);
  const [draft, setDraft] = useState<Draft>(null);

  const ctx = { users: users.data?.items ?? [], ruleFields: workflow.data?.ruleFields ?? [] };
  const problem = editing ? settingProblem(editing, draft) : null;
  const data = settings.data;

  return (
    <div data-testid="page" data-page-title="App settings">
      <BackToAdmin />
      <PageHeader
        eyebrow="Configuration"
        title="App settings"
        description="Values the business still owns: each says which decision it waits on. Provisional until the owner approves."
      />
      {!canEdit && <ReadOnlyNotice />}
      {settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : !data ? (
        <SkeletonRows rows={10} />
      ) : (
        <div className="grid gap-6">
          {data.groups
            .map((g) => [g, data.items.filter((s) => s.group === g)] as const)
            .filter(([, items]) => items.length > 0)
            .map(([group, items]) => (
              <section key={group} aria-labelledby={`settings-${group}`} className="grid gap-2">
                <h2 id={`settings-${group}`} className="font-display text-lg">
                  {GROUP_LABEL[group] ?? group}
                </h2>
                <ul className="bg-card rounded-card divide-y border">
                  {items.map((s) => (
                    <li key={s.key} className="grid gap-1.5 p-3" data-testid={`setting-${s.key}`}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="font-medium">{s.label}</span>
                        <span className="text-muted-foreground font-mono text-xs">{s.key}</span>
                        <ApprovalBadge approval={s.approval} />
                        <span className="flex-1" />
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Edit ${s.label}`}
                            onClick={() => {
                              setDraft(initialDraft(s));
                              setEditing(s);
                            }}
                          >
                            <PencilIcon aria-hidden="true" /> Edit
                          </Button>
                        )}
                      </div>
                      <p className="text-sm" data-testid="setting-value">
                        {formatSetting(s, ctx.users)}
                      </p>
                      <p className="text-muted-foreground text-xs">{s.description}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}

      <ChangeDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        wide={editing?.editor === 'rules' || editing?.editor === 'overridableFields'}
        title={`Edit: ${editing?.label ?? ''}`}
        description={editing?.description}
        approval={editing?.approval}
        canSubmit={problem === null}
        onSubmit={(s) => {
          const e = editing!;
          const value = draftValue(e, draft);
          const changed = JSON.stringify(value) !== JSON.stringify(e.value);
          return api.admin.updateSetting(e.key, {
            version: e.version,
            changeReason: s.changeReason,
            ...(changed ? { value } : {}),
            ...(s.approved !== undefined ? { approved: s.approved } : {}),
            ...(s.confirm ? { confirm: true } : {}),
          });
        }}
      >
        {editing && <SettingEditor setting={editing} draft={draft} onChange={setDraft} ctx={ctx} />}
        {problem && (
          <p className="text-destructive text-xs" role="alert">
            {problem}
          </p>
        )}
      </ChangeDialog>
    </div>
  );
}
