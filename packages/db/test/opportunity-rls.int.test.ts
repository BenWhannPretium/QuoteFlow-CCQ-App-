import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { as, asPersona, persona, pgError, raw, testDb } from './helpers';
import { uuidv7 } from '../src/ids';
import { visibleOpportunityIds } from '../src/repos/index';

/**
 * L-6: CCQ reads Salesforce as one integration user, so the synced opportunities are scoped in SQL
 * (migration 0021) the way quotes are. Expectations are computed as the superuser owner, then checked
 * against what each caller sees under RLS.
 */
const { db } = testDb();

let total = 0;
const ids = (rows: { sf_opportunity_id: string }[]) =>
  new Set(rows.map((r) => r.sf_opportunity_id));
const visibleTo = (tx: Parameters<Parameters<typeof as>[2]>[0]) =>
  raw<{ sf_opportunity_id: string }>(
    tx,
    sql`select sf_opportunity_id from sf_opportunity_snapshot`,
  );
const expected = async (where: ReturnType<typeof sql>) =>
  ids(
    await raw<{ sf_opportunity_id: string }>(
      db as never,
      sql`select s.sf_opportunity_id from sf_opportunity_snapshot s where ${where}`,
    ),
  );

beforeAll(async () => {
  const [row] = await raw<{ n: number }>(
    db as never,
    sql`select count(*)::int as n from sf_opportunity_snapshot`,
  );
  total = row!.n;
});

describe('RLS on sf_opportunity_snapshot (L-6)', () => {
  it('an owner-scoped KAM sees the opportunities they own in Salesforce, plus their quotes’', async () => {
    const me = persona('kam-owner');
    const want = await expected(sql`lower(s.owner_email) = lower(${me.email})
      or exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id
                 and q.kam_user_id = ${me.id})`);
    expect(want.size).toBeGreaterThan(0);
    expect(want.size).toBeLessThan(total);
    await asPersona(db, 'kam-owner', async (tx) => {
      expect(ids(await visibleTo(tx))).toEqual(want);
    });
  });

  it('a region-scoped KAM sees opportunities whose Salesforce owner is in their CCQ region', async () => {
    const me = persona('kam-region');
    const want = await expected(sql`exists (select 1 from app_user u
        where lower(u.email) = lower(s.owner_email) and u.region = 'West')
      or lower(s.owner_email) = lower(${me.email})
      or exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id
                 and q.region = 'West')`);
    expect(want.size).toBeGreaterThan(0);
    expect(want.size).toBeLessThan(total);
    await asPersona(db, 'kam-region', async (tx) => {
      expect(ids(await visibleTo(tx))).toEqual(want);
    });
  });

  it('an account-list-scoped KAM sees that account’s opportunities', async () => {
    const [account] = await raw<{ account_id: string }>(
      db as never,
      sql`select account_id from sf_opportunity_snapshot where account_id is not null
          group by account_id order by count(*) desc limit 1`,
    );
    const accountId = account!.account_id;
    const want = await expected(sql`s.account_id = ${accountId}
      or exists (select 1 from quote q join customer c on c.id = q.customer_id
                 where q.sf_opportunity_id = s.sf_opportunity_id and c.sf_account_id = ${accountId})`);
    expect(want.size).toBeGreaterThan(0);
    await as(
      db,
      { userId: uuidv7(), roles: ['KAM'], scope: { type: 'account_list', values: [accountId] } },
      async (tx) => {
        expect(ids(await visibleTo(tx))).toEqual(want);
      },
    );
  });

  it('an owner-scoped Engineer sees only the opportunities of quotes assigned to them', async () => {
    const me = persona('engineer-owner');
    const want = await expected(sql`exists (select 1 from quote q
      where q.sf_opportunity_id = s.sf_opportunity_id and q.assigned_engineer_id = ${me.id})`);
    expect(want.size).toBeGreaterThan(0);
    await asPersona(db, 'engineer-owner', async (tx) => {
      expect(ids(await visibleTo(tx))).toEqual(want);
    });
  });

  it('a KAM with scope all sees every opportunity', async () => {
    await asPersona(db, 'kam', async (tx) => {
      expect(await visibleTo(tx)).toHaveLength(total);
    });
  });

  it.each(['sales-leader', 'eng-lead', 'pricing', 'approver', 'leadership', 'admin'] as const)(
    '%s sees every opportunity, even with an owner scope',
    async (key) => {
      const p = persona(key);
      await as(db, { userId: p.id, roles: p.roles, scope: { type: 'owner' } }, async (tx) => {
        expect(await visibleTo(tx)).toHaveLength(total);
      });
    },
  );

  it('ccq_app with no request context sees nothing', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role ccq_app`);
      return visibleTo(tx);
    });
    expect(rows).toHaveLength(0);
  });

  it('a KAM cannot write a snapshot they may not see (WITH CHECK / USING)', async () => {
    const other = persona('kam-region');
    expect(
      await pgError(
        asPersona(db, 'kam-owner', (tx) =>
          raw(
            tx,
            sql`insert into sf_opportunity_snapshot (id, sf_opportunity_id, name, owner_email)
                values (${uuidv7()}, '006TESTRLS000001', 'Hidden', ${other.email})`,
          ),
        ),
      ),
    ).toBe('42501');
    const me = persona('kam-owner');
    const [hidden] = await raw<{ sf_opportunity_id: string }>(
      db as never,
      sql`select sf_opportunity_id from sf_opportunity_snapshot s
          where lower(s.owner_email) <> lower(${me.email})
            and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id
                            and q.kam_user_id = ${me.id})
          limit 1`,
    );
    const updated = await asPersona(db, 'kam-owner', (tx) =>
      raw(
        tx,
        sql`update sf_opportunity_snapshot set name = 'x'
            where sf_opportunity_id = ${hidden!.sf_opportunity_id} returning 1`,
      ),
    );
    expect(updated).toHaveLength(0);
  });

  it('visibleOpportunityIds (live Salesforce rows) applies the same rule as the policy', async () => {
    const sample = await raw<{ id: string; owner_email: string | null; account_id: string | null }>(
      db as never,
      sql`select sf_opportunity_id as id, owner_email, account_id from sf_opportunity_snapshot`,
    );
    for (const key of ['kam-owner', 'kam-region', 'engineer-owner', 'kam', 'admin'] as const) {
      await asPersona(db, key, async (tx) => {
        const viaPolicy = ids(await visibleTo(tx));
        const viaHelper = await visibleOpportunityIds(
          tx,
          sample.map((r) => ({ id: r.id, ownerEmail: r.owner_email, accountId: r.account_id })),
        );
        expect(viaHelper, key).toEqual(viaPolicy);
      });
    }
    // An opportunity that isn't synced yet: visible to its Salesforce owner, not to another KAM.
    const me = persona('kam-owner');
    const fresh = { id: '006TESTLIVE00001', ownerEmail: me.email.toUpperCase(), accountId: null };
    await asPersona(db, 'kam-owner', async (tx) => {
      expect([...(await visibleOpportunityIds(tx, [fresh]))]).toEqual([fresh.id]);
    });
    await asPersona(db, 'kam-region', async (tx) => {
      expect((await visibleOpportunityIds(tx, [fresh])).size).toBe(0);
    });
  });
});
