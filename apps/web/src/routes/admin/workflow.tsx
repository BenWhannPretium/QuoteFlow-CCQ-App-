import type { AdminGate, AdminOutcome, AdminStage, Approval } from '@ccq/contracts';
import type { RequiredRule } from '@ccq/domain';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { PencilIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { describeRules, RuleEditor, rulesProblem } from '@/admin/RuleEditor';
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
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/workflow')({ component: WorkflowPage });

type Editing =
  | { kind: 'stage'; row: AdminStage }
  | { kind: 'gate'; row: AdminGate }
  | { kind: 'outcome'; row: AdminOutcome };

interface Draft {
  label: string;
  helpText: string;
  requiresNote: boolean;
  requiresReasonCode: boolean;
  rules: RequiredRule[];
}

function Chip({ on, children }: { on: boolean; children: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        on ? 'bg-primary/10 text-foreground' : 'bg-muted text-muted-foreground line-through',
      )}
    >
      {children}
    </span>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" aria-label={`Edit ${label}`} onClick={onClick}>
      <PencilIcon aria-hidden="true" /> Edit
    </Button>
  );
}

function Header({
  title,
  code,
  approval,
  action,
}: {
  title: string;
  code: string;
  approval: Approval;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="font-medium">{title}</span>
      <span className="text-muted-foreground font-mono text-xs">{code}</span>
      <ApprovalBadge approval={approval} />
      <span className="flex-1" />
      {action}
    </div>
  );
}

/**
 * B-19 screen 3: labels, help text and rules of the stage/gate model. Adding or removing stages and
 * transitions is deliberately not here (a migration plus a domain seed change keeps that safe).
 */
function WorkflowPage() {
  useDocumentTitle('Workflow');
  const canEdit = useCanEditConfig();
  const ids = { label: useId(), help: useId(), note: useId(), reason: useId(), g1: useId() };
  const wf = useQuery({ queryKey: adminKey('workflow'), queryFn: api.admin.workflow });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<Draft>({
    label: '',
    helpText: '',
    requiresNote: false,
    requiresReasonCode: false,
    rules: [],
  });
  const [g1Open, setG1Open] = useState(false);
  const [g1Next, setG1Next] = useState(true);

  const open = (e: Editing) => {
    setDraft({
      label: e.row.label,
      helpText: e.row.helpText ?? '',
      requiresNote: e.kind === 'outcome' ? e.row.requiresNote : false,
      requiresReasonCode: e.kind === 'outcome' ? e.row.requiresReasonCode : false,
      rules: e.kind === 'stage' ? [] : (e.row.requiredFields as RequiredRule[]),
    });
    setEditing(e);
  };

  const data = wf.data;
  const rulesInvalid = editing?.kind !== 'stage' && rulesProblem(draft.rules) !== null;

  return (
    <div data-testid="page" data-page-title="Workflow">
      <BackToAdmin />
      <PageHeader
        eyebrow="Configuration"
        title="Workflow labels and rules"
        description="Stage, gate and outcome labels, help text, what each decision requires, and whether G1 is used."
      />
      {!canEdit && <ReadOnlyNotice />}
      <p className="text-muted-foreground mb-4 text-sm">
        Adding or removing stages or transitions isn&apos;t done here: it is a database migration
        plus a domain seed change, so the workflow stays consistent.
      </p>
      {wf.isError ? (
        <ErrorState error={wf.error} onRetry={() => void wf.refetch()} />
      ) : !data ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="grid gap-4">
          {data.g1Enabled && (
            <section className="bg-card rounded-card flex flex-wrap items-center gap-3 border p-4">
              <div className="grid flex-1 gap-0.5">
                <h2 className="font-medium">G1 qualify gate</h2>
                <p className="text-muted-foreground text-sm">
                  {data.g1Enabled.value
                    ? 'On: submitted intakes wait for a sales leader at G1 (D-06).'
                    : 'Off: a KAM’s submit goes straight to Engineering Review.'}
                </p>
              </div>
              <Chip on={data.g1Enabled.value}>{data.g1Enabled.value ? 'On' : 'Off'}</Chip>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setG1Next(!data.g1Enabled!.value);
                    setG1Open(true);
                  }}
                >
                  Turn {data.g1Enabled.value ? 'off' : 'on'}
                </Button>
              )}
            </section>
          )}

          {data.stages.map((stage) => {
            const gates = data.gates.filter((g) => g.stageKey === stage.key);
            return (
              <section
                key={stage.id}
                className="bg-card rounded-card grid gap-3 border p-4"
                aria-label={`Stage ${stage.label}`}
              >
                <Header
                  title={stage.label}
                  code={stage.key}
                  approval={stage.approval}
                  action={
                    canEdit && (
                      <EditButton
                        label={stage.label}
                        onClick={() => open({ kind: 'stage', row: stage })}
                      />
                    )
                  }
                />
                <p className="text-muted-foreground text-sm">
                  {stage.terminal ? 'Terminal stage' : `Owner: ${stage.ownerRole ?? '—'}`}
                  {stage.helpText ? ` · ${stage.helpText}` : ''}
                </p>
                {gates.map((gate) => (
                  <div key={gate.id} className="grid gap-2 rounded-md border p-3">
                    <Header
                      title={`Gate: ${gate.label}`}
                      code={gate.key}
                      approval={gate.approval}
                      action={
                        canEdit && (
                          <EditButton
                            label={gate.label}
                            onClick={() => open({ kind: 'gate', row: gate })}
                          />
                        )
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      <Chip on={gate.enabled}>{gate.enabled ? 'Enabled' : 'Disabled'}</Chip>
                      <span className="text-muted-foreground text-xs">
                        Decided with {gate.deciderPermission}
                      </span>
                    </div>
                    {gate.helpText && <p className="text-sm">{gate.helpText}</p>}
                    <p className="text-sm">
                      <span className="text-muted-foreground">Required: </span>
                      {describeRules(gate.requiredFields as RequiredRule[])}
                    </p>
                    <ul className="grid gap-2">
                      {data.outcomes
                        .filter((o) => o.gateKey === gate.key)
                        .map((o) => (
                          <li key={o.id} className="bg-muted/40 grid gap-1.5 rounded-md p-2.5">
                            <Header
                              title={o.label}
                              code={`${o.gateKey}/${o.key}`}
                              approval={o.approval}
                              action={
                                canEdit && (
                                  <EditButton
                                    label={`${gate.label}: ${o.label}`}
                                    onClick={() => open({ kind: 'outcome', row: o })}
                                  />
                                )
                              }
                            />
                            <div className="flex flex-wrap gap-2">
                              <Chip on={o.requiresNote}>Note required</Chip>
                              <Chip on={o.requiresReasonCode}>
                                {`Reason code${o.reasonContext ? ` (${o.reasonContext})` : ''}`}
                              </Chip>
                            </div>
                            {o.helpText && <p className="text-sm">{o.helpText}</p>}
                            {(o.requiredFields as RequiredRule[]).length > 0 && (
                              <p className="text-sm">
                                <span className="text-muted-foreground">Also required: </span>
                                {describeRules(o.requiredFields as RequiredRule[])}
                              </p>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}

      <ChangeDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        wide={editing?.kind !== 'stage'}
        title={`Edit ${editing?.kind ?? ''}: ${editing?.row.label ?? ''}`}
        approval={editing?.row.approval}
        canSubmit={draft.label.trim().length > 0 && !rulesInvalid}
        onSubmit={(s) => {
          const e = editing!;
          const common = {
            version: e.row.version,
            changeReason: s.changeReason,
            ...(s.approved !== undefined ? { approved: s.approved } : {}),
            ...(draft.label.trim() !== e.row.label ? { label: draft.label.trim() } : {}),
            ...(draft.helpText.trim() !== (e.row.helpText ?? '')
              ? { helpText: draft.helpText.trim() || null }
              : {}),
          };
          const rulesChanged =
            e.kind !== 'stage' &&
            JSON.stringify(draft.rules) !== JSON.stringify(e.row.requiredFields);
          if (e.kind === 'stage') return api.admin.updateStage(e.row.key, common);
          if (e.kind === 'gate') {
            return api.admin.updateGate(e.row.key, {
              ...common,
              ...(rulesChanged ? { requiredFields: draft.rules } : {}),
            });
          }
          return api.admin.updateOutcome(e.row.gateKey, e.row.key, {
            ...common,
            ...(draft.requiresNote !== e.row.requiresNote
              ? { requiresNote: draft.requiresNote }
              : {}),
            ...(draft.requiresReasonCode !== e.row.requiresReasonCode
              ? { requiresReasonCode: draft.requiresReasonCode }
              : {}),
            ...(rulesChanged ? { requiredFields: draft.rules } : {}),
          });
        }}
      >
        <div className="grid gap-1.5">
          <label htmlFor={ids.label} className="text-sm font-medium">
            Label
          </label>
          <Input
            id={ids.label}
            value={draft.label}
            maxLength={200}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={ids.help} className="text-sm font-medium">
            Help text
          </label>
          <Textarea
            id={ids.help}
            value={draft.helpText}
            maxLength={1000}
            className="min-h-16"
            placeholder="Shown next to it in the app (optional)"
            onChange={(e) => setDraft((d) => ({ ...d, helpText: e.target.value }))}
          />
        </div>
        {editing?.kind === 'outcome' && (
          <div className="grid gap-1">
            <label htmlFor={ids.note} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                id={ids.note}
                type="checkbox"
                className="size-4"
                checked={draft.requiresNote}
                onChange={(e) => setDraft((d) => ({ ...d, requiresNote: e.target.checked }))}
              />
              Requires a note
            </label>
            <label htmlFor={ids.reason} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                id={ids.reason}
                type="checkbox"
                className="size-4"
                checked={draft.requiresReasonCode}
                disabled={!editing.row.reasonContext}
                onChange={(e) => setDraft((d) => ({ ...d, requiresReasonCode: e.target.checked }))}
              />
              Requires a reason code
              {editing.row.reasonContext
                ? ` (${editing.row.reasonContext})`
                : ' (no reason context)'}
            </label>
          </div>
        )}
        {editing && editing.kind !== 'stage' && (
          <RuleEditor
            value={draft.rules}
            onChange={(rules) => setDraft((d) => ({ ...d, rules }))}
            fields={data?.ruleFields ?? []}
            label={
              editing.kind === 'gate'
                ? 'Required for every outcome'
                : 'Also required for this outcome'
            }
          />
        )}
      </ChangeDialog>

      <ChangeDialog
        open={g1Open}
        onOpenChange={setG1Open}
        title={g1Next ? 'Turn the G1 qualify gate on' : 'Turn the G1 qualify gate off'}
        description={
          g1Next
            ? 'Submitted intakes will wait for a sales leader at G1.'
            : 'Submitted intakes will go straight to Engineering Review.'
        }
        submitLabel={g1Next ? 'Turn on' : 'Turn off'}
        onSubmit={(s) =>
          api.admin.updateSetting('g1_enabled', {
            version: data!.g1Enabled!.version,
            value: g1Next,
            changeReason: s.changeReason,
            ...(s.confirm ? { confirm: true } : {}),
          })
        }
      />
    </div>
  );
}
