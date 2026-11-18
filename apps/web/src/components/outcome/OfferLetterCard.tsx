import type { OfferLetterResponse, OfferLetterSummary, QuoteDetail } from '@ccq/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangleIcon, DownloadIcon, FileTextIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, isApiError } from '@/lib/api';
import { calendarDate, absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { openFileLink } from '@/lib/unsaved-changes';

import {
  allAcknowledged,
  blockerFixText,
  blockerTab,
  formWarnings,
  problemLists,
  volumeText,
  type OfferLetterForm,
} from './offer-letter';
import { timelineQueryKey } from '../Overrides';

/**
 * FB-20 (F-070): the customer offer letter, on the quote page. The letter is made only after Final
 * Review approves the quote; its prices come from the costing workbook and cannot be edited here. The
 * KAM types only the Attention line and a Part # per item. The server re-checks everything.
 */

/** Under the quote's key, so anything that refreshes the quote refreshes this. */
export const offerLetterQueryKey = (quoteNumber: string) =>
  ['quote', quoteNumber, 'offer-letter'] as const;

export const OFFER_LETTER_ANCHOR = 'offer-letter';

export function OfferLetterCard({ quote }: { quote: QuoteDetail }) {
  const q = useQuery({
    queryKey: offerLetterQueryKey(quote.quoteNumber),
    queryFn: () => api.offerLetter(quote.quoteNumber),
  });
  const ref = useRef<HTMLElement>(null);
  // My proposals links here (#offer-letter): scroll once the card has its content.
  useEffect(() => {
    if (q.data && window.location.hash === `#${OFFER_LETTER_ANCHOR}`) {
      ref.current?.scrollIntoView({ block: 'start' });
    }
  }, [q.data]);

  if (!q.data) return null;
  const data = q.data;
  // UX-012: nothing to show until Final Review has approved the quote. Once a letter can be made, or
  // one already exists (an earlier version's), the card is shown.
  if (!data.available && data.letters.length === 0) return null;

  return (
    <section
      ref={ref}
      id={OFFER_LETTER_ANCHOR}
      aria-labelledby="offer-letter-title"
      data-testid="offer-letter-card"
      data-state={!data.available ? 'not-available' : data.canGenerate ? 'ready' : 'blocked'}
      // The page's own scroll padding (index.css) already clears the sticky header.
      className="scroll-mt-1"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="offer-letter-title" className="flex items-center gap-2 text-base font-semibold">
              <FileTextIcon className="size-4" aria-hidden="true" />
              Offer letter
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!data.available ? (
            <p className="text-foreground-2 text-sm" data-testid="offer-letter-not-available">
              Not available yet. The offer letter is made once Final Review approves the quote.
            </p>
          ) : data.blockers.length > 0 ? (
            <Blockers quoteNumber={quote.quoteNumber} blockers={data.blockers} />
          ) : data.mayGenerate ? (
            <GenerateForm quoteNumber={quote.quoteNumber} data={data} />
          ) : (
            <p className="text-foreground-2 text-sm">
              The quote&rsquo;s KAM, a sales leader or Pricing generates the offer letter.
            </p>
          )}
          {data.letters.length > 0 && <LetterList letters={data.letters} />}
        </CardContent>
      </Card>
    </section>
  );
}

function Blockers({
  quoteNumber,
  blockers,
}: {
  quoteNumber: string;
  blockers: OfferLetterResponse['blockers'];
}) {
  return (
    <div className="grid gap-2" data-testid="offer-letter-blockers">
      <p className="text-sm font-medium">The offer letter cannot be generated yet:</p>
      <ul className="grid gap-2">
        {blockers.map((b, i) => {
          const tab = blockerTab(b.fixAt);
          const fix = blockerFixText(b.fixAt);
          return (
            <li
              key={`${b.code}-${b.itemNo ?? i}`}
              data-code={b.code}
              className="flex items-start gap-2 text-sm"
            >
              <AlertTriangleIcon
                className="text-warning-foreground mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>
                {b.message}
                {tab && fix && (
                  <>
                    {' '}
                    <Link
                      to="/quotes/$quoteNumber"
                      params={{ quoteNumber }}
                      search={{ tab }}
                      className="text-emphasis whitespace-nowrap underline underline-offset-4"
                    >
                      {fix} →
                    </Link>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GenerateForm({ quoteNumber, data }: { quoteNumber: string; data: OfferLetterResponse }) {
  const qc = useQueryClient();
  const preview = data.preview!;
  const [form, setForm] = useState<OfferLetterForm>({ attention: '', partNumbers: {} });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<{
    message: string;
    lines: string[];
  } | null>(null);
  const warnings = formWarnings(data, form);
  const ready = allAcknowledged(warnings, ticked);
  const showMolds = preview.items.some((i) => i.moldCharge);
  const showChangeParts = preview.items.some((i) => i.changePartsCharge);

  const generate = useMutation({
    mutationFn: () =>
      api.generateOfferLetter(quoteNumber, {
        attention: form.attention.trim() || null,
        items: preview.items.map((i) => ({
          itemId: i.itemId,
          partNumber: form.partNumbers[i.itemNo]?.trim() || null,
        })),
        acknowledgedWarnings: warnings.map((w) => w.code),
      }),
    onSuccess: async (out) => {
      setProblem(null);
      setForm({ attention: '', partNumbers: {} });
      setTicked(new Set());
      void qc.invalidateQueries({ queryKey: offerLetterQueryKey(quoteNumber) });
      void qc.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) });
      toast.success({ title: `Offer letter ${out.letter.letterNo} generated` });
      try {
        const link = await api.attachmentLink(out.letter.attachmentId);
        openFileLink(link.url);
      } catch (err) {
        toast.error({
          title: 'The letter was made, but the download did not start',
          description:
            (isApiError(err) && err.problem.detail) || 'Download it from the list of letters.',
        });
      }
    },
    onError: (err) => {
      if (isApiError(err)) {
        const lists = problemLists(err.problem);
        setProblem({
          message: err.problem.detail ?? err.problem.title,
          lines: [...lists.blockers, ...lists.warnings].map((x) => x.message),
        });
        if (err.status === 409)
          void qc.invalidateQueries({ queryKey: offerLetterQueryKey(quoteNumber) });
      } else {
        setProblem({
          message: 'The offer letter could not be generated. Please try again.',
          lines: [],
        });
      }
    },
  });

  const toggle = (code: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });

  return (
    <form
      className="grid gap-4"
      data-testid="offer-letter-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) generate.mutate();
      }}
    >
      {data.draftText && (
        <p
          role="status"
          data-testid="offer-letter-draft-banner"
          className="bg-warning text-warning-foreground flex items-start gap-2 rounded-md px-3 py-2 text-sm"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            The letter will be marked &ldquo;{data.draftText}&rdquo; until an Admin records
            Legal&rsquo;s approval of the wording.
          </span>
        </p>
      )}

      <div className="grid gap-1.5 sm:max-w-md">
        <label htmlFor="offer-attention" className="text-sm font-medium">
          Attention
        </label>
        <Input
          id="offer-attention"
          maxLength={120}
          value={form.attention}
          onChange={(e) => setForm((f) => ({ ...f, attention: e.target.value }))}
          aria-describedby="offer-attention-hint"
          autoComplete="off"
        />
        <span id="offer-attention-hint" className="text-muted-foreground text-xs">
          The customer contact the letter is addressed to, e.g. &ldquo;Alex Buyer,
          Procurement&rdquo;.
        </span>
      </div>

      <div className="grid gap-2">
        <h3 className="text-sm font-medium">What the letter will print</h3>
        <div className="overflow-x-auto rounded-md border">
          <table
            className="w-full min-w-[36rem] text-left text-sm"
            data-testid="offer-letter-preview"
          >
            <caption className="sr-only">Items and prices on the offer letter</caption>
            <thead className="bg-secondary text-foreground-2 text-xs">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Item
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Part #
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Place of manufacture
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Annual volume
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {preview.labels.piecePrice}
                </th>
                {showMolds && (
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {preview.labels.molds}
                  </th>
                )}
                {showChangeParts && (
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {preview.labels.changeParts}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {preview.items.map((i) => (
                <tr key={i.itemNo} className="border-t" data-testid={`offer-item-${i.itemNo}`}>
                  <td className="px-3 py-2 align-top">
                    <span className="font-medium">{i.name}</span>
                    <span className="text-muted-foreground block text-xs">{i.partDescription}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      aria-label={`Part # for ${i.name}`}
                      maxLength={60}
                      className="min-w-28"
                      value={form.partNumbers[i.itemNo] ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          partNumbers: { ...f.partNumbers, [i.itemNo]: e.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2 align-top">{i.placeOfManufacture ?? '–'}</td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">
                    {volumeText(i.annualVolume)}
                  </td>
                  <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">
                    {i.piecePricePer1000 ?? '–'}
                  </td>
                  {showMolds && (
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {i.moldCharge ?? ''}
                    </td>
                  )}
                  {showChangeParts && (
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {i.changePartsCharge ?? ''}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.source && (
          <p className="text-muted-foreground text-xs" data-testid="offer-letter-source">
            {data.source.text}. Figures come from the workbook and cannot be edited here.
          </p>
        )}
      </div>

      {preview.assumptions.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Pricing assumptions on the letter ({preview.assumptions.length})
          </summary>
          <ul className="text-foreground-2 mt-2 grid list-disc gap-1 pl-5">
            {preview.assumptions.map((a, i) => (
              <li key={i}>
                {a.text}
                {a.points.length > 0 && (
                  <ul className="mt-1 list-[circle] pl-5">
                    {a.points.map((p, j) => (
                      <li key={j}>{p}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {warnings.length > 0 && (
        <fieldset className="grid gap-2" data-testid="offer-letter-warnings">
          <legend className="mb-1 text-sm font-medium">Before you generate, confirm:</legend>
          {warnings.map((w) => (
            <label key={w.code} className="flex min-h-11 items-start gap-2 text-sm sm:min-h-0">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0"
                checked={ticked.has(w.code)}
                onChange={(e) => toggle(w.code, e.target.checked)}
                data-code={w.code}
              />
              <span>{w.message}</span>
            </label>
          ))}
        </fieldset>
      )}

      {problem && (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive grid gap-1 rounded-md px-3 py-2 text-sm"
        >
          <p className="font-medium">{problem.message}</p>
          {problem.lines.length > 0 && (
            <ul className="list-disc pl-5">
              {problem.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <Button type="submit" disabled={!ready || generate.isPending}>
          <FileTextIcon aria-hidden="true" />
          {generate.isPending ? 'Generating…' : 'Generate Word document'}
        </Button>
        {!ready && (
          <p className="text-muted-foreground mt-1 text-xs">Tick each point above to continue.</p>
        )}
      </div>
    </form>
  );
}

function LetterList({ letters }: { letters: OfferLetterSummary[] }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Letters generated</h3>
      <ul className="divide-y rounded-md border" data-testid="offer-letter-list">
        {letters.map((l) => (
          <LetterRow key={l.id} letter={l} />
        ))}
      </ul>
    </div>
  );
}

function LetterRow({ letter: l }: { letter: OfferLetterSummary }) {
  const download = useMutation({
    mutationFn: () => api.attachmentLink(l.attachmentId),
    onSuccess: (link) => openFileLink(link.url),
    onError: (err) =>
      toast.error({
        title: 'Could not download the letter',
        description: (isApiError(err) && err.problem.detail) || 'Please try again.',
      }),
  });
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
      data-testid="offer-letter-row"
      data-letter={l.letterNo}
      data-superseded={l.superseded}
    >
      <div className="grid min-w-0 gap-0.5">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          Letter {l.letterNo}
          {l.superseded && (
            <span
              className="bg-secondary text-foreground-2 rounded-pill px-2 py-0.5 text-xs font-semibold"
              title="Made for an earlier version of the quote"
            >
              Superseded
            </span>
          )}
          {!l.wordingApproved && (
            <span className="text-muted-foreground text-xs font-normal">Draft wording</span>
          )}
        </span>
        <span className="text-muted-foreground text-xs">
          Dated {calendarDate(l.letterDate)} · {l.itemCount} item{l.itemCount === 1 ? '' : 's'} · by{' '}
          {l.generatedByName ?? 'someone'} on {absoluteTime(l.generatedAt)}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => download.mutate()}
        disabled={download.isPending}
        aria-label={`Download letter ${l.letterNo} (${l.fileName})`}
      >
        <DownloadIcon aria-hidden="true" />
        Download
      </Button>
    </li>
  );
}
