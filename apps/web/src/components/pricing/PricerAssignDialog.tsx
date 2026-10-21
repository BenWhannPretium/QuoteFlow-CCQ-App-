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
import { pricingQueueQueryKey } from './QuotingTab';

/**
 * B-26 (A6): the pricing lead triages Quoting by assigning each quote to a pricer. The picker shows
 * each pricer's open load in Quoting. The pricer is notified; the move is recorded and audited.
 */
export function PricerAssignDialog({
  open,
  onOpenChange,
  quoteNumber,
  currentPricerId,
  pricers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteNumber: string;
  currentPricerId: string | null;
  pricers: PricingQueueResponse['pricers'];
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const [pricerId, setPricerId] = useState(currentPricerId ?? '');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.assignPricer(quoteNumber, pricerId),
    onSuccess: async (res) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pricingQueueQueryKey }),
        queryClient.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) }),
        queryClient.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) }),
      ]);
      toast.success({
        title: `Assigned to ${res.assignedPricerName ?? 'the pricer'}`,
        description: res.changed
          ? 'They have been notified.'
          : 'Nothing changed: already assigned.',
      });
      onOpenChange(false);
    },
    onError: (err) =>
      setError(isApiError(err) ? (err.problem.detail ?? err.problem.title) : 'Try again.'),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{currentPricerId ? 'Reassign' : 'Assign'} pricer</DialogTitle>
          <DialogDescription>{quoteNumber}</DialogDescription>
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
          <NativeSelect id={id} value={pricerId} onChange={(e) => setPricerId(e.target.value)}>
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
