import type { PricingHistoryImportResponse } from '@ccq/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheetIcon, UploadIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { api, importPricingHistory } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';

export const pricingHistoryStatusKey = ['admin', 'pricing-history'] as const;

const KIND_LABEL = { erf: 'ERF', bpr: 'BPR', spr: 'SPR' } as const;
const n = (v: number) => v.toLocaleString('en-US');

function Summary({ result }: { result: PricingHistoryImportResponse }) {
  return (
    <div className="grid gap-2 text-sm" data-testid="pricing-import-summary">
      <p className="font-medium">
        {result.applied ? 'Imported' : 'Checked'} {result.fileName} in{' '}
        {Math.round(result.durationMs / 100) / 10} s
        {result.written
          ? `: ${n(result.written.inserted)} new, ${n(result.written.updated)} changed, ${n(result.written.unchanged)} unchanged.`
          : '. Nothing was written.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th className="py-1 pr-3 font-medium">Sheet</th>
              <th className="py-1 pr-3 font-medium">Rows</th>
              <th className="py-1 pr-3 font-medium">Skipped</th>
              <th className="py-1 pr-3 font-medium">New / already in CCQ</th>
              <th className="py-1 pr-3 font-medium">Fiscal years</th>
              <th className="py-1 pr-3 font-medium">Repeated numbers</th>
              <th className="py-1 pr-3 font-medium">0 read as unknown</th>
            </tr>
          </thead>
          <tbody>
            {result.sheets.map((s) => (
              <tr key={s.kind} className="border-t" data-testid={`pricing-import-${s.kind}`}>
                <td className="py-1 pr-3">
                  {KIND_LABEL[s.kind]} <span className="text-muted-foreground">({s.sheet})</span>
                </td>
                <td className="py-1 pr-3">{n(s.valid)}</td>
                <td className="py-1 pr-3">{n(s.skipped)}</td>
                <td className="py-1 pr-3">
                  {n(s.newRows)} / {n(s.existingRows)}
                </td>
                <td className="py-1 pr-3">
                  {s.fiscalYears.from ?? '–'}–{s.fiscalYears.to ?? '–'}
                </td>
                <td className="py-1 pr-3">{n(s.duplicateNumbers)}</td>
                <td className="py-1 pr-3">{n(s.zeroAsUnknown)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.sheets.some((s) => s.missingColumns.length > 0) && (
        <p className="bg-warning text-warning-foreground rounded-md px-3 py-2">
          Missing columns (their values will be empty):{' '}
          {result.sheets
            .filter((s) => s.missingColumns.length > 0)
            .map((s) => `${KIND_LABEL[s.kind]}: ${s.missingColumns.join(', ')}`)
            .join('; ')}
        </p>
      )}
    </div>
  );
}

/**
 * B-15 (revised): Admin loads the retired pricing app's export (ERF, BPR, SPR sheets) into CCQ.
 * "Check file" reads and reports without writing; "Import" writes it (re-importing the same file
 * changes nothing; a corrected export updates the rows it changes). The server enforces
 * config.manage and audits every import.
 */
export function PricingHistoryImport() {
  const inputId = useId();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PricingHistoryImportResponse | null>(null);
  const status = useQuery({ queryKey: pricingHistoryStatusKey, queryFn: api.pricingHistoryStatus });
  const run = useMutation({
    mutationFn: (apply: boolean) => importPricingHistory(file!, apply),
    onSuccess: (res) => {
      setResult(res);
      if (res.applied) toast.success({ title: 'Pricing history imported' });
    },
    onError: (err) =>
      toast.error({ title: 'Import failed', description: describeError(err).message }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: pricingHistoryStatusKey }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] }),
      ]),
  });
  const checked = result && !result.applied && result.fileName === file?.name;
  const source = status.data?.source;

  return (
    <section
      aria-labelledby="pricing-history-import"
      className="bg-card rounded-card mb-6 grid gap-3 border p-4"
      data-testid="pricing-history-import"
    >
      <h2 id="pricing-history-import" className="font-display flex items-center gap-2 text-lg">
        <FileSpreadsheetIcon className="size-5" aria-hidden="true" />
        Pricing history
      </h2>
      <p className="text-muted-foreground text-sm">
        The retired pricing app&apos;s export (an .xlsx with the ERF Export, BPR Export and SPR
        Export sheets from IT). There is no live connection: import a new export to refresh it.
      </p>
      {status.isError ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <p className="text-sm" data-testid="pricing-history-loaded">
          {source?.imported
            ? `Loaded: ${n(source.counts.erf)} ERFs, ${n(source.counts.bpr)} BPRs, ${n(source.counts.spr)} SPRs${
                source.importedAt ? `, last imported ${absoluteTime(source.importedAt)}` : ''
              }.`
            : 'Nothing imported yet.'}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={inputId} className="grid gap-1 text-sm">
          <span className="font-medium">Export file</span>
          <input
            id={inputId}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="text-sm"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
            }}
          />
        </label>
        <Button
          variant="outline"
          disabled={!file || run.isPending}
          onClick={() => run.mutate(false)}
        >
          {run.isPending && run.variables === false ? 'Checking…' : 'Check file'}
        </Button>
        <Button disabled={!file || !checked || run.isPending} onClick={() => run.mutate(true)}>
          <UploadIcon className="size-4" aria-hidden="true" />
          {run.isPending && run.variables === true ? 'Importing…' : 'Import'}
        </Button>
      </div>
      {!checked && file && !run.isPending && !result && (
        <p className="text-muted-foreground text-xs">Check the file first: Import unlocks after.</p>
      )}
      {result && <Summary result={result} />}
    </section>
  );
}
