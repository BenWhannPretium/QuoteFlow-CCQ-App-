import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import { DEMO_CASES, seedDemo } from '../seeds/demo/index';

const { db } = testDb();

/** Rolled back at the end, so the demo rows never leak into the other suites' counts. */
class Rollback extends Error {}

describe('demo seed', () => {
  it('adds one quote per stage on demo opportunities, idempotently, alongside the synthetic set', async () => {
    const anchor = new Date('2026-11-02T15:00:00Z');
    await db
      .transaction(async (tx) => {
        const first = await seedDemo(tx, { anchor });
        expect(first.quotes).not.toBe('already-present');
        const again = await seedDemo(tx, { anchor });
        expect(again.quotes).toBe('already-present');

        const rows = await raw<{ stage_key: string; status: string; n: number }>(
          tx,
          sql`select stage_key, status, count(*)::int as n from quote
              where sf_opportunity_id like '006DEMO%' group by 1, 2`,
        );
        expect(Object.fromEntries(rows.map((r) => [r.stage_key, r.n]))).toEqual(
          Object.fromEntries(DEMO_CASES.map((c) => [c.stage, 1])),
        );
        const status = Object.fromEntries(rows.map((r) => [r.stage_key, r.status]));
        expect(status.INTAKE).toBe('active');
        expect(status.COMMIT_HANDOFF).toBe('active');
        expect(status.AWARDED).toBe('closed');
        expect(status.NOT_AUTHORIZED).toBe('closed');

        // Every demo event is in the past of the anchor, and the open proposal is still valid.
        const [latest] = await raw<{ at: Date }>(
          tx,
          sql`select max(h.entered_at) as at from stage_history h
              join quote q on q.id = h.quote_id where q.sf_opportunity_id like '006DEMO%'`,
        );
        expect(new Date(latest!.at).getTime()).toBeLessThan(anchor.getTime());
        const [proposal] = await raw<{ validity_until: string }>(
          tx,
          sql`select validity_until::text from quote
              where sf_opportunity_id like '006DEMO%' and stage_key = 'CUSTOMER_DECISION'`,
        );
        expect(proposal!.validity_until > anchor.toISOString().slice(0, 10)).toBe(true);

        // Some demo opportunities are left free for a live intake.
        const [free] = await raw<{ n: number }>(
          tx,
          sql`select count(*)::int as n from sf_opportunity_snapshot s
              where s.sf_opportunity_id like '006DEMO%'
                and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id)`,
        );
        expect(free!.n).toBeGreaterThan(0);
        throw new Rollback();
      })
      .catch((err: unknown) => {
        if (!(err instanceof Rollback)) throw err;
      });
  });
});
