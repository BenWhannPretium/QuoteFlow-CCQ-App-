import { describe, expect, it } from 'vitest';

import { computeHoldMs, computeTimeInStage } from './time-in-stage';
import type { HoldInterval, StageHistoryEntry } from '../types/quote';

const at = (hours: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, 0) + hours * 3_600_000);
const H = 3_600_000;

describe('computeTimeInStage', () => {
  const history: StageHistoryEntry[] = [
    { stageKey: 'INTAKE', enteredAt: at(0), exitedAt: at(10) },
    { stageKey: 'ENG_REVIEW', enteredAt: at(10), exitedAt: null },
  ];

  it('without holds, active = elapsed (open stage runs to now)', () => {
    const [intake, eng] = computeTimeInStage(history, [], at(30));
    expect(intake).toMatchObject({
      stageKey: 'INTAKE',
      elapsedMs: 10 * H,
      heldMs: 0,
      activeMs: 10 * H,
    });
    expect(eng).toMatchObject({ elapsedMs: 20 * H, activeMs: 20 * H, exitedAt: null });
  });

  it('excludes closed hold intervals (CR-57)', () => {
    const holds: HoldInterval[] = [{ startedAt: at(12), endedAt: at(20) }];
    const [, eng] = computeTimeInStage(history, holds, at(30));
    expect(eng).toMatchObject({ elapsedMs: 20 * H, heldMs: 8 * H, activeMs: 12 * H });
  });

  it('treats an open hold as running to now', () => {
    const [, eng] = computeTimeInStage(history, [{ startedAt: at(25), endedAt: null }], at(30));
    expect(eng).toMatchObject({ heldMs: 5 * H, activeMs: 15 * H });
  });

  it('clips a hold to each stage window', () => {
    const holds: HoldInterval[] = [{ startedAt: at(8), endedAt: at(14) }];
    const [intake, eng] = computeTimeInStage(history, holds, at(30));
    expect(intake).toMatchObject({ heldMs: 2 * H, activeMs: 8 * H });
    expect(eng).toMatchObject({ heldMs: 4 * H, activeMs: 16 * H });
  });

  it('does not double count overlapping or touching holds', () => {
    const holds: HoldInterval[] = [
      { startedAt: at(11), endedAt: at(15) },
      { startedAt: at(13), endedAt: at(18) },
      { startedAt: at(18), endedAt: at(19) },
      { startedAt: at(40), endedAt: at(41) }, // outside the window
      { startedAt: at(5), endedAt: at(5) }, // empty
    ];
    const [, eng] = computeTimeInStage(history, holds, at(30));
    expect(eng!.heldMs).toBe(8 * H);
  });

  it('handles a stage entered "in the future" and empty history', () => {
    expect(
      computeTimeInStage([{ stageKey: 'X', enteredAt: at(5), exitedAt: null }], [], at(1))[0],
    ).toMatchObject({
      elapsedMs: 0,
      heldMs: 0,
      activeMs: 0,
    });
    expect(computeTimeInStage([], [], at(1))).toEqual([]);
  });

  it('computeHoldMs is usable on its own', () => {
    expect(computeHoldMs([{ startedAt: at(1), endedAt: at(3) }], at(0), at(2), at(9))).toBe(H);
  });
});
