import type {
  CapitalReadiness,
  PricingRecordBody,
  PricingRecordView,
  QuoteDetail,
  QuotingDetail,
} from '@ccq/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, CircleAlertIcon, EyeOffIcon } from 'lucide-react';
import { useState } from 'react';

import { useCurrentUser } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { usePublicConfig } from '@/config/public-config';
import { api } from '@/lib/api';
import { absoluteTime, toLocalInput } from '@/lib/time';
import { toast } from '@/lib/toast';

import { Field, FormErrors, errorFor, problemErrors, type ServerError } from '../forms';
import { quoteQueryKey } from '../GateDecisionDialog';
import { KeyValueGrid } from '../KeyValueGrid';
import { LeadReviewPanel } from '../LeadReviewPanel';
import { timelineQueryKey } from '../Overrides';
import { PricerAssignDialog, pricingQueueQueryKey } from './PricerAssignDialog';
import {
  PricingContextPanel,
  pricingContextQueryKey,
  type ReferenceKind,
} from './PricingContextPanel';

export { pricingQueueQueryKey };

export const CAPITAL_LABELS: Record<CapitalReadiness, string> = {
  not_required: 'Not required',
  pending: 'Pending',
  pre_approved: 'Pre-approved',
  not_approved: 'Not approved',
};

const splitRefs = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((r) => r.trim())
    .filter(Boolean);

/**
 * The quote's "Quoting" tab (B-11, CR-25/26, DEC-19/20/23). Pricing records the price APPROVAL as a
 * decision (who, when, on what basis, an optional legacy ERF #), the costing attestation and the capital readiness, then submits
 * to Final Review (G3). There is no price figure to edit anywhere (PRD §9). Everything here except
 * the approval status is commercial: the API strips it for KAMs, Engineers and SalesLeaders.
 */
export function QuotingTab({
  quote,
  onDecide,
}: {
  quote: QuoteDetail;
  onDecide: (outcomeKey?: string) => void;
}) {
  const quoting = quote.quoting;
  const canDecideG3 = quote.availableActions.some((a) => a.gateKey === 'G3');
  const record = quoting.pricingRecord ?? null;
  return (
    <div className="grid gap-6" data-testid="quoting-tab">
      <ApprovalStatus quoting={quoting} passThrough={quote.commercial.passThroughEligible} />
      <PricerAssignment quote={quote} />
      <PricingLeadReview quote={quote} />
      {quoting.commercialRedacted ? (
        <p
          className="bg-secondary flex items-start gap-2 rounded-md px-3 py-2 text-sm"
          data-testid="quoting-redacted"
        >
          <EyeOffIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Pricing details, references and capital readiness are commercial. Your role sees whether
          the price is approved, by whom and when.
        </p>
      ) : (
        <>
          {record && record.warnings.length > 0 && <Warnings record={record} />}
          {canDecideG3 && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onDecide('submit')}>Advance to Final Review…</Button>
              <Button variant="outline" onClick={() => onDecide('rework')}>
                Return to Engineering…
              </Button>
              <Button variant="ghost" onClick={() => onDecide()}>
                Hold or stop…
              </Button>
            </div>
          )}
          <EngineeringSummary quote={quote} />
          <PricingContextForQuote quote={quote} />
          <PricingRecordCard key={`${quote.version}-${record?.updatedAt ?? ''}`} quote={quote} />
          <CapitalCard key={`cap-${quote.version}-${record?.updatedAt ?? ''}`} quote={quote} />
          <History records={quoting.pricingRecords ?? []} />
        </>
      )}
    </div>
  );
}

/**
 * Who prices this quote, and (for the pricing lead) Assign… / Reassign… right here, like the
 * Engineering tab's assigned engineer. The picker loads the pricers' open load from the queue.
 */
function PricerAssignment({ quote }: { quote: QuoteDetail }) {
  const quoting = quote.quoting;
  const [assigning, setAssigning] = useState(false);
  const picker = useQuery({
    queryKey: [...pricingQueueQueryKey, 'picker'],
    queryFn: () => api.pricingQueue({ q: quote.quoteNumber }),
    enabled: assigning,
  });
  if (!quoting.inQuoting && !quoting.assignedPricerId) return null;
  return (
    <section
      className="bg-card rounded-card flex flex-wrap items-center gap-3 border p-4 text-sm"
      data-testid="pricer-assignment"
    >
      <span>
        <span className="font-semibold">Pricer:</span>{' '}
        {quoting.assignedPricerName ? (
          <span data-testid="assigned-pricer">
            {quoting.assignedPricerName}
            {quoting.pricerAssignedAt
              ? ` (assigned ${absoluteTime(quoting.pricerAssignedAt)})`
              : ''}
          </span>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </span>
      {quoting.canAssign && (
        <Button variant="outline" size="sm" onClick={() => setAssigning(true)}>
          {quoting.assignedPricerId ? 'Reassign…' : 'Assign…'}
        </Button>
      )}
      {assigning && picker.data && (
        <PricerAssignDialog
          open
          onOpenChange={setAssigning}
          quoteNumbers={[quote.quoteNumber]}
          pricers={picker.data.pricers}
          currentPricerId={quoting.assignedPricerId}
        />
      )}
    </section>
  );
}

function ApprovalStatus({
  quoting,
  passThrough,
}: {
  quoting: QuotingDetail;
  passThrough: boolean;
}) {
  const a = quoting.approval;
  return (
    <section
      role="status"
      data-testid="price-approval-status"
      data-approved={a.approved}
      className="bg-card rounded-card flex items-center gap-2 border p-4 text-sm"
    >
      {a.approved ? (
        <>
          <CheckCircle2Icon className="text-emphasis size-5" aria-hidden="true" />
          <span>
            <span className="font-semibold">Price approved ✓</span> on{' '}
            {a.approvedAt ? absoluteTime(a.approvedAt) : '–'}
            {a.approvedByName ? ` by ${a.approvedByName}` : ''}
            {a.quoteVersion > 1 ? ` (version ${a.quoteVersion})` : ''}
          </span>
        </>
      ) : (
        <>
          <CircleAlertIcon className="text-muted-foreground size-5" aria-hidden="true" />
          <span>
            {passThrough ? (
              <span data-testid="price-approval-not-required">
                Price approval not required: below the pass-through threshold (D-24).
              </span>
            ) : (
              <>
                Price approval not recorded yet
                {a.quoteVersion > 1 ? ` for version ${a.quoteVersion}` : ''}.
              </>
            )}
          </span>
        </>
      )}
    </section>
  );
}

function Warnings({ record }: { record: PricingRecordView }) {
  return (
    <section
      className="bg-warning text-warning-foreground rounded-card grid gap-1 p-4 text-sm"
      data-testid="quoting-warnings"
    >
      <p className="font-semibold">Final Review will see:</p>
      <ul className="list-disc pl-5">
        {record.warnings.map((w) => (
          <li key={w.code}>{w.message}</li>
        ))}
      </ul>
    </section>
  );
}

/** Lead review: the pricer submits to the pricing lead, who may send it back. */
function PricingLeadReview({ quote }: { quote: QuoteDetail }) {
  const refresh = useRefresh(quote.quoteNumber);
  return (
    <LeadReviewPanel
      kind="pricing"
      review={quote.quoting.leadReview}
      submit={() => api.submitQuotingToLead(quote.quoteNumber)}
      sendBack={(note) => api.sendBackQuoting(quote.quoteNumber, note)}
      onDone={(detail) => refresh(detail)}
    />
  );
}

function useRefresh(quoteNumber: string) {
  const queryClient = useQueryClient();
  return (detail: QuotingDetail) => {
    queryClient.setQueryData<QuoteDetail>(quoteQueryKey(quoteNumber), (q) =>
      q ? { ...q, quoting: detail } : q,
    );
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) }),
      queryClient.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) }),
      queryClient.invalidateQueries({ queryKey: pricingQueueQueryKey }),
      queryClient.invalidateQueries({ queryKey: pricingContextQueryKey(quoteNumber) }),
    ]);
  };
}

/**
 * B-15: the pricing history panel (the retired pricing app's export, imported). "Use as reference"
 * adds the legacy ERF to the current version's pricing record through the B-11 route (format-checked
 * there); the server then sets the quote's ERF number if it has none. Unsaved edits in the approval
 * form below are reloaded from the server.
 */
function PricingContextForQuote({ quote }: { quote: QuoteDetail }) {
  const refresh = useRefresh(quote.quoteNumber);
  const record = quote.quoting.pricingRecord ?? null;
  const add = useMutation({
    mutationFn: ({ value }: { kind: ReferenceKind; value: string }) =>
      api.updatePricingRecord(quote.quoteNumber, {
        erfRefs: [...(record?.erfRefs ?? []), value],
      }),
    onSuccess: async (detail, { value }) => {
      await refresh(detail);
      toast.success({ title: `Added ${value} to the legacy ERF references` });
    },
    onError: (err) => {
      const [first] = problemErrors(err);
      toast.error({ title: 'Could not add the reference', description: first?.message ?? '' });
    },
  });
  return (
    <PricingContextPanel
      quoteNumber={quote.quoteNumber}
      refFormats={quote.quoting.refFormats}
      pendingReference={add.isPending ? add.variables.value : null}
      onUseReference={(kind, value) => add.mutate({ kind, value })}
    />
  );
}

/** What Engineering handed over (read-only): Pricing reads the commercial numbers. */
function EngineeringSummary({ quote }: { quote: QuoteDetail }) {
  const { data: config } = usePublicConfig();
  const eng = quote.engineering;
  const g2 = quote.quoting.g2;
  const label = (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Engineering summary</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <KeyValueGrid
          items={[
            {
              id: 'g2',
              label: 'G2 outcome',
              value: g2 ? (
                <span data-testid="quoting-g2">
                  {g2.outcomeLabel}
                  <span className="text-muted-foreground text-xs">
                    {' '}
                    · {g2.decidedByName ?? 'Unknown'} · {absoluteTime(g2.decidedAt)}
                  </span>
                </span>
              ) : null,
            },
            { id: 'g2-note', label: 'Engineering note', value: g2?.note },
            { label: 'Process', value: label('process_type', eng.review.processType) },
            { label: 'Machine', value: label('machine_type', eng.review.machineType) },
            { label: 'Plant / site', value: label('plant', eng.review.plantCode) },
            { label: 'Cavitation', value: eng.review.cavitation?.toString() },
            { label: 'Cycle time (s)', value: eng.review.cycleTimeS?.toString() },
            {
              label: 'Preliminary capital',
              value:
                eng.review.prelimCapitalUsd != null
                  ? `$${eng.review.prelimCapitalUsd.toLocaleString('en-US')}`
                  : null,
            },
            { id: 'concept', label: 'Technical concept', value: eng.review.technicalConceptNotes },
          ]}
        />
        {eng.capacityEvidence.length > 0 && (
          <div className="grid gap-1 text-sm">
            <h3 className="font-medium">Capacity evidence</h3>
            <ul className="text-foreground-2 grid gap-1" data-testid="quoting-capacity">
              {eng.capacityEvidence.map((r) => (
                <li key={r.id}>
                  {label('plant', r.site)}
                  {r.lineAsset ? ` · ${r.lineAsset}` : ''} · effectiveness{' '}
                  {r.assumedEffectivenessPct ?? '–'}% · utilization {r.utilizationPct ?? '–'}% ·
                  cycle {r.cycleTimeS ?? '–'} s
                  {r.bufferPct != null ? ` · buffer ${r.bufferPct}%` : ''}{' '}
                  <span className="text-muted-foreground text-xs">
                    ({r.analystName ?? 'Unknown'}, {r.analysisDate})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PricingRecordCard({ quote }: { quote: QuoteDetail }) {
  const quoting = quote.quoting;
  const record = quoting.pricingRecord ?? null;
  const me = useCurrentUser();
  const refresh = useRefresh(quote.quoteNumber);
  const meIsPricing = quoting.pricingUsers.some((u) => u.id === me.user.id);
  const initial = {
    approvedBy: record?.priceApprovedBy ?? (meIsPricing ? me.user.id : ''),
    approvedAt: toLocalInput(record?.priceApprovedAt),
    pricingBasisNote: record?.pricingBasisNote ?? '',
    approvedRangeNote: record?.approvedRangeNote ?? '',
    erfRefs: (record?.erfRefs ?? []).join(', '),
    costingCompleted: record?.costingCompleted ?? false,
  };
  // What is stored: the defaulted approver (the caller) and time are a change until saved.
  const stored = {
    ...initial,
    approvedBy: record?.priceApprovedBy ?? '',
    approvedAt: record?.priceApprovedAt ? initial.approvedAt : '',
  };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<ServerError[]>([]);
  const set =
    <K extends keyof typeof form>(k: K) =>
    (v: (typeof form)[K]) =>
      setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      // Only what changed: re-saving must not move the recorded approval time.
      const body: PricingRecordBody = {};
      const changed = (k: keyof typeof form) => form[k] !== stored[k];
      if (changed('approvedBy') || changed('approvedAt')) {
        body.approvedBy = form.approvedBy || null;
        body.approvedAt = form.approvedBy ? new Date(form.approvedAt).toISOString() : null;
      }
      if (changed('pricingBasisNote')) body.pricingBasisNote = form.pricingBasisNote;
      if (changed('approvedRangeNote')) body.approvedRangeNote = form.approvedRangeNote;
      if (changed('erfRefs')) body.erfRefs = splitRefs(form.erfRefs);
      if (changed('costingCompleted')) body.costingCompleted = form.costingCompleted;
      return api.updatePricingRecord(quote.quoteNumber, body);
    },
    onSuccess: async (detail) => {
      setErrors([]);
      await refresh(detail);
      toast.success({
        title: detail.approval.approved ? 'Price approval recorded' : 'Pricing record saved',
      });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });
  const refError = errors.find(
    (e) => e.path === '/erfRefs' || e.path.startsWith('/erfRefs/'),
  )?.message;
  const passThrough = quote.commercial.passThroughEligible;

  if (!quoting.canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">Price approval record</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {record ? (
            <RecordView record={record} />
          ) : (
            <p className="text-muted-foreground text-sm">Nothing recorded for this version.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Price approval record</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5"
          noValidate
          data-testid="pricing-record-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <fieldset className="grid gap-4">
            <legend className="mb-2 text-sm font-semibold">Legacy reference</legend>
            <Field
              label="Legacy ERF #"
              hint={`Optional, transition only (B-26): the ${quoting.refFormats.erf.label}, if the opportunity started in the legacy ERF app. Separate with commas, e.g. ${quoting.refFormats.erf.example}. No gate needs it.`}
              error={refError}
            >
              {(id) => (
                <Input
                  id={id}
                  value={form.erfRefs}
                  onChange={(e) => set('erfRefs')(e.target.value)}
                />
              )}
            </Field>
          </fieldset>

          <fieldset className="grid gap-4">
            <legend className="mb-2 text-sm font-semibold">Costing (required before price)</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={form.costingCompleted}
                onChange={(e) => set('costingCompleted')(e.target.checked)}
                data-testid="costing-completed"
              />
              Costing completed (Cost-to-Serve)
              <span className="text-muted-foreground text-xs">
                Required to submit to Final Review (G3). Attestation only (CR-25); costing stays in
                Excel and the pricing app.
              </span>
            </label>
            {record?.costingAttestedByName && record.costingCompleted && (
              <p className="text-muted-foreground text-xs">
                Ticked by {record.costingAttestedByName}
                {record.costingAttestedAt ? ` on ${absoluteTime(record.costingAttestedAt)}` : ''}.
              </p>
            )}
          </fieldset>

          <fieldset className="grid gap-4">
            <legend className="mb-2 text-sm font-semibold">Approval</legend>
            {passThrough && (
              <p
                className="bg-secondary rounded-md px-3 py-2 text-sm"
                data-testid="pass-through-notice"
              >
                This quote is below the pricing pass-through threshold (D-24): a price approval is
                not required at G3. Costing must still be attested.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Approved by" error={errorFor(errors, 'approvedBy')}>
                {(id) => (
                  <NativeSelect
                    id={id}
                    value={form.approvedBy}
                    onChange={(e) => set('approvedBy')(e.target.value)}
                  >
                    <option value="">Not approved yet</option>
                    {quoting.pricingUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Approved at" error={errorFor(errors, 'approvedAt')}>
                {(id) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    value={form.approvedAt}
                    disabled={!form.approvedBy}
                    onChange={(e) => set('approvedAt')(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Pricing basis"
              hint="e.g. resin index month, FOB terms. No price figures are kept in CCQ."
              error={errorFor(errors, 'pricingBasisNote')}
            >
              {(id) => (
                <Textarea
                  id={id}
                  value={form.pricingBasisNote}
                  onChange={(e) => set('pricingBasisNote')(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Approved negotiation range"
              hint="In words. Guardrails are still open (D-10)."
              error={errorFor(errors, 'approvedRangeNote')}
            >
              {(id) => (
                <Textarea
                  id={id}
                  value={form.approvedRangeNote}
                  onChange={(e) => set('approvedRangeNote')(e.target.value)}
                />
              )}
            </Field>
          </fieldset>
          <FormErrors
            errors={errors.filter(
              (e) => !e.path.match(/^\/\w+$/) && !e.path.startsWith('/erfRefs'),
            )}
          />
          <div>
            <Button
              type="submit"
              disabled={
                save.isPending ||
                (Object.keys(form) as (keyof typeof form)[]).every((k) => form[k] === stored[k])
              }
            >
              {save.isPending ? 'Saving…' : 'Save price approval'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CapitalCard({ quote }: { quote: QuoteDetail }) {
  const quoting = quote.quoting;
  const record = quoting.pricingRecord ?? null;
  const refresh = useRefresh(quote.quoteNumber);
  const capitalRequired = quoting.g2?.outcomeKey === 'capital_required';
  const [form, setForm] = useState({
    capitalReadiness: record?.capitalReadiness ?? '',
    cerReference: record?.cerReference ?? '',
    capitalNotes: record?.capitalNotes ?? '',
    capitalPendingJustification: record?.capitalPendingJustification ?? '',
  });
  const [errors, setErrors] = useState<ServerError[]>([]);
  const save = useMutation({
    mutationFn: () =>
      api.updateCapitalReadiness(quote.quoteNumber, {
        capitalReadiness: form.capitalReadiness as CapitalReadiness,
        cerReference: form.cerReference,
        capitalNotes: form.capitalNotes,
        capitalPendingJustification: form.capitalPendingJustification,
      }),
    onSuccess: async (detail) => {
      setErrors([]);
      await refresh(detail);
      toast.success({ title: 'Capital readiness saved' });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });

  if (!quoting.canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">Capital readiness</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValueGrid
            items={[
              {
                label: 'Status',
                value: record?.capitalReadiness ? CAPITAL_LABELS[record.capitalReadiness] : null,
              },
              { label: 'CER reference', value: record?.cerReference },
              { id: 'cap-notes', label: 'Notes', value: record?.capitalNotes },
              {
                id: 'cap-just',
                label: 'Pending justification',
                value: record?.capitalPendingJustification,
              },
            ]}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Capital readiness</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          noValidate
          data-testid="capital-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Status"
              hint={
                capitalRequired
                  ? 'Engineering said capital is required (G2), so it cannot be "Not required".'
                  : undefined
              }
              error={errorFor(errors, 'capitalReadiness')}
            >
              {(id) => (
                <NativeSelect
                  id={id}
                  value={form.capitalReadiness}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      capitalReadiness: e.target.value,
                    }))
                  }
                >
                  <option value="">Choose…</option>
                  {(Object.keys(CAPITAL_LABELS) as CapitalReadiness[]).map((v) => (
                    <option key={v} value={v} disabled={capitalRequired && v === 'not_required'}>
                      {CAPITAL_LABELS[v]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="CER reference" hint="Optional" error={errorFor(errors, 'cerReference')}>
              {(id) => (
                <Input
                  id={id}
                  value={form.cerReference}
                  onChange={(e) => setForm((f) => ({ ...f, cerReference: e.target.value }))}
                />
              )}
            </Field>
          </div>
          {form.capitalReadiness === 'pending' && (
            <Field
              label="Pending-capital justification"
              hint="Needed to submit to Final Review while capital is pending. Final Review sees it as a warning (D-11)."
              error={errorFor(errors, 'capitalPendingJustification')}
            >
              {(id) => (
                <Textarea
                  id={id}
                  value={form.capitalPendingJustification}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, capitalPendingJustification: e.target.value }))
                  }
                />
              )}
            </Field>
          )}
          <Field label="Capital notes" error={errorFor(errors, 'capitalNotes')}>
            {(id) => (
              <Textarea
                id={id}
                value={form.capitalNotes}
                onChange={(e) => setForm((f) => ({ ...f, capitalNotes: e.target.value }))}
              />
            )}
          </Field>
          <FormErrors errors={errors.filter((e) => !e.path.match(/^\/\w+$/))} />
          <div>
            <Button type="submit" disabled={!form.capitalReadiness || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save capital readiness'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RecordView({ record }: { record: PricingRecordView }) {
  return (
    <KeyValueGrid
      items={[
        { label: 'Approved by', value: record.priceApprovedByName },
        {
          label: 'Approved at',
          value: record.priceApprovedAt ? absoluteTime(record.priceApprovedAt) : null,
        },
        { id: 'basis', label: 'Pricing basis', value: record.pricingBasisNote },
        { id: 'range', label: 'Approved range', value: record.approvedRangeNote },
        { label: 'Legacy ERF #', value: record.erfRefs.join(', ') || null },
        { label: 'Costing completed', value: record.costingCompleted ? 'Yes' : 'No' },
        {
          label: 'Capital readiness',
          value: record.capitalReadiness ? CAPITAL_LABELS[record.capitalReadiness] : null,
        },
        { label: 'CER reference', value: record.cerReference },
      ]}
    />
  );
}

/** Prior versions' records (CR-38: kept, never edited). */
function History({ records }: { records: PricingRecordView[] }) {
  if (records.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Earlier versions</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3" data-testid="pricing-history">
        {records.map((r) => (
          <details key={r.quoteVersion} className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">
              Version {r.quoteVersion}
              {r.priceApprovedAt
                ? ` · approved ${absoluteTime(r.priceApprovedAt)}${r.priceApprovedByName ? ` by ${r.priceApprovedByName}` : ''}`
                : ' · not approved'}
            </summary>
            <div className="mt-2">
              <RecordView record={r} />
            </div>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}
