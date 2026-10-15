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
import { NativeSelect, Textarea } from '@/components/ui/input';
import { gateOutcomes, reasonCodesFor, usePublicConfig } from '@/config/public-config';
import { cn } from '@/lib/utils';

export interface GateDecision {
  outcomeKey: string;
  reasonCode?: string;
  note?: string;
}

/**
 * Shell only (B-09 wires it to the gate API). Outcomes, reason codes and "note required" come from
 * config. The checks here only guide the user; the domain engine on the server decides.
 */
export function GateDecisionDialog({
  open,
  onOpenChange,
  gateKey,
  quoteNumber,
  busy = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateKey: string;
  quoteNumber: string;
  busy?: boolean;
  onSubmit: (decision: GateDecision) => void;
}) {
  const { data: config } = usePublicConfig();
  const gate = config?.gates.find((g) => g.key === gateKey);
  const outcomes = gateOutcomes(config, gateKey);
  const [outcomeKey, setOutcomeKey] = useState<string>('');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const ids = { reason: useId(), note: useId(), error: useId() };

  const outcome = outcomes.find((o) => o.key === outcomeKey);
  const reasons = reasonCodesFor(config, outcome?.reasonContext ?? null);
  const reason = reasons.find((r) => r.code === reasonCode);
  const needsReason = !!outcome?.requiresReasonCode;
  const needsNote = !!outcome?.requiresNote || !!reason?.requiresNote;

  const problems = [
    !outcome && 'Choose a decision.',
    needsReason && !reason && 'Choose a reason.',
    needsNote && note.trim() === '' && 'Add a note.',
  ].filter((p): p is string => !!p);

  const reset = () => {
    setOutcomeKey('');
    setReasonCode('');
    setNote('');
    setSubmitted(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{gate?.label ?? gateKey}</DialogTitle>
          <DialogDescription>Record the decision for {quoteNumber}.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (problems.length > 0 || !outcome) return;
            onSubmit({
              outcomeKey: outcome.key,
              ...(reason ? { reasonCode: reason.code } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            });
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Decision</legend>
            {outcomes.length === 0 && (
              <p className="text-muted-foreground text-sm">No outcomes are configured.</p>
            )}
            {outcomes.map((o) => (
              <label
                key={o.key}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3',
                  outcomeKey === o.key && 'border-primary bg-secondary',
                )}
              >
                <input
                  type="radio"
                  name="outcome"
                  value={o.key}
                  checked={outcomeKey === o.key}
                  onChange={() => {
                    setOutcomeKey(o.key);
                    setReasonCode('');
                  }}
                  className="accent-[var(--primary)] size-4"
                />
                <span className="text-sm">{o.label}</span>
              </label>
            ))}
          </fieldset>

          {needsReason && (
            <div className="grid gap-1.5">
              <label htmlFor={ids.reason} className="text-sm font-medium">
                Reason
              </label>
              <NativeSelect
                id={ids.reason}
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                aria-invalid={submitted && !reason}
              >
                <option value="">Choose a reason…</option>
                {reasons.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          <div className="grid gap-1.5">
            <label htmlFor={ids.note} className="text-sm font-medium">
              Note {needsNote ? '(required)' : '(optional)'}
            </label>
            <Textarea
              id={ids.note}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={submitted && needsNote && note.trim() === ''}
            />
          </div>

          {submitted && problems.length > 0 && (
            <ul id={ids.error} role="alert" className="text-destructive text-sm">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy} aria-busy={busy}>
              {busy ? 'Saving…' : 'Record decision'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
