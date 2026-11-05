import {
  BUDGETARY_CAPITAL_HELP,
  BUDGETARY_CAPITAL_LABEL,
  type CapacityEvidenceRowBody,
  type EngineeringDetail,
  type EngReviewBody,
  type QuoteDetail,
} from '@ccq/contracts';
import {
  EXCEEDS_CAPACITY_MESSAGE,
  allocationCheck,
  computeUtilization,
  roundPct,
  storedUtilizationPct,
  utilizationLevel,
  type UtilizationLevel,
} from '@ccq/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DownloadIcon, EyeOffIcon, PaperclipIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';

import { useCurrentUser } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { usePublicConfig } from '@/config/public-config';
import { api, downloadBlob, uploadAttachment } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';

import { AssignDialog, engQueueQueryKey } from './AssignDialog';
import { attachmentsQueryKey } from '../attachments/Attachments';
import {
  Field,
  FormErrors,
  HiddenValue,
  errorFor,
  problemErrors,
  type ServerError,
} from '../forms';
import { quoteQueryKey } from '../GateDecisionDialog';
import { IntakeFactsHeader } from '../intake/IntakeFacts';
import { KeyValueGrid } from '../KeyValueGrid';
import { LeadReviewPanel } from '../LeadReviewPanel';
import { FieldOverride, timelineQueryKey } from '../Overrides';
import { SectionLockLine } from '../SectionLockLine';

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
      {/* FB-02: destination and mold modification from intake. */}
      <IntakeFactsHeader facts={quote.intakeFacts} shipTo={quote.shipTo} />
      <ProductFactsHeader facts={eng.productFacts} />
      <AssignmentCard quote={quote} canDecideG2={canDecideG2} onDecide={onDecide} />
      <EngLeadReview quote={quote} />
      <SectionLockLine lock={eng.lock} />
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

/**
 * F-023: what the KAM told us about the product, above everything Engineering enters: resin (and the
 * customer-specified grade), PCR %, colour and additives, and the variants note. The list comes from the
 * server, so a field the intake gains (FB-02) shows up here without a change to this tab.
 */
function ProductFactsHeader({ facts }: { facts: EngineeringDetail['productFacts'] }) {
  if (facts.length === 0) return null;
  return (
    <section
      aria-label="Product facts from the intake"
      className="bg-secondary rounded-md px-4 py-3"
      data-testid="product-facts"
    >
      <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
        From the intake
      </h2>
      <KeyValueGrid
        columns={3}
        items={facts.map((f) => ({ id: f.key, label: f.label, value: f.value }))}
      />
    </section>
  );
}

/** Lead review: the engineer submits to the engineering lead, who may send it back. */
function EngLeadReview({ quote }: { quote: QuoteDetail }) {
  const refresh = useRefresh(quote.quoteNumber);
  return (
    <LeadReviewPanel
      kind="engineering"
      review={quote.engineering.leadReview}
      submit={() => api.submitEngReviewToLead(quote.quoteNumber)}
      sendBack={(note) => api.sendBackEngReview(quote.quoteNumber, note)}
      onDone={(detail) => refresh(detail)}
    />
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
  const refresh = useRefresh(quote.quoteNumber);
  const capitalHidden = !('prelimCapitalUsd' in review);
  const initial = solutionForm(review);
  // Reset only from our own successful save, never on a background refetch (it would wipe typing).
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<ServerError[]>([]);
  const set = (k: SolutionKey) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

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
              { label: 'Process', value: eng.selectedLabels.processType },
              { label: 'Machine', value: eng.selectedLabels.machineType },
              { label: 'Plant / site', value: eng.selectedLabels.plantCode },
              { label: 'Cavitation', value: review.cavitation?.toString() },
              { label: 'Cycle time (s)', value: review.cycleTimeS?.toString() },
              {
                label: BUDGETARY_CAPITAL_LABEL,
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
                  retiredLabel={eng.selectedLabels.processType}
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
                  retiredLabel={eng.selectedLabels.machineType}
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
                  retiredLabel={eng.selectedLabels.plantCode}
                  onChange={set('plantCode')}
                />
              )}
            </Field>
            <Field
              label="Cavitation"
              hint="A whole number, 1 to 99"
              error={errorFor(errors, 'cavitation')}
            >
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={99}
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
              label={BUDGETARY_CAPITAL_LABEL}
              hint={
                capitalHidden
                  ? `${BUDGETARY_CAPITAL_HELP} Hidden from your role: leave blank to keep.`
                  : `${BUDGETARY_CAPITAL_HELP} Saving it rescores the quote.`
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
  /** F-059: the line's current load, entered. */
  utilizationBeforePct: string;
  /** Blank = the quote's estimated annual volume. */
  allocatedAnnualVolume: string;
  /** Blank = the `capacity_basis` default. */
  scheduledRunDaysPerYear: string;
  /** What the server last stored; shown only when the entered numbers are hidden from this role. */
  storedAfterPct: number | null;
  analysisDate: string;
  analystId: string;
  analystName: string | null;
  notes: string;
}
const NUMBER_FIELDS = ['assumedEffectivenessPct', 'cycleTimeS', 'utilizationBeforePct'] as const;
const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

const LEVEL_CLASS: Record<UtilizationLevel, string> = {
  ok: 'text-foreground',
  warn: 'font-semibold text-amber-700 dark:text-amber-400',
  over: 'text-destructive font-semibold',
};

/**
 * Utilization after the new business: calculated, never typed (F-059). Over 100 % is red with "exceeds line
 * capacity"; over the basis' warning threshold, amber. One decimal place.
 */
function UtilizationAfter({
  pct,
  basis,
  testId = 'utilization-after',
}: {
  pct: number | null;
  basis: EngineeringDetail['capacityBasis'];
  testId?: string;
}) {
  if (pct === null) {
    return (
      <span className="text-muted-foreground text-sm" data-testid={testId}>
        Calculated once cavitation, cycle time, effectiveness and volume are in
      </span>
    );
  }
  const level = utilizationLevel(pct, basis);
  return (
    <span className={LEVEL_CLASS[level]} data-testid={testId} data-level={level}>
      {roundPct(pct, 1).toFixed(1)}%{level === 'over' && ` · ${EXCEEDS_CAPACITY_MESSAGE}`}
      {level === 'warn' && ` · above ${basis.warnAbovePct}%`}
    </span>
  );
}

function CapacityCard({ quote }: { quote: QuoteDetail }) {
  const eng = quote.engineering;
  const me = useCurrentUser();
  const { data: config } = usePublicConfig();
  const refresh = useRefresh(quote.quoteNumber);
  const hidden = eng.commercialRedacted;
  const basis = eng.capacityBasis;
  const cavitation = eng.review.cavitation;
  const today = new Date().toISOString().slice(0, 10);
  const initial: RowForm[] = eng.capacityEvidence.map((r) => ({
    key: r.id,
    id: r.id,
    site: r.site,
    lineAsset: r.lineAsset ?? '',
    assumedEffectivenessPct: str(r.assumedEffectivenessPct),
    cycleTimeS: str(r.cycleTimeS),
    utilizationBeforePct: str(r.utilizationBeforePct),
    allocatedAnnualVolume: str(r.allocatedAnnualVolume),
    scheduledRunDaysPerYear: str(r.scheduledRunDaysPerYear),
    storedAfterPct: r.utilizationAfterPct ?? null,
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
        utilizationBeforePct: '',
        allocatedAnnualVolume: '',
        scheduledRunDaysPerYear: '',
        storedAfterPct: null,
        analysisDate: today,
        analystId: me.user.id,
        analystName: me.user.displayName,
        notes: '',
      },
    ]);
  };

  /** The same calculation the server runs on save (domain `computeUtilization`), so what you see is what is stored. */
  const volumeOf = (r: RowForm) => num(r.allocatedAnnualVolume) ?? eng.quoteAnnualVolume;
  const afterOf = (r: RowForm): number | null => {
    const calc = computeUtilization({
      cycleTimeS: num(r.cycleTimeS),
      cavitation,
      effectivenessPct: num(r.assumedEffectivenessPct),
      scheduledRunDaysPerYear: num(r.scheduledRunDaysPerYear) ?? basis.scheduledRunDaysPerYear,
      allocatedAnnualVolume: volumeOf(r),
      utilizationBeforePct: num(r.utilizationBeforePct),
    });
    // The value the server stores (two decimals), so the preview and the saved figure always agree.
    if (calc.ok) return storedUtilizationPct(calc.utilizationAfterPct);
    // Numbers hidden from this role and left blank: show what the server stored.
    return hidden && r.id ? r.storedAfterPct : null;
  };
  // T-030: the rows should add up to the quote's volume. A warning, never a block.
  const allocation = allocationCheck(
    rows.map((r) => ({ allocatedAnnualVolume: volumeOf(r) })),
    eng.quoteAnnualVolume,
  );

  const save = useMutation({
    mutationFn: () =>
      api.updateCapacityEvidence(quote.quoteNumber, {
        rows: rows.map((r) => {
          const row: Record<string, unknown> = {
            ...(r.id ? { id: r.id } : {}),
            site: r.site,
            lineAsset: r.lineAsset.trim() || null,
            allocatedAnnualVolume: num(r.allocatedAnnualVolume),
            scheduledRunDaysPerYear: num(r.scheduledRunDaysPerYear),
            analysisDate: r.analysisDate,
            analystId: r.analystId,
            notes: r.notes.trim() || null,
          };
          for (const f of NUMBER_FIELDS) {
            const v = r[f].trim();
            // Blank on an existing row whose numbers are hidden means "keep".
            if (v === '' && hidden && r.id) continue;
            row[f] = v === '' ? undefined : Number(v);
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

  const volumeText = (n: number | null) => (n === null ? null : n.toLocaleString('en-US'));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Capacity evidence</h2>
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          At least one row is needed to Proceed (CR-19). There is no OEE default. Enter the line’s
          utilization before this business; utilization after is calculated.
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
              <li
                key={r.key}
                className="rounded-md border p-3 text-sm"
                data-testid="capacity-row-view"
              >
                <KeyValueGrid
                  items={[
                    { label: 'Site', value: siteLabel(r.site) },
                    { label: 'Line / asset', value: r.lineAsset || null },
                    {
                      label: 'Assumed effectiveness %',
                      value: hidden ? <HiddenValue /> : r.assumedEffectivenessPct,
                    },
                    { label: 'Cycle time (s)', value: hidden ? <HiddenValue /> : r.cycleTimeS },
                    {
                      label: 'Utilization before %',
                      value: hidden ? <HiddenValue /> : r.utilizationBeforePct,
                    },
                    {
                      label: 'Allocated annual volume (units)',
                      value: volumeText(num(r.allocatedAnnualVolume)),
                    },
                    {
                      label: 'Scheduled run days per year',
                      value: r.scheduledRunDaysPerYear || null,
                    },
                    {
                      label: 'Utilization after % (calculated)',
                      value: hidden ? (
                        <HiddenValue />
                      ) : (
                        <UtilizationAfter
                          pct={afterOf(r)}
                          basis={basis}
                          testId="utilization-after-view"
                        />
                      ),
                    },
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
            {cavitation === null && rows.length > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="no-cavitation">
                Enter the cavitation in the Solution section above: utilization after is calculated
                from it.
              </p>
            )}
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
                        retiredLabel={eng.selectedLabels.plantCode}
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
                  <Field
                    label="Utilization before %"
                    hint="The line’s current load, before this business"
                    error={errorFor(errors, `rows/${i}/utilizationBeforePct`)}
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
                        value={r.utilizationBeforePct}
                        onChange={(e) => update(r.key, { utilizationBeforePct: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label="Allocated annual volume (units)"
                    hint={
                      eng.quoteAnnualVolume !== null
                        ? `Blank = the quote’s ${eng.quoteAnnualVolume.toLocaleString('en-US')}. Set each row’s share when the business is split.`
                        : 'The quote has no estimated volume: enter this line’s share.'
                    }
                    error={errorFor(errors, `rows/${i}/allocatedAnnualVolume`)}
                  >
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        placeholder={volumeText(eng.quoteAnnualVolume) ?? undefined}
                        value={r.allocatedAnnualVolume}
                        onChange={(e) => update(r.key, { allocatedAnnualVolume: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label="Scheduled run days per year"
                    hint={`Blank = ${basis.scheduledRunDaysPerYear}`}
                    error={errorFor(errors, `rows/${i}/scheduledRunDaysPerYear`)}
                  >
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min={1}
                        max={366}
                        step={1}
                        inputMode="numeric"
                        placeholder={String(basis.scheduledRunDaysPerYear)}
                        value={r.scheduledRunDaysPerYear}
                        onChange={(e) => update(r.key, { scheduledRunDaysPerYear: e.target.value })}
                      />
                    )}
                  </Field>
                  <div className="grid content-start gap-1" data-testid="utilization-after-field">
                    <span className="text-sm font-medium">Utilization after % (calculated)</span>
                    <output className="text-sm" aria-live="polite">
                      <UtilizationAfter pct={afterOf(r)} basis={basis} />
                    </output>
                    <span className="text-muted-foreground text-xs">Read-only. Not typed.</span>
                  </div>
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
            {allocation && (
              <p
                role="status"
                className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                data-testid="allocation-warning"
              >
                {allocation.message} This is a warning: you can still save.
              </p>
            )}
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
        {!eng.canEdit && eng.allocationWarning && (
          <p
            className="text-sm text-amber-700 dark:text-amber-400"
            data-testid="allocation-warning-view"
          >
            {eng.allocationWarning}
          </p>
        )}
        <p className="text-muted-foreground text-xs" data-testid="capacity-basis">
          Basis: {basis.basisLabel}. Run days default to {basis.scheduledRunDaysPerYear} a year;
          utilization after is amber above {basis.warnAbovePct}% and red over 100%. Effectiveness is
          applied once.
        </p>
        <CapacityEvidenceActions
          quoteNumber={quote.quoteNumber}
          hasRows={eng.capacityEvidence.length > 0}
        />
      </CardContent>
    </Card>
  );
}

/**
 * F-061: the evidence can leave QuoteFlow to support a later CER. "Download CSV" is the saved rows with their
 * calculated utilization (audited on the server); "Attach analysis" stores the engineer's own analysis file
 * on the quote as a Capacity analysis.
 */
function CapacityEvidenceActions({
  quoteNumber,
  hasRows,
}: {
  quoteNumber: string;
  hasRows: boolean;
}) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const attachments = useQuery({
    queryKey: attachmentsQueryKey({ quoteNumber }),
    queryFn: () => api.quoteAttachments(quoteNumber),
  });
  const analyses = attachments.data?.items.filter((a) => a.kind === 'capacity_analysis') ?? [];
  const canAttach = attachments.data?.canUpload ?? false;

  const download = useMutation({
    mutationFn: () => api.capacityEvidenceCsv(quoteNumber),
    onSuccess: (blob) => {
      downloadBlob(blob, `${quoteNumber}-capacity-evidence.csv`);
      toast.success({
        title: 'Capacity evidence downloaded',
        description: 'The export is recorded in the audit log.',
      });
    },
    onError: () => toast.error({ title: 'Download failed', description: 'Try again.' }),
  });

  const attach = (file: File | undefined) => {
    if (!file) return;
    const handle = uploadAttachment(
      { quoteNumber },
      file,
      { kind: 'capacity_analysis' },
      setProgress,
    );
    setProgress(0);
    handle.promise.then(
      () => {
        setProgress(null);
        void qc.invalidateQueries({ queryKey: attachmentsQueryKey({ quoteNumber }) });
        void qc.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) });
        toast.success({ title: `${file.name} attached as a capacity analysis` });
      },
      (err: unknown) => {
        setProgress(null);
        toast.error({
          title: 'Could not attach the file',
          description: err instanceof Error ? err.message : 'Try again.',
        });
      },
    );
  };

  return (
    <div className="grid gap-2" data-testid="capacity-actions">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => download.mutate()}
          disabled={!hasRows || download.isPending}
          data-testid="capacity-csv"
        >
          <DownloadIcon aria-hidden="true" />
          {download.isPending ? 'Preparing…' : 'Download CSV'}
        </Button>
        {canAttach && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
              disabled={progress !== null}
              data-testid="capacity-attach"
            >
              <PaperclipIcon aria-hidden="true" />
              {progress === null ? 'Attach analysis' : `Uploading ${Math.round(progress * 100)}%`}
            </Button>
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              aria-label="Capacity analysis file"
              data-testid="capacity-attach-input"
              onChange={(e) => {
                attach(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>
      {!hasRows && (
        <p className="text-muted-foreground text-xs">Save at least one row to download the CSV.</p>
      )}
      {analyses.length > 0 && (
        <p className="text-muted-foreground text-xs" data-testid="capacity-analyses">
          Capacity analysis attached: {analyses.map((a) => a.fileName).join(', ')}
        </p>
      )}
    </div>
  );
}

function ValueListSelect({
  id,
  list,
  value,
  retiredLabel,
  onChange,
}: {
  id: string;
  list: string;
  value: string;
  /** The label of the stored value, shown when the list no longer offers it (F-057: the EBM wheel). */
  retiredLabel?: string | null;
  onChange: (v: string) => void;
}) {
  const { data: config } = usePublicConfig();
  const options = config?.valueLists[list] ?? [];
  const retired = value !== '' && !options.some((v) => v.code === value);
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {retired && <option value={value}>{`${retiredLabel ?? value} (no longer offered)`}</option>}
      {options.map((v) => (
        <option key={v.code} value={v.code}>
          {v.label}
        </option>
      ))}
    </NativeSelect>
  );
}
