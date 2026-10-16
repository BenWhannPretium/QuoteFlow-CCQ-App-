import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { as, asPersona, persona, pgError, raw, testDb } from './helpers';
import { QUOTE_STAGE_TARGETS } from '../seeds/synthetic/index';
import { createDb } from '../src/client';
import { uuidv7 } from '../src/ids';
import { listQuotes } from '../src/repos/index';
import { withRequestContext } from '../src/withRequestContext';

const { db } = testDb();

let total = 0;
let ownQuoteId = '';
let otherQuoteId = '';
let otherQuoteNumber = '';

beforeAll(async () => {
  const kamOwner = persona('kam-owner');
  const rows = await raw<{ id: string; kam_user_id: string; quote_number: string }>(
    db as never,
    sql`select id, kam_user_id, quote_number from quote order by quote_number`,
  );
  total = rows.length;
  ownQuoteId = rows.find((r) => r.kam_user_id === kamOwner.id)!.id;
  const other = rows.find((r) => r.kam_user_id !== kamOwner.id)!;
  otherQuoteId = other.id;
  otherQuoteNumber = other.quote_number;
});

describe('RLS on quote: owner-scoped KAM', () => {
  it('cannot select another KAM’s quote, even with a raw query by id or number', async () => {
    await asPersona(db, 'kam-owner', async (tx) => {
      expect(await raw(tx, sql`select * from quote where id = ${otherQuoteId}`)).toHaveLength(0);
      expect(
        await raw(tx, sql`select * from quote where quote_number = ${otherQuoteNumber}`),
      ).toHaveLength(0);
      expect(await raw(tx, sql`select * from quote where id = ${ownQuoteId}`)).toHaveLength(1);
    });
  });

  it('sees only their own quotes in a full scan', async () => {
    const kamOwner = persona('kam-owner');
    await asPersona(db, 'kam-owner', async (tx) => {
      const rows = await raw<{ kam_user_id: string }>(tx, sql`select kam_user_id from quote`);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(total);
      expect(new Set(rows.map((r) => r.kam_user_id))).toEqual(new Set([kamOwner.id]));
      // The repositories get the same answer: RLS is not something they opt into.
      expect((await listQuotes(tx, { limit: 500 })).length).toBe(rows.length);
    });
  });

  it('cannot see child rows of another KAM’s quote', async () => {
    await asPersona(db, 'kam-owner', async (tx) => {
      for (const table of [
        'stage_history',
        'gate_decision',
        'activity_event',
        'attachment',
        'override',
        'pricing_record',
        'eng_review',
      ]) {
        const rows = await raw(
          tx,
          sql`select 1 from ${sql.identifier(table)} where quote_id = ${otherQuoteId}`,
        );
        expect(rows, table).toHaveLength(0);
      }
      const own = await raw(tx, sql`select 1 from stage_history where quote_id = ${ownQuoteId}`);
      expect(own.length).toBeGreaterThan(0);
    });
  });

  it('cannot update or delete another KAM’s quote (zero rows affected)', async () => {
    await asPersona(db, 'kam-owner', async (tx) => {
      const updated = await raw(
        tx,
        sql`update quote set description = 'hijacked' where id = ${otherQuoteId} returning id`,
      );
      expect(updated).toHaveLength(0);
      const deleted = await raw(
        tx,
        sql`delete from stage_history where quote_id = ${otherQuoteId} returning id`,
      );
      expect(deleted).toHaveLength(0);
    });
    const [row] = await raw<{ description: string }>(
      db as never,
      sql`select description from quote where id = ${otherQuoteId}`,
    );
    expect(row!.description).not.toBe('hijacked');
  });

  it('cannot insert a quote owned by someone else (WITH CHECK), or a child row on one', async () => {
    const other = persona('kam');
    const code = await pgError(
      asPersona(db, 'kam-owner', (tx) =>
        raw(
          tx,
          sql`insert into quote (id, quote_number, sf_opportunity_id, kam_user_id, stage_key, status)
              select ${uuidv7()}, 'CCQ-2099-00001', sf_opportunity_id, ${other.id}, 'INTAKE', 'active' from sf_opportunity_snapshot limit 1`,
        ),
      ),
    );
    expect(code).toBe('42501');
    const child = await pgError(
      asPersona(db, 'kam-owner', (tx) =>
        raw(
          tx,
          sql`insert into comment (id, quote_id, author_id, body) values (${uuidv7()}, ${otherQuoteId}, ${persona('kam-owner').id}, 'x')`,
        ),
      ),
    );
    expect(child).toBe('42501');
  });

  it('a login that is only a ccq_app member cannot escape RLS (the Azure set-up)', async () => {
    // Prod logins (the App Service managed identity) are members of ccq_app, never superusers.
    await db.execute(
      sql.raw(`do $$ begin create role ccq_rls_probe login password 'probe' in role ccq_app;
      exception when duplicate_object then null; end $$`),
    );
    const url = new URL(process.env.DB_TEST_URL!);
    url.username = 'ccq_rls_probe';
    url.password = 'probe';
    const probe = createDb(url.toString(), { max: 1 });
    try {
      const p = persona('kam-owner');
      const ctx = { userId: p.id, roles: p.roles, scope: p.scope };
      await withRequestContext(
        probe.db,
        ctx,
        async (tx) => {
          await raw(tx, sql`reset role`);
          expect(await raw(tx, sql`select 1 from quote where id = ${otherQuoteId}`)).toHaveLength(
            0,
          );
          expect(await raw(tx, sql`select 1 from quote where id = ${ownQuoteId}`)).toHaveLength(1);
        },
        { dbRole: null },
      );
      expect(
        await pgError(
          withRequestContext(probe.db, ctx, (tx) => raw(tx, sql`set role ccq_migrator`)),
        ),
      ).toBe('42501');
      expect(
        await pgError(
          withRequestContext(probe.db, ctx, (tx) =>
            raw(tx, sql`alter table quote disable row level security`),
          ),
        ),
      ).toBe('42501');
    } finally {
      await probe.close();
    }
  });
});

describe('RLS on quote: other scopes and roles', () => {
  it('region-scoped KAM sees only quotes in their regions', async () => {
    await asPersona(db, 'kam-region', async (tx) => {
      const rows = await raw<{ region: string }>(tx, sql`select region from quote`);
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.region))).toEqual(new Set(['West']));
    });
  });

  it('owner-scoped Engineer sees only quotes assigned to them', async () => {
    const engineer = persona('engineer-owner');
    await asPersona(db, 'engineer-owner', async (tx) => {
      const rows = await raw<{ assigned_engineer_id: string }>(
        tx,
        sql`select assigned_engineer_id from quote`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.assigned_engineer_id))).toEqual(new Set([engineer.id]));
    });
  });

  it('a KAM with scope all sees the full pipeline (PRD lean)', async () => {
    await asPersona(db, 'kam', async (tx) => {
      expect(await raw(tx, sql`select 1 from quote`)).toHaveLength(total);
    });
  });

  it.each(['sales-leader', 'eng-lead', 'pricing', 'approver', 'leadership', 'admin'] as const)(
    '%s sees every quote, even with an owner scope',
    async (key) => {
      const p = persona(key);
      await as(db, { userId: p.id, roles: p.roles, scope: { type: 'owner' } }, async (tx) => {
        expect(await raw(tx, sql`select 1 from quote`)).toHaveLength(total);
      });
    },
  );

  it('PostAward sees Awarded quotes only', async () => {
    await as(db, { userId: uuidv7(), roles: ['PostAward'], scope: { type: 'all' } }, async (tx) => {
      const rows = await raw<{ stage_key: string }>(tx, sql`select stage_key from quote`);
      const awarded = QUOTE_STAGE_TARGETS.find(([stage]) => stage === 'AWARDED')![1];
      expect(rows.length).toBe(awarded);
      expect(new Set(rows.map((r) => r.stage_key))).toEqual(new Set(['AWARDED']));
    });
  });

  it('ccq_app with no request context sees nothing', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role ccq_app`);
      return raw(tx, sql`select 1 from quote`);
    });
    expect(rows).toHaveLength(0);
  });

  it('withRequestContext rejects malformed context before it reaches Postgres', async () => {
    await expect(
      withRequestContext(
        db,
        { userId: 'not-a-uuid', roles: ['KAM'], scope: { type: 'all' } },
        async () => 1,
      ),
    ).rejects.toThrow(/UUID/);
    await expect(
      withRequestContext(
        db,
        { userId: uuidv7(), roles: ['KAM'], scope: { type: 'region', values: ['West,East'] } },
        async () => 1,
      ),
    ).rejects.toThrow(/commas/);
  });
});

describe('RLS on quote_draft: creator plus Admin only (B-07)', () => {
  const insertDraft = (ownerId: string) =>
    sql`insert into quote_draft (id, owner_user_id, data) values (${uuidv7()}, ${ownerId}, '{}') returning id`;

  it('a KAM sees, edits and deletes only their own drafts; Admin sees all', async () => {
    const kam = persona('kam');
    const other = persona('kam-region');
    const [mine] = await asPersona(db, 'kam', (tx) => raw<{ id: string }>(tx, insertDraft(kam.id)));
    const [theirs] = await asPersona(db, 'kam-region', (tx) =>
      raw<{ id: string }>(tx, insertDraft(other.id)),
    );

    await asPersona(db, 'kam', async (tx) => {
      expect(await raw(tx, sql`select 1 from quote_draft where id = ${theirs!.id}`)).toHaveLength(
        0,
      );
      expect(await raw(tx, sql`select 1 from quote_draft where id = ${mine!.id}`)).toHaveLength(1);
      const updated = await raw(
        tx,
        sql`update quote_draft set step = 2 where id = ${theirs!.id} returning id`,
      );
      expect(updated).toHaveLength(0);
      const deleted = await raw(
        tx,
        sql`delete from quote_draft where id = ${theirs!.id} returning id`,
      );
      expect(deleted).toHaveLength(0);
    });
    // A KAM with an `all` data scope still can't read someone else's draft: drafts aren't pipeline.
    await asPersona(db, 'sales-leader', async (tx) => {
      expect(await raw(tx, sql`select 1 from quote_draft where id = ${mine!.id}`)).toHaveLength(0);
    });
    await asPersona(db, 'admin', async (tx) => {
      const rows = await raw(
        tx,
        sql`select 1 from quote_draft where id in (${mine!.id}, ${theirs!.id})`,
      );
      expect(rows).toHaveLength(2);
    });
  });

  it('cannot create a draft owned by someone else (WITH CHECK)', async () => {
    const code = await pgError(
      asPersona(db, 'kam', (tx) => raw(tx, insertDraft(persona('kam-region').id))),
    );
    expect(code).toBe('42501');
  });
});

describe('one active quote per SF opportunity (B-07)', () => {
  it('a second active quote on the same opportunity violates the unique partial index', async () => {
    const [active] = await raw<{ sf_opportunity_id: string; kam_user_id: string }>(
      db as never,
      sql`select sf_opportunity_id, kam_user_id from quote where status <> 'closed' limit 1`,
    );
    const insert = (status: string) =>
      raw(
        db as never,
        sql`insert into quote (id, quote_number, sf_opportunity_id, kam_user_id, stage_key, status, closed_at)
            values (${uuidv7()}, 'CCQ-2098-00001', ${active!.sf_opportunity_id}, ${active!.kam_user_id}, 'INTAKE', ${status},
                    ${status === 'closed' ? sql`now()` : sql`null`})`,
      );
    expect(await pgError(insert('active'))).toBe('23505');
    expect(await pgError(insert('on_hold'))).toBe('23505');
  });

  it('closed quotes do not count, so an opportunity can carry its history', async () => {
    const rows = await raw<{ n: number }>(
      db as never,
      sql`select count(*)::int as n from (select sf_opportunity_id from quote group by 1 having count(*) > 1) x`,
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});

describe('append-only audit_event and activity_event for ccq_app', () => {
  it('INSERT and SELECT work', async () => {
    const admin = persona('admin');
    await asPersona(db, 'admin', async (tx) => {
      await raw(
        tx,
        sql`insert into audit_event (id, actor_id, actor_roles, action, entity) values (${uuidv7()}, ${admin.id}, '{Admin}', 'config_change', 'app_setting')`,
      );
      await raw(
        tx,
        sql`insert into activity_event (id, quote_id, type, at) values (${uuidv7()}, ${ownQuoteId}, 'comment_added', now())`,
      );
      expect((await raw(tx, sql`select 1 from audit_event`)).length).toBeGreaterThan(0);
    });
  });

  it('UPDATE and DELETE fail with insufficient_privilege', async () => {
    for (const statement of [
      sql`update audit_event set action = 'view'`,
      sql`delete from audit_event`,
      sql`update activity_event set type = 'x'`,
      sql`delete from activity_event`,
      sql`truncate audit_event`,
    ]) {
      expect(await pgError(asPersona(db, 'admin', (tx) => raw(tx, statement)))).toBe('42501');
    }
  });

  it('the append-only trigger blocks UPDATE and DELETE even for the owner', async () => {
    expect(await pgError(db.execute(sql`update audit_event set action = 'view' where true`))).toBe(
      '42501',
    );
    expect(await pgError(db.execute(sql`delete from audit_event where true`))).toBe('42501');
  });

  it('non-privileged users read only their own audit rows', async () => {
    const kam = persona('kam-owner');
    await asPersona(db, 'kam-owner', async (tx) => {
      const rows = await raw<{ actor_id: string }>(tx, sql`select actor_id from audit_event`);
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.actor_id))).toEqual(new Set([kam.id]));
    });
  });
});

describe('quote number function privileges', () => {
  it('ccq_app can call next_quote_number() but not touch the counter table', async () => {
    await asPersona(db, 'kam', async (tx) => {
      const [row] = await raw<{ n: string }>(
        tx,
        sql`select next_quote_number('2031-06-01T00:00Z') as n`,
      );
      expect(row!.n).toMatch(/^CCQ-2031-\d{5}$/);
    });
    expect(
      await pgError(asPersona(db, 'kam', (tx) => raw(tx, sql`select * from quote_number_counter`))),
    ).toBe('42501');
  });
});
