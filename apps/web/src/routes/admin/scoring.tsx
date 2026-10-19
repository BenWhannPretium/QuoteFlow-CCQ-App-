import type { AdminScoringVersion, ScoringModelBody } from '@ccq/contracts';
import { parseScoringModel } from '@ccq/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowDownIcon, ArrowUpIcon, CopyPlusIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
import { TierChip } from '@/components/TierChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/scoring')({ component: ScoringPage });

type Band = [number | null, number | null, number];
interface Attr {
  key: string;
  label: string;
  weight: number;
  input: string;
  bands?: Band[];
  map?: { by: string; values: Record<string, number>; default?: number };
  inverse?: boolean;
  unknownScore?: number;
  unknownExplanation?: string;
  provisional?: boolean;
}
interface Tier {
  key: string;
  label?: string;
  min: number;
}
interface Model {
  attributes: Attr[];
  tiers: Tier[];
  unknownScore: number;
}

const toModel = (m: ScoringModelBody): Model => structuredClone(m) as unknown as Model;
const toBody = (m: Model): ScoringModelBody => m;
const num = (text: string): number | null => (text.trim() === '' ? null : Number(text));
const pct = (w: number) => `${Math.round(w * 1000) / 10}%`;

/** Client-side check with the domain parser (the server runs the same one). */
function modelProblem(m: Model): string | null {
  try {
    parseScoringModel({ version: 1, ...m });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid model';
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function statusLabel(v: AdminScoringVersion) {
  return { active: 'Active', scheduled: 'Scheduled', superseded: 'Superseded', draft: 'Draft' }[
    v.status
  ];
}

/** B-19 screen 5: versioned scoring model. Never edited in place: a new version is a draft. */
function ScoringPage() {
  useDocumentTitle('Scoring model');
  const canEdit = useCanEditConfig();
  const scoring = useQuery({ queryKey: adminKey('scoring'), queryFn: api.admin.scoring });
  const versions = scoring.data?.versions ?? [];
  const draft = versions.find((v) => v.status === 'draft');
  const active = versions.find((v) => v.status === 'active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = versions.find((v) => v.id === selectedId) ?? draft ?? active;

  // Edits belong to the version (and row version) they started from; selecting another drops them.
  const selKey = selected ? `${selected.id}:${selected.version}` : '';
  const base = useMemo(() => (selected ? toModel(selected.model) : null), [selKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edit, setEdit] = useState<{ key: string; model: Model } | null>(null);
  const model = edit?.key === selKey ? edit.model : base;
  const setModel = (m: Model) => setEdit({ key: selKey, model: m });

  const editable = canEdit && selected?.status === 'draft';
  const problem = model ? modelProblem(model) : null;
  const dirty =
    !!model && !!selected && JSON.stringify(toBody(model)) !== JSON.stringify(selected.model);

  const [dialog, setDialog] = useState<null | 'create' | 'save' | 'activate' | 'discard'>(null);

  return (
    <div data-testid="page" data-page-title="Scoring model">
      <BackToAdmin />
      <PageHeader
        eyebrow="Configuration"
        title="Scoring model"
        description="Advisory priority scoring (F-05, D-19). Versions are never edited in place: create a new version, preview it on the last 50 quotes, then activate it."
        actions={
          canEdit &&
          !draft &&
          active && (
            <Button onClick={() => setDialog('create')}>
              <CopyPlusIcon aria-hidden="true" /> Create new version
            </Button>
          )
        }
      />
      {!canEdit && <ReadOnlyNotice />}
      {scoring.isError ? (
        <ErrorState error={scoring.error} onRetry={() => void scoring.refetch()} />
      ) : !scoring.data ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="grid gap-6">
          <section aria-labelledby="versions" className="grid gap-2">
            <h2 id="versions" className="font-display text-lg">
              Versions
            </h2>
            <ul className="bg-card rounded-card divide-y border">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className={cn(
                      'hover:bg-accent grid w-full gap-1 p-3 text-left',
                      selected?.id === v.id && 'bg-accent',
                    )}
                    aria-pressed={selected?.id === v.id}
                    onClick={() => setSelectedId(v.id)}
                  >
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">v{v.modelVersion}</span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-semibold',
                          v.status === 'active'
                            ? 'bg-success/15 text-success'
                            : v.status === 'draft'
                              ? 'bg-warning text-warning-foreground'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {statusLabel(v)}
                      </span>
                      <ApprovalBadge approval={v.approval} />
                      <span className="text-muted-foreground text-xs">
                        {v.effectiveFrom
                          ? `Effective ${absoluteTime(v.effectiveFrom)}`
                          : 'Not active'}
                        {v.createdByName ? ` · by ${v.createdByName}` : ''}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-sm">{v.changeReason}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {selected && model && (
            <section aria-labelledby="model" className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="model" className="font-display flex-1 text-lg">
                  v{selected.modelVersion} ({statusLabel(selected).toLowerCase()})
                  {selected.status !== 'draft' && (
                    <span className="text-muted-foreground ml-2 text-sm">read-only</span>
                  )}
                </h2>
                {editable && (
                  <>
                    <Button variant="outline" onClick={() => setDialog('discard')}>
                      Discard draft
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!dirty || !!problem}
                      onClick={() => setDialog('save')}
                    >
                      Save draft
                    </Button>
                    <Button disabled={dirty || !!problem} onClick={() => setDialog('activate')}>
                      Activate v{selected.modelVersion}
                    </Button>
                  </>
                )}
              </div>
              {editable && dirty && (
                <p className="text-muted-foreground text-sm">
                  Unsaved changes: save the draft before activating it.
                </p>
              )}
              {problem && (
                <p role="alert" className="text-destructive text-sm" data-testid="model-problem">
                  {problem}
                </p>
              )}
              <ModelEditor
                model={model}
                editable={editable}
                inputs={scoring.data.inputs}
                onChange={setModel}
              />
              {(selected.status === 'draft' || editable) && (
                <Preview model={model} valid={!problem} />
              )}
            </section>
          )}
        </div>
      )}

      <ChangeDialog
        open={dialog === 'create'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Create a new scoring version"
        description={`Copies v${active?.modelVersion ?? ''} into a draft. Nothing changes for quotes until you activate it.`}
        submitLabel="Create draft"
        onSubmit={async (s) => {
          await api.admin.createScoringDraft(s.changeReason);
          setSelectedId(null);
        }}
      />
      <ChangeDialog
        open={dialog === 'save'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Save draft v${selected?.modelVersion ?? ''}`}
        canSubmit={!problem}
        onSubmit={(s) =>
          api.admin.updateScoringDraft({
            version: selected!.version,
            changeReason: s.changeReason,
            model: toBody(model!),
          })
        }
      />
      <ChangeDialog
        open={dialog === 'activate'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Activate v${selected?.modelVersion ?? ''}`}
        description="It applies from now. Open quotes are rescored in the background (a timeline event for each tier that changes). Closed quotes, past decisions and older versions are not touched."
        submitLabel="Activate"
        destructive
        onSubmit={async (s) => {
          const res = await api.admin.activateScoringDraft({
            version: selected!.version,
            changeReason: s.changeReason,
          });
          setSelectedId(null);
          return res;
        }}
      />
      <ChangeDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Discard draft v${selected?.modelVersion ?? ''}`}
        submitLabel="Discard"
        destructive
        onSubmit={async (s) => {
          await api.admin.discardScoringDraft({
            version: selected!.version,
            changeReason: s.changeReason,
          });
          setSelectedId(null);
        }}
      />
    </div>
  );
}

function NumberCell({
  label,
  value,
  editable,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: number | null | undefined;
  editable: boolean;
  onChange: (v: number | null) => void;
  placeholder?: string;
  className?: string;
}) {
  if (!editable) {
    return (
      <span className={cn('tabular-nums', className)}>
        {value === null || value === undefined ? (placeholder ?? '—') : value.toLocaleString()}
      </span>
    );
  }
  return (
    <Input
      aria-label={label}
      type="number"
      step="any"
      className={cn('tabular-nums', className)}
      value={value === null || value === undefined ? '' : value}
      placeholder={placeholder}
      onChange={(e) => onChange(num(e.target.value))}
    />
  );
}

function ModelEditor({
  model,
  editable,
  inputs,
  onChange,
}: {
  model: Model;
  editable: boolean;
  inputs: readonly string[];
  onChange: (m: Model) => void;
}) {
  const sum = model.attributes.reduce((n, a) => n + (Number.isFinite(a.weight) ? a.weight : 0), 0);
  const sumOk = Math.abs(sum - 1) < 1e-6;
  const setAttr = (i: number, patch: Partial<Attr>) =>
    onChange({
      ...model,
      attributes: model.attributes.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    });

  return (
    <div className="grid gap-4">
      <div className="bg-card rounded-card overflow-x-auto border">
        <table className="w-full text-sm">
          <caption className="sr-only">Attributes and weights</caption>
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="p-2 font-medium">Attribute</th>
              <th className="w-32 p-2 font-medium">Weight</th>
              <th className="p-2 font-medium">Scored on</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {model.attributes.map((a, i) => (
              <tr key={a.key} className="align-top" data-testid={`attr-${a.key}`}>
                <td className="p-2">
                  <span className="font-medium">{a.label}</span>
                  <span className="text-muted-foreground block font-mono text-xs">{a.key}</span>
                </td>
                <td className="p-2">
                  <NumberCell
                    label={`Weight of ${a.label}`}
                    value={a.weight}
                    editable={editable}
                    onChange={(v) => setAttr(i, { weight: v ?? 0 })}
                  />
                  {!editable && (
                    <span className="text-muted-foreground block text-xs">{pct(a.weight)}</span>
                  )}
                </td>
                <td className="p-2">
                  <AttrDetail
                    attr={a}
                    editable={editable}
                    inputs={inputs}
                    onChange={(p) => setAttr(i, p)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="p-2 text-right font-medium">Total</td>
              <td
                className={cn('p-2 font-semibold tabular-nums', !sumOk && 'text-destructive')}
                data-testid="weight-sum"
              >
                {Math.round(sum * 1e6) / 1e6}
                {!sumOk && <span className="block text-xs font-normal">Must be 1</span>}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <fieldset className="bg-card rounded-card grid gap-2 border p-3">
          <legend className="px-1 text-sm font-medium">Tiers (score at or above)</legend>
          {[...model.tiers]
            .map((t, i) => ({ t, i }))
            .sort((x, y) => y.t.min - x.t.min)
            .map(({ t, i }) => (
              <div key={i} className="flex items-center gap-2">
                <TierChip tier={t.key} label={t.label ?? t.key} className="w-24 justify-center" />
                <NumberCell
                  label={`Minimum score for ${t.label ?? t.key}`}
                  value={t.min}
                  editable={editable}
                  onChange={(v) =>
                    onChange({
                      ...model,
                      tiers: model.tiers.map((x, j) => (j === i ? { ...x, min: v ?? 0 } : x)),
                    })
                  }
                />
              </div>
            ))}
        </fieldset>
        <fieldset className="bg-card rounded-card grid content-start gap-2 border p-3">
          <legend className="px-1 text-sm font-medium">Unknown inputs</legend>
          <label className="grid gap-1 text-sm">
            Points when an input is unknown (unless the attribute says otherwise)
            <NumberCell
              label="Unknown score"
              value={model.unknownScore}
              editable={editable}
              onChange={(v) => onChange({ ...model, unknownScore: v ?? 0 })}
            />
          </label>
        </fieldset>
      </div>
    </div>
  );
}

function AttrDetail({
  attr,
  editable,
  inputs,
  onChange,
}: {
  attr: Attr;
  editable: boolean;
  inputs: readonly string[];
  onChange: (p: Partial<Attr>) => void;
}) {
  const kind = attr.map ? 'map' : 'bands';
  return (
    <div className="grid gap-2">
      <span className="text-muted-foreground text-xs">
        {attr.input === 'map' ? `Lookup on ${attr.map?.by ?? ''}` : attr.input}
        {inputs.includes(attr.input) ? '' : ' (number)'}
        {attr.inverse ? ' · inverse (bigger is worse)' : ''}
      </span>
      {kind === 'bands' && (
        <div className="grid gap-1">
          {(attr.bands ?? []).map(([min, max, points], i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_5rem_auto] items-center gap-1.5">
              <NumberCell
                label={`${attr.label} band ${i + 1} from`}
                value={min}
                editable={editable}
                placeholder="any"
                onChange={(v) =>
                  onChange({ bands: attr.bands!.map((b, j) => (j === i ? [v, b[1], b[2]] : b)) })
                }
              />
              <NumberCell
                label={`${attr.label} band ${i + 1} up to`}
                value={max}
                editable={editable}
                placeholder="any"
                onChange={(v) =>
                  onChange({ bands: attr.bands!.map((b, j) => (j === i ? [b[0], v, b[2]] : b)) })
                }
              />
              <NumberCell
                label={`${attr.label} band ${i + 1} points`}
                value={points}
                editable={editable}
                onChange={(v) =>
                  onChange({
                    bands: attr.bands!.map((b, j) => (j === i ? [b[0], b[1], v ?? 0] : b)),
                  })
                }
              />
              {editable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${attr.label} band ${i + 1}`}
                  onClick={() => onChange({ bands: attr.bands!.filter((_, j) => j !== i) })}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs">pts</span>
              )}
            </div>
          ))}
          {editable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => onChange({ bands: [...(attr.bands ?? []), [null, null, 50]] })}
            >
              <PlusIcon aria-hidden="true" /> Add band
            </Button>
          )}
        </div>
      )}
      {kind === 'map' && attr.map && (
        <div className="grid gap-1">
          {Object.entries(attr.map.values).length === 0 && (
            <span className="text-muted-foreground text-xs">
              No codes mapped yet (all neutral).
            </span>
          )}
          {Object.entries(attr.map.values).map(([code, points], i, rows) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_auto] items-center gap-1.5">
              {editable ? (
                <Input
                  aria-label={`${attr.label} code ${i + 1}`}
                  value={code}
                  onChange={(e) => {
                    const next = rows.map(
                      ([c, p], j) => [j === i ? e.target.value : c, p] as const,
                    );
                    onChange({ map: { ...attr.map!, values: Object.fromEntries(next) } });
                  }}
                />
              ) : (
                <span className="font-mono text-xs">{code}</span>
              )}
              <NumberCell
                label={`${attr.label} ${code} points`}
                value={points}
                editable={editable}
                onChange={(v) =>
                  onChange({
                    map: { ...attr.map!, values: { ...attr.map!.values, [code]: v ?? 0 } },
                  })
                }
              />
              {editable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${attr.label} ${code}`}
                  onClick={() => {
                    const { [code]: _gone, ...rest } = attr.map!.values;
                    onChange({ map: { ...attr.map!, values: rest } });
                  }}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs">pts</span>
              )}
            </div>
          ))}
          {editable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                onChange({
                  map: {
                    ...attr.map!,
                    values: {
                      ...attr.map!.values,
                      [`CODE_${Object.keys(attr.map!.values).length + 1}`]: 50,
                    },
                  },
                })
              }
            >
              <PlusIcon aria-hidden="true" /> Add code
            </Button>
          )}
          <div className="grid grid-cols-[1fr_5rem_auto] items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Any other known value</span>
            <NumberCell
              label={`${attr.label} default points`}
              value={attr.map.default}
              editable={editable}
              placeholder="unknown"
              onChange={(v) => {
                const { default: _d, ...rest } = attr.map!;
                onChange({ map: v === null ? rest : { ...rest, default: v } });
              }}
            />
            <span />
          </div>
        </div>
      )}
    </div>
  );
}

/** Live preview: the last 50 quotes under the active model and this one (debounced). */
function Preview({ model, valid }: { model: Model; valid: boolean }) {
  const body = useMemo(() => toBody(model), [model]);
  const debounced = useDebounced(body, 400);
  const preview = useQuery({
    queryKey: adminKey('scoring-preview', JSON.stringify(debounced)),
    queryFn: () => api.admin.previewScoring(debounced),
    enabled: valid,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const p = preview.data;
  return (
    <section aria-labelledby="preview" className="grid gap-3" data-testid="scoring-preview">
      <h3 id="preview" className="font-display text-lg">
        Preview on the last 50 quotes
      </h3>
      {!valid ? (
        <p className="text-muted-foreground text-sm">Fix the model to see the preview.</p>
      ) : preview.isError ? (
        <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
      ) : !p ? (
        <SkeletonRows rows={4} />
      ) : (
        <>
          <p className="text-sm" data-testid="preview-summary">
            Against v{p.activeVersion ?? '—'}: <strong>{p.summary.tierChanges}</strong> tier change
            {p.summary.tierChanges === 1 ? '' : 's'}, {p.summary.rankChanges} rank change
            {p.summary.rankChanges === 1 ? '' : 's'} ({p.summary.movedUp} up, {p.summary.movedDown}{' '}
            down).
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            {p.summary.byTier.map((t) => (
              <span key={t.tier} className="inline-flex items-center gap-1.5">
                <TierChip tier={t.tier} label={t.label} />
                {t.before} → <strong>{t.after}</strong>
              </span>
            ))}
          </div>
          <div className="bg-card rounded-card max-h-96 overflow-auto border">
            <table className="w-full text-sm">
              <caption className="sr-only">Quotes whose tier or rank changes</caption>
              <thead className="text-muted-foreground bg-card sticky top-0 text-left text-xs">
                <tr>
                  <th className="p-2 font-medium">Quote</th>
                  <th className="p-2 font-medium">Before</th>
                  <th className="p-2 font-medium">After</th>
                  <th className="p-2 font-medium">Rank</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...p.rows]
                  .sort(
                    (a, b) =>
                      Number(b.tierChanged) - Number(a.tierChanged) ||
                      Math.abs(b.rankDelta) - Math.abs(a.rankDelta),
                  )
                  .map((r) => (
                    <tr key={r.quoteNumber} className={cn(r.tierChanged && 'bg-warning/30')}>
                      <td className="p-2">
                        <Link
                          to="/quotes/$quoteNumber"
                          params={{ quoteNumber: r.quoteNumber }}
                          className="underline-offset-4 hover:underline"
                        >
                          {r.quoteNumber}
                        </Link>
                        <span className="text-muted-foreground block text-xs">
                          {r.stageKey}
                          {r.status === 'closed' ? ' · closed (not rescored)' : ''}
                        </span>
                      </td>
                      <td className="p-2 tabular-nums">
                        {r.before ? (
                          <span className="inline-flex items-center gap-1.5">
                            <TierChip tier={r.before.tier} /> {r.before.score}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-2 tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <TierChip tier={r.after.tier} /> {r.after.score}
                        </span>
                      </td>
                      <td className="p-2 tabular-nums">
                        #{r.after.rank}
                        {r.rankDelta > 0 && (
                          <span className="text-success ml-1 inline-flex items-center">
                            <ArrowUpIcon className="size-3" aria-label="up" />
                            {r.rankDelta}
                          </span>
                        )}
                        {r.rankDelta < 0 && (
                          <span className="text-destructive ml-1 inline-flex items-center">
                            <ArrowDownIcon className="size-3" aria-label="down" />
                            {-r.rankDelta}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
