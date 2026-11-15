import { describe, expect, it } from 'vitest';

import { holdReasonLabel, onHoldFirst } from './hold-list';
import { hybridConfig } from './seeds/hybrid';

/**
 * FB-18 (W13-26): the Command Center marks an on-hold quote, lists it first and says why it is held.
 */
describe('holdReasonLabel', () => {
  const holdReasons = hybridConfig.reasonCodes.filter((r) => r.context === 'hold');

  it('names every seeded hold reason by its label', () => {
    expect(holdReasons.length).toBeGreaterThan(0);
    for (const r of holdReasons) expect(holdReasonLabel(hybridConfig, r.code)).toBe(r.label);
  });

  it('is null without a code, and shows a code it does not know as it is', () => {
    expect(holdReasonLabel(hybridConfig, null)).toBeNull();
    expect(holdReasonLabel(hybridConfig, undefined)).toBeNull();
    expect(holdReasonLabel(hybridConfig, '')).toBeNull();
    expect(holdReasonLabel(hybridConfig, 'NO_SUCH_CODE')).toBe('NO_SUCH_CODE');
  });

  it('reads only the contexts of outcomes that put a quote on hold', () => {
    // A code that exists only under another context (a rework reason) is not a hold reason.
    const rework = hybridConfig.reasonCodes.find(
      (r) => r.context === 'rework' && !holdReasons.some((h) => h.code === r.code),
    );
    expect(rework, 'the seed has a rework-only reason code').toBeDefined();
    expect(holdReasonLabel(hybridConfig, rework!.code)).toBe(rework!.code);
    // A workflow whose hold outcome uses another context reads that context.
    const moved = {
      transitions: [
        {
          ...hybridConfig.transitions[0]!,
          gateKey: 'GX',
          outcomeKey: 'pause',
          nextStatus: 'on_hold' as const,
        },
      ],
      outcomes: [
        { ...hybridConfig.outcomes[0]!, gateKey: 'GX', key: 'pause', reasonContext: 'rework' },
      ],
      reasonCodes: hybridConfig.reasonCodes,
    };
    expect(holdReasonLabel(moved, rework!.code)).toBe(rework!.label);
  });
});

describe('onHoldFirst', () => {
  interface Row {
    n: string;
    status: string;
    days: number;
  }
  const q = (n: string, status: string, days: number): Row => ({ n, status, days });
  const oldestFirst = (a: Row, b: Row) => b.days - a.days;

  it('lists on-hold quotes first and keeps the other order inside each group', () => {
    const list = [
      q('A', 'active', 9),
      q('B', 'on_hold', 1),
      q('C', 'active', 30),
      q('D', 'on_hold', 12),
      q('E', 'active', 2),
    ];
    expect(list.sort(onHoldFirst(oldestFirst)).map((x) => x.n)).toEqual(['D', 'B', 'C', 'A', 'E']);
  });

  it('changes nothing when no quote is on hold', () => {
    const list = [q('A', 'active', 9), q('C', 'active', 30), q('E', 'active', 2)];
    expect(list.sort(onHoldFirst(oldestFirst)).map((x) => x.n)).toEqual(['C', 'A', 'E']);
  });

  it('keeps a held quote inside a short list that is cut after sorting', () => {
    const list = [
      ...Array.from({ length: 6 }, (_, i) => q(`old-${i}`, 'active', 100 - i)),
      q('held', 'on_hold', 0),
    ];
    expect(
      list
        .sort(onHoldFirst(oldestFirst))
        .slice(0, 5)
        .map((x) => x.n),
    ).toContain('held');
  });
});
