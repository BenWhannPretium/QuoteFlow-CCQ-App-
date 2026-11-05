import type { SectionLockView } from '@ccq/contracts';
import { LockIcon } from 'lucide-react';

/** The decision date in the user's locale (dates only: "Nov 5, 2026"). */
function decidedOn(iso: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
}

/**
 * FB-01 (F-001): the line a locked section shows: "Locked after G2 · decided by Jim Zweifel on
 * Nov 5, 2026 · reopens if the quote is sent back". The section's fields are read-only and its edit
 * controls are hidden; the server refuses the write either way (409 SECTION_LOCKED).
 */
export function SectionLockLine({ lock }: { lock: SectionLockView }) {
  if (!lock.locked) return null;
  return (
    <p
      className="text-muted-foreground flex items-start gap-2 text-xs"
      data-testid="section-lock"
      data-gate={lock.gate ?? undefined}
    >
      <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>
        Locked after {lock.gate}
        {lock.decidedByName ? ` · decided by ${lock.decidedByName}` : ''}
        {lock.decidedAt ? ` on ${decidedOn(lock.decidedAt)}` : ''} · reopens if the quote is sent
        back
      </span>
    </p>
  );
}
