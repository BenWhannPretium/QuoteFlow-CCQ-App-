import type { ModelSummaryFieldView, ModelSummaryView } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangleIcon } from 'lucide-react';

import { api } from '@/lib/api';
import { absoluteTime } from '@/lib/time';

/**
 * FB-14 (F-031 summary half, D-013): the one-page summary read from an uploaded costing or payback
 * workbook, shown read-only in its Quoting step and at Final Review. The figures are the workbook's own
 * (cached values read at upload): QuoteFlow never recomputes or edits them. Errors, blanks and
 * negatives are shown as they are, with advisory warnings that never block anything.
 */

/** Under the quote's key, so anything that refreshes the quote (an upload, a removal) refreshes this. */
export const modelSummariesQueryKey = (quoteNumber: string) =>
  ['quote', quoteNumber, 'model-summaries'] as const;

export function useModelSummaries(quoteNumber: string) {
  return useQuery({
    queryKey: modelSummariesQueryKey(quoteNumber),
    queryFn: () => api.modelSummaries(quoteNumber),
  });
}

const usd = (v: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2,
  }).format(v);

/** A value as the workbook holds it, in the field's unit. Exported for tests. */
export function formatSummaryValue(f: ModelSummaryFieldView): string {
  switch (f.state) {
    case 'blank':
      return 'Blank in the workbook';
    case 'error':
      return f.text && f.text !== 'error' ? `Excel error (${f.text})` : 'Excel error';
    case 'not_calculated':
      return 'Not calculated';
    case 'not_found':
      return 'Not found in the workbook';
    case 'wrong_type':
      return `“${f.text ?? ''}” (text, not a ${f.type})`;
    case 'out_of_range':
      return `Out of range (${f.text ?? ''})`;
    case 'ok':
      break;
  }
  if (f.type === 'date') return f.date ?? '';
  if (f.type === 'text' || f.number === null) return f.text ?? '';
  const v = f.number;
  switch (f.unit) {
    case 'usd':
      return usd(v);
    case 'percent':
      return `${(v * 100).toFixed(1)}%`;
    case 'years':
      return `${v.toFixed(1)} years`;
    case 'units':
    case 'count':
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v);
    default:
      return String(v);
  }
}

const QUIET = new Set(['not_configured']);

export function ModelSummaryPanel({
  quoteNumber,
  kind,
  label,
}: {
  quoteNumber: string;
  kind: ModelSummaryView['kind'];
  /** "Costing model", "Payback model". */
  label: string;
}) {
  const q = useModelSummaries(quoteNumber);
  if (!q.data) return null;
  if (!q.data.visible) {
    return (
      <p className="text-muted-foreground text-xs" data-testid={`summary-hidden-${kind}`}>
        {q.data.hiddenText}
      </p>
    );
  }
  const s = q.data.summaries.find((x) => x.kind === kind);
  if (!s) return null;
  if (QUIET.has(s.status) || s.status === 'none') {
    return (
      <p
        className="text-muted-foreground text-xs"
        data-testid={`summary-${kind}`}
        data-status={s.status}
      >
        {s.reasonText}
      </p>
    );
  }
  const by = s.uploadedByName ?? 'someone';
  return (
    <div
      className="bg-secondary/40 grid gap-2 rounded-md border p-2"
      data-testid={`summary-${kind}`}
      data-status={s.status}
    >
      <p className="text-sm font-medium">{label} summary</p>
      {s.status === 'unavailable' ? (
        <p
          className="bg-warning text-warning-foreground rounded-md px-2 py-1 text-xs"
          role="status"
        >
          Summary unavailable. {s.reasonText}
        </p>
      ) : (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-xs">
          {s.fields.map((f) => (
            <div
              key={f.key}
              className="contents"
              data-testid={`summary-field-${f.key}`}
              data-state={f.state}
            >
              <dt
                className={f.headline ? 'font-medium' : 'text-muted-foreground'}
                title={`${f.sheet}!${f.ref}`}
              >
                {f.label}
              </dt>
              <dd
                className={
                  f.state === 'ok' ? 'text-right tabular-nums' : 'text-right font-semibold'
                }
              >
                {formatSummaryValue(f)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {s.warnings.length > 0 && (
        <ul className="grid gap-1 text-xs" data-testid={`summary-warnings-${kind}`}>
          {s.warnings.map((w, i) => (
            <li key={`${w.code}-${w.fieldKey ?? i}`} className="flex items-start gap-1.5">
              <AlertTriangleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs" data-testid={`summary-provenance-${kind}`}>
        Read from v{s.version}, uploaded by {by} on {absoluteTime(s.uploadedAt)}. Figures come from
        the workbook and cannot be edited here.
        {s.mapProvisional
          ? ' The cells read are provisional until the template owner confirms them.'
          : ''}
      </p>
    </div>
  );
}
