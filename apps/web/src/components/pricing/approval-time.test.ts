import { describe, expect, it } from 'vitest';

import { approvedAtIso } from './approval-time';

describe('approvedAtIso', () => {
  it('turns the datetime-local value into the same instant in ISO form', () => {
    // 09:30 local on the machine that runs the test; the instant, not the wall-clock text, is compared.
    const iso = approvedAtIso('user-1', '2026-11-17T09:30');
    expect(iso).toMatch(/^2026-11-1[678]T\d{2}:\d{2}:00\.000Z$/);
    expect(new Date(iso!).getTime()).toBe(new Date(2026, 10, 17, 9, 30).getTime());
  });

  it('is null, not a thrown RangeError, when the date field is cleared or half-typed', () => {
    expect(approvedAtIso('user-1', '')).toBeNull();
    expect(approvedAtIso('user-1', 'not a date')).toBeNull();
    expect(approvedAtIso('user-1', '2026-11-17T')).toBeNull();
  });

  it('is null when there is no approver, whatever the field holds', () => {
    expect(approvedAtIso('', '2026-11-17T09:30')).toBeNull();
  });
});
