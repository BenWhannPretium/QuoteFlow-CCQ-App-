import type { SectionLockView } from '@ccq/contracts';
import { LockIcon } from 'lucide-react';

import { stageLabel, usePublicConfig } from '@/config/public-config';
import { lockedAfterText } from '@/lib/quote-header-text';
import { absoluteTime } from '@/lib/time';

/**
 * FB-01 (F-001): the line a locked section shows: "Locked after the Engineering & Capacity decision ·
 * decided by Jim Zweifel on Nov 5, 2026, 3:04 PM CST · reopens if the quote is sent back" (UX-013: the
 * gate's stage by its label, not the gate's number). The section's fields are read-only and
 * its edit controls are hidden; the server refuses the write either way (409 SECTION_LOCKED).
 * UX-011: the decision time is shown like every other time (US Central, zone named), not in the
 * browser's own zone and format.
 */
export function SectionLockLine({ lock }: { lock: SectionLockView }) {
  const { data: config } = usePublicConfig();
  if (!lock.locked) return null;
  const gate = config?.gates.find((g) => g.key === lock.gate);
  return (
    <p
      className="text-muted-foreground flex items-start gap-2 text-xs"
      data-testid="section-lock"
      data-gate={lock.gate ?? undefined}
    >
      <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {lockedAfterText(gate ? stageLabel(config, gate.stageKey) : null)}
        {lock.decidedByName ? ` · decided by ${lock.decidedByName}` : ''}
        {lock.decidedAt ? ` on ${absoluteTime(lock.decidedAt)}` : ''} · reopens if the quote is sent
        back
      </span>
    </p>
  );
}
