import type { BulkReassignBody, BulkReassignResponse } from '@ccq/contracts';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/input';
import { isApiError } from '@/lib/api';
import { toast } from '@/lib/toast';

export interface ReassignPerson {
  id: string;
  displayName: string;
  openCount: number;
}

/**
 * B-26 (A1, A6): move a person's open work to someone else in one step, e.g. when an engineer or a
 * pricer is out. With `quoteNumbers` only those quotes move (the selected rows); otherwise every open
 * quote assigned to the "from" person. The server records and audits each move on its own and says
 * which quotes it skipped and why.
 */
export function BulkReassignDialog({
  open,
  onOpenChange,
  title,
  noun,
  people,
  quoteNumbers,
  queryKey,
  reassign,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** "engineer" or "pricer". */
  noun: string;
  people: ReassignPerson[];
  quoteNumbers?: string[] | undefined;
  /** Invalidated after a move. */
  queryKey: QueryKey;
  reassign: (body: BulkReassignBody) => Promise<BulkReassignResponse>;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = { from: useId(), to: useId() };
  const [fromUserId, setFrom] = useState('');
  const [toUserId, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkReassignResponse | null>(null);
  const listed = quoteNumbers && quoteNumbers.length > 0 ? quoteNumbers : undefined;

  const mutation = useMutation({
    mutationFn: () =>
      reassign({ fromUserId, toUserId, ...(listed ? { quoteNumbers: listed } : {}) }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey });
      const name = res.toUserName ?? `the ${noun}`;
      toast.success({
        title:
          res.reassigned.length === 0
            ? 'Nothing was reassigned'
            : `${res.reassigned.length} quote${res.reassigned.length === 1 ? '' : 's'} reassigned to ${name}`,
      });
      if (res.skipped.length > 0) {
        setResult(res);
        return;
      }
      onOpenChange(false);
      onDone?.();
    },
    onError: (err) =>
      setError(isApiError(err) ? (err.problem.detail ?? err.problem.title) : 'Try again.'),
  });

  const option = (p: ReassignPerson) => (
    <option key={p.id} value={p.id}>
      {p.displayName} ({p.openCount} open)
    </option>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" data-testid="bulk-reassign-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {listed
              ? `${listed.length} selected: ${listed.join(', ')}`
              : `Every open quote assigned to the ${noun} you pick moves to the new ${noun}.`}
          </DialogDescription>
        </DialogHeader>
        <form
          id="bulk-reassign-form"
          className="grid gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setResult(null);
            if (!fromUserId || !toUserId) {
              setError(`Choose both ${noun}s.`);
              return;
            }
            if (fromUserId === toUserId) {
              setError(`Choose a different ${noun} to move the work to.`);
              return;
            }
            mutation.mutate();
          }}
        >
          <label htmlFor={ids.from} className="text-sm font-medium">
            From
          </label>
          <NativeSelect id={ids.from} value={fromUserId} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose a {noun}…</option>
            {people.map(option)}
          </NativeSelect>
          <label htmlFor={ids.to} className="text-sm font-medium">
            To
          </label>
          <NativeSelect id={ids.to} value={toUserId} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a {noun}…</option>
            {people.filter((p) => p.id !== fromUserId).map(option)}
          </NativeSelect>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {result && (
            <div role="status" className="grid gap-1 text-sm" data-testid="bulk-reassign-skipped">
              <p className="font-medium">
                {result.reassigned.length} moved; {result.skipped.length} skipped:
              </p>
              <ul className="text-foreground-2 list-disc pl-5">
                {result.skipped.map((s) => (
                  <li key={s.quoteNumber}>
                    {s.quoteNumber}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          <Button type="submit" form="bulk-reassign-form" disabled={mutation.isPending}>
            {mutation.isPending ? 'Reassigning…' : 'Reassign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
