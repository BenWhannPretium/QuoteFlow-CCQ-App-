import { z } from 'zod';

import { DomainError } from '../errors';

/**
 * The engineering queue (F-04, DEC-26): a MANUAL prioritized queue to the upfront engineering lead,
 * who is alerted on arrival and assigns in-app. Rules-based routing is P1 ("we're intentionally doing
 * it manually so that we can learn", Darren 10/14), so nothing here routes work: it only orders,
 * ages and filters what the EngLead sees.
 */

/** The stage the engineering queue lists (hybrid seed: Engineering Review). */
export const ENG_QUEUE_STAGE_KEY = 'ENG_REVIEW';

/** Business days are counted on the US Central calendar (Pretium HQ). */
export const ENG_QUEUE_TIME_ZONE = 'America/Chicago';

export const engQueueSettingsSchema = z
  .object({
    /**
     * Aging bucket edges in business days (app_setting `eng_queue_aging_days`). Seed 3 / 10: 3 is Jim
     * Zweifel's unwritten turnaround target. These are buckets, NOT an SLA (D-20 open).
     */
    agingDays: z
      .object({
        aging: z.number().int().min(1),
        old: z.number().int().min(1),
      })
      .strict()
      .refine((a) => a.old >= a.aging, { message: 'old must be ≥ aging' }),
    /**
     * Users who may act as EngLead for assignment while the lead is out (Op Model R-04, app_setting
     * `eng_queue_backup_assigner_user_ids`). They also receive the arrival alert.
     */
    backupAssignerUserIds: z.array(z.string().min(1)),
  })
  .strict();

export type EngQueueSettings = z.infer<typeof engQueueSettingsSchema>;

export const ENG_QUEUE_SETTINGS_SEED: EngQueueSettings = {
  agingDays: { aging: 3, old: 10 },
  backupAssignerUserIds: [],
};

/** Parses untrusted config (`app_setting` rows). Throws INVALID_CONFIG. */
export function parseEngQueueSettings(input: unknown): EngQueueSettings {
  const parsed = engQueueSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new DomainError(
      'INVALID_CONFIG',
      `Engineering queue settings failed validation: ${detail}`,
    );
  }
  return parsed.data;
}

// ── Business days ────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The calendar date of `at` in `timeZone`, as a UTC-midnight timestamp (so date arithmetic is exact). */
function localDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'));
}

/**
 * Weekdays (Mon–Fri) after `from`'s local date up to and including `to`'s local date. Entered on a
 * Monday, it is 3 on Thursday; entered on a Friday, it is 1 on Monday. 0 when `to` ≤ `from`.
 * Public holidays are not excluded (no holiday calendar is configured yet).
 */
export function businessDaysBetween(from: Date, to: Date, timeZone = ENG_QUEUE_TIME_ZONE): number {
  const start = localDay(from, timeZone);
  const end = localDay(to, timeZone);
  if (end <= start) return 0;
  const days = Math.round((end - start) / DAY_MS);
  const fullWeeks = Math.floor(days / 7);
  let count = fullWeeks * 5;
  // The remaining 0–6 days after the full weeks, starting the day after `start`.
  const startDow = new Date(start).getUTCDay();
  for (let i = 1; i <= days - fullWeeks * 7; i++) {
    const dow = (startDow + i) % 7;
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

// ── Aging buckets ────────────────────────────────────────────────────────────────────────────────

export const AGING_BUCKETS = ['fresh', 'aging', 'old'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** fresh: < aging days · aging: aging…old days · old: > old days. */
export function agingBucket(
  businessDays: number,
  edges: EngQueueSettings['agingDays'],
): AgingBucket {
  if (businessDays < edges.aging) return 'fresh';
  if (businessDays <= edges.old) return 'aging';
  return 'old';
}

/** Chip labels, e.g. `< 3 days`, `3–10 days`, `> 10 days` (business days). */
export function agingBucketLabels(
  edges: EngQueueSettings['agingDays'],
): Record<AgingBucket, string> {
  return {
    fresh: `< ${edges.aging} days`,
    aging: `${edges.aging}–${edges.old} days`,
    old: `> ${edges.old} days`,
  };
}

export function countByAgingBucket(
  entries: readonly Pick<EngQueueEntry, 'agingBucket'>[],
): Record<AgingBucket, number> {
  const counts: Record<AgingBucket, number> = { fresh: 0, aging: 0, old: 0 };
  for (const e of entries) counts[e.agingBucket] += 1;
  return counts;
}

// ── Ordering and filtering ───────────────────────────────────────────────────────────────────────

/** What the queue orders and filters on (the API builds one per quote). */
export interface EngQueueEntry {
  quoteNumber: string;
  /** Displayed tier key (an override tier when one is applied); null when not scored or hidden. */
  tier: string | null;
  score: number | null;
  /** When the quote entered Engineering Review (the open stage_history row). */
  enteredQueueAt: Date;
  businessDaysInQueue: number;
  agingBucket: AgingBucket;
  /** Set only by an applied queue_position override (the EngLead's "pin to top"). */
  pinnedPosition: number | null;
  assignedEngineerId: string | null;
  productFamily: string | null;
  /** Lower-cased text the search box matches: quote number, customer, opportunity, KAM, engineer. */
  searchText: string;
}

/**
 * Default order: pinned first (by pinned position), then tier (highest first, in the scoring model's
 * tier order), then score (desc), then oldest in the queue first, then quote number.
 * `tierOrder` lists tier keys highest first; an unknown or missing tier sorts after the known ones.
 */
export function compareEngQueue(tierOrder: readonly string[]) {
  const rank = (tier: string | null) => {
    const i = tier ? tierOrder.indexOf(tier) : -1;
    return i === -1 ? tierOrder.length : i;
  };
  return (a: EngQueueEntry, b: EngQueueEntry): number => {
    const pa = a.pinnedPosition ?? Number.POSITIVE_INFINITY;
    const pb = b.pinnedPosition ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa < pb ? -1 : 1;
    const ta = rank(a.tier);
    const tb = rank(b.tier);
    if (ta !== tb) return ta - tb;
    const sa = a.score ?? Number.NEGATIVE_INFINITY;
    const sb = b.score ?? Number.NEGATIVE_INFINITY;
    if (sa !== sb) return sb > sa ? 1 : -1;
    const ea = a.enteredQueueAt.getTime();
    const eb = b.enteredQueueAt.getTime();
    if (ea !== eb) return ea - eb;
    return a.quoteNumber.localeCompare(b.quoteNumber);
  };
}

export function sortEngQueue<T extends EngQueueEntry>(
  entries: readonly T[],
  tierOrder: readonly string[],
): T[] {
  return [...entries].sort(compareEngQueue(tierOrder));
}

export interface EngQueueFilter {
  tiers?: readonly string[];
  /** An engineer's user id, or `unassigned`. */
  engineer?: string;
  /** Only quotes in the queue for more than this many business days. */
  agedOverDays?: number;
  agingBuckets?: readonly AgingBucket[];
  productFamilies?: readonly string[];
  /** Free text, matched case-insensitively against `searchText`. */
  q?: string;
}

export const UNASSIGNED = 'unassigned';

export function filterEngQueue<T extends EngQueueEntry>(
  entries: readonly T[],
  filter: EngQueueFilter,
): T[] {
  const q = filter.q?.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.tiers?.length && !(e.tier && filter.tiers.includes(e.tier))) return false;
    if (filter.engineer) {
      if (
        filter.engineer === UNASSIGNED
          ? e.assignedEngineerId !== null
          : e.assignedEngineerId !== filter.engineer
      )
        return false;
    }
    if (filter.agedOverDays !== undefined && !(e.businessDaysInQueue > filter.agedOverDays))
      return false;
    if (filter.agingBuckets?.length && !filter.agingBuckets.includes(e.agingBucket)) return false;
    if (
      filter.productFamilies?.length &&
      !(e.productFamily && filter.productFamilies.includes(e.productFamily))
    )
      return false;
    if (q && !e.searchText.includes(q)) return false;
    return true;
  });
}
