import {
  BUDGETARY_CAPITAL_HELP,
  BUDGETARY_CAPITAL_LABEL,
  engInputError,
  type CapacityEvidenceRowBody,
  type EngInputField,
  type EngineeringDetail,
  type EngReviewBody,
  type PublicValueListEntry,
  type QuoteDetail,
} from '@ccq/contracts';
import {
  EXCEEDS_CAPACITY_MESSAGE,
  allocationCheck,
  capacityAtAGlance,
  checkPlantRunsMachineType,
  computeUtilization,
  machineTypesForPlant,
  parseMachineTypeProcessMap,
  plantMachineTypes,
  plantsRunning,
  processTypeForMachine,
  roundPct,
  storedUtilizationPct,
  utilizationLevel,
  type UtilizationLevel,
  type CapacityFigure,
  type CapacityGlance,
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
import { decisionLabel, forwardReadiness } from '@/lib/decision-label';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { RETIRED_SUFFIX } from '@/lib/value-label';

import { AssignDialog, engQueueQueryKey } from './AssignDialog';
import { EquipmentBomCard, LegacyNotes, PricingInputsCard } from './EngineeringExtras';
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
import { LeadReviewActions, LeadReviewStatus } from '../LeadReviewPanel';
import { FieldOverride, timelineQueryKey } from '../Overrides';
import { SectionLockLine } from '../SectionLockLine';

const DF22_HELP =
  'Enter the effectiveness you are assuming. Past quotes assumed 85%; lines have actually run at about 70%.';

/**
 * The quote's "Engineering" tab (B-10): assignment and acceptance, the Engineering Review solution
 * and the capacity evidence (CR-19). Editable by the EngLead and the assigned engineer while the
 * quote is in Engineering Review; read-only for everyone else. Commercial numbers come back only for
 * roles allowed to see them: for others the inputs are write-only ("leave blank to keep").
 *
 * FB-16 (W13-15): two people work it. The solution is the engineer's part; the capacity rows and the
 * capacity sign-off are the production scheduler's part (when one is assigned). Each card says whose.
 */
export function EngineeringTab({
  quote,
  onDecide,
}: {
  quote: QuoteDetail;
  onDecide: (outcomeKey?: string, scope?: { outcomes: string[]; title: string }) => void;
}) {
  const eng = quote.engineering;
  const refresh = useRefresh(quote.quoteNumber);
  const g2 = quote.availableActions.find((a) => a.gateKey === 'G2');
  const forward = forwardReadiness(quote.availableActions, 'G2');
  // The tab reads top to bottom in the order the work is done: who has it, where it stands, the
  // work itself, then the one next step (submit to the lead, or the lead's decision) at the end.
  return (
    <div className="grid gap-6" data-testid="engineering-tab">
      {/* FB-02: destination and mold modification from intake. */}
      <IntakeFactsHeader facts={quote.intakeFacts} shipTo={quote.shipTo} />
      <ProductFactsHeader facts={eng.productFacts} />
      <AssignmentCard quote={quote} />
      <LeadReviewStatus kind="engineering" review={eng.leadReview} />
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
      <EquipmentBomCard quote={quote} />
      <PricingInputsCard quote={quote} refresh={refresh} />
      <LegacyNotes review={eng.review} />
      <CapacityCard key={eng.capacityEvidence.map((r) => r.id).join()} quote={quote} />
      <CapacitySignoffCard
        key={`signoff-${eng.capacitySignoff.at ?? ''}-${eng.capacitySignoff.status ?? ''}`}
        quote={quote}
      />
      <LeadReviewActions
        kind="engineering"
        review={eng.leadReview}
        submit={() => api.submitEngReviewToLead(quote.quoteNumber)}
        sendBack={(note, to) => api.sendBackEngReview(quote.quoteNumber, note, to)}
        onDone={(detail) => refresh(detail)}
        decide={
          g2
            ? {
                label: decisionLabel('G2', g2.gateLabel),
                onClick: () => onDecide(),
                ...forward,
                onOther:
                  forward.others.length > 0
                    ? () =>
                        onDecide(undefined, {
                          outcomes: forward.others,
                          title: 'Hold, send back or stop',
                        })
                    : undefined,
              }
            : undefined
        }
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

function useRefresh(quoteNumber: string) {
  const queryClient = useQueryClient();
  return (detail?: EngineeringDetail) => {
    if (detail) {
      // A save's response has no required-field list (it comes with the quote): keep the one on screen.
      queryClient.setQueryData<QuoteDetail>(quoteQueryKey(quoteNumber), (q) =>
        q
          ? {
              ...q,
              engineering: {
                ...detail,
                leadReview: {
                  ...detail.leadReview,
                  requiredFields:
                    detail.leadReview.requiredFields ?? q.engineering.leadReview.requiredFields,
                },
              },
            }
          : q,
      );
    }
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) }),
      queryClient.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) }),
      queryClient.invalidateQueries({ queryKey: engQueueQueryKey }),
    ]);
  };
}

/**
 * FB-16 (W13-15): whose part a card is. "Your part" on the viewer's own; with no production scheduler
 * assigned, the capacity part says who fills it in instead.
 */
function PartLabel({ part, quote }: { part: 'engineer' | 'scheduler'; quote: QuoteDetail }) {
  const me = useCurrentUser().user.id;
  const eng = quote.engineering;
  const owner = part === 'engineer' ? eng.assignedEngineerId : eng.assignedSchedulerId;
  const text =
    owner && owner === me
      ? 'Your part'
      : part === 'engineer'
        ? 'Engineer’s part'
        : eng.assignedSchedulerId
          ? 'Production scheduler’s part'
          : 'Production scheduler’s part (none assigned: the engineer or the engineering lead fills it in)';
  return (
    <p className="text-muted-foreground text-xs" data-testid={`part-${part}`}>
      {text}
    </p>
  );
}

function AssignmentCard({ quote }: { quote: QuoteDetail }) {
  const eng = quote.engineering;
  const isAssignee = useCurrentUser().user.id === eng.assignedEngineerId;
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
        title: 'Review started',
        description: 'Fill in the sections below, then submit at the bottom.',
      });
    },
    onError: (err) =>
      toast.error({
        title: 'Could not start the review',
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
              // FB-16 (W13-15): the second assignee, who works the capacity part.
              id: 'scheduler',
              label: 'Production scheduler',
              value: eng.assignedSchedulerName ?? (
                <span className="text-muted-foreground">None assigned</span>
              ),
            },
            {
              id: 'accepted',
              label: 'Review started',
              value: eng.acceptedAt
                ? `${absoluteTime(eng.acceptedAt)}${eng.acceptedByName ? ` by ${eng.acceptedByName}` : ''}`
                : eng.inQueue
                  ? 'Not started yet'
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
        {/* One step at a time: assign first, then the engineer starts. Reassigning stays available, quietly. */}
        {(eng.canAssign || eng.canAccept) && (
          <div className="flex flex-wrap items-center gap-2">
            {eng.canAssign && !eng.assignedEngineerId && (
              <Button onClick={() => setAssigning(true)}>Assign engineer</Button>
            )}
            {/* Starting is the assigned engineer's step; a lead may start it for them (quieter). */}
            {eng.canAccept && eng.assignedEngineerId && (
              <Button
                variant={isAssignee ? 'action' : 'outline'}
                size={isAssignee ? 'default' : 'sm'}
                onClick={() => accept.mutate()}
                disabled={accept.isPending}
              >
                Start review
              </Button>
            )}
            {eng.canAssign && eng.assignedEngineerId && (
              <Button variant="ghost" size="sm" onClick={() => setAssigning(true)}>
                Reassign
              </Button>
            )}
          </div>
        )}
        {assigning && picker.data && (
          <AssignDialog
            open
            onOpenChange={setAssigning}
            quoteNumbers={[quote.quoteNumber]}
            engineers={picker.data.engineers}
            currentEngineerId={eng.assignedEngineerId}
            schedulers={picker.data.schedulers}
            currentSchedulerId={eng.assignedSchedulerId}
            suggestions={[{ quoteNumber: quote.quoteNumber, suggested: eng.suggestedEngineer }]}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── Solution ─────────────────────────────────────────────────────────────────────────────────────

/** FB-06: the two-step and pack-out fields have their own card; the legacy notes accept no writes. */
type ExtrasKey =
  | 'twoStep'
  | 'preformPlantCode'
  | 'blowPlantCode'
  | 'preformNumber'
  | 'twoStepFreightNote'
  | 'unitsPerBag'
  | 'unitsPerTray'
  | 'unitsPerCase'
  | 'unitsPerPallet';
/**
 * FB-16 (W13-12): the process type is no longer picked. The form sends the plant and one "Process &
 * machine type" pick; the server derives the process type from it (`machine_type_process_map`).
 */
type SolutionKey = Exclude<keyof EngReviewBody, ExtrasKey | 'processType'>;
const NUMERIC = ['cavitation', 'cycleTimeS', 'prelimCapitalUsd'] as const satisfies SolutionKey[];
const isNumeric = (k: SolutionKey): k is (typeof NUMERIC)[number] =>
  (NUMERIC as readonly SolutionKey[]).includes(k);

function SolutionCard({ quote }: { quote: QuoteDetail }) {
  const eng = quote.engineering;
  const review = eng.review;
  const { data: config } = usePublicConfig();
  const refresh = useRefresh(quote.quoteNumber);
  const capitalHidden = !('prelimCapitalUsd' in review);
  // Bailey Schmitt (2026-11-12): the fields the quote needs before it can advance say so (workflow config).
  const required = new Set(eng.leadReview.requiredFields ?? []);
  const req = (label: string, field: string) =>
    required.has(field) ? `${label} (required)` : label;
  const initial = solutionForm(review);
  // Reset only from our own successful save, never on a background refetch (it would wipe typing).
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<ServerError[]>([]);
  // FB-16 (W13-13): why the machine type was cleared when the plant changed ("X does not run Y").
  const [cleared, setCleared] = useState<string | null>(null);
  const set = (k: SolutionKey) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  // FB-16 (W13-12, W13-13): plant first, then one pick over the machine types that plant runs.
  const plants = config?.valueLists.plant ?? [];
  const machineTypes = config?.valueLists.machine_type ?? [];
  const offered = machineTypesForPlant(machineTypes, plants, form.plantCode || null);
  const plant = plants.find((v) => v.code === form.plantCode);
  const machineHint =
    form.plantCode === ''
      ? 'Pick the plant first to see only what it runs'
      : plant && plantMachineTypes(plant) !== null
        ? `Only what ${plant.label} runs`
        : undefined;
  const setPlant = (plantCode: string) => {
    const check = checkPlantRunsMachineType({
      plantCode,
      machineType: form.machineType,
      plants,
      machineTypes,
    });
    setCleared(
      check.ok ? null : `${check.plantLabel} does not run ${check.machineLabel}; pick again`,
    );
    setForm((f) => ({ ...f, plantCode, ...(check.ok ? {} : { machineType: '' }) }));
  };
  const setMachine = (machineType: string) => {
    setCleared(null);
    setForm((f) => ({ ...f, machineType }));
  };
  // The process the pick stands for, as the server will derive it (read-only: it is never picked).
  const derivedProcess = (() => {
    if (!config || form.machineType === '') return null;
    try {
      const map = parseMachineTypeProcessMap(config.settings.machine_type_process_map);
      const code = processTypeForMachine(map, form.machineType);
      return code
        ? (config.valueLists.process_type?.find((v) => v.code === code)?.label ?? code)
        : null;
    } catch {
      return null; // a malformed setting: the server says so on save
    }
  })();
  // FB-16 (W13-20): the numeric inputs are checked as they are typed, with the server's own rules.
  // An old quote keeps the process it was saved with until someone picks again.
  const machineUnchanged = form.machineType === initial.machineType;
  const processShown = machineUnchanged
    ? (eng.selectedLabels.processType ?? review.processType ?? null)
    : derivedProcess;
  const inputError = (k: (typeof NUMERIC)[number]) => engInputError(k, form[k]) ?? undefined;
  const invalid = NUMERIC.some((k) => inputError(k));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const k of Object.keys(form) as SolutionKey[]) {
        if (form[k] === initial[k]) continue;
        // Blank on a hidden (write-only) field means "keep".
        if (k === 'prelimCapitalUsd' && capitalHidden && form[k].trim() === '') continue;
        const v = form[k].trim();
        body[k] = v === '' ? null : isNumeric(k) ? Number(v) : v;
      }
      return api.updateEngReview(quote.quoteNumber, body);
    },
    onSuccess: async (detail) => {
      setErrors([]);
      setCleared(null);
      setForm(solutionForm(detail.review));
      await refresh(detail);
      // FB-16 (W13-16): this names the card that was saved, not the stage.
      toast.success({ title: 'Solution saved' });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });

  if (!eng.canEdit) {
    // DR-cross-cutting-12: a plant, machine or process taken off its list reads "(no longer offered)",
    // as on Final Review (the pickers list active entries only).
    const shown = (list: string, code: string | null | undefined, label: string | null) =>
      code && label && config && !config.valueLists[list]?.some((v) => v.code === code)
        ? `${label}${RETIRED_SUFFIX}`
        : label;
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">Solution</h2>
          </CardTitle>
          <PartLabel part="engineer" quote={quote} />
        </CardHeader>
        <CardContent>
          <KeyValueGrid
            items={[
              {
                label: 'Plant / site',
                value: shown('plant', review.plantCode, eng.selectedLabels.plantCode),
              },
              {
                // FB-16 (W13-12): one pick. The process below is derived from it; an old quote keeps
                // and shows the pair it was saved with.
                label: 'Process & machine type',
                value: shown('machine_type', review.machineType, eng.selectedLabels.machineType),
              },
              {
                label: eng.processPairLegacy ? 'Process (as saved)' : 'Process',
                value: shown('process_type', review.processType, eng.selectedLabels.processType),
              },
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
              { id: 'concept', label: 'Technical concept', value: review.technicalConceptNotes },
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
        <PartLabel part="engineer" quote={quote} />
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          noValidate
          data-testid="solution-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {/* FB-16 (W13-13): the plant comes first; it decides which machine types are offered. */}
            <Field
              label={req('Plant / site', 'plant_code')}
              hint="Agreed by Engineering, Operations and Supply Chain"
              error={errorFor(errors, 'plantCode')}
            >
              {(id) => (
                <ValueListSelect
                  id={id}
                  list="plant"
                  value={form.plantCode}
                  retiredLabel={eng.selectedLabels.plantCode}
                  onChange={setPlant}
                />
              )}
            </Field>
            <Field
              label={req('Process & machine type', 'machine_type')}
              hint={machineHint}
              error={errorFor(errors, 'machineType') ?? cleared ?? undefined}
            >
              {(id) => (
                <ValueListSelect
                  id={id}
                  list="machine_type"
                  options={offered}
                  outsideSuffix=" (not run at this plant)"
                  value={form.machineType}
                  retiredLabel={eng.selectedLabels.machineType}
                  onChange={setMachine}
                />
              )}
            </Field>
            {/* The process is derived from the pick (machine_type_process_map); it is shown, not chosen. */}
            <div className="grid content-start gap-1.5" data-testid="derived-process">
              <span className="text-sm font-medium">Process</span>
              <span className="flex min-h-9 items-center text-sm">
                {processShown ?? (
                  <span className="text-muted-foreground">Set by the process & machine type</span>
                )}
              </span>
              <span className="text-muted-foreground text-xs">
                {eng.processPairLegacy && machineUnchanged
                  ? 'Saved before the single pick: kept as it is until you pick again.'
                  : 'Follows the process & machine type. Not picked separately.'}
              </span>
            </div>
            <Field
              label={req('Cavitation', 'cavitation')}
              hint="A whole number, 1 to 99"
              error={inputError('cavitation') ?? errorFor(errors, 'cavitation')}
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
            <Field
              label={req('Cycle time (s)', 'cycle_time_s')}
              error={inputError('cycleTimeS') ?? errorFor(errors, 'cycleTimeS')}
            >
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
                  ? `${BUDGETARY_CAPITAL_HELP} Your role cannot see the saved figure. Leave this blank to keep it.`
                  : `${BUDGETARY_CAPITAL_HELP} Saving it updates the quote’s priority score.`
              }
              error={inputError('prelimCapitalUsd') ?? errorFor(errors, 'prelimCapitalUsd')}
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
            label="Supply Chain"
            hint="What Supply Chain says about the chosen plant: network, resin and freight"
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
            <Button type="submit" disabled={!changed || invalid || save.isPending}>
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
    machineType: review.machineType ?? '',
    plantCode: review.plantCode ?? '',
    cavitation: review.cavitation?.toString() ?? '',
    cycleTimeS: review.cycleTimeS?.toString() ?? '',
    toolingNotes: review.toolingNotes ?? '',
    prelimCapitalUsd: review.prelimCapitalUsd?.toString() ?? '',
    technicalConceptNotes: review.technicalConceptNotes ?? '',
    supplyChainNotes: review.supplyChainNotes ?? '',
  };
}

// ── Capacity sign-off (B-26, B5) ─────────────────────────────────────────────────────────────────

const SIGNOFF_LABEL = { approved: 'Capacity approved', blocked: 'Capacity blocked' } as const;

/**
 * The capacity owner's sign-off (B-26, deck slide 9): G2 "Advance" needs capacity approved, not just
 * the evidence rows. Blocking needs a note. Changing the solution does **not** clear an approval (the
 * card says so).
 *
 * FB-16 (W13-15, W13-17, W13-18): recorded by the production scheduler assigned to the quote, or the
 * EngLead (`capacity.signoff`). Everyone sees the status; the buttons are for the scheduler, and for the
 * lead only when no scheduler is assigned (with one assigned, the lead approves capacity inside "Decide
 * feasibility" instead; the server still accepts the lead's sign-off here). A block sends the work
 * straight back to the engineer with the note.
 */
function CapacitySignoffCard({ quote }: { quote: QuoteDetail }) {
  const eng = quote.engineering;
  const signoff = eng.capacitySignoff;
  const me = useCurrentUser().user.id;
  const isScheduler = !!eng.assignedSchedulerId && eng.assignedSchedulerId === me;
  const showButtons = eng.canSignOffCapacity && (isScheduler || !eng.assignedSchedulerId);
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
        ...(status === 'blocked'
          ? { description: 'The work is back with the engineer, who has been told why.' }
          : {}),
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
        <PartLabel part="scheduler" quote={quote} />
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm" role="status" data-testid="capacity-signoff-status">
          {signoff.status ? (
            <>
              <span
                className={
                  signoff.status === 'blocked' ? 'text-destructive font-semibold' : 'font-medium'
                }
              >
                {SIGNOFF_LABEL[signoff.status]}
              </span>
              {signoff.byName ? ` by ${signoff.byName}` : ''}
              {signoff.at ? ` on ${absoluteTime(signoff.at)}` : ''}
              {signoff.note ? `: ${signoff.note}` : ''}
            </>
          ) : (
            <span className="text-muted-foreground">
              Not signed off yet. The quote can only advance once capacity is approved.
            </span>
          )}
        </p>
        <p className="text-muted-foreground text-xs" data-testid="capacity-signoff-help">
          Changing the solution does not clear an approval: check capacity again if the plant, the
          machine or the cycle time changes.
          {signoff.status === 'blocked' &&
            ' While capacity is blocked the quote cannot advance; it is approved again here.'}
          {eng.canSignOffCapacity &&
            !showButtons &&
            ' The production scheduler signs capacity off. If they have not, you can approve it yourself when you decide feasibility.'}
        </p>
        {showButtons && (
          <div className="grid gap-3">
            <Field
              label="Sign-off note"
              hint="Only needed if you block capacity: say why. Blocking sends the work back to the engineer with this note."
              error={errorFor(errors, 'note')}
            >
              {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <FormErrors errors={errors.filter((e) => e.path !== '/note')} />
            <div className="flex flex-wrap gap-2">
              {/* Only the choices that change something: an approved sign-off does not offer Approve again. */}
              {signoff.status !== 'approved' && (
                <Button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => save.mutate('approved')}
                >
                  Approve capacity
                </Button>
              )}
              {signoff.status !== 'blocked' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={save.isPending || note.trim() === ''}
                  onClick={() => save.mutate('blocked')}
                >
                  Block capacity
                </Button>
              )}
              {signoff.status && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => save.mutate(null)}
                >
                  Undo sign-off
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

/** DR-engineering-01: row errors shown under their own field (not listed again below the table). */
const CAPACITY_INLINE =
  /^\/rows\/\d+\/(site|assumedEffectivenessPct|cycleTimeS|utilizationBeforePct|allocatedAnnualVolume|scheduledRunDaysPerYear|analysisDate)$/;
const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

/**
 * FB-16 (W13-21): at or below the target is green, above it amber, above 100 % red. The words carry the
 * meaning too ("above 85%", "exceeds line capacity"), so colour is never the only signal.
 */
const LEVEL_CLASS: Record<UtilizationLevel, string> = {
  ok: 'font-medium text-emerald-700 dark:text-emerald-400',
  warn: 'font-semibold text-amber-700 dark:text-amber-400',
  over: 'text-destructive font-semibold',
};

/** FB-16 (W13-20): the capacity row's numeric inputs and the contract rule each is checked against. */
const ROW_RULES = [
  ['assumedEffectivenessPct', 'assumedEffectivenessPct', 'Assumed effectiveness %'],
  ['cycleTimeS', 'rowCycleTimeS', 'Cycle time (s)'],
  ['utilizationBeforePct', 'utilizationBeforePct', 'Utilization before %'],
  ['allocatedAnnualVolume', 'allocatedAnnualVolume', 'Allocated annual volume'],
  ['scheduledRunDaysPerYear', 'scheduledRunDaysPerYear', 'Scheduled run days per year'],
] as const satisfies readonly (readonly [keyof RowForm, EngInputField, string])[];
type RowNumberField = (typeof ROW_RULES)[number][0];

/** What is wrong with each numeric input of a row as typed (the server's own rules and words). */
function rowInputErrors(row: RowForm): Partial<Record<RowNumberField, string>> {
  const out: Partial<Record<RowNumberField, string>> = {};
  for (const [field, rule] of ROW_RULES) {
    const message = engInputError(rule, row[field]);
    if (message) out[field] = message;
  }
  return out;
}

/**
 * The first problem, worded for the utilization preview: the real reason nothing is calculated ("Enter an
 * assumed effectiveness above 0%, up to 100%"), not "Calculated once…".
 */
function rowProblem(row: RowForm): string | null {
  const found = rowInputErrors(row);
  for (const [field, , label] of ROW_RULES) {
    const message = found[field];
    if (!message) continue;
    // The effectiveness message names its own field; the others are short ("Enter 0 to 100%").
    return field === 'assumedEffectivenessPct' ? message : `${label}: ${message}`;
  }
  return null;
}

/**
 * Utilization after the new business: calculated, never typed (F-059). Over 100 % is red with "exceeds line
 * capacity"; over the basis' warning threshold, amber; at or below it, green. One decimal place.
 */
function UtilizationAfter({
  pct,
  basis,
  problem = null,
  testId = 'utilization-after',
}: {
  pct: number | null;
  basis: EngineeringDetail['capacityBasis'];
  /** FB-16 (W13-20): an input is out of range, so nothing can be calculated; say which. */
  problem?: string | null;
  testId?: string;
}) {
  if (problem) {
    return (
      <span className="text-destructive text-sm" data-testid={testId} data-problem="true">
        {problem}
      </span>
    );
  }
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
  // FB-14 (Capacity Exhibit): capacity at a glance, from the row's own inputs (OEE once; practical at
  // the row's run days or capacity_basis). Read-only; it changes no utilization figure and no G2 rule.
  const glanceOf = (row: RowForm) => (
    <CapacityGlanceTable
      glance={capacityAtAGlance({
        cycleTimeS: num(row.cycleTimeS),
        cavitation,
        effectivenessPct: num(row.assumedEffectivenessPct),
        scheduledRunDaysPerYear: num(row.scheduledRunDaysPerYear) ?? basis.scheduledRunDaysPerYear,
        partWeightG: quote.intakeFacts.gramWeightG,
      })}
    />
  );
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

  // A plant taken off the list keeps its own name on the row (FB-09 retired labels).
  const retiredSite = (code: string) => config?.retiredValues?.plant?.[code] ?? null;
  const siteLabel = (code: string) =>
    config?.valueLists.plant?.find((v) => v.code === code)?.label ?? retiredSite(code) ?? code;
  // FB-16 (W13-13): a row's Site offers the plants that run the solution's machine type (all of them
  // while no machine type is chosen).
  const sitePlants = plantsRunning(
    config?.valueLists.plant ?? [],
    eng.review.machineType ? [eng.review.machineType] : [],
  );
  // FB-16 (W13-20): every row's numbers are checked as typed; Save waits until they are all valid.
  const rowErrors = rows.map(rowInputErrors);
  const invalid = rowErrors.some((e) => Object.keys(e).length > 0);

  const volumeText = (n: number | null) => (n === null ? null : n.toLocaleString('en-US'));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Capacity evidence</h2>
        </CardTitle>
        <PartLabel part="scheduler" quote={quote} />
        <p className="text-muted-foreground text-sm">
          Add at least one row before the quote can advance. Enter how loaded the line is today;
          QuoteFlow calculates the load with this business added. No effectiveness figure is assumed
          for you.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {rows.length === 0 && (
          <p className="text-muted-foreground text-sm" data-testid="no-capacity">
            No capacity evidence yet.
          </p>
        )}
        {!eng.canEditCapacity && rows.length > 0 && (
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
                {!hidden && glanceOf(r)}
              </li>
            ))}
          </ul>
        )}
        {eng.canEditCapacity && (
          <form
            className="grid gap-4"
            noValidate
            data-testid="capacity-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!invalid) save.mutate();
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
                  <Field
                    label="Site"
                    hint={
                      eng.selectedLabels.machineType
                        ? `Plants that run ${eng.selectedLabels.machineType}`
                        : undefined
                    }
                    error={errorFor(errors, `rows/${i}/site`)}
                  >
                    {(id) => (
                      <ValueListSelect
                        id={id}
                        list="plant"
                        options={sitePlants}
                        outsideSuffix=" (does not run the solution’s machine type)"
                        value={r.site}
                        // FB-16: the row's own plant name, not the solution plant's.
                        retiredLabel={retiredSite(r.site)}
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
                    hint={
                      hidden && r.id
                        ? 'Your role cannot see the saved figure. Leave blank to keep it.'
                        : DF22_HELP
                    }
                    error={
                      rowErrors[i]?.assumedEffectivenessPct ??
                      errorFor(errors, `rows/${i}/assumedEffectivenessPct`)
                    }
                  >
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        // DR-engineering-02: 0% gives no capacity; the API refuses it.
                        min={0.1}
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
                  <Field
                    label="Cycle time (s)"
                    error={rowErrors[i]?.cycleTimeS ?? errorFor(errors, `rows/${i}/cycleTimeS`)}
                  >
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
                    hint="How loaded the line is today, before this business"
                    error={
                      rowErrors[i]?.utilizationBeforePct ??
                      errorFor(errors, `rows/${i}/utilizationBeforePct`)
                    }
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
                        ? `Leave blank to use the quote’s ${eng.quoteAnnualVolume.toLocaleString('en-US')}. If the business is split across lines, enter each line’s share.`
                        : 'The quote has no estimated volume: enter this line’s share.'
                    }
                    error={
                      rowErrors[i]?.allocatedAnnualVolume ??
                      errorFor(errors, `rows/${i}/allocatedAnnualVolume`)
                    }
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
                    hint={`Leave blank to use ${basis.scheduledRunDaysPerYear}`}
                    error={
                      rowErrors[i]?.scheduledRunDaysPerYear ??
                      errorFor(errors, `rows/${i}/scheduledRunDaysPerYear`)
                    }
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
                      <UtilizationAfter pct={afterOf(r)} basis={basis} problem={rowProblem(r)} />
                    </output>
                    <span className="text-muted-foreground text-xs">Read-only. Not typed.</span>
                  </div>
                  <div className="sm:col-span-4">{glanceOf(r)}</div>
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
            <FormErrors errors={errors} inline={(p) => CAPACITY_INLINE.test(p)} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={add}>
                <PlusIcon aria-hidden="true" />
                Add capacity row
              </Button>
              <Button type="submit" disabled={!dirty || invalid || save.isPending}>
                {save.isPending ? 'Saving…' : 'Save capacity evidence'}
              </Button>
            </div>
          </form>
        )}
        {!eng.canEditCapacity && eng.allocationWarning && (
          <p
            className="text-sm text-amber-700 dark:text-amber-400"
            data-testid="allocation-warning-view"
          >
            {eng.allocationWarning}
          </p>
        )}
        <p className="text-muted-foreground text-xs" data-testid="capacity-basis">
          How this is calculated: {basis.basisLabel}. A line runs {basis.scheduledRunDaysPerYear}{' '}
          days a year unless you enter another number. Utilization after is green up to{' '}
          {basis.warnAbovePct}%, amber above it and red above 100%.
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
  options: offered,
  outsideSuffix = '',
  value,
  retiredLabel,
  onChange,
}: {
  id: string;
  list: string;
  /** FB-16 (W13-13): a narrower set to offer (what the plant runs); default: the whole active list. */
  options?: readonly PublicValueListEntry[];
  /** What to say after a saved value that is still active but outside `options` (an old quote). */
  outsideSuffix?: string;
  value: string;
  /** The label of the stored value, shown when the list no longer offers it (F-057: the EBM wheel). */
  retiredLabel?: string | null;
  onChange: (v: string) => void;
}) {
  const { data: config } = usePublicConfig();
  const active = config?.valueLists[list] ?? [];
  const options = offered ?? active;
  const retired = value !== '' && !active.some((v) => v.code === value);
  // Still an active code, but not one this picker offers: kept visible so it is not silently dropped.
  const outside =
    value !== '' && !retired && !options.some((v) => v.code === value)
      ? active.find((v) => v.code === value)
      : undefined;
  // Bailey Schmitt (2026-11-12): alphabetical, so a value is found by its name; "Other" stays last.
  const isOther = (label: string) => /^other\b/i.test(label);
  const sorted = [...options].sort(
    (a, b) => Number(isOther(a.label)) - Number(isOther(b.label)) || a.label.localeCompare(b.label),
  );
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {retired && <option value={value}>{`${retiredLabel ?? value} (no longer offered)`}</option>}
      {outside && <option value={value}>{`${outside.label}${outsideSuffix}`}</option>}
      {sorted.map((v) => (
        <option key={v.code} value={v.code}>
          {v.label}
        </option>
      ))}
    </NativeSelect>
  );
}

const glanceNumber = (v: number) => Math.round(v).toLocaleString('en-US');

/** FB-14: the Capacity Exhibit's three definitions for one row (nothing shown until the inputs are in). */
function CapacityGlanceTable({ glance }: { glance: CapacityGlance | null }) {
  if (!glance) return null;
  const rows: [string, CapacityFigure][] = [
    ['Theoretical (24/7/365 at 100%)', glance.theoretical],
    ['Expected (24/7/365 at effectiveness)', glance.expected],
    [`Practical (${glance.runDaysPerYear} run days at effectiveness)`, glance.practical],
  ];
  const lbs = glance.theoretical.lbsPerDay !== null;
  return (
    <details className="text-xs" data-testid="capacity-glance">
      <summary className="text-muted-foreground cursor-pointer">
        Capacity at a glance (calculated from the row above)
      </summary>
      <table className="mt-1 w-full text-left tabular-nums">
        <thead className="text-muted-foreground">
          <tr>
            <th className="font-normal">Parts</th>
            <th className="text-right font-normal">Per day</th>
            <th className="text-right font-normal">Per year</th>
            {lbs && <th className="text-right font-normal">Lb per year</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label}>
              <th className="font-normal">{label}</th>
              <td className="text-right">{glanceNumber(f.perDay)}</td>
              <td className="text-right">{glanceNumber(f.perYear)}</td>
              {lbs && <td className="text-right">{glanceNumber(f.lbsPerYear ?? 0)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground mt-1">
        These figures are calculated from the row above and cannot be edited.
      </p>
    </details>
  );
}
