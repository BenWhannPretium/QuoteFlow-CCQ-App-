import type {
  CerStatus,
  CustomerDecisionDetail,
  HandoffBody,
  QuoteDetail,
  SfStageComparison,
  ValidityStatus,
} from '@ccq/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlertIcon, ClockIcon, HandshakeIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { Field, FormErrors, errorFor, problemErrors, type ServerError } from '../forms';
import { quoteQueryKey } from '../GateDecisionDialog';
import { KeyValueGrid } from '../KeyValueGrid';
import { timelineQueryKey } from '../Overrides';

// B-13: the Customer Decision header (validity countdown, SF stage side by side), the closure record
// and the hand-off record. B-26: the hand-off belongs to Stage 6 (Commit & Hand Off), where the CER is
// recorded as a reference (status, ID, approval date) and the receiving team accepts the hand-off.

/** B-26: CER status labels (the CER itself stays in Apex: a reference only). */
export const CER_STATUS_LABELS: Record<CerStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  not_approved: 'Not approved',
  not_required: 'Not required',
};

/** "12 days left" / "Last day" / "Expired 3 days ago", amber at ≤ the warning window, red once expired. */
export function ValidityChip({
  validity,
  className,
}: {
  validity: ValidityStatus;
  className?: string;
}) {
  if (validity.state === 'none' || validity.daysLeft === null) return null;
  const d = validity.daysLeft;
  const text =
    d < 0
      ? `Expired ${-d} day${d === -1 ? '' : 's'} ago`
      : d === 0
        ? 'Last valid day'
        : `${d} day${d === 1 ? '' : 's'} left`;
  return (
    <span
      data-testid="validity-chip"
      data-state={validity.state}
      title={`Valid until ${validity.validityUntil}`}
      className={cn(
        'rounded-pill inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        validity.state === 'valid' && 'bg-secondary text-foreground',
        validity.state === 'expiring' && 'bg-warning text-warning-foreground',
        validity.state === 'expired' && 'bg-destructive text-destructive-foreground',
        className,
      )}
    >
      <ClockIcon className="size-3.5" aria-hidden="true" />
      {text}
    </span>
  );
}

/** The SF stage next to the CCQ one, with a mismatch flag when they disagree on the outcome. */
export function SfStageCompare({ sf }: { sf: SfStageComparison }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="sf-stage">
      <span>{sf.sfStage ?? 'Not synced'}</span>
      {sf.mismatch && (
        <span
          data-testid="sf-mismatch"
          title={sf.reason ?? undefined}
          className="bg-warning text-warning-foreground rounded-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold"
        >
          <CircleAlertIcon className="size-3.5" aria-hidden="true" />
          Mismatch
        </span>
      )}
      {sf.sfStatusFlag && (
        <span className="text-muted-foreground text-xs">
          (SF: {sf.sfStatusFlag.replace('_', ' ')})
        </span>
      )}
    </span>
  );
}

/** The header shown while the quote waits for the customer (and on closed quotes that got that far). */
export function CustomerDecisionHeader({ quote }: { quote: QuoteDetail }) {
  const cd = quote.customerDecision;
  if (!cd.proposalIssuedAt && quote.stageKey !== 'CUSTOMER_DECISION') return null;
  const waiting = quote.stageKey === 'CUSTOMER_DECISION' && quote.status !== 'closed';
  return (
    <section
      aria-label="Customer decision"
      data-testid="customer-decision-header"
      className="bg-card rounded-card grid gap-3 border p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">Customer decision</h2>
        {waiting && <ValidityChip validity={cd.validity} />}
        {cd.inNegotiation && (
          <span
            data-testid="negotiating-chip"
            title="The customer countered within the approved range (G5 In negotiation)."
            className="bg-secondary text-foreground rounded-pill inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold"
          >
            <HandshakeIcon className="size-3.5" aria-hidden="true" />
            In negotiation
          </span>
        )}
      </div>
      <KeyValueGrid
        columns={3}
        items={[
          {
            id: 'issued',
            label: 'Proposal issued',
            value: cd.proposalIssuedAt ? absoluteTime(cd.proposalIssuedAt) : null,
          },
          { id: 'valid', label: 'Valid until', value: cd.validity.validityUntil },
          { id: 'sf', label: 'Salesforce stage', value: <SfStageCompare sf={cd.sf} /> },
        ]}
      />
      {waiting && cd.validity.state === 'expired' && (
        <p role="status" className="text-sm" data-testid="validity-expired-note">
          The proposal validity has passed. Revalidate it with the customer, or record the outcome.
          Silence is not a loss: use “No response / Expired”.
        </p>
      )}
      {cd.sf.mismatch && cd.sf.reason && (
        <p className="text-muted-foreground text-xs">{cd.sf.reason}.</p>
      )}
    </section>
  );
}

/** How a closed quote closed: outcome, reason, owner, date and the deciding role (CR-39/40). */
export function ClosureCard({ closure }: { closure: CustomerDecisionDetail['closure'] }) {
  if (!closure) return null;
  return (
    <Card data-testid="closure-card">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">
            Closed: {closure.outcomeLabel}
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {closure.kind === 'customer' ? 'Customer outcome' : 'Internal decision'}
            </span>
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <KeyValueGrid
          items={[
            { id: 'reason', label: 'Reason', value: closure.reasonLabel },
            { id: 'owner', label: 'Closure owner', value: closure.closureOwnerName },
            {
              id: 'closed',
              label: 'Closed',
              value: closure.closedAt ? absoluteTime(closure.closedAt) : null,
            },
            {
              id: 'by',
              label: 'Recorded by',
              value: closure.decidedByName
                ? `${closure.decidedByName}${closure.decidedByRoles.length ? ` (${closure.decidedByRoles.join(', ')})` : ''}`
                : null,
            },
            ...(closure.competitor
              ? [{ id: 'competitor', label: 'Competitor', value: closure.competitor }]
              : []),
            ...(closure.note ? [{ id: 'note', label: 'Note', value: closure.note }] : []),
          ]}
        />
      </CardContent>
    </Card>
  );
}

type HandoffForm = {
  acceptanceEvidence: string;
  cerId: string;
  cerStatus: CerStatus;
  cerApprovedOn: string;
  receivingRole: string;
  receivingRoleOther: string;
  receivingContactName: string;
  acceptedOn: string;
  notes: string;
  complete: boolean;
};

function formFrom(cd: CustomerDecisionDetail): HandoffForm {
  const h = cd.handoff;
  return {
    acceptanceEvidence: h?.acceptanceEvidence ?? '',
    cerId: h?.cerId ?? '',
    cerStatus: h?.cerStatus ?? 'pending',
    cerApprovedOn: h?.cerApprovedOn ?? '',
    receivingRole: h?.receivingRole ?? '',
    receivingRoleOther: h?.receivingRoleOther ?? '',
    receivingContactName: h?.receivingContactName ?? '',
    acceptedOn: h?.acceptedOn ?? '',
    notes: h?.notes ?? '',
    complete: h?.completed ?? false,
  };
}

/** Stage 6 and the Closed – Won stage show the hand-off record. */
const HANDOFF_STAGES = new Set(['COMMIT_HANDOFF', 'AWARDED']);

/**
 * The hand-off record (Stage 6, Commit & Hand Off; B-26). The CER is a reference only (no integration in
 * MVP): its status, ID and approval date. G6 Advance (close Won) needs the CER approved or not required
 * and the hand-off accepted by the receiving team. Editable by the KAM (own), a SalesLeader and Admin;
 * read-only for everyone else.
 */
export function HandoffCard({
  quote,
  autoFocus = false,
}: {
  quote: QuoteDetail;
  /** Open with focus on the form (right after recording Awarded). */
  autoFocus?: boolean;
}) {
  if (!HANDOFF_STAGES.has(quote.stageKey)) return null;
  // A new saved version (or the record the award just opened) starts the form from what is stored.
  return (
    <HandoffEditor
      key={quote.customerDecision.handoff?.updatedAt ?? 'none'}
      quote={quote}
      autoFocus={autoFocus}
    />
  );
}

function HandoffEditor({ quote, autoFocus }: { quote: QuoteDetail; autoFocus: boolean }) {
  const queryClient = useQueryClient();
  const cerRef = useRef<HTMLInputElement>(null);
  // After recording Awarded the decision dialog closes and hands focus back; move it to the next job.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => {
      cerRef.current?.focus();
      cerRef.current?.scrollIntoView({ block: 'center' });
    }, 50);
    return () => clearTimeout(t);
  }, [autoFocus]);
  const cd = quote.customerDecision;
  const stored = formFrom(cd);
  const [form, setForm] = useState<HandoffForm>(stored);
  const [errors, setErrors] = useState<ServerError[]>([]);
  const set =
    <K extends keyof HandoffForm>(key: K) =>
    (value: HandoffForm[K]) =>
      setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const body: HandoffBody = {};
      const changed = (k: keyof HandoffForm) => form[k] !== stored[k];
      const text = (
        k: Exclude<keyof HandoffForm, 'complete' | 'acceptanceEvidence' | 'cerStatus'>,
      ) => (form[k].trim() === '' ? null : form[k]);
      if (changed('acceptanceEvidence') && form.acceptanceEvidence)
        body.acceptanceEvidence = form.acceptanceEvidence as HandoffBody['acceptanceEvidence'];
      if (changed('cerStatus')) body.cerStatus = form.cerStatus;
      for (const k of [
        'cerId',
        'cerApprovedOn',
        'receivingRole',
        'receivingRoleOther',
        'receivingContactName',
        'acceptedOn',
        'notes',
      ] as const) {
        if (changed(k)) body[k] = text(k);
      }
      if (changed('complete')) body.complete = form.complete;
      return api.updateHandoff(quote.quoteNumber, body);
    },
    onSuccess: async (res) => {
      setErrors([]);
      queryClient.setQueryData(quoteQueryKey(quote.quoteNumber), {
        ...quote,
        customerDecision: res.customerDecision,
      });
      await queryClient.invalidateQueries({ queryKey: timelineQueryKey(quote.quoteNumber) });
      toast.success({
        title: res.customerDecision.handoff?.completed ? 'Hand-off accepted' : 'Hand-off saved',
      });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });

  const h = cd.handoff;
  const editable = cd.canEditHandoff;
  const dirty = (Object.keys(form) as (keyof HandoffForm)[]).some((k) => form[k] !== stored[k]);

  return (
    <Card data-testid="handoff-card" id="handoff">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <HandshakeIcon className="size-4" aria-hidden="true" />
            Commit &amp; hand off
            {h && (
              <span
                data-testid="cer-status"
                className="bg-secondary text-foreground rounded-pill px-2 py-0.5 text-xs font-semibold"
              >
                CER: {CER_STATUS_LABELS[h.cerStatus]}
              </span>
            )}
            {h?.completed && (
              <span className="bg-success/15 text-success rounded-pill px-2 py-0.5 text-xs font-semibold">
                Hand-off accepted
              </span>
            )}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-muted-foreground text-sm">
          The customer said yes; commitment comes next. Record the CER (a reference to Apex: status,
          ID, approval date) and the receiving team that accepted the hand-off. Closing Won (G6
          Advance) needs the CER approved or not required and the hand-off accepted.
        </p>
        {!editable ? (
          <KeyValueGrid
            items={[
              { id: 'evidence', label: 'Acceptance evidence', value: h?.acceptanceEvidenceLabel },
              { id: 'acc-date', label: 'Accepted by the customer', value: h?.acceptanceDate },
              {
                id: 'cer-status',
                label: 'CER status',
                value: h ? CER_STATUS_LABELS[h.cerStatus] : null,
              },
              { id: 'cer', label: 'CER ID (Apex)', value: h?.cerId },
              { id: 'cer-on', label: 'CER approved on', value: h?.cerApprovedOn },
              {
                id: 'role',
                label: 'Receiving role',
                value: h?.receivingRoleOther ?? h?.receivingRoleLabel,
              },
              { id: 'contact', label: 'Receiving contact', value: h?.receivingContactName },
              { id: 'on', label: 'Accepted-by date', value: h?.acceptedOn },
              { id: 'notes', label: 'Notes', value: h?.notes },
            ]}
          />
        ) : (
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Acceptance evidence" error={errorFor(errors, 'acceptanceEvidence')}>
                {(id) => (
                  <NativeSelect
                    id={id}
                    value={form.acceptanceEvidence}
                    onChange={(e) => set('acceptanceEvidence')(e.target.value)}
                  >
                    {cd.acceptanceEvidenceOptions.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <div className="grid content-start gap-1.5 text-sm">
                <span className="font-medium">Accepted by the customer</span>
                <span>
                  {h?.acceptanceDate ?? '–'}
                  {h?.acceptanceDocumentUrl && (
                    <>
                      {' · '}
                      <a
                        href={h.acceptanceDocumentUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline underline-offset-4"
                      >
                        Document
                      </a>
                    </>
                  )}
                </span>
              </div>
              <Field
                label="CER status"
                hint="Per the official CER approval matrix (provisional, D-26)."
                error={errorFor(errors, 'cerStatus')}
              >
                {(id) => (
                  <NativeSelect
                    id={id}
                    value={form.cerStatus}
                    onChange={(e) => set('cerStatus')(e.target.value as CerStatus)}
                  >
                    {(Object.keys(CER_STATUS_LABELS) as CerStatus[]).map((k) => (
                      <option key={k} value={k}>
                        {CER_STATUS_LABELS[k]}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field
                label="CER ID (Apex)"
                hint={form.cerStatus === 'approved' ? 'Required when approved.' : 'Reference only.'}
                error={errorFor(errors, 'cerId')}
              >
                {(id) => (
                  <Input
                    id={id}
                    ref={cerRef}
                    value={form.cerId}
                    onChange={(e) => set('cerId')(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="CER approved on"
                hint={form.cerStatus === 'approved' ? 'Required when approved.' : undefined}
                error={errorFor(errors, 'cerApprovedOn')}
              >
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={form.cerApprovedOn}
                    onChange={(e) => set('cerApprovedOn')(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Receiving role" error={errorFor(errors, 'receivingRole')}>
                {(id) => (
                  <NativeSelect
                    id={id}
                    value={form.receivingRole}
                    onChange={(e) => set('receivingRole')(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {cd.receivingRoles.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              {form.receivingRole === 'other' && (
                <Field label="Receiving team" error={errorFor(errors, 'receivingRoleOther')}>
                  {(id) => (
                    <Input
                      id={id}
                      value={form.receivingRoleOther}
                      onChange={(e) => set('receivingRoleOther')(e.target.value)}
                    />
                  )}
                </Field>
              )}
              <Field label="Receiving contact" error={errorFor(errors, 'receivingContactName')}>
                {(id) => (
                  <Input
                    id={id}
                    value={form.receivingContactName}
                    onChange={(e) => set('receivingContactName')(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Accepted-by date" error={errorFor(errors, 'acceptedOn')}>
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={form.acceptedOn}
                    onChange={(e) => set('acceptedOn')(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Notes" error={errorFor(errors, 'notes')}>
              {(id) => (
                <Textarea
                  id={id}
                  value={form.notes}
                  onChange={(e) => set('notes')(e.target.value)}
                />
              )}
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={form.complete}
                onChange={(e) => set('complete')(e.target.checked)}
              />
              Hand-off accepted by the receiving team
              <span className="text-muted-foreground text-xs">
                Needs the receiving role, contact and accepted-by date.
              </span>
            </label>
            {h?.completed && h.completedByName && (
              <p className="text-muted-foreground text-xs" data-testid="handoff-completed-by">
                Confirmed by {h.completedByName}
                {h.completedAt ? ` on ${absoluteTime(h.completedAt)}` : ''}.
              </p>
            )}
            <FormErrors errors={errors.filter((e) => !e.path.match(/^\/\w+$/))} />
            <div>
              <Button type="submit" disabled={save.isPending || !dirty}>
                {save.isPending ? 'Saving…' : 'Save hand-off'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
