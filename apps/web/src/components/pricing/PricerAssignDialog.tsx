import type { PricingQueueResponse } from '@ccq/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { api, isApiError } from '@/lib/api';
import { toast } from '@/lib/toast';

import { quoteQueryKey } from '../GateDecisionDialog';
import { timelineQueryKey } from '../Overrides';

export const pricingQueueQueryKey = ['pricing-queue'] as const;

/**
 * B-26 (A6): the pricing lead triages Quoting by assigning quotes to a pricer, like the engineering
 * lead's AssignDialog: one quote or several. The picker shows each pricer's open load in Quoting. A
 * bulk assign sends one request per quote (each is recorded, audited and notified on its own) and
 * reports any that failed.
 */
export function PricerAssignDialog({
  open,
  onOpenChange,
  quoteNumbers,
  currentPricerId,
  pricers,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteNumbers: string[];
  currentPricerId?: string | null;
  pricers: PricingQueueResponse['pricers'];
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const [pricerId, setPricerId] = useState(currentPricerId ?? '');
  const [error, setError] = useState<string | null>(null);
  const bulk = quoteNumbers.length > 1;
  const mutation = useMutation({
    mutationFn: async () => {
      const failed: string[] = [];
      let changed = 0;
      for (const qn of quoteNumbers) {
        try {
          if ((await api.assignPricer(qn, pricerId)).changed) changed += 1;
        } catch (err) {
          failed.push(
            `${qn}: ${isApiError(err) ? (err.problem.detail ?? err.problem.title) : 'failed'}`,
          );
        }
      }
      return { changed, failed };
    },
    onSuccess: async ({ changed, failed }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pricingQueueQueryKey }),
        ...quoteNumbers.flatMap((qn) => [
          queryClient.invalidateQueries({ queryKey: quoteQueryKey(qn) }),
          queryClient.invalidateQueries({ queryKey: timelineQueryKey(qn) }),
        ]),
      ]);
      const name = pricers.find((p) => p.id === pricerId)?.displayName ?? 'the pricer';
      if (failed.length > 0) {
        setError(failed.join('; '));
        if (changed > 0) toast.success({ title: `${changed} assigned to ${name}` });
        return;
      }
      toast.success({
        title: bulk ? `${quoteNumbers.length} quotes assigned to ${name}` : `Assigned to ${name}`,
        description:
          changed === 0 ? 'Nothing changed: already assigned.' : 'They have been notified.',
      });
      onOpenChange(false);
      onDone?.();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{currentPricerId ? 'Reassign' : 'Assign'} pricer</DialogTitle>
          <DialogDescription>
            {bulk ? `${quoteNumbers.length} quotes: ${quoteNumbers.join(', ')}` : quoteNumbers[0]}
          </DialogDescription>
        </DialogHeader>
        <form
          id="pricer-assign-form"
          className="grid gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!pricerId) {
              setError('Choose a pricer.');
              return;
            }
            mutation.mutate();
          }}
        >
          <label htmlFor={id} className="text-sm font-medium">
            Pricer
          </label>
          <NativeSelect
            id={id}
            value={pricerId}
            onChange={(e) => setPricerId(e.target.value)}
            aria-invalid={!!error && !pricerId}
          >
            <option value="">Choose a pricer…</option>
            {pricers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} ({p.openAssigned} open)
              </option>
            ))}
          </NativeSelect>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" form="pricer-assign-form" disabled={mutation.isPending}>
            {mutation.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
