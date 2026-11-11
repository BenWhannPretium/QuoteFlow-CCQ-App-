import type { CapitalTermsBody, CapitalTermsView, QuoteDetail, TermsBody } from '@ccq/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { useValueList } from '@/config/public-config';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';

import { Field, FormErrors, errorFor, problemErrors, type ServerError } from '../forms';
import { KeyValueGrid, type KeyValueItem } from '../KeyValueGrid';
import { FundingHelp } from './FundingHelp';

/**
 * FB-08 (F-068, V-054, T-031): the capital terms (funding model, mold ownership, amortization, minimum
 * supply / shortfall, agreement and its duration). Sales may pre-fill them on the Commercial panel
 * (`prefill`, terms.edit: everything but the funding model, which is Engineering's); the approver edits
 * and confirms them on the Final Review screen (`finalize`, terms.finalize). Changing one after the
 * confirmation clears it; G4 Advance needs the confirmation; the terms lock at G4 Approve.
 */

export type CapitalTermsMode = 'prefill' | 'finalize' | 'readonly';

const yesNo = (v: boolean | null) => (v === null ? null : v ? 'Yes' : 'No');
const months = (n: number | null) => (n === null ? null : `${n} months`);

type Form = {
  toolingFundingModel: string;
  termsMoldOwnership: string;
  termsAmortized: '' | 'yes' | 'no';
  termsAmortizationMonths: string;
  termsMinSupply: string;
  termsAgreementInPlace: '' | 'yes' | 'no';
  termsAgreementMonths: string;
};

const tri = (v: boolean | null): '' | 'yes' | 'no' => (v === null ? '' : v ? 'yes' : 'no');
const fromTri = (v: '' | 'yes' | 'no') => (v === '' ? null : v === 'yes');
const num = (v: string) => (v.trim() === '' ? null : Number(v));

function formFrom(v: CapitalTermsView): Form {
  return {
    toolingFundingModel: v.toolingFundingModel ?? '',
    termsMoldOwnership: v.moldOwnership ?? '',
    termsAmortized: tri(v.amortized),
    termsAmortizationMonths: v.amortizationMonths?.toString() ?? '',
    termsMinSupply: v.minSupply ?? '',
    termsAgreementInPlace: tri(v.agreementInPlace),
    termsAgreementMonths: v.agreementMonths?.toString() ?? '',
  };
}

/** Read-only rows for the capital terms (the review screen and the Commercial panel). */
export function useCapitalTermItems(v: CapitalTermsView): KeyValueItem[] {
  const funding = useValueList('tooling_funding_model');
  const mold = useValueList('mold_ownership');
  const label = (list: { code: string; label: string }[], code: string | null) =>
    code ? (list.find((e) => e.code === code)?.label ?? code) : null;
  return [
    { id: 'cap-funding', label: 'Funding model', value: label(funding, v.toolingFundingModel) },
    { id: 'cap-mold', label: 'Mold ownership', value: label(mold, v.moldOwnership) },
    {
      id: 'cap-amortized',
      label: 'Amortized',
      value: v.amortized
        ? `Yes, ${months(v.amortizationMonths) ?? 'months not given'}`
        : yesNo(v.amortized),
    },
    { id: 'cap-min-supply', label: 'Minimum supply / shortfall', value: v.minSupply },
    {
      id: 'cap-agreement',
      label: 'Agreement in place',
      value: v.agreementInPlace
        ? `Yes, ${months(v.agreementMonths) ?? 'duration not given'}`
        : yesNo(v.agreementInPlace),
    },
    {
      id: 'cap-finalized',
      label: 'Confirmed by the approver',
      value: v.finalizedAt
        ? `${v.finalizedByName ?? 'The approver'}, ${absoluteTime(v.finalizedAt)}`
        : 'Not confirmed',
    },
  ];
}

export function CapitalTerms({
  quoteNumber,
  view,
  mode,
  onSaved,
  termsCheckedAt = null,
}: {
  quoteNumber: string;
  view: CapitalTermsView;
  mode: CapitalTermsMode;
  onSaved: (next: QuoteDetail) => Promise<void> | void;
  /** DR-approver-leadership-admin-09: whether the terms were checked, to say when a change clears it. */
  termsCheckedAt?: string | null;
}) {
  const items = useCapitalTermItems(view);
  if (mode === 'readonly') {
    return (
      <section aria-label="Capital terms" className="grid gap-2" data-testid="capital-terms">
        <p className="text-sm font-medium">Capital terms</p>
        <KeyValueGrid items={items} />
      </section>
    );
  }
  return (
    <CapitalTermsForm
      key={`${view.finalizedAt}|${view.toolingFundingModel}|${view.moldOwnership}`}
      quoteNumber={quoteNumber}
      view={view}
      mode={mode}
      onSaved={onSaved}
      termsCheckedAt={termsCheckedAt}
    />
  );
}

const INLINE = new Set(
  [
    'toolingFundingModel',
    'termsMoldOwnership',
    'termsAmortized',
    'termsAmortizationMonths',
    'termsMinSupply',
    'termsAgreementInPlace',
    'termsAgreementMonths',
  ].map((p) => `/${p}`),
);

function CapitalTermsForm({
  quoteNumber,
  view,
  mode,
  onSaved,
  termsCheckedAt,
}: {
  quoteNumber: string;
  view: CapitalTermsView;
  mode: 'prefill' | 'finalize';
  onSaved: (next: QuoteDetail) => Promise<void> | void;
  termsCheckedAt: string | null;
}) {
  const funding = useValueList('tooling_funding_model');
  const mold = useValueList('mold_ownership');
  const stored = formFrom(view);
  const [form, setForm] = useState<Form>(stored);
  const [errors, setErrors] = useState<ServerError[]>([]);
  const set =
    <K extends keyof Form>(key: K) =>
    (value: Form[K]) =>
      setForm((f) => ({ ...f, [key]: value }));
  const changed = (k: keyof Form) => form[k] !== stored[k];
  const dirty = (Object.keys(form) as (keyof Form)[]).some(changed);
  const text = (v: string) => (v.trim() === '' ? null : v.trim());
  const finalize = mode === 'finalize';

  const save = useMutation({
    mutationFn: (finalized?: boolean) => {
      const body: TermsBody & CapitalTermsBody = {};
      if (finalize && changed('toolingFundingModel'))
        body.toolingFundingModel = text(form.toolingFundingModel);
      if (changed('termsMoldOwnership')) body.termsMoldOwnership = text(form.termsMoldOwnership);
      if (changed('termsAmortized')) body.termsAmortized = fromTri(form.termsAmortized);
      if (changed('termsAmortizationMonths') && form.termsAmortized === 'yes')
        body.termsAmortizationMonths = num(form.termsAmortizationMonths);
      if (changed('termsMinSupply')) body.termsMinSupply = text(form.termsMinSupply);
      if (changed('termsAgreementInPlace'))
        body.termsAgreementInPlace = fromTri(form.termsAgreementInPlace);
      if (changed('termsAgreementMonths') && form.termsAgreementInPlace === 'yes')
        body.termsAgreementMonths = num(form.termsAgreementMonths);
      if (finalized !== undefined) body.finalized = finalized;
      if (finalize) {
        const { toolingFundingModel, finalized: f, ...capital } = body;
        return api.updateCapitalTerms(quoteNumber, {
          ...capital,
          ...(toolingFundingModel !== undefined ? { toolingFundingModel } : {}),
          ...(f !== undefined ? { finalized: f } : {}),
        });
      }
      const { toolingFundingModel: _f, finalized: _x, ...prefill } = body;
      return api.updateTerms(quoteNumber, prefill);
    },
    onSuccess: async (next, finalized) => {
      setErrors([]);
      await onSaved(next);
      // DR-approver-leadership-admin-09: say what a change cleared, not just that it saved.
      const fundingChanged =
        view.toolingFundingModel !== next.commercial.terms.capital.toolingFundingModel;
      const checkedBefore = !!termsCheckedAt;
      const cleared = [
        view.finalizedAt && !next.commercial.terms.capital.finalizedAt
          ? 'the approver’s confirmation'
          : null,
        fundingChanged && checkedBefore && !next.commercial.terms.checkedAt
          ? 'the Sales or Pricing terms check (the funding model is part of the checked terms)'
          : null,
      ].filter(Boolean);
      toast.success({
        title: finalized ? 'Capital terms confirmed' : 'Capital terms saved',
        ...(cleared.length ? { description: `The change cleared ${cleared.join(' and ')}.` } : {}),
      });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });

  return (
    <form
      aria-label="Capital terms"
      className="grid gap-4"
      data-testid="capital-terms"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <div className="grid gap-1">
        <p className="text-sm font-medium">Capital terms</p>
        <p className="text-muted-foreground text-xs">
          {finalize
            ? 'Edit them if needed, then confirm. Releasing the offer needs the confirmation; the terms lock when you approve.'
            : 'Pre-fill what you know. The approver confirms them at Final Review.'}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {finalize && (
          <>
            <Field
              label="Funding model"
              hint="Changing it clears the Sales or Pricing terms check: the terms are checked again."
              error={errorFor(errors, 'toolingFundingModel')}
            >
              {(id) => (
                <NativeSelect
                  id={id}
                  value={form.toolingFundingModel}
                  onChange={(e) => set('toolingFundingModel')(e.target.value)}
                >
                  <option value="">Not set</option>
                  {funding.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <FundingHelp options={funding} />
          </>
        )}
        <Field label="Mold ownership" error={errorFor(errors, 'termsMoldOwnership')}>
          {(id) => (
            <NativeSelect
              id={id}
              value={form.termsMoldOwnership}
              onChange={(e) => set('termsMoldOwnership')(e.target.value)}
            >
              <option value="">Not set</option>
              {mold.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Amortized" error={errorFor(errors, 'termsAmortized')}>
          {(id) => (
            <NativeSelect
              id={id}
              value={form.termsAmortized}
              onChange={(e) => set('termsAmortized')(e.target.value as Form['termsAmortized'])}
            >
              <option value="">Not answered</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </NativeSelect>
          )}
        </Field>
        {form.termsAmortized === 'yes' && (
          <Field
            label="Amortized over (months)"
            error={errorFor(errors, 'termsAmortizationMonths')}
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                max={120}
                value={form.termsAmortizationMonths}
                onChange={(e) => set('termsAmortizationMonths')(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label="Agreement in place" error={errorFor(errors, 'termsAgreementInPlace')}>
          {(id) => (
            <NativeSelect
              id={id}
              value={form.termsAgreementInPlace}
              onChange={(e) =>
                set('termsAgreementInPlace')(e.target.value as Form['termsAgreementInPlace'])
              }
            >
              <option value="">Not answered</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </NativeSelect>
          )}
        </Field>
        {form.termsAgreementInPlace === 'yes' && (
          <Field
            label="Agreement duration (months)"
            error={errorFor(errors, 'termsAgreementMonths')}
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                max={240}
                value={form.termsAgreementMonths}
                onChange={(e) => set('termsAgreementMonths')(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
      <Field
        label="Minimum supply / shortfall terms"
        hint="Up to 300 characters. Write “None” if there are none."
        error={errorFor(errors, 'termsMinSupply')}
      >
        {(id) => (
          <Textarea
            id={id}
            maxLength={300}
            value={form.termsMinSupply}
            onChange={(e) => set('termsMinSupply')(e.target.value)}
          />
        )}
      </Field>
      <p className="text-muted-foreground text-xs" data-testid="capital-terms-confirmed">
        {view.finalizedAt
          ? `Confirmed by ${view.finalizedByName ?? 'the approver'} on ${absoluteTime(view.finalizedAt)}.`
          : 'Not confirmed by the approver yet.'}
      </p>
      <FormErrors errors={errors.filter((e) => !INLINE.has(e.path))} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant={finalize ? 'outline' : 'primary'}
          disabled={save.isPending || !dirty}
        >
          {save.isPending ? 'Saving…' : 'Save capital terms'}
        </Button>
        {finalize && (
          <Button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate(true)}
            data-testid="confirm-capital-terms"
          >
            {view.finalizedAt && !dirty ? 'Confirmed' : 'Confirm capital terms'}
          </Button>
        )}
      </div>
    </form>
  );
}
