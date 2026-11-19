import type { QuoteDetail, RequoteSourceResponse } from '@ccq/contracts';
import { REQUOTE_NOTE_MAX } from '@ccq/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CopyPlusIcon, Link2Icon } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { api, isApiError } from '@/lib/api';
import { absoluteTime, calendarDate } from '@/lib/time';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { Field } from '../forms';
import { quoteQueryKey } from '../GateDecisionDialog';
import { KeyValueGrid } from '../KeyValueGrid';
import { timelineQueryKey } from '../Overrides';

/**
 * FB-26 (N17-30, Bailey Schmitt and Ben Whann): the linked re-quote of an expired quote. Once the offer
 * has expired, the customer's late "yes" gets a NEW quote linked to the old one: a new intake draft on the
 * same opportunity, pre-filled from what the KAM entered, that Engineering, Pricing and Final Review
 * review again. The old quote keeps what was quoted. The server decides who may start one and when
 * (`QuoteDetail.requote.canStart`); this only offers it.
 */


/** The header line(s): "Re-quote of CCQ-…", "Re-quoted as CCQ-… on <date>", or a re-quote in progress. */
export function RequoteLinks({ quote }: { quote: QuoteDetail }) {
  const r = quote.requote;
  if (!r || (!r.requoteOf && !r.requotedAs && !r.draft)) return null;
  return (
    <p
      className="text-foreground-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
      data-testid="requote-links"
    >
      <Link2Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      {r.requoteOf && (
        <span data-testid="requote-of">
          Re-quote of{' '}
          <Link
            to="/quotes/$quoteNumber"
            params={{ quoteNumber: r.requoteOf.quoteNumber }}
            className="text-emphasis font-medium hover:underline"
          >
            {r.requoteOf.quoteNumber}
          </Link>
          {r.requoteOf.at && (
            <span className="text-muted-foreground"> (expired {calendarDate(r.requoteOf.at)})</span>
          )}
        </span>
      )}
      {r.requotedAs && (
        <span data-testid="requoted-as">
          Re-quoted as{' '}
          <Link
            to="/quotes/$quoteNumber"
            params={{ quoteNumber: r.requotedAs.quoteNumber }}
            className="text-emphasis font-medium hover:underline"
          >
            {r.requotedAs.quoteNumber}
          </Link>
          {r.requotedAs.at && <> on {calendarDate(r.requotedAs.at.slice(0, 10))}</>}
        </span>
      )}
      {r.draft && (
        <span data-testid="requote-draft">
          A re-quote was started on {absoluteTime(r.draft.startedAt)}
          {r.draft.ownerName ? ` by ${r.draft.ownerName}` : ''}.{' '}
          {r.draft.draftId && (
            <Link
              to="/intake/new"
              search={{ draft: r.draft.draftId }}
              className="text-emphasis font-medium hover:underline"
            >
              Continue the re-quote draft
            </Link>
          )}
        </span>
      )}
    </p>
  );
}

/**
 * "Start a linked re-quote": on a quote closed as "No response / Expired", or open at Customer Decision
 * with its validity passed (then it is closed as expired first, so the reason is asked for).
 */
export function StartRequote({ quote }: { quote: QuoteDetail }) {
  const r = quote.requote;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const closeFirst = r?.startFrom === 'open_lapsed';
  const reasons =
    quote.availableActions.find((a) => a.gateKey === 'G5' && a.outcomeKey === 'expired')
      ?.reasonCodes ?? [];
  const [reasonCode, setReasonCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () =>
      api.startRequote(quote.quoteNumber, {
        note: note.trim(),
        ...(closeFirst && reasonCode ? { reasonCode } : {}),
      }),
    onSuccess: async (res) => {
      setOpen(false);
      toast.success({
        title: res.recordedExpired
          ? `${quote.quoteNumber} closed as expired; re-quote draft started`
          : 'Re-quote draft started',
        description: 'Check every value, then submit it.',
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: quoteQueryKey(quote.quoteNumber) }),
        qc.invalidateQueries({ queryKey: timelineQueryKey(quote.quoteNumber) }),
      ]);
      await navigate({ to: '/intake/new', search: { draft: res.draftId } });
    },
    onError: (err: unknown) =>
      setError((isApiError(err) && err.problem.detail) || 'The re-quote could not be started.'),
  });
  if (!r?.canStart) return null;
  const valid = note.trim().length > 0 && (!closeFirst || reasonCode !== '');
  return (
    <div className="grid gap-2" data-testid="start-requote">
      <p className="text-muted-foreground text-sm">
        The offer has expired. If the customer now says yes, start a linked re-quote: a new quote with
        its own record, pre-filled from this one, that Engineering, Pricing and Final Review review
        again. This quote keeps what was quoted.
      </p>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          <CopyPlusIcon aria-hidden="true" />
          Start a linked re-quote
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Re-quote ${quote.quoteNumber}`}
        description={
          closeFirst
            ? `${quote.quoteNumber} is closed as "No response / Expired" first. Then a new intake draft opens on the same opportunity, pre-filled from this quote.`
            : 'A new intake draft opens on the same opportunity, pre-filled from this quote. Engineering, pricing, terms and decisions are not copied.'
        }
        confirmLabel="Start the re-quote"
        busy={start.isPending}
        onConfirm={() => {
          if (!valid) {
            setError(
              closeFirst && !reasonCode
                ? 'Pick why the offer expired, and say why it is re-quoted.'
                : 'Say why it is re-quoted.',
            );
            return;
          }
          start.mutate();
        }}
      >
        <div className="grid gap-3">
          {closeFirst && (
            <Field label="Why did the offer expire?">
              {(id) => (
                <NativeSelect
                  id={id}
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  data-testid="requote-reason"
                >
                  <option value="">Choose…</option>
                  {reasons.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}
          <Field
            label="Why re-quote it?"
            hint="For example: the customer said yes after the validity date."
          >
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={REQUOTE_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="requote-note"
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}

export const requoteSourceQueryKey = (quoteNumber: string) =>
  ['quote', quoteNumber, 'requote-source'] as const;

const fmt = (v: number | null | undefined, unit = '') =>
  v === null || v === undefined ? null : `${v.toLocaleString()}${unit}`;

/**
 * "From the expired quote": on a linked re-quote's Engineering and Quoting tabs, the old quote's
 * engineering solution per item, its price approval and capital readiness. Collapsed and read only. A
 * reader who cannot read the old quote sees only its number.
 */
export function RequoteSourcePanel({
  quote,
  className,
}: {
  quote: QuoteDetail;
  className?: string;
}) {
  const from = quote.requote?.requoteOf;
  const [opened, setOpened] = useState(false);
  const source = useQuery({
    queryKey: requoteSourceQueryKey(quote.quoteNumber),
    queryFn: () => api.requoteSource(quote.quoteNumber),
    enabled: Boolean(from) && opened,
  });
  if (!from) return null;
  return (
    <details
      className={cn('bg-card rounded-card border p-4', className)}
      data-testid="requote-source"
      onToggle={(e) => setOpened((e.currentTarget).open)}
    >
      <summary className="cursor-pointer text-sm font-semibold">
        From the expired quote {from.quoteNumber}
        <span className="text-muted-foreground ml-2 text-xs font-normal">Read only</span>
      </summary>
      <div className="mt-3 grid gap-3 text-sm">
        {!from.readable ? (
          <p className="text-muted-foreground">
            You can&apos;t open {from.quoteNumber}, so its engineering and pricing are not shown.
          </p>
        ) : source.isPending ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : source.isError ? (
          <p className="text-destructive">The expired quote could not be loaded.</p>
        ) : (
          <SourceBody quote={quote} source={source.data} />
        )}
      </div>
    </details>
  );
}

function SourceBody({ quote, source }: { quote: QuoteDetail; source: RequoteSourceResponse }) {
  if (!source.readable) {
    return (
      <p className="text-muted-foreground">
        You can&apos;t open {source.quoteNumber}, so its engineering and pricing are not shown.
      </p>
    );
  }
  return (
    <>
      <p className="text-muted-foreground">
        What {source.quoteNumber} was quoted on. Capacity and costs may have changed: review it
        again, nothing here is copied.
      </p>
      {source.items.map((item) => {
        const now = quote.items.find((i) => i.itemNo === item.itemNo);
        return (
          <section key={item.itemNo} className="grid gap-1" aria-label={item.name}>
            <h3 className="font-medium">
              {item.name}
              {now && now.name !== item.name && (
                <span className="text-muted-foreground font-normal"> (now {now.name})</span>
              )}
            </h3>
            <KeyValueGrid
              columns={3}
              items={[
                { id: 'plant', label: 'Plant', value: item.plantLabel },
                {
                  id: 'process',
                  label: 'Process & machine',
                  value:
                    [item.processTypeLabel, item.machineTypeLabel].filter(Boolean).join(' · ') ||
                    null,
                },
                { id: 'cav', label: 'Cavitation', value: fmt(item.cavitation) },
                { id: 'cycle', label: 'Cycle time', value: fmt(item.cycleTimeS, ' s') },
                {
                  id: 'capital',
                  label: 'Budgetary capital',
                  value:
                    item.prelimCapitalUsd === undefined || item.prelimCapitalUsd === null
                      ? null
                      : `$${item.prelimCapitalUsd.toLocaleString()}`,
                },
                { id: 'tooling', label: 'Tooling notes', value: item.toolingNotes },
              ]}
            />
          </section>
        );
      })}
      <KeyValueGrid
        columns={2}
        items={[
          {
            id: 'price',
            label: 'Price approval',
            value: source.priceApproval?.approvedAt
              ? `Approved${source.priceApproval.approvedByName ? ` by ${source.priceApproval.approvedByName}` : ''} · ${absoluteTime(source.priceApproval.approvedAt)}`
              : 'Not approved',
          },
          { id: 'readiness', label: 'Capital readiness', value: source.capitalReadinessLabel },
        ]}
      />
      <p>
        <Link
          to="/quotes/$quoteNumber"
          params={{ quoteNumber: source.quoteNumber }}
          className="text-emphasis font-medium hover:underline"
        >
          Open {source.quoteNumber}
        </Link>
      </p>
    </>
  );
}

