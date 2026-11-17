import { describe, expect, it } from 'vitest';

import { approvedAtIso } from './approval-time';

describe('approvedAtIso', () => {
  it('turns the datetime-local value into an ISO instant', () => {
    const local = '2026-11-17T09:30';
    expect(approvedAtIso('user-1', local)).toBe(new Date(local).toISOString());
  });

  it('is null, not a thrown RangeError, when the date field was cleared', () => {
    expect(approvedAtIso('user-1', '')).toBeNull();
    expect(approvedAtIso('user-1', 'not a date')).toBeNull();
  });

  it('is null when there is no approver, whatever the field holds', () => {
    expect(approvedAtIso('', '2026-11-17T09:30')).toBeNull();
  });
});
