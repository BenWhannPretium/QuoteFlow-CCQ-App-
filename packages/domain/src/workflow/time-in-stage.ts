import type { HoldInterval, StageHistoryEntry } from '../types/quote';

export interface StageTime {
  stageKey: string;
  enteredAt: Date;
  exitedAt: Date | null;
  /** Wall-clock time in the stage (open stages run to `now`). */
  elapsedMs: number;
  /** Time inside the stage window that the quote spent on hold. */
  heldMs: number;
  /** `elapsedMs - heldMs`: the number SLAs and cycle-time reports use (CR-55, CR-57). */
  activeMs: number;
}

interface Span {
  start: number;
  end: number;
}

/** Sorts and merges overlapping spans so a double-recorded hold is never counted twice. */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** Milliseconds of `holds` that fall inside [from, to]. Open holds run to `now`. */
export function computeHoldMs(
  holds: readonly HoldInterval[],
  from: Date,
  to: Date,
  now: Date,
): number {
  const spans = mergeSpans(
    holds.map((h) => ({ start: h.startedAt.getTime(), end: (h.endedAt ?? now).getTime() })),
  );
  let total = 0;
  for (const span of spans) {
    const start = Math.max(span.start, from.getTime());
    const end = Math.min(span.end, to.getTime());
    if (end > start) total += end - start;
  }
  return total;
}

/** Per stage visit: elapsed, held and active time. Holds are excluded from `activeMs` (CR-57). */
export function computeTimeInStage(
  history: readonly StageHistoryEntry[],
  holds: readonly HoldInterval[],
  now: Date,
): StageTime[] {
  return history.map((entry) => {
    const end = entry.exitedAt ?? now;
    const elapsedMs = Math.max(0, end.getTime() - entry.enteredAt.getTime());
    const heldMs = elapsedMs === 0 ? 0 : computeHoldMs(holds, entry.enteredAt, end, now);
    return {
      stageKey: entry.stageKey,
      enteredAt: entry.enteredAt,
      exitedAt: entry.exitedAt,
      elapsedMs,
      heldMs,
      activeMs: elapsedMs - heldMs,
    };
  });
}
