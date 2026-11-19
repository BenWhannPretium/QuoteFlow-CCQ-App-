import type { CapacityEvidenceRow, CapacitySignoff, EngPartView } from '@ccq/contracts';
import { EXCEEDS_CAPACITY_MESSAGE, capacityAtAGlance, roundPct } from '@ccq/domain';

import { absoluteTime } from './time';

/**
 * FB-30 (N19-28; Sarah Brennan, 2026-11-19): "what was the engineering recommendation" and "what was the
 * capacity recommendation", shown apart. Nothing new is stored: the engineering recommendation is the
 * engineer's solution, and the capacity recommendation is the capacity sign-off (approved or blocked, by
 * whom, when, the note) with what the capacity rows say. This file only words them.
 */

/** The sign-off as a sentence: "Capacity is signed off by … on …", or null when there is none yet. */
export function capacitySignoffText(signoff: CapacitySignoff): string | null {
  if (!signoff.status) return null;
  const by = signoff.byName ? ` by ${signoff.byName}` : '';
  const on = signoff.at ? ` on ${absoluteTime(signoff.at)}` : '';
  return signoff.status === 'approved'
    ? `Capacity is signed off${by}${on}`
    : `Capacity is blocked${by}${on}`;
}

/** What the reader sees until capacity is signed off. */
export const CAPACITY_NOT_SIGNED_OFF = 'Not signed off yet';
/** What the reader sees until the engineer's part is submitted. */
export const ENGINEERING_NOT_SUBMITTED = 'Not submitted yet';

/**
 * Who submitted a part to the engineering lead, and when. A part whose owner is an engineering lead needs
 * no submit (FB-22, D2). Null when nothing is known about the part.
 */
export function partSubmittedText(part: EngPartView | null | undefined): string | null {
  if (!part) return null;
  if (part.submittedAt) {
    return `Submitted${part.submittedByName ? ` by ${part.submittedByName}` : ''} on ${absoluteTime(part.submittedAt)}`;
  }
  if (part.ownerIsLead) {
    return `${part.ownerName ?? 'The engineer'} is an engineering lead: no submit needed`;
  }
  return ENGINEERING_NOT_SUBMITTED;
}

/**
 * One capacity row in a line: where, how loaded the line is with this business (the stored, calculated
 * figure, with the same words as the tab: "above 85%", "exceeds line capacity"), and the practical
 * capacity of the line (FB-14's "Capacity at a glance"). Null when the row has nothing to say yet.
 */
export function capacityHeadline(
  row: Pick<
    CapacityEvidenceRow,
    | 'site'
    | 'lineAsset'
    | 'utilizationAfterPct'
    | 'utilizationLevel'
    | 'cycleTimeS'
    | 'assumedEffectivenessPct'
    | 'scheduledRunDaysPerYear'
  >,
  context: {
    /** The plant's name for the row's site code. */
    siteLabel: string;
    /** The item's cavitation (the engineer's solution). */
    cavitation: number | null | undefined;
    /** `capacity_basis`: the run days a row uses when it names none, and the warning threshold. */
    scheduledRunDaysPerYear: number;
    warnAbovePct: number;
  },
): string {
  const where = [context.siteLabel, row.lineAsset].filter(Boolean).join(' · ');
  const parts: string[] = [];
  if (row.utilizationAfterPct != null) {
    const level =
      row.utilizationLevel === 'over'
        ? ` (${EXCEEDS_CAPACITY_MESSAGE})`
        : row.utilizationLevel === 'warn'
          ? ` (above ${context.warnAbovePct}%)`
          : '';
    parts.push(
      `${roundPct(row.utilizationAfterPct, 1).toFixed(1)}% loaded with this business${level}`,
    );
  }
  const glance = capacityAtAGlance({
    cycleTimeS: row.cycleTimeS,
    cavitation: context.cavitation,
    effectivenessPct: row.assumedEffectivenessPct,
    scheduledRunDaysPerYear: row.scheduledRunDaysPerYear ?? context.scheduledRunDaysPerYear,
  });
  if (glance) {
    parts.push(
      `practical capacity ${Math.round(glance.practical.perYear).toLocaleString('en-US')} parts a year`,
    );
  }
  return parts.length > 0 ? `${where}: ${parts.join(', ')}` : where;
}
