import {
  OverrideResponse,
  AuditListResponse,
  MeResponse,
  UsageReportResponse,
} from '@ccq/contracts';
import { schema, withRequestContext, type DbClient } from '@ccq/db';
import { asUserId, type Role } from '@ccq/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-09 usage audit (F-12): one view row per user per quote per 10 minutes (async, best effort);
 * mutations audited in their own transaction (a failed one leaves no row); UPDATE/DELETE denied;
 * the admin viewer, its audited CSV export and the usage report (audit.read: Leadership + Admin).
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-10-27T15:00:00Z');
const minutes = (n: number) => (clock = new Date(clock.getTime() + n * 60_000));

const as = (role: Role) => asRole(app, role);
const userId = async (role: Role) =>
  MeResponse.parse((await as(role).get('/api/v1/me')).json()).user.id;

let qn: string;
let quoteId: string;

const views = (actorId: string) =>
  db.db
    .select()
    .from(schema.auditEvent)
    .where(
      and(
        eq(schema.auditEvent.quoteId, quoteId),
        eq(schema.auditEvent.action, 'view'),
        eq(schema.auditEvent.actorId, actorId),
      ),
    );

beforeAll(async () => {
  const fresh = await freshSfDatabase('audit');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db, now: () => clock });
  await app.ready();
  const [row] = await db.db.execute<{ quote_number: string; id: string }>(sql`
    select quote_number, id from quote q where status = 'active'
      and not exists (select 1 from audit_event a where a.quote_id = q.id and a.action = 'view')
    order by quote_number limit 1`);
  qn = row!.quote_number;
  quoteId = row!.id;
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('quote views', () => {
  it('one view row per user per quote per 10 minutes, written after the response', async () => {
    const leader = await userId('Leadership');
    const engLead = await userId('EngLead');
    for (let i = 0; i < 3; i++) {
      expect((await as('Leadership').get(`/api/v1/quotes/${qn}`)).statusCode).toBe(200);
      minutes(2);
    }
    await app.audit.flush();
    expect(await views(leader)).toHaveLength(1);

    minutes(5); // 11 minutes after the first view
    await as('Leadership').get(`/api/v1/quotes/${qn}`);
    await as('EngLead').get(`/api/v1/quotes/${qn}`);
    await app.audit.flush();
    const rows = await views(leader);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      entity: 'quote',
      entityId: quoteId,
      actorRoles: ['Leadership'],
    });
    expect(rows[0]!.requestId).toBeTruthy();
    expect(rows[0]!.userAgent).toBeTruthy();
    expect(await views(engLead)).toHaveLength(1);
  });

  it('the debounce also holds across API instances (checked in the database)', async () => {
    // A second instance on the same database (its own in-memory debounce; closing it keeps the pool).
    const other = await buildApp(testConfig(), {
      db: { ...db, close: () => Promise.resolve() },
      now: () => clock,
    });
    await other.ready();
    try {
      minutes(11);
      const leader = await userId('Leadership');
      const before = (await views(leader)).length;
      await as('Leadership').get(`/api/v1/quotes/${qn}`);
      await app.audit.flush();
      await asRole(other, 'Leadership').get(`/api/v1/quotes/${qn}`);
      await other.audit.flush();
      expect(await views(leader)).toHaveLength(before + 1);
    } finally {
      await other.close().catch(() => undefined);
    }
  });

  it('a 404 is not a view', async () => {
    const before = await db.db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.action, 'view'));
    await as('Leadership').get('/api/v1/quotes/CCQ-2099-99999');
    await app.audit.flush();
    const after = await db.db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.action, 'view'));
    expect(after.length).toBe(before.length);
  });
});

describe('mutations are audited in the same transaction', () => {
  it('a mutation that fails after its audit row was written leaves no audit row behind', async () => {
    // Make the override's activity insert fail AFTER the audit row of the same transaction.
    await db.db.execute(sql`
      create or replace function test_fail_activity() returns trigger language plpgsql as $$
      begin
        if new.payload->>'justification' like '%FAIL-IN-TX%' then raise exception 'injected failure'; end if;
        return new;
      end $$`);
    await db.db.execute(sql`
      create trigger test_fail_activity before insert on activity_event
      for each row execute function test_fail_activity()`);
    try {
      const res = await as('SalesLeader').post(`/api/v1/quotes/${qn}/overrides`, {
        field: 'ship_to',
        requestedValue: { line1: '5 Failing St', city: 'Nowhere' },
        justification: 'FAIL-IN-TX: injected failure for the test',
      });
      expect(res.statusCode).toBe(500);
      const audits = await db.db
        .select()
        .from(schema.auditEvent)
        .where(sql`${schema.auditEvent.after}->>'justification' like '%FAIL-IN-TX%'`);
      expect(audits).toHaveLength(0);
      const overrides = await db.db
        .select()
        .from(schema.override)
        .where(sql`${schema.override.justification} like '%FAIL-IN-TX%'`);
      expect(overrides).toHaveLength(0);
    } finally {
      await db.db.execute(sql`drop trigger test_fail_activity on activity_event`);
      await db.db.execute(sql`drop function test_fail_activity()`);
    }
  });

  it('the same mutation succeeds, with its audit row, once nothing fails', async () => {
    const res = await as('SalesLeader').post(`/api/v1/quotes/${qn}/overrides`, {
      field: 'ship_to',
      requestedValue: { line1: '5 Working St', city: 'Somewhere' },
      justification: 'Customer moved the filling to a co-packer',
    });
    expect(res.statusCode, res.body).toBe(201);
    const audits = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.entity, 'override'),
          eq(schema.auditEvent.entityId, OverrideResponse.parse(res.json()).override.id),
        ),
      );
    expect(audits.map((a) => a.action)).toEqual(['override_requested', 'override_applied']);
  });
});

describe('append-only', () => {
  it('ccq_app may not UPDATE or DELETE audit rows (privilege and trigger)', async () => {
    const admin = await userId('Admin');
    const ctx = {
      userId: asUserId(admin),
      roles: ['Admin'] as Role[],
      scope: { type: 'all' as const },
    };
    const code = async (statement: ReturnType<typeof sql>) => {
      try {
        await withRequestContext(db.db, ctx, (tx) => tx.execute(statement));
        return 'ok';
      } catch (err) {
        return (
          (err as { code?: string; cause?: { code?: string } }).cause?.code ??
          (err as { code?: string }).code
        );
      }
    };
    expect(await code(sql`update audit_event set action = 'view' where true`)).toBe('42501');
    expect(await code(sql`delete from audit_event where true`)).toBe('42501');
    expect(await code(sql`select count(*) from audit_event`)).toBe('ok');
    // Even the table owner (here the local superuser login) is stopped by the trigger.
    await expect(db.db.execute(sql`delete from audit_event where true`)).rejects.toThrow();
  });
});

describe('admin audit viewer, export and usage report', () => {
  it.each<[Role, number]>([
    ['Leadership', 200],
    ['Admin', 200],
    ['KAM', 403],
    ['SalesLeader', 403],
    ['EngLead', 403],
    ['Engineer', 403],
    ['Pricing', 403],
    ['Approver', 403],
  ])('%s → %i', async (role, status) => {
    expect((await as(role).get('/api/v1/admin/audit')).statusCode).toBe(status);
    expect((await as(role).get('/api/v1/admin/reports/usage')).statusCode).toBe(status);
  });

  it('filters by user, quote, action and date, and pages', async () => {
    const leader = await userId('Leadership');
    const res = await as('Admin').get(
      `/api/v1/admin/audit?actorId=${leader}&quoteNumber=${qn}&action=view&from=2026-10-27&to=2026-10-27`,
    );
    expect(res.statusCode, res.body).toBe(200);
    const body = AuditListResponse.parse(res.json());
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    expect(
      body.items.every((i) => i.action === 'view' && i.actorId === leader && i.quoteNumber === qn),
    ).toBe(true);
    expect(body.items[0]!.actorName).toBeTruthy();

    const page1 = AuditListResponse.parse(
      (await as('Admin').get('/api/v1/admin/audit?limit=2')).json(),
    );
    expect(page1.nextCursor).toBeTruthy();
    const page2 = AuditListResponse.parse(
      (await as('Admin').get(`/api/v1/admin/audit?limit=2&cursor=${page1.nextCursor}`)).json(),
    );
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
    // A day with nothing, an unknown quote, a backwards range and a bad cursor.
    expect(
      AuditListResponse.parse(
        (await as('Admin').get('/api/v1/admin/audit?from=2020-01-01&to=2020-01-01')).json(),
      ).items,
    ).toEqual([]);
    expect(
      AuditListResponse.parse(
        (await as('Admin').get('/api/v1/admin/audit?quoteNumber=CCQ-2099-99999')).json(),
      ).items,
    ).toEqual([]);
    expect(
      (await as('Admin').get('/api/v1/admin/audit?from=2026-10-28&to=2026-10-27')).statusCode,
    ).toBe(400);
    expect((await as('Admin').get('/api/v1/admin/audit?cursor=zzz')).statusCode).toBe(400);
  });

  it('exports CSV, and the export is audited too', async () => {
    const res = await as('Leadership').get(`/api/v1/admin/audit/export.csv?quoteNumber=${qn}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const lines = res.body.trim().split('\r\n');
    expect(lines[0]).toBe(
      'at_utc,actor,actor_upn,actor_roles,action,entity,entity_id,quote_number,before,after,ip,user_agent,request_id',
    );
    expect(lines.length).toBeGreaterThan(2);
    const exports = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.action, 'export'), eq(schema.auditEvent.entity, 'audit_event')),
      );
    expect(exports).toHaveLength(1);
    expect(exports[0]!.after).toMatchObject({
      format: 'csv',
      filters: { quoteNumber: qn },
      rows: lines.length - 1,
    });
  });

  it('reports adoption: daily active users by role, quotes viewed and actions by type', async () => {
    const res = await as('Leadership').get(
      '/api/v1/admin/reports/usage?from=2026-10-27&to=2026-10-27',
    );
    expect(res.statusCode, res.body).toBe(200);
    const r = UsageReportResponse.parse(res.json());
    expect(r).toMatchObject({ from: '2026-10-27', to: '2026-10-27', timeZone: 'America/Chicago' });
    expect(r.dailyActiveUsers).toContainEqual({ day: '2026-10-27', role: 'Leadership', users: 1 });
    expect(r.quotesViewed[0]).toMatchObject({ day: '2026-10-27' });
    expect(r.quotesViewed[0]!.views).toBeGreaterThanOrEqual(3);
    expect(r.actionsByType.map((a) => a.action)).toEqual(
      expect.arrayContaining(['view', 'override_applied']),
    );
    expect(r.totals.activeUsers).toBeGreaterThanOrEqual(3);
    // Default range: the last 30 days up to today (US Central).
    const def = UsageReportResponse.parse(
      (await as('Admin').get('/api/v1/admin/reports/usage')).json(),
    );
    expect(def.to).toBe('2026-10-27');
    expect(def.from).toBe('2026-09-28');
    expect(
      (await as('Admin').get('/api/v1/admin/reports/usage?from=2024-01-01&to=2026-01-01'))
        .statusCode,
    ).toBe(400);
  });
});
