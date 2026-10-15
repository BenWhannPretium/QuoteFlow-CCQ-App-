import { isQuoteNumber, parseQuoteNumber } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { asPersona, raw, testDb } from './helpers';
import { nextQuoteNumber } from '../src/repos/index';

const { db } = testDb(20);

describe('next_quote_number()', () => {
  it('returns 50 distinct, consecutive numbers under 50 parallel callers', async () => {
    const at = new Date('2032-03-01T12:00:00Z'); // a year no other test uses
    const numbers = await Promise.all(
      Array.from({ length: 50 }, () => db.transaction((tx) => nextQuoteNumber(tx, at))),
    );
    expect(new Set(numbers).size).toBe(50);
    for (const n of numbers) expect(isQuoteNumber(n)).toBe(true);
    const seqs = numbers.map((n) => parseQuoteNumber(n)!.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('is concurrency-safe as ccq_app inside request contexts too', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 50 }, () =>
        asPersona(db, 'kam', async (tx) => {
          const [row] = await raw<{ n: string }>(
            tx,
            sql`select next_quote_number('2033-07-01T00:00Z') as n`,
          );
          return row!.n;
        }),
      ),
    );
    expect(new Set(numbers).size).toBe(50);
  });

  it('uses the US Central calendar year and restarts the sequence each year', async () => {
    const lateNewYearsEve = await db.transaction((tx) =>
      nextQuoteNumber(tx, new Date('2035-01-01T05:30:00Z')),
    );
    const newYear = await db.transaction((tx) =>
      nextQuoteNumber(tx, new Date('2035-01-01T06:30:00Z')),
    );
    expect(lateNewYearsEve).toBe('CCQ-2034-00001');
    expect(newYear).toBe('CCQ-2035-00001');
  });

  it('does not consume a number when the caller rolls back', async () => {
    const at = new Date('2036-05-05T00:00:00Z');
    await expect(
      db.transaction(async (tx) => {
        await nextQuoteNumber(tx, at);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.transaction((tx) => nextQuoteNumber(tx, at))).toBe('CCQ-2036-00001');
  });
});
