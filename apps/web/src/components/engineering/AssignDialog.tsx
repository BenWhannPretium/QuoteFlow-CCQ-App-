import type { AssignableEngineer, SuggestedEngineer } from '@ccq/contracts';
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

export const engQueueQueryKey = ['eng-queue'] as const;

export interface QuoteSuggestion {
  quoteNumber: string;
  suggested: SuggestedEngineer | null;
}

/**
 * FB-06 (F-062): the routing suggestion for the quotes in the dialog. One engineer for all of them →
 * "Suggested: <name>"; mixed → each quote's own; none of them has one → nothing. Never chosen for you.
 */
export function suggestionFor(
  suggestions: readonly QuoteSuggestion[],
): { userId: string | null; text: string } | null {
  const named = suggestions.filter((s) => s.suggested);
  if (named.length === 0) return null;
  const ids = new Set(named.map((s) => s.suggested!.userId));
  const basis = (s: SuggestedEngineer) => [s.processType, s.resin].filter(Boolean).join(' · ');
  if (ids.size === 1 && named.length === suggestions.length) {
    const s = named[0]!.suggested!;
    return { userId: s.userId, text: `Suggested: ${s.name}${basis(s) ? ` (${basis(s)})` : ''}` };
  }
  return {
    userId: null,
    text: `Suggested: ${named.map((n) => `${n.quoteNumber} → ${n.suggested!.name}`).join('; ')}`,
  };
}

/**
 * Assign (or reassign) one or more quotes to an engineer. The picker shows each engineer's open
 * count. A bulk assign sends one request per quote (each is recorded and audited on its own) and
 * reports any that failed.
 */
export function AssignDialog({
  open,
  onOpenChange,
  quoteNumbers,
  engineers,
  currentEngineerId,
  suggestions = [],
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteNumbers: string[];
  engineers: AssignableEngineer[];
  currentEngineerId?: string | null;
  /** FB-06 (F-062): the routing suggestion per quote; the lead still chooses. */
  suggestions?: readonly QuoteSuggestion[];
  onDone?: () => void;
}) {
  const suggestion = suggestionFor(suggestions);
  const queryClient = useQueryClient();
  const id = useId();
  const [engineerId, setEngineerId] = useState(currentEngineerId ?? '');
  const [error, setError] = useState<string | null>(null);
  const bulk = quoteNumbers.length > 1;

  const mutation = useMutation({
    mutationFn: async () => {
      const failed: string[] = [];
      let changed = 0;
      for (const qn of quoteNumbers) {
        try {
          if ((await api.assignEngineer(qn, engineerId)).changed) changed += 1;
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
        queryClient.invalidateQueries({ queryKey: engQueueQueryKey }),
        ...quoteNumbers.flatMap((qn) => [
          queryClient.invalidateQueries({ queryKey: quoteQueryKey(qn) }),
          queryClient.invalidateQueries({ queryKey: timelineQueryKey(qn) }),
        ]),
      ]);
      const name = engineers.find((e) => e.id === engineerId)?.displayName ?? 'the engineer';
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
          <DialogTitle>{currentEngineerId ? 'Reassign' : 'Assign'} engineer</DialogTitle>
          <DialogDescription>
            {bulk ? `${quoteNumbers.length} quotes: ${quoteNumbers.join(', ')}` : quoteNumbers[0]}
          </DialogDescription>
        </DialogHeader>
        <form
          id="assign-form"
          className="grid gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!engineerId) {
              setError('Choose an engineer.');
              return;
            }
            mutation.mutate();
          }}
        >
          <label htmlFor={id} className="text-sm font-medium">
            Engineer
          </label>
          <NativeSelect
            id={id}
            value={engineerId}
            onChange={(e) => setEngineerId(e.target.value)}
            aria-invalid={!!error && !engineerId}
          >
            <option value="">Choose an engineer…</option>
            {engineers.map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName} ({e.openCount} open{e.roles.includes('EngLead') ? ', lead' : ''})
              </option>
            ))}
          </NativeSelect>
          {suggestion && (
            <p className="text-muted-foreground text-sm" data-testid="assign-suggestion">
              {suggestion.text}
              {suggestion.userId &&
                suggestion.userId !== engineerId &&
                engineers.some((e) => e.id === suggestion.userId) && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="text-foreground underline"
                      onClick={() => setEngineerId(suggestion.userId!)}
                    >
                      Use it
                    </button>
                  </>
                )}
            </p>
          )}
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
          <Button type="submit" form="assign-form" disabled={mutation.isPending}>
            {mutation.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
