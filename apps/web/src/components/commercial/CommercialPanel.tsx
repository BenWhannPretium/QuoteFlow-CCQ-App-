import type {
  CommercialDetail,
  EngineeringTermsBody,
  QuoteDetail,
  TermsBody,
} from '@ccq/contracts';
import { isNonStandardPaymentTerms } from '@ccq/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MegaphoneIcon, ScaleIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { usePublicConfig, useValueList } from '@/config/public-config';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';

import { Field, FormErrors, errorFor, problemErrors, type ServerError } from '../forms';
import { quoteQueryKey } from '../GateDecisionDialog';
import {
  CustomerRequested,
  NonStandardTermsBadge,
  standardTermsFrom,
} from '../intake/CommercialInputs';
import { KeyValueGrid } from '../KeyValueGrid';
import { timelineQueryKey } from '../Overrides';
import { SectionLockLine } from '../SectionLockLine';
import { CapitalTerms } from './CapitalTerms';
import { FundingHelp } from './FundingHelp';
import { AdditionalApprovals, TermsExceptionCard } from './TermsException';

// B-26 (CCQ demo and the future-state process deck): the quote's commercial controls. The early
// "capital likely" flag (Capital Management awareness, not approval), the terms check and Legal review
// that G4 Advance needs, the pass-through indicator, the hold owner and escalations. None of it is a
// price, margin or capital figure. The server decides who may change what (the can* flags only guide).

const yesNo = (v: boolean | null) => (v === null ? null : v ? 'Yes' : 'No');

export function CommercialPanel({ quote }: { quote: QuoteDetail }) {
  const c = quote.commercial;
  return (
    // `id`: the Final Review screen links here for an open terms / Legal check (FB-01, F-069).
    <Card id="commercial" data-testid="commercial-panel">
      <CardHeader>
        <CardTitle>
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <ScaleIcon className="size-4" aria-hidden="true" />
            Commercial terms
            {c.passThroughEligible && (
              <span
                data-testid="pass-through-chip"
                title="Below the pricing pass-through threshold: the price may proceed without formal approval."
                className="bg-secondary text-foreground rounded-pill px-2 py-0.5 text-xs font-semibold"
              >
                Pass-through eligible
              </span>
            )}
            {c.legal.required && (
              <span
                data-testid="legal-required-chip"
                className="bg-warning text-warning-foreground rounded-pill px-2 py-0.5 text-xs font-semibold"
              >
                Legal review required
              </span>
            )}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        {quote.status === 'on_hold' && (
          <p className="text-sm" data-testid="hold-owner-display">
            <span className="font-medium">Hold owner:</span> {c.hold.ownerName ?? 'Not named'}
            {quote.reviewDate ? ` · review by ${quote.reviewDate}` : ''}
          </p>
        )}
        <CapitalFlag quote={quote} />
        <CustomerRequested quote={quote} />
        <TermsEditor
          key={`${c.terms.checkedAt}|${c.legal.reviewedOn}|${c.terms.termsPaymentTermsCode}|${c.terms.exception?.status}`}
          quote={quote}
        />
        <EscalateSection quote={quote} />
      </CardContent>
    </Card>
  );
}

function useApplyQuote(quote: QuoteDetail) {
  const queryClient = useQueryClient();
  return async (next: QuoteDetail) => {
    queryClient.setQueryData(quoteQueryKey(quote.quoteNumber), next);
    await queryClient.invalidateQueries({ queryKey: timelineQueryKey(quote.quoteNumber) });
  };
}

/** B-26 (B1): flags capital as likely early so Capital Management hears about it before G3. */
function CapitalFlag({ quote }: { quote: QuoteDetail }) {
  const cap = quote.commercial.capital;
  const apply = useApplyQuote(quote);
  const [errors, setErrors] = useState<ServerError[]>([]);
  const save = useMutation({
    mutationFn: (capitalLikely: boolean) =>
      api.setCapitalFlag(quote.quoteNumber, { capitalLikely }),
    onSuccess: async (next) => {
      setErrors([]);
      await apply(next);
      toast.success({
        title: next.commercial.capital.likely
          ? 'Capital flagged as likely'
          : 'Capital flag cleared',
        ...(next.commercial.capital.noticeSentAt
          ? { description: 'Capital Management has been told (awareness, not approval).' }
          : {}),
      });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });
  return (
    <section aria-label="Capital" className="grid gap-2" data-testid="capital-flag">
      <SectionLockLine lock={cap.lock} />
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={cap.likely}
          disabled={!cap.canEdit || save.isPending}
          onChange={(e) => save.mutate(e.target.checked)}
        />
        Capital likely
      </label>
      <p className="text-muted-foreground text-xs">
        Gives Capital Management early notice (awareness, not approval). While it is set, the price
        can’t advance at G3 until capital readiness is confirmed (not required or pre-approved).
      </p>
      {(cap.setByName || cap.noticeSentAt) && (
        <p className="text-muted-foreground text-xs">
          {cap.setByName &&
            `Set by ${cap.setByName}${cap.setAt ? ` on ${absoluteTime(cap.setAt)}` : ''}. `}
          {cap.noticeSentAt && `Capital Management notified ${absoluteTime(cap.noticeSentAt)}.`}
        </p>
      )}
      <FormErrors errors={errors} />
    </section>
  );
}

/** Server error paths shown next to their field (the rest show under the form). */
const INLINE_TERMS_PATHS = new Set(
  [
    'termsToolingCommitment',
    'termsPaymentTermsCode',
    'termsPaymentTerms',
    'termsNonstandard',
    'termsToolingPayment',
    'termsMilestoneNote',
    'termsNotes',
    'legal/reviewedOn',
    'legal/reviewerName',
    'legal/note',
  ].map((p) => `/${p}`),
);

type TermsForm = {
  termsToolingCommitment: '' | 'yes' | 'no';
  termsPaymentTermsCode: string;
  termsPaymentTerms: string;
  termsNonstandard: boolean;
  termsToolingPayment: string;
  termsMilestoneNote: string;
  termsNotes: string;
  checked: boolean;
  legalReviewedOn: string;
  legalReviewerName: string;
  legalNote: string;
};

function termsFormFrom(c: CommercialDetail): TermsForm {
  const t = c.terms;
  return {
    termsToolingCommitment:
      t.termsToolingCommitment === null ? '' : t.termsToolingCommitment ? 'yes' : 'no',
    termsPaymentTermsCode: t.termsPaymentTermsCode ?? '',
    termsPaymentTerms: t.termsPaymentTerms ?? '',
    termsNonstandard: t.termsNonstandard,
    termsToolingPayment: t.termsToolingPayment ?? '',
    termsMilestoneNote: t.termsMilestoneNote ?? '',
    termsNotes: t.termsNotes ?? '',
    checked: t.checkedAt !== null,
    legalReviewedOn: c.legal.reviewedOn ?? '',
    legalReviewerName: c.legal.reviewerName ?? '',
    legalNote: c.legal.note ?? '',
  };
}

/**
 * FB-08 (F-021): with no payment terms recorded, the form starts from the customer's request at intake
 * (FB-11), or else `default_payment_terms` (provisional Net 30). Nothing is saved until someone saves.
 */
function withDefaultTerms(form: TermsForm, quote: QuoteDetail, fallback: string | null): TermsForm {
  if (form.termsPaymentTermsCode) return form;
  const requested = quote.intakeFacts.requestedPaymentTerms;
  if (requested) {
    return {
      ...form,
      termsPaymentTermsCode: requested,
      termsPaymentTerms: quote.intakeFacts.requestedPaymentTermsOther ?? form.termsPaymentTerms,
    };
  }
  return fallback ? { ...form, termsPaymentTermsCode: fallback } : form;
}

/** FB-08 (D-029): the milestones of a tooling-payment option ("50% at the order, 50% at qualification"). */
function milestoneText(meta: Record<string, unknown> | undefined): string | null {
  const list = meta?.milestones;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list
    .map(
      (m: { percent?: unknown; trigger?: unknown }) =>
        `${String(m.percent)}% ${String(m.trigger).toLowerCase()}`,
    )
    .join(', ');
}

/**
 * B-26 (B6, B8), FB-08: payment terms (a list; non-standard opens an exception for the pricing lead),
 * the tooling payment milestones, the terms check and, when a trigger applies, the Legal review. MOQ
 * and tooling funding are Engineering's (`EngineeringTerms`); the capital terms are `CapitalTerms`.
 */
function TermsEditor({ quote }: { quote: QuoteDetail }) {
  const c = quote.commercial;
  const { data: config } = usePublicConfig();
  const paymentTerms = useValueList('requested_payment_terms');
  const toolingPayments = useValueList('tooling_payment_terms');
  const fundingModels = useValueList('tooling_funding_model');
  const standard = standardTermsFrom(config);
  const fallback =
    typeof config?.settings.default_payment_terms === 'string'
      ? config.settings.default_payment_terms
      : null;
  const listLabel = (list: { code: string; label: string }[], code: string | null) =>
    code ? (list.find((m) => m.code === code)?.label ?? code) : null;
  const apply = useApplyQuote(quote);
  const stored = termsFormFrom(c);
  const [form, setForm] = useState<TermsForm>(() =>
    c.terms.canEdit ? withDefaultTerms(stored, quote, fallback) : stored,
  );
  const [errors, setErrors] = useState<ServerError[]>([]);
  const set =
    <K extends keyof TermsForm>(key: K) =>
    (value: TermsForm[K]) =>
      setForm((f) => ({ ...f, [key]: value }));
  const changed = (k: keyof TermsForm) => form[k] !== stored[k];
  const dirty = (Object.keys(form) as (keyof TermsForm)[]).some(changed);
  const text = (v: string) => (v.trim() === '' ? null : v.trim());
  const option = paymentTerms.find((p) => p.code === form.termsPaymentTermsCode);
  const freeText = option?.meta.freeText === true;
  const nonstandard = isNonStandardPaymentTerms(form.termsPaymentTermsCode, standard);

  const save = useMutation({
    mutationFn: () => {
      const body: TermsBody = {};
      if (changed('termsToolingCommitment'))
        body.termsToolingCommitment =
          form.termsToolingCommitment === '' ? null : form.termsToolingCommitment === 'yes';
      if (changed('termsPaymentTermsCode'))
        body.termsPaymentTermsCode = text(form.termsPaymentTermsCode);
      if (changed('termsPaymentTerms') || (freeText && changed('termsPaymentTermsCode')))
        body.termsPaymentTerms = freeText ? text(form.termsPaymentTerms) : null;
      if (changed('termsNonstandard') && !nonstandard)
        body.termsNonstandard = form.termsNonstandard;
      if (changed('termsToolingPayment')) body.termsToolingPayment = text(form.termsToolingPayment);
      if (changed('termsMilestoneNote')) body.termsMilestoneNote = text(form.termsMilestoneNote);
      if (changed('termsNotes')) body.termsNotes = text(form.termsNotes);
      if (changed('checked')) body.checked = form.checked;
      if (changed('legalReviewedOn') || changed('legalReviewerName') || changed('legalNote')) {
        body.legal =
          form.legalReviewedOn === '' && form.legalReviewerName.trim() === ''
            ? null
            : {
                reviewedOn: form.legalReviewedOn,
                reviewerName: form.legalReviewerName.trim(),
                note: text(form.legalNote),
              };
      }
      return api.updateTerms(quote.quoteNumber, body);
    },
    onSuccess: async (next) => {
      setErrors([]);
      await apply(next);
      const opened =
        next.commercial.terms.exception?.status === 'pending' &&
        c.terms.exception?.status !== 'pending';
      toast.success({
        title: next.commercial.terms.checkedAt ? 'Terms checked' : 'Terms saved',
        ...(opened
          ? {
              description: 'Non-standard payment terms: the pricing lead has been asked to decide.',
            }
          : {}),
      });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });

  const legalBlock = (
    <div className="grid gap-2" data-testid="legal-review">
      <p className="text-sm font-medium">Legal review</p>
      {c.legal.required ? (
        <ul className="text-muted-foreground list-disc pl-6 text-xs">
          {c.legal.reasons.map((r) => (
            <li key={r.code}>{r.label}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">
          No Legal trigger applies (new customer, non-standard terms or a tooling commitment).
        </p>
      )}
    </div>
  );

  const paymentText = c.terms.termsPaymentTermsCode
    ? paymentTerms.find((p) => p.code === c.terms.termsPaymentTermsCode)?.meta.freeText === true
      ? c.terms.termsPaymentTerms
      : listLabel(paymentTerms, c.terms.termsPaymentTermsCode)
    : c.terms.termsPaymentTerms && `${c.terms.termsPaymentTerms} (entered before the list)`;
  const toolingOption = toolingPayments.find((t) => t.code === c.terms.termsToolingPayment);

  const extras = (
    <>
      <EngineeringTerms quote={quote} />
      <CapitalTerms
        quoteNumber={quote.quoteNumber}
        view={c.terms.capital}
        mode={c.terms.capital.canFinalize ? 'finalize' : c.terms.canEdit ? 'prefill' : 'readonly'}
        onSaved={apply}
      />
      <TermsExceptionCard
        quoteNumber={quote.quoteNumber}
        exception={c.terms.exception}
        onSaved={apply}
      />
      <AdditionalApprovals
        quoteNumber={quote.quoteNumber}
        items={c.additionalApprovals}
        onSaved={apply}
      />
    </>
  );

  if (!c.terms.canEdit) {
    return (
      <section aria-label="Terms" className="grid gap-4" data-testid="terms">
        <SectionLockLine lock={c.terms.lock} />
        <KeyValueGrid
          items={[
            {
              id: 'payment',
              label: 'Payment terms',
              value: paymentText ? (
                <>
                  {paymentText}
                  <NonStandardTermsBadge show={c.terms.paymentTermsNonstandard} />
                </>
              ) : null,
            },
            {
              id: 'tooling-payment',
              label: 'Tooling payment',
              value: toolingOption?.label ?? c.terms.termsToolingPayment,
            },
            { id: 'milestone-note', label: 'Milestone note', value: c.terms.termsMilestoneNote },
            {
              id: 'tooling',
              label: 'Tooling commitment',
              value: yesNo(c.terms.termsToolingCommitment),
            },
            {
              id: 'nonstandard',
              label: 'Non-standard terms',
              value: yesNo(c.terms.termsNonstandard),
            },
            { id: 'notes', label: 'Terms notes', value: c.terms.termsNotes },
            {
              id: 'checked',
              label: 'Terms checked',
              value: c.terms.checkedAt
                ? `${c.terms.checkedByName ?? 'Someone'}, ${absoluteTime(c.terms.checkedAt)}`
                : null,
            },
            {
              id: 'legal',
              label: 'Legal reviewed',
              value: c.legal.reviewedOn
                ? `${c.legal.reviewedOn} by ${c.legal.reviewerName ?? '–'}`
                : null,
            },
          ]}
        />
        {legalBlock}
        {extras}
      </section>
    );
  }

  return (
    <div className="grid gap-6">
      <form
        aria-label="Terms"
        className="grid gap-4"
        data-testid="terms"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <SectionLockLine lock={c.terms.lock} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Payment terms"
            hint={
              standard.length > 0
                ? `Standard: ${standard.map((s) => listLabel(paymentTerms, s)).join(', ')}. Anything else goes to the pricing lead as an exception.`
                : undefined
            }
            error={errorFor(errors, 'termsPaymentTermsCode')}
          >
            {(id) => (
              <NativeSelect
                id={id}
                value={form.termsPaymentTermsCode}
                onChange={(e) => set('termsPaymentTermsCode')(e.target.value)}
              >
                <option value="">Not set</option>
                {paymentTerms.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <div className="flex items-end pb-2">
            <NonStandardTermsBadge show={nonstandard} />
          </div>
          {freeText && (
            <Field
              label="Payment terms agreed (required)"
              error={errorFor(errors, 'termsPaymentTerms')}
            >
              {(id) => (
                <Input
                  id={id}
                  maxLength={200}
                  placeholder="e.g. 2% 10, Net 45"
                  value={form.termsPaymentTerms}
                  onChange={(e) => set('termsPaymentTerms')(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field
            label="Tooling payment"
            hint={
              milestoneText(
                toolingPayments.find((t) => t.code === form.termsToolingPayment)?.meta,
              ) ?? undefined
            }
            error={errorFor(errors, 'termsToolingPayment')}
          >
            {(id) => (
              <NativeSelect
                id={id}
                value={form.termsToolingPayment}
                onChange={(e) => set('termsToolingPayment')(e.target.value)}
              >
                <option value="">Not set</option>
                {toolingPayments.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            label="Customer tooling commitment"
            hint="Does the customer commit to fund or pay for tooling?"
            error={errorFor(errors, 'termsToolingCommitment')}
          >
            {(id) => (
              <NativeSelect
                id={id}
                value={form.termsToolingCommitment}
                onChange={(e) =>
                  set('termsToolingCommitment')(
                    e.target.value as TermsForm['termsToolingCommitment'],
                  )
                }
              >
                <option value="">Not answered</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </NativeSelect>
            )}
          </Field>
        </div>
        {!c.terms.termsPaymentTermsCode && c.terms.termsPaymentTerms && (
          <p className="text-muted-foreground -mt-2 text-xs" data-testid="legacy-payment-terms">
            Entered before the list: {c.terms.termsPaymentTerms}. Pick the matching terms above.
          </p>
        )}
        <Field
          label="Milestone note"
          hint="Up to 300 characters, e.g. when qualification is expected."
          error={errorFor(errors, 'termsMilestoneNote')}
        >
          {(id) => (
            <Input
              id={id}
              maxLength={300}
              value={form.termsMilestoneNote}
              onChange={(e) => set('termsMilestoneNote')(e.target.value)}
            />
          )}
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={nonstandard || form.termsNonstandard}
            disabled={nonstandard}
            onChange={(e) => set('termsNonstandard')(e.target.checked)}
          />
          Non-standard terms
          {nonstandard && (
            <span className="text-muted-foreground text-xs">(set by the payment terms)</span>
          )}
        </label>
        <Field label="Terms notes" error={errorFor(errors, 'termsNotes')}>
          {(id) => (
            <Textarea
              id={id}
              value={form.termsNotes}
              onChange={(e) => set('termsNotes')(e.target.value)}
            />
          )}
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={form.checked}
            onChange={(e) => set('checked')(e.target.checked)}
          />
          Terms checked
          <span className="text-muted-foreground text-xs font-normal">
            Needs payment terms and the tooling-commitment answer; changing a term clears it.
          </span>
        </label>
        {c.terms.checkedAt && (
          <p className="text-muted-foreground -mt-2 text-xs" data-testid="terms-checked-by">
            Checked by {c.terms.checkedByName ?? 'someone'} on {absoluteTime(c.terms.checkedAt)}.
          </p>
        )}

        {legalBlock}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal reviewed on" error={errorFor(errors, 'legal/reviewedOn')}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={form.legalReviewedOn}
                onChange={(e) => set('legalReviewedOn')(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Reviewed by (Legal)"
            hint="Legal is not a CCQ role: name the reviewer."
            error={errorFor(errors, 'legal/reviewerName')}
          >
            {(id) => (
              <Input
                id={id}
                value={form.legalReviewerName}
                onChange={(e) => set('legalReviewerName')(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Legal note" error={errorFor(errors, 'legal/note')}>
          {(id) => (
            <Textarea
              id={id}
              value={form.legalNote}
              onChange={(e) => set('legalNote')(e.target.value)}
            />
          )}
        </Field>
        {c.legal.recordedByName && (
          <p className="text-muted-foreground -mt-2 text-xs">
            Recorded by {c.legal.recordedByName}.
          </p>
        )}
        <FormErrors errors={errors.filter((e) => !INLINE_TERMS_PATHS.has(e.path))} />
        <div>
          <Button type="submit" disabled={save.isPending || !dirty}>
            {save.isPending ? 'Saving…' : 'Save terms'}
          </Button>
        </div>
      </form>
      {extras}
      {/* Funding is Engineering's on the quote; the label is shown for context when it is not. */}
      {!c.terms.canEditEngineering && !c.terms.capital.canFinalize && (
        <p className="text-muted-foreground -mt-4 text-xs">
          Funding model: {listLabel(fundingModels, c.terms.toolingFundingModel) ?? 'Not set'}{' '}
          (Engineering confirms MOQ and funding; the approver finalizes the capital terms).
        </p>
      )}
    </div>
  );
}

/**
 * FB-08 (F-021, D-003 provisional): MOQ and the tooling funding model are Engineering's (the EngLead,
 * or the assigned engineer). Everyone else reads them here.
 */
function EngineeringTerms({ quote }: { quote: QuoteDetail }) {
  const t = quote.commercial.terms;
  const fundingModels = useValueList('tooling_funding_model');
  const apply = useApplyQuote(quote);
  const [funding, setFunding] = useState(t.toolingFundingModel ?? '');
  const [moq, setMoq] = useState(t.termsMoq ?? '');
  const [errors, setErrors] = useState<ServerError[]>([]);
  const dirty = funding !== (t.toolingFundingModel ?? '') || moq !== (t.termsMoq ?? '');
  const save = useMutation({
    mutationFn: () => {
      const body: EngineeringTermsBody = {};
      if (funding !== (t.toolingFundingModel ?? '')) body.toolingFundingModel = funding || null;
      if (moq !== (t.termsMoq ?? '')) body.termsMoq = moq.trim() || null;
      return api.updateEngineeringTerms(quote.quoteNumber, body);
    },
    onSuccess: async (next) => {
      setErrors([]);
      await apply(next);
      toast.success({ title: 'MOQ and funding saved' });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });
  const fundingLabel = t.toolingFundingModel
    ? (fundingModels.find((m) => m.code === t.toolingFundingModel)?.label ?? t.toolingFundingModel)
    : null;
  if (!t.canEditEngineering) {
    return (
      <section aria-label="MOQ and funding" className="grid gap-2" data-testid="engineering-terms">
        <KeyValueGrid
          items={[
            { id: 'eng-funding', label: 'Tooling funding model', value: fundingLabel },
            { id: 'eng-moq', label: 'MOQ', value: t.termsMoq },
          ]}
        />
      </section>
    );
  }
  return (
    <form
      aria-label="MOQ and funding"
      className="grid gap-4"
      data-testid="engineering-terms"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm font-medium">MOQ and tooling funding (Engineering)</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tooling funding model" error={errorFor(errors, 'toolingFundingModel')}>
          {(id) => (
            <NativeSelect id={id} value={funding} onChange={(e) => setFunding(e.target.value)}>
              <option value="">Not set</option>
              {fundingModels.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <FundingHelp options={fundingModels} />
        <Field label="MOQ" error={errorFor(errors, 'termsMoq')}>
          {(id) => (
            <Input id={id} maxLength={200} value={moq} onChange={(e) => setMoq(e.target.value)} />
          )}
        </Field>
      </div>
      <FormErrors
        errors={errors.filter((e) => e.path !== '/toolingFundingModel' && e.path !== '/termsMoq')}
      />
      <div>
        <Button type="submit" disabled={save.isPending || !dirty}>
          {save.isPending ? 'Saving…' : 'Save MOQ and funding'}
        </Button>
      </div>
    </form>
  );
}

/** B-26 (B11): raise a quote to the configured owner of an escalation route (or the Process Owner). */
function EscalateSection({ quote }: { quote: QuoteDetail }) {
  const esc = quote.commercial.escalation;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<ServerError[]>([]);
  const ids = { route: useId(), note: useId() };
  const route = esc.routes.find((r) => r.code === code);
  const reset = () => {
    setCode('');
    setNote('');
    setSubmitted(false);
    setErrors([]);
  };
  const send = useMutation({
    mutationFn: () => api.escalate(quote.quoteNumber, { code, note: note.trim() }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: timelineQueryKey(quote.quoteNumber) });
      toast.success({
        title: `Escalated: ${res.label}`,
        description: `${res.notified} ${res.notified === 1 ? 'person was' : 'people were'} told.`,
      });
      reset();
      setOpen(false);
    },
    onError: (err) => setErrors(problemErrors(err)),
  });
  const problems = [!route && 'Choose what to escalate.', !note.trim() && 'Add a note.'].filter(
    (p): p is string => !!p,
  );

  return (
    <section aria-label="Escalation" className="grid gap-2" data-testid="escalation">
      <p className="text-sm">
        <span className="font-medium">{esc.processOwner.label}:</span>{' '}
        {esc.processOwner.name ?? 'Not named yet'}
      </p>
      {esc.canEscalate && esc.routes.length > 0 && (
        <div>
          <Button variant="outline" onClick={() => setOpen(true)} data-testid="escalate">
            <MegaphoneIcon className="size-4" aria-hidden="true" />
            Escalate…
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (send.isPending) return;
          if (!next) reset();
          setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escalate {quote.quoteNumber}</DialogTitle>
            <DialogDescription>
              Tells the owner of the route you choose. It does not change the quote’s stage or
              decide anything.
            </DialogDescription>
          </DialogHeader>
          <form
            id="escalate-form"
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
              setErrors([]);
              if (problems.length === 0) send.mutate();
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor={ids.route} className="text-sm font-medium">
                What needs a decision? (required)
              </label>
              <NativeSelect
                id={ids.route}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={submitted && !route}
              >
                <option value="">Choose…</option>
                {esc.routes.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
              {route?.description && (
                <p className="text-muted-foreground text-xs" data-testid="route-description">
                  {route.description}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={ids.note} className="text-sm font-medium">
                Note (required)
              </label>
              <Textarea
                id={ids.note}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-invalid={submitted && !note.trim()}
              />
            </div>
            {submitted && problems.length > 0 && (
              <ul role="alert" className="text-destructive grid gap-1 text-sm">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <FormErrors errors={errors} />
          </form>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={send.isPending}
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="escalate-form" disabled={send.isPending}>
              {send.isPending ? 'Sending…' : 'Escalate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
