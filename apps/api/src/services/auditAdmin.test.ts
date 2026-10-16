import {
  AUDIT_ACTION_VALUES,
  OVERRIDE_STATUS_VALUES,
  TIMELINE_FILTER_VALUES,
} from '@ccq/contracts';
import { AUDIT_ACTIONS } from '@ccq/db';
import { OVERRIDE_STATUSES, TIMELINE_FILTERS } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { csvCell, dayIn, startOfDay } from './auditAdmin';
import { decodeCursor, encodeCursor, page } from './cursor';

describe('report days (US Central)', () => {
  it('a day starts at local midnight, across DST', () => {
    expect(startOfDay('2026-10-27', 'America/Chicago').toISOString()).toBe(
      '2026-10-27T05:00:00.000Z',
    );
    expect(startOfDay('2026-12-01', 'America/Chicago').toISOString()).toBe(
      '2026-12-01T06:00:00.000Z',
    );
    // 2026-11-01 is the fall-back day: midnight is still CDT.
    expect(startOfDay('2026-11-01', 'America/Chicago').toISOString()).toBe(
      '2026-11-01T05:00:00.000Z',
    );
    expect(startOfDay('2026-03-08', 'America/Chicago').toISOString()).toBe(
      '2026-03-08T06:00:00.000Z',
    );
  });

  it('today is the local calendar date', () => {
    expect(dayIn(new Date('2026-10-28T03:00:00Z'), 'America/Chicago')).toBe('2026-10-27');
  });
});

describe('csvCell', () => {
  it('quotes, doubles quotes, serialises objects and neutralises formulas', () => {
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
  });
});

describe('keyset cursors', () => {
  const id = '019a0000-0000-7000-8000-000000000001';
  it('round-trips and rejects anything else', () => {
    const at = new Date('2026-10-27T15:00:00.123Z');
    expect(decodeCursor(encodeCursor({ at, id }))).toEqual({ at, id });
    expect(decodeCursor('nope')).toBeNull();
    expect(decodeCursor(Buffer.from(`not-a-date|${id}`).toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from(`2026-10-27T00:00:00Z|x`).toString('base64url'))).toBeNull();
    expect(
      decodeCursor(Buffer.from(`2026-10-27T00:00:00Z|${id}|x`).toString('base64url')),
    ).toBeNull();
  });

  it('pages limit + 1 rows', () => {
    const rows = [1, 2, 3].map((n) => ({ at: new Date(n * 1000), id }));
    expect(page(rows, 2, (r) => r).items).toHaveLength(2);
    expect(page(rows, 2, (r) => r).nextCursor).toBe(encodeCursor(rows[1]!));
    expect(page(rows, 3, (r) => r).nextCursor).toBeNull();
  });
});

describe('contract enums mirror their sources', () => {
  it('audit actions, override statuses and timeline filters', () => {
    expect([...AUDIT_ACTION_VALUES]).toEqual([...AUDIT_ACTIONS]);
    expect([...OVERRIDE_STATUS_VALUES]).toEqual([...OVERRIDE_STATUSES]);
    expect([...TIMELINE_FILTER_VALUES]).toEqual([...TIMELINE_FILTERS]);
  });
});
