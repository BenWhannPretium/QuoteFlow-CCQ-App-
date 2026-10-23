import type {
  CapacityEvidenceRowBody,
  EngineeringDetail,
  EngReviewBody,
  QuoteDetail,
} from '@ccq/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOffIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';

import { useCurrentUser } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { usePublicConfig } from '@/config/public-config';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';

import { AssignDialog, engQueueQueryKey } from './AssignDialog';
import {
  Field,
  FormErrors,
  HiddenValue,
  errorFor,
  problemErrors,
  type ServerError,
} from '../forms';
import { quoteQueryKey } from '../GateDecisionDialog';
import { KeyValueGrid } from '../KeyValueGrid';
import { FieldOverride, timelineQueryKey } from '../Overrides';

const DF22_HELP =
  'State your assumption. Quotes have historically assumed 85% vs ~70% demonstrated (DF-22).';

/**
 * The quote's "Engineering" tab (B-10): assignment and acceptance, the Engineering Review solution
 * and the capacity evidence (CR-19). Editable by the EngLead and the assigned engineer while the
 * quote is in Engineering Review; read-only for everyone else. Commercial numbers come back only for
 * roles allowed to see them: for others the inputs are write-only ("leave blank to keep").
 */
export function EngineeringTab({
  quote,
  onDecide,
}: {
  quote: QuoteDetail;
  onDecide: (outcomeKey?: string) => void;
}) {
  const eng = quote.engineering;
  const canDecideG2 = quote.availableActions.some((a) => a.gateKey === 'G2');
  return (
    <div className="grid gap-6" data-testid="engineering-tab">
      <AssignmentCard quote={quote} canDecideG2={canDecideG2} onDecide={onDecide} />
      {eng.commercialRedacted && eng.canEdit && (
        <p
          className="bg-secondary flex items-start gap-2 rounded-md px-3 py-2 text-sm"
          data-testid="commercial-hidden"
        >
          <EyeOffIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Capital and capacity figures are commercial: your role can enter them but not read them
          back. Leave a hidden field blank to keep what is saved.
        </p>
      )}
      <SolutionCard quote={quote} />
      <CapacityCard key={eng.capacityEvidence.map((r) => r.id).join()} quote={quote} />
      <CapacitySignoffCard
        key={`signoff-${eng.capacitySignoff.at ?? ''}-${eng.capacitySignoff.status ?? ''}`}
        quote={quote}
      />
    </div>
  );
}

function useRefresh(quoteNumber: string) {
  const queryClient = useQueryClient();
  return (detail?: EngineeringDetail) => {
    if (detail) {
      queryClient.setQueryData<QuoteDetail>(quoteQueryKey(quoteNumber), (q) =>
        q ? { ...q, engineering: detail } : q,
      );
    }
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) }),
      queryClient.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) }),
      queryClient.invalidateQueries({ queryKey: engQueueQueryKey }),
    ]);
  };
}

function AssignmentCard({
  quote,
  canDecideG2,
  onDecide,
}: {
  quote: QuoteDetail;
  canDecideG2: boolean;
  onDecide: (outcomeKey?: string) => void;
}) {
  const eng = quote.engineering;
  const refresh = useRefresh(quote.quoteNumber);
  const [assigning, setAssigning] = useState(false);
  // The picker's engineers (with open counts) come with the queue; load them when the dialog opens.
  const picker = useQuery({
    queryKey: [...engQueueQueryKey, 'picker'],
    queryFn: () => api.engQueue({ q: quote.quoteNumber }),
    enabled: assigning,
  });
  const accept = useMutation({
    mutationFn: () => api.acceptEngReview(quote.quoteNumber),
    onSuccess: async (detail) => {
      await refresh(detail);
      toast.success({
        title: 'Review accepted',
        description: 'The engineering review is in progress.',
      });
    },
    onError: (err) =>
      toast.error({
        title: 'Could not accept',
        description: problemErrors(err)[0]?.message ?? 'Try again.',
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Assignment</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <KeyValueGrid
          items={[
            {
              id: 'engineer',
              label: 'Engineer',
              value: eng.assignedEngineerName ?? (
                <span className="text-muted-foreground">Unassigned</span>
              ),
            },
            {
              label: 'Assigned',
              value: eng.assignedAt ? absoluteTime(eng.assignedAt) : null,
            },
            {
              id: 'accepted',
              label: 'Accepted',
              value: eng.acceptedAt
                ? `${absoluteTime(eng.acceptedAt)}${eng.acceptedByName ? ` by ${eng.acceptedByName}` : ''}`
                : eng.inQueue
                  ? 'Awaiting acceptance'
                  : null,
            },
            {
              id: 'queue-position',
              label: 'Queue position',
              value: (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span>{quote.engineering.inQueue ? 'By priority' : '–'}</span>
                  <FieldOverride quote={quote} field="queue_position" />
                </span>
              ),
            },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {eng.canAssign && (
            <Button variant="outline" size="sm" onClick={() => setAssigning(true)}>
              {eng.assignedEngineerId ? 'Reassign…' : 'Assign…'}
            </Button>
          )}
          {eng.canAccept && (
            <Button size="sm" onClick={() => accept.mutate()} disabled={accept.isPending}>
              Accept (start review)
            </Button>
          )}
          {canDecideG2 && (
            <>
              <Button size="sm" onClick={() => onDecide()}>
                Decide G2…
              </Button>
              <Button variant="outline" size="sm" onClick={() => onDecide('rework')}>
                Return to KAM…
              </Button>
            </>
          )}
        </div>
        {assigning && picker.data && (
          <AssignDialog
            open
            onOpenChange={setAssigning}
            quoteNumbers={[quote.quoteNumber]}
            engineers={picker.data.engineers}
            currentEngineerId={eng.assignedEngineerId}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── Solution ─────────────────────────────────────────────────────────────────────────────────────

type SolutionKey = keyof EngReviewBody;
const NUMERIC: SolutionKey[] = ['cavitation', 'cycleTimeS', 'prelimCapitalUsd'];

function SolutionCard({ quote }: { quote: QuoteDetail }) {
  const eng = quote.engineering;
  const review = eng.review;
  const { data: config } = usePublicConfig();
  const refresh = useRefresh(quote.quoteNumber);
  const capitalHidden = !('prelimCapitalUsd' in review);
  const initial = solutionForm(review);
  // Reset only from our own successful save, never on a background refetch (it would wipe typing).
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<ServerError[]>([]);
  const set = (k: SolutionKey) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const label = (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : null;

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const k of Object.keys(form) as SolutionKey[]) {
        if (form[k] === initial[k]) continue;
        // Blank on a hidden (write-only) field means "keep".
        if (k === 'prelimCapitalUsd' && capitalHidden && form[k].trim() === '') continue;
        const v = form[k].trim();
        body[k] = v === '' ? null : NUMERIC.includes(k) ? Number(v) : v;
      }
      return api.updateEngReview(quote.quoteNumber, body);
    },
    onSuccess: async (detail) => {
      setErrors([]);
      setForm(solutionForm(detail.review));
      await refresh(detail);
      toast.success({ title: 'Engineering review saved' });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });

  if (!eng.canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">Solution</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValueGrid
            items={[
              { label: 'Process', value: label('process_type', review.processType) },
              { label: 'Machine', value: label('machine_type', review.machineType) },
              { label: 'Plant / site', value: label('plant', review.plantCode) },
              { label: 'Cavitation', value: review.cavitation?.toString() },
              { label: 'Cycle time (s)', value: review.cycleTimeS?.toString() },
              {
                label: 'Preliminary capital',
                value: capitalHidden ? (
                  <HiddenValue />
                ) : review.prelimCapitalUsd != null ? (
                  `$${review.prelimCapitalUsd.toLocaleString('en-US')}`
                ) : null,
              },
              { id: 'tooling', label: 'Tooling (mold / hot runner)', value: review.toolingNotes },
              {
                id: 'downstream',
                label: 'Downstream equipment',
                value: review.downstreamEquipmentNotes,
              },
              { id: 'concept', label: 'Technical concept', value: review.technicalConceptNotes },
              { id: 'bom', label: 'Equipment BOM', value: review.equipmentBomNotes },
              { id: 'supply-chain', label: 'Supply Chain', value: review.supplyChainNotes },
            ]}
          />
        </CardContent>
      </Card>
    );
  }

  const changed = (Object.keys(form) as SolutionKey[]).some((k) => form[k] !== initial[k]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Solution</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          noValidate
          data-testid="solution-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Process type" error={errorFor(errors, 'processType')}>
              {(id) => (
                <ValueListSelect
                  id={id}
                  list="process_type"
                  value={form.processType}
                  onChange={set('processType')}
                />
              )}
            </Field>
            <Field
              label="Machine type"
              hint="Provisional list"
              error={errorFor(errors, 'machineType')}
            >
              {(id) => (
                <ValueListSelect
                  id={id}
                  list="machine_type"
                  value={form.machineType}
                  onChange={set('machineType')}
                />
              )}
            </Field>
            <Field
              label="Plant / site"
              hint="Decided by Engineering, Ops and Supply Chain (DF-10)"
              error={errorFor(errors, 'plantCode')}
            >
              {(id) => (
                <ValueListSelect
                  id={id}
                  list="plant"
                  value={form.plantCode}
                  onChange={set('plantCode')}
                />
              )}
            </Field>
            <Field label="Cavitation" error={errorFor(errors, 'cavitation')}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={form.cavitation}
                  onChange={(e) => set('cavitation')(e.target.value)}
                />
              )}
            </Field>
            <Field label="Cycle time (s)" error={errorFor(errors, 'cycleTimeS')}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  step="0.1"
                  inputMode="decimal"
                  value={form.cycleTimeS}
                  onChange={(e) => set('cycleTimeS')(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Preliminary capital (USD)"
              hint={
                capitalHidden
                  ? 'Commercial: hidden from your role. Leave blank to keep.'
                  : 'Commercial. Saving it rescores the quote.'
              }
              error={errorFor(errors, 'prelimCapitalUsd')}
            >
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  step={1000}
                  inputMode="numeric"
                  placeholder={capitalHidden ? 'Hidden' : undefined}
                  value={form.prelimCapitalUsd}
                  onChange={(e) => set('prelimCapitalUsd')(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label="Tooling notes (mold, hot runner)" error={errorFor(errors, 'toolingNotes')}>
            {(id) => (
              <Textarea
                id={id}
                value={form.toolingNotes}
                onChange={(e) => set('toolingNotes')(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Downstream equipment"
            hint="Air, water, electric, inspection / leak detection (DF-37)"
            error={errorFor(errors, 'downstreamEquipmentNotes')}
          >
            {(id) => (
              <Textarea
                id={id}
                value={form.downstreamEquipmentNotes}
                onChange={(e) => set('downstreamEquipmentNotes')(e.target.value)}
              />
            )}
          </Field>
          <Field label="Technical concept" error={errorFor(errors, 'technicalConceptNotes')}>
            {(id) => (
              <Textarea
                id={id}
                value={form.technicalConceptNotes}
                onChange={(e) => set('technicalConceptNotes')(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Equipment BOM"
            hint="Equipment list for the capital estimate: machine, mold, downstream, auxiliaries (B-26)"
            error={errorFor(errors, 'equipmentBomNotes')}
          >
            {(id) => (
              <Textarea
                id={id}
                value={form.equipmentBomNotes}
                onChange={(e) => set('equipmentBomNotes')(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Supply Chain"
            hint="Supply Chain's network, resin and freight view on the chosen plant (B-26)"
            error={errorFor(errors, 'supplyChainNotes')}
          >
            {(id) => (
              <Textarea
                id={id}
                value={form.supplyChainNotes}
                onChange={(e) => set('supplyChainNotes')(e.target.value)}
              />
            )}
          </Field>
          <FormErrors errors={errors.filter((e) => !e.path.match(/^\/\w+$/))} />
          <div>
            <Button type="submit" disabled={!changed || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save solution'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function solutionForm(review: EngineeringDetail['review']): Record<SolutionKey, string> {
  return {
    processType: review.processType ?? '',
    machineType: review.machineType ?? '',
    plantCode: review.plantCode ?? '',
    cavitation: review.cavitation?.toString() ?? '',
    cycleTimeS: review.cycleTimeS?.toString() ?? '',
    toolingNotes: review.toolingNotes ?? '',
    downstreamEquipmentNotes: review.downstreamEquipmentNotes ?? '',
    prelimCapitalUsd: review.prelimCapitalUsd?.toString() ?? '',
    technicalConceptNotes: review.technicalConceptNotes ?? '',
    equipmentBomNotes: review.equipmentBomNotes ?? '',
    supplyChainNotes: review.supplyChainNotes ?? '',
  };
}

// ── Capacity sign-off (B-26, B5) ─────────────────────────────────────────────────────────────────

const SIGNOFF_LABEL = { approved: 'Capacity approved', blocked: 'Capacity blocked' } as const;

/**
 * The capacity owner's sign-off (B-26, deck slide 9): G2 "Advance" needs capacity approved, not just
 * the evidence rows. Recorded by the EngLead (capacity.signoff) while the quote is in Engineering
 * Review; blocking needs a note. Changing the solution clears it on the server.
 */
function CapacitySignoffCard({ quote }: { quote: QuoteDetail }) {
  const eng = quote.engineering;
  const signoff = eng.capacitySignoff;
  const refresh = useRefresh(quote.quoteNumber);
  const [note, setNote] = useState(signoff.note ?? '');
  const [errors, setErrors] = useState<ServerError[]>([]);
  const save = useMutation({
    mutationFn: (status: 'approved' | 'blocked' | null) =>
      api.updateCapacitySignoff(quote.quoteNumber, {
        status,
        note: note.trim() === '' ? null : note.trim(),
      }),
    onSuccess: async (detail, status) => {
      setErrors([]);
      await refresh(detail);
      toast.success({
        title: status ? SIGNOFF_LABEL[status] : 'Capacity sign-off cleared',
      });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });
  return (
    <Card data-testid="capacity-signoff">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Capacity sign-off</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm" role="status" data-testid="capacity-signoff-status">
          {signoff.status ? (
            <>
              <span className="font-medium">{SIGNOFF_LABEL[signoff.status]}</span>
              {signoff.byName ? ` by ${signoff.byName}` : ''}
              {signoff.at ? ` on ${absoluteTime(signoff.at)}` : ''}
              {signoff.note ? `: ${signoff.note}` : ''}
            </>
          ) : (
            <span className="text-muted-foreground">
              Not signed off yet. G2 &ldquo;Advance&rdquo; needs the capacity owner to approve
              capacity.
            </span>
          )}
        </p>
        {eng.canSignOffCapacity && (
          <div className="grid gap-3">
            <Field
              label="Sign-off note"
              hint="Required to block capacity"
              error={errorFor(errors, 'note')}
            >
              {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <FormErrors errors={errors.filter((e) => e.path !== '/note')} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate('approved')}
              >
                Approve capacity
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending || note.trim() === ''}
                onClick={() => save.mutate('blocked')}
              >
                Block capacity
              </Button>
              {signoff.status && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => save.mutate(null)}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Capacity evidence ────────────────────────────────────────────────────────────────────────────

interface RowForm {
  key: string;
  id?: string;
  site: string;
  lineAsset: string;
  assumedEffectivenessPct: string;
  cycleTimeS: string;
  utilizationPct: string;
  bufferPct: string;
  analysisDate: string;
  analystId: string;
  analystName: string | null;
  notes: string;
}
const NUMBER_FIELDS = [
  'assumedEffectivenessPct',
  'cycleTimeS',
  'utilizationPct',
  'bufferPct',
] as const;
const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

function CapacityCard({ quote }: { quote: QuoteDetail }) {
  const eng = quote.engineering;
  const me = useCurrentUser();
  const { data: config } = usePublicConfig();
  const refresh = useRefresh(quote.quoteNumber);
  const hidden = eng.commercialRedacted;
  const today = new Date().toISOString().slice(0, 10);
  const initial: RowForm[] = eng.capacityEvidence.map((r) => ({
    key: r.id,
    id: r.id,
    site: r.site,
    lineAsset: r.lineAsset ?? '',
    assumedEffectivenessPct: str(r.assumedEffectivenessPct),
    cycleTimeS: str(r.cycleTimeS),
    utilizationPct: str(r.utilizationPct),
    bufferPct: str(r.bufferPct),
    analysisDate: r.analysisDate,
    analystId: r.analystId,
    analystName: r.analystName,
    notes: r.notes ?? '',
  }));
  const [rows, setRows] = useState<RowForm[]>(initial);
  const [errors, setErrors] = useState<ServerError[]>([]);
  const [dirty, setDirty] = useState(false);
  const update = (key: string, patch: Partial<RowForm>) => {
    setDirty(true);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const add = () => {
    setDirty(true);
    setRows((rs) => [
      ...rs,
      {
        key: `new-${Date.now()}-${rs.length}`,
        site: quote.engineering.review.plantCode ?? '',
        lineAsset: '',
        assumedEffectivenessPct: '',
        cycleTimeS: quote.engineering.review.cycleTimeS?.toString() ?? '',
        utilizationPct: '',
        bufferPct: '',
        analysisDate: today,
        analystId: me.user.id,
        analystName: me.user.displayName,
        notes: '',
      },
    ]);
  };

  const save = useMutation({
    mutationFn: () =>
      api.updateCapacityEvidence(quote.quoteNumber, {
        rows: rows.map((r) => {
          const row: Record<string, unknown> = {
            ...(r.id ? { id: r.id } : {}),
            site: r.site,
            lineAsset: r.lineAsset.trim() || null,
            analysisDate: r.analysisDate,
            analystId: r.analystId,
            notes: r.notes.trim() || null,
          };
          for (const f of NUMBER_FIELDS) {
            const v = r[f].trim();
            // Blank on an existing row whose numbers are hidden means "keep".
            if (v === '' && hidden && r.id) continue;
            row[f] = v === '' ? (f === 'bufferPct' ? null : undefined) : Number(v);
          }
          return row as CapacityEvidenceRowBody;
        }),
      }),
    onSuccess: async (detail) => {
      setErrors([]);
      setDirty(false);
      await refresh(detail);
      toast.success({ title: 'Capacity evidence saved' });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });

  const siteLabel = (code: string) =>
    config?.valueLists.plant?.find((v) => v.code === code)?.label ?? code;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Capacity evidence</h2>
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          At least one row is needed to Proceed (CR-19). There is no OEE default.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {rows.length === 0 && (
          <p className="text-muted-foreground text-sm" data-testid="no-capacity">
            No capacity evidence yet.
          </p>
        )}
        {!eng.canEdit && rows.length > 0 && (
          <ul className="grid gap-3">
            {rows.map((r) => (
              <li key={r.key} className="rounded-md border p-3 text-sm">
                <KeyValueGrid
                  items={[
                    { label: 'Site', value: siteLabel(r.site) },
                    { label: 'Line / asset', value: r.lineAsset || null },
                    {
                      label: 'Assumed effectiveness %',
                      value: hidden ? <HiddenValue /> : r.assumedEffectivenessPct,
                    },
                    { label: 'Cycle time (s)', value: hidden ? <HiddenValue /> : r.cycleTimeS },
                    { label: 'Utilization %', value: hidden ? <HiddenValue /> : r.utilizationPct },
                    { label: 'Buffer %', value: hidden ? <HiddenValue /> : r.bufferPct || null },
                    { label: 'Analysis date', value: r.analysisDate },
                    { label: 'Analyst', value: r.analystName },
                    { id: 'notes', label: 'Notes', value: r.notes || null },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
        {eng.canEdit && (
          <form
            className="grid gap-4"
            noValidate
            data-testid="capacity-form"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {rows.map((r, i) => (
              <fieldset
                key={r.key}
                className="grid gap-3 rounded-md border p-3"
                data-testid="capacity-row"
              >
                <legend className="px-1 text-sm font-medium">Row {i + 1}</legend>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Site" error={errorFor(errors, `rows/${i}/site`)}>
                    {(id) => (
                      <ValueListSelect
                        id={id}
                        list="plant"
                        value={r.site}
                        onChange={(v) => update(r.key, { site: v })}
                      />
                    )}
                  </Field>
                  <Field label="Line / asset">
                    {(id) => (
                      <Input
                        id={id}
                        value={r.lineAsset}
                        onChange={(e) => update(r.key, { lineAsset: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label="Assumed effectiveness %"
                    hint={hidden && r.id ? 'Hidden. Leave blank to keep.' : DF22_HELP}
                    error={errorFor(errors, `rows/${i}/assumedEffectivenessPct`)}
                  >
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        inputMode="decimal"
                        placeholder={hidden && r.id ? 'Hidden' : undefined}
                        required={!r.id || !hidden}
                        value={r.assumedEffectivenessPct}
                        onChange={(e) => update(r.key, { assumedEffectivenessPct: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Cycle time (s)" error={errorFor(errors, `rows/${i}/cycleTimeS`)}>
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min={0}
                        step="0.1"
                        inputMode="decimal"
                        placeholder={hidden && r.id ? 'Hidden' : undefined}
                        value={r.cycleTimeS}
                        onChange={(e) => update(r.key, { cycleTimeS: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Utilization %" error={errorFor(errors, `rows/${i}/utilizationPct`)}>
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        inputMode="decimal"
                        placeholder={hidden && r.id ? 'Hidden' : undefined}
                        value={r.utilizationPct}
                        onChange={(e) => update(r.key, { utilizationPct: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Buffer %" error={errorFor(errors, `rows/${i}/bufferPct`)}>
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        inputMode="decimal"
                        placeholder={hidden && r.id ? 'Hidden' : undefined}
                        value={r.bufferPct}
                        onChange={(e) => update(r.key, { bufferPct: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Analysis date" error={errorFor(errors, `rows/${i}/analysisDate`)}>
                    {(id) => (
                      <Input
                        id={id}
                        type="date"
                        value={r.analysisDate}
                        onChange={(e) => update(r.key, { analysisDate: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Analyst">
                    {(id) => (
                      <NativeSelect
                        id={id}
                        value={r.analystId}
                        onChange={(e) =>
                          update(r.key, {
                            analystId: e.target.value,
                            analystName: e.target.selectedOptions[0]?.text ?? null,
                          })
                        }
                      >
                        {[
                          ...new Map([
                            [me.user.id, me.user.displayName],
                            ...rows.map((x): [string, string] => [
                              x.analystId,
                              x.analystName ?? 'Unknown',
                            ]),
                          ]),
                        ].map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                </div>
                <Field label="Notes and assumptions">
                  {(id) => (
                    <Textarea
                      id={id}
                      value={r.notes}
                      onChange={(e) => update(r.key, { notes: e.target.value })}
                    />
                  )}
                </Field>
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDirty(true);
                      setRows((rs) => rs.filter((x) => x.key !== r.key));
                    }}
                  >
                    <Trash2Icon aria-hidden="true" />
                    Remove row {i + 1}
                  </Button>
                </div>
              </fieldset>
            ))}
            <FormErrors errors={errors} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={add}>
                <PlusIcon aria-hidden="true" />
                Add capacity row
              </Button>
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending ? 'Saving…' : 'Save capacity evidence'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ValueListSelect({
  id,
  list,
  value,
  onChange,
}: {
  id: string;
  list: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: config } = usePublicConfig();
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {(config?.valueLists[list] ?? []).map((v) => (
        <option key={v.code} value={v.code}>
          {v.label}
        </option>
      ))}
    </NativeSelect>
  );
}
