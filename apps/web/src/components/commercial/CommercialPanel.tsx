import type { CommercialDetail, QuoteDetail, TermsBody } from '@ccq/contracts';
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
import { useValueList } from '@/config/public-config';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';

import { Field, FormErrors, errorFor, problemErrors, type ServerError } from '../forms';
import { quoteQueryKey } from '../GateDecisionDialog';
import { KeyValueGrid } from '../KeyValueGrid';
import { timelineQueryKey } from '../Overrides';

// B-26 (CCQ demo and the future-state process deck): the quote's commercial controls. The early
// "capital likely" flag (Capital Management awareness, not approval), the terms check and Legal review
// that G4 Advance needs, the pass-through indicator, the hold owner and escalations. None of it is a
// price, margin or capital figure. The server decides who may change what (the can* flags only guide).

const yesNo = (v: boolean | null) => (v === null ? null : v ? 'Yes' : 'No');

export function CommercialPanel({ quote }: { quote: QuoteDetail }) {
  const c = quote.commercial;
  return (
    <Card data-testid="commercial-panel">
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
        <TermsEditor key={`${c.terms.checkedAt}|${c.legal.reviewedOn}`} quote={quote} />
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
    'toolingFundingModel',
    'termsToolingCommitment',
    'termsMoq',
    'termsPaymentTerms',
    'termsNotes',
    'legal/reviewedOn',
    'legal/reviewerName',
    'legal/note',
  ].map((p) => `/${p}`),
);

type TermsForm = {
  toolingFundingModel: string;
  termsToolingCommitment: '' | 'yes' | 'no';
  termsMoq: string;
  termsPaymentTerms: string;
  termsNonstandard: boolean;
  termsNotes: string;
  checked: boolean;
  legalReviewedOn: string;
  legalReviewerName: string;
  legalNote: string;
};

function termsFormFrom(c: CommercialDetail): TermsForm {
  const t = c.terms;
  return {
    toolingFundingModel: t.toolingFundingModel ?? '',
    termsToolingCommitment:
      t.termsToolingCommitment === null ? '' : t.termsToolingCommitment ? 'yes' : 'no',
    termsMoq: t.termsMoq ?? '',
    termsPaymentTerms: t.termsPaymentTerms ?? '',
    termsNonstandard: t.termsNonstandard,
    termsNotes: t.termsNotes ?? '',
    checked: t.checkedAt !== null,
    legalReviewedOn: c.legal.reviewedOn ?? '',
    legalReviewerName: c.legal.reviewerName ?? '',
    legalNote: c.legal.note ?? '',
  };
}

/** B-26 (B6, B8): tooling funding, the terms check and, when a trigger applies, the Legal review. */
function TermsEditor({ quote }: { quote: QuoteDetail }) {
  const c = quote.commercial;
  const fundingModels = useValueList('tooling_funding_model');
  const fundingLabel = (code: string | null) =>
    code ? (fundingModels.find((m) => m.code === code)?.label ?? code) : null;
  const apply = useApplyQuote(quote);
  const stored = termsFormFrom(c);
  const [form, setForm] = useState<TermsForm>(stored);
  const [errors, setErrors] = useState<ServerError[]>([]);
  const set =
    <K extends keyof TermsForm>(key: K) =>
    (value: TermsForm[K]) =>
      setForm((f) => ({ ...f, [key]: value }));
  const changed = (k: keyof TermsForm) => form[k] !== stored[k];
  const dirty = (Object.keys(form) as (keyof TermsForm)[]).some(changed);
  const text = (v: string) => (v.trim() === '' ? null : v.trim());

  const save = useMutation({
    mutationFn: () => {
      const body: TermsBody = {};
      if (changed('toolingFundingModel')) body.toolingFundingModel = text(form.toolingFundingModel);
      if (changed('termsToolingCommitment'))
        body.termsToolingCommitment =
          form.termsToolingCommitment === '' ? null : form.termsToolingCommitment === 'yes';
      if (changed('termsMoq')) body.termsMoq = text(form.termsMoq);
      if (changed('termsPaymentTerms')) body.termsPaymentTerms = text(form.termsPaymentTerms);
      if (changed('termsNonstandard')) body.termsNonstandard = form.termsNonstandard;
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
      toast.success({
        title: next.commercial.terms.checkedAt ? 'Terms checked' : 'Terms saved',
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

  if (!c.terms.canEdit) {
    return (
      <section aria-label="Terms" className="grid gap-4" data-testid="terms">
        <KeyValueGrid
          items={[
            {
              id: 'funding',
              label: 'Tooling funding model',
              value: fundingLabel(c.terms.toolingFundingModel),
            },
            {
              id: 'tooling',
              label: 'Tooling commitment',
              value: yesNo(c.terms.termsToolingCommitment),
            },
            { id: 'moq', label: 'MOQ', value: c.terms.termsMoq },
            { id: 'payment', label: 'Payment terms', value: c.terms.termsPaymentTerms },
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
      </section>
    );
  }

  return (
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tooling funding model" error={errorFor(errors, 'toolingFundingModel')}>
          {(id) => (
            <NativeSelect
              id={id}
              value={form.toolingFundingModel}
              onChange={(e) => set('toolingFundingModel')(e.target.value)}
            >
              <option value="">Not set</option>
              {fundingModels.map((m) => (
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
                set('termsToolingCommitment')(e.target.value as TermsForm['termsToolingCommitment'])
              }
            >
              <option value="">Not answered</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </NativeSelect>
          )}
        </Field>
        <Field label="MOQ" error={errorFor(errors, 'termsMoq')}>
          {(id) => (
            <Input
              id={id}
              value={form.termsMoq}
              onChange={(e) => set('termsMoq')(e.target.value)}
            />
          )}
        </Field>
        <Field label="Payment terms" error={errorFor(errors, 'termsPaymentTerms')}>
          {(id) => (
            <Input
              id={id}
              placeholder="e.g. Net 45"
              value={form.termsPaymentTerms}
              onChange={(e) => set('termsPaymentTerms')(e.target.value)}
            />
          )}
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={form.termsNonstandard}
          onChange={(e) => set('termsNonstandard')(e.target.checked)}
        />
        Non-standard terms
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
          Needs payment terms and the tooling-commitment answer. Final Review needs it to release
          the offer; changing a term clears it.
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
        <p className="text-muted-foreground -mt-2 text-xs">Recorded by {c.legal.recordedByName}.</p>
      )}
      <FormErrors errors={errors.filter((e) => !INLINE_TERMS_PATHS.has(e.path))} />
      <div>
        <Button type="submit" disabled={save.isPending || !dirty}>
          {save.isPending ? 'Saving…' : 'Save terms'}
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
