import {
  OverrideResponse,
  MeResponse,
  OverrideDto,
  OverrideListResponse,
  OverrideLogResponse,
  QuoteDetail,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { OVERRIDE_SETTINGS_SEED, type Role } from '@ccq/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-09 governed overrides through the API: the tier (approver) and ship-to (self, logged) lifecycles,
 * 409 on a stale value, exact revert, justification, approver-per-config, segregation, the inbox,
 * notifications, activity + audit rows, and the Leadership/Admin-only override log.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-10-27T15:00:00Z');
const WHY = 'Strategic account renewal tied to this launch';

const as = (role: Role, scope?: 'all' | 'owner' | 'region') => asRole(app, role, scope);

async function userId(role: Role, scope?: 'all' | 'owner' | 'region') {
  const res = await as(role, scope).get('/api/v1/me');
  return MeResponse.parse(res.json()).user.id;
}

async function detail(quoteNumber: string, role: Role = 'SalesLeader') {
  const res = await as(role).get(`/api/v1/quotes/${quoteNumber}`);
  expect(res.statusCode, res.body).toBe(200);
  return QuoteDetail.parse(res.json());
}

const quoteRow = async (quoteNumber: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, quoteNumber)))[0]!;

const used = new Set<string>();
/** An active, scored quote with no overrides yet (optionally owned by `kamUserId`). */
async function freshQuote(kamUserId?: string): Promise<string> {
  const rows = await db.db.execute<{ quote_number: string }>(sql`
    select q.quote_number from quote q
    where q.status = 'active' and q.priority_tier in ('STANDARD', 'LOW', 'HIGH')
      and not exists (select 1 from override o where o.quote_id = q.id)
      ${kamUserId ? sql`and q.kam_user_id = ${kamUserId}` : sql``}
    order by q.quote_number`);
  const pick = [...rows].map((r) => r.quote_number).find((n) => !used.has(n));
  if (!pick) throw new Error('no fresh quote left');
  used.add(pick);
  return pick;
}

const otherTier = (tier: string | null) => (tier === 'HIGH' ? 'CRITICAL' : 'HIGH');

const request = (
  quoteNumber: string,
  body: Record<string, unknown>,
  role: Role = 'KAM',
  scope?: 'all' | 'owner' | 'region',
) => as(role, scope).post(`/api/v1/quotes/${quoteNumber}/overrides`, body);

async function requestTier(quoteNumber: string, role: Role = 'KAM') {
  const q = await quoteRow(quoteNumber);
  const res = await request(
    quoteNumber,
    {
      field: 'priority_tier',
      requestedValue: otherTier(q.priorityTier),
      justification: WHY,
    },
    role,
  );
  expect(res.statusCode, res.body).toBe(201);
  return {
    override: OverrideDto.parse(OverrideResponse.parse(res.json()).override),
    original: q.priorityTier,
  };
}

const auditFor = (overrideId: string) =>
  db.db
    .select()
    .from(schema.auditEvent)
    .where(
      and(eq(schema.auditEvent.entity, 'override'), eq(schema.auditEvent.entityId, overrideId)),
    )
    .orderBy(asc(schema.auditEvent.at), asc(schema.auditEvent.createdAt));

const activityFor = (quoteId: string) =>
  db.db
    .select()
    .from(schema.activityEvent)
    .where(
      and(
        eq(schema.activityEvent.quoteId, quoteId),
        sql`${schema.activityEvent.type} like 'override_%'`,
      ),
    )
    .orderBy(asc(schema.activityEvent.at));

const setFields = (fields: unknown) =>
  db.db.execute(
    sql`update app_setting set value = ${JSON.stringify(fields)}::jsonb where key = 'overridable_fields'`,
  );

beforeAll(async () => {
  const fresh = await freshSfDatabase('overrides');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db, now: () => clock });
  await app.ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  clock = new Date(clock.getTime() + 60_000);
  await setFields(OVERRIDE_SETTINGS_SEED.fields);
});

describe('priority tier: request → approve → applied → revert', () => {
  it('runs end to end, keeps the original, and restores it exactly', async () => {
    const qn = await freshQuote();
    const { override: requested, original } = await requestTier(qn);
    expect(requested).toMatchObject({
      field: 'priority_tier',
      status: 'requested',
      approvalMode: 'approver',
      originalValue: original,
      justification: WHY,
      fieldLabel: 'Priority tier',
    });

    // The quote page shows the pending badge; the tier is unchanged until approved.
    const before = await detail(qn);
    const tierField = before.overridableFields.find((f) => f.field === 'priority_tier')!;
    expect(tierField.pending?.id).toBe(requested.id);
    expect(tierField.canRequest).toBe(false);
    expect(before.priority.tier).toBe(original);

    // The SalesLeader's inbox has it, decidable.
    const inbox = OverrideListResponse.parse(
      (await as('SalesLeader').get('/api/v1/overrides')).json(),
    );
    expect(inbox.items.find((i) => i.id === requested.id)?.canDecide).toBe(true);

    const approved = await as('SalesLeader').post(`/api/v1/overrides/${requested.id}/approve`, {
      note: 'Agreed with the account plan',
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(OverrideDto.parse(OverrideResponse.parse(approved.json()).override)).toMatchObject({
      status: 'applied',
      decisionNote: 'Agreed with the account plan',
      canRevert: true,
    });
    const after = await detail(qn);
    expect(after.priority).toMatchObject({ tier: requested.requestedValue, tierOverridden: true });
    const applied = after.overridableFields.find((f) => f.field === 'priority_tier')!;
    expect(applied.applied?.id).toBe(requested.id);
    expect(applied.pending).toBeNull();

    // A rescore while overridden keeps the displayed tier (B-08 rule).
    expect((await quoteRow(qn)).priorityTierOverridden).toBe(true);

    clock = new Date(clock.getTime() + 60_000);
    const reverted = await as('SalesLeader').post(`/api/v1/overrides/${requested.id}/revert`);
    expect(reverted.statusCode, reverted.body).toBe(200);
    expect(OverrideResponse.parse(reverted.json()).override.status).toBe('reverted');
    const row = await quoteRow(qn);
    expect(row.priorityTier).toBe(original);
    expect(row.priorityTierOverridden).toBe(false);

    // The override row still holds the original and the requested value.
    const [stored] = await db.db
      .select()
      .from(schema.override)
      .where(eq(schema.override.id, requested.id));
    expect(stored).toMatchObject({ originalValue: original, status: 'reverted' });

    // Activity (timeline) and audit (before/after) for every step.
    expect((await activityFor(row.id)).map((a) => a.type)).toEqual([
      'override_requested',
      'override_applied',
      'override_reverted',
    ]);
    const audits = await auditFor(requested.id);
    expect(audits.map((a) => a.action)).toEqual([
      'override_requested',
      'override_approved',
      'override_applied',
      'override_reverted',
    ]);
    expect(audits[2]).toMatchObject({
      before: { field: 'priority_tier', value: original },
      after: { field: 'priority_tier', value: requested.requestedValue, status: 'applied' },
    });
    expect(audits[3]).toMatchObject({
      before: { value: requested.requestedValue },
      after: { value: original, status: 'reverted' },
    });
    expect(audits.every((a) => a.ip && a.requestId && a.actorRoles.length > 0)).toBe(true);
  });

  it('notifies the approvers on request and the requester on the decision', async () => {
    const qn = await freshQuote();
    const kamId = await userId('KAM');
    const leaderId = await userId('SalesLeader');
    const { override } = await requestTier(qn);
    const quoteId = override.quoteId;
    const toApprovers = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.type, 'override.requested'),
          eq(schema.notification.quoteId, quoteId),
        ),
      );
    expect(toApprovers.map((n) => n.userId)).toContain(leaderId);
    expect(toApprovers.map((n) => n.userId)).toContain(await userId('EngLead'));
    expect(toApprovers.map((n) => n.userId)).not.toContain(kamId);

    await as('EngLead').post(`/api/v1/overrides/${override.id}/approve`, {});
    const toRequester = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.type, 'override.approved'),
          eq(schema.notification.userId, kamId),
          eq(schema.notification.quoteId, quoteId),
        ),
      );
    expect(toRequester.length).toBeGreaterThan(0);
    expect(toRequester[0]!.title).toContain(qn);
  });

  it('fails with 409 when the tier changed since the request, and leaves the request open', async () => {
    const qn = await freshQuote();
    const { override } = await requestTier(qn);
    await db.db
      .update(schema.quote)
      .set({ priorityTier: 'CRITICAL' })
      .where(eq(schema.quote.quoteNumber, qn));
    const res = await as('SalesLeader').post(`/api/v1/overrides/${override.id}/approve`, {});
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ code: 'override_conflict' });
    const [stored] = await db.db
      .select()
      .from(schema.override)
      .where(eq(schema.override.id, override.id));
    expect(stored!.status).toBe('requested');
    expect((await auditFor(override.id)).map((a) => a.action)).toEqual(['override_requested']);
  });

  it('a revert fails with 409 when a later change replaced the value', async () => {
    const qn = await freshQuote();
    const { override } = await requestTier(qn);
    await as('SalesLeader').post(`/api/v1/overrides/${override.id}/approve`, {});
    await db.db
      .update(schema.quote)
      .set({ priorityTier: 'LOW' })
      .where(eq(schema.quote.quoteNumber, qn));
    expect(
      (await as('SalesLeader').post(`/api/v1/overrides/${override.id}/revert`)).statusCode,
    ).toBe(409);
  });

  it('requires a justification of at least 15 characters, and a valid tier', async () => {
    const qn = await freshQuote();
    const res = await request(qn, {
      field: 'priority_tier',
      requestedValue: 'MEGA',
      justification: 'because',
    });
    expect(res.statusCode).toBe(422);
    expect(
      res
        .json<{ errors: { code: string }[] }>()
        .errors.map((e) => e.code)
        .sort(),
    ).toEqual(['INVALID_VALUE', 'JUSTIFICATION_REQUIRED']);
  });

  it('allows one open request per field (409 for a second)', async () => {
    const qn = await freshQuote();
    await requestTier(qn);
    const again = await request(
      qn,
      { field: 'priority_tier', requestedValue: 'LOW', justification: WHY },
      'SalesLeader',
    );
    expect(again.statusCode, again.body).toBe(409);
  });

  it('reject needs a note, closes the request and leaves the tier alone', async () => {
    const qn = await freshQuote();
    const { override, original } = await requestTier(qn);
    expect(
      (await as('SalesLeader').post(`/api/v1/overrides/${override.id}/reject`, {})).statusCode,
    ).toBe(422);
    const res = await as('SalesLeader').post(`/api/v1/overrides/${override.id}/reject`, {
      note: 'The score already reflects it',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(OverrideResponse.parse(res.json()).override).toMatchObject({
      status: 'rejected',
      decisionNote: 'The score already reflects it',
    });
    expect((await quoteRow(qn)).priorityTier).toBe(original);
    // Already decided: a second decision is a conflict.
    expect(
      (await as('SalesLeader').post(`/api/v1/overrides/${override.id}/approve`, {})).statusCode,
    ).toBe(409);
  });
});

describe('who approves is config (blueprint gap, R1)', () => {
  it('seed: SalesLeader or EngLead approve the tier; Admin and the requester may not', async () => {
    const qn = await freshQuote();
    const { override } = await requestTier(qn, 'SalesLeader');
    // Segregation: the SalesLeader who asked cannot approve their own request.
    expect(
      (await as('SalesLeader').post(`/api/v1/overrides/${override.id}/approve`, {})).statusCode,
    ).toBe(403);
    // Admin holds override.approve in the matrix but is not a configured tier approver.
    expect(
      (await as('Admin').post(`/api/v1/overrides/${override.id}/approve`, {})).statusCode,
    ).toBe(403);
    // Pricing has no override.approve at all (route floor).
    expect(
      (await as('Pricing').post(`/api/v1/overrides/${override.id}/approve`, {})).statusCode,
    ).toBe(403);
    expect(
      (await as('EngLead').post(`/api/v1/overrides/${override.id}/approve`, {})).statusCode,
    ).toBe(200);
  });

  it('changing overridable_fields changes who approves, with no code change', async () => {
    await setFields(
      OVERRIDE_SETTINGS_SEED.fields.map((f) =>
        f.field === 'priority_tier' ? { ...f, approverRoles: ['SalesLeader'] } : f,
      ),
    );
    const qn = await freshQuote();
    const { override } = await requestTier(qn);
    expect(
      (await as('EngLead').post(`/api/v1/overrides/${override.id}/approve`, {})).statusCode,
    ).toBe(403);
    const inbox = OverrideListResponse.parse((await as('EngLead').get('/api/v1/overrides')).json());
    expect(inbox.items.map((i) => i.id)).not.toContain(override.id);
    expect(
      (await as('SalesLeader').post(`/api/v1/overrides/${override.id}/approve`, {})).statusCode,
    ).toBe(200);
  });

  it('a field taken out of config can no longer be requested', async () => {
    await setFields(OVERRIDE_SETTINGS_SEED.fields.filter((f) => f.field !== 'priority_tier'));
    const qn = await freshQuote();
    const res = await request(qn, {
      field: 'priority_tier',
      requestedValue: 'HIGH',
      justification: WHY,
    });
    expect(res.statusCode).toBe(422);
    expect((await detail(qn)).overridableFields.map((f) => f.field)).toEqual([
      'ship_to',
      'queue_position',
    ]);
  });
});

describe('ship-to: the KAM self-applies with a reason (logged)', () => {
  it('applies at once on the KAM’s own quote, shows the marker, and the KAM can revert it exactly', async () => {
    const ownerId = await userId('KAM', 'owner');
    const qn = await freshQuote(ownerId);
    const original = (await quoteRow(qn)).shipTo;
    const res = await request(
      qn,
      {
        field: 'ship_to',
        requestedValue: { line1: '99 Co-packer Way', city: 'Elsewhere', state: 'OH' },
        justification: 'Filled at the customer co-packer',
      },
      'KAM',
      'owner',
    );
    expect(res.statusCode, res.body).toBe(201);
    const o = OverrideDto.parse(OverrideResponse.parse(res.json()).override);
    expect(o).toMatchObject({ status: 'applied', approvalMode: 'self', canRevert: true });
    const row = await quoteRow(qn);
    expect(row).toMatchObject({
      shipToOverridden: true,
      shipToOverrideReason: 'Filled at the customer co-packer',
    });
    expect(row.shipTo).toEqual({ line1: '99 Co-packer Way', city: 'Elsewhere', state: 'OH' });

    const d = await detail(qn, 'Leadership');
    expect(d.overridableFields.find((f) => f.field === 'ship_to')?.applied).toMatchObject({
      id: o.id,
      originalValue: original,
      justification: 'Filled at the customer co-packer',
    });
    expect((await auditFor(o.id)).map((a) => a.action)).toEqual([
      'override_requested',
      'override_applied',
    ]);

    const reverted = await as('KAM', 'owner').post(`/api/v1/overrides/${o.id}/revert`);
    expect(reverted.statusCode, reverted.body).toBe(200);
    const back = await quoteRow(qn);
    expect(back.shipTo).toEqual(original);
    expect(back.shipToOverridden).toBe(false);
    expect(back.shipToOverrideReason).toBeNull();
  });

  it("another KAM may not change it (own quotes only), nor revert the owner's override", async () => {
    const ownerId = await userId('KAM', 'owner');
    const qn = await freshQuote(ownerId);
    const body = {
      field: 'ship_to',
      requestedValue: { city: 'Elsewhere' },
      justification: 'Filled at the customer co-packer',
    };
    expect((await request(qn, body, 'KAM', 'all')).statusCode).toBe(403);
    const res = await request(qn, body, 'KAM', 'owner');
    const id = OverrideResponse.parse(res.json()).override.id;
    expect((await as('KAM', 'all').post(`/api/v1/overrides/${id}/revert`)).statusCode).toBe(403);
    // A configured revert role (SalesLeader) may.
    expect((await as('SalesLeader').post(`/api/v1/overrides/${id}/revert`)).statusCode).toBe(200);
  });

  it('the EngLead pins a quote to the top of the queue (self, logged)', async () => {
    const qn = await freshQuote();
    const res = await request(
      qn,
      {
        field: 'queue_position',
        requestedValue: 1,
        justification: 'Customer line-down; needs a quote this week',
      },
      'EngLead',
    );
    expect(res.statusCode, res.body).toBe(201);
    expect(await quoteRow(qn)).toMatchObject({ queuePosition: 1, queuePositionOverridden: true });
    expect(
      (await request(qn, { field: 'queue_position', requestedValue: 1, justification: WHY }, 'KAM'))
        .statusCode,
    ).toBe(403);
  });
});

describe('the override log', () => {
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
    expect((await as(role).get('/api/v1/admin/override-log')).statusCode).toBe(status);
  });

  it('lists every override with names, newest first, and pages with a cursor', async () => {
    const first = OverrideLogResponse.parse(
      (await as('Leadership').get('/api/v1/admin/override-log?limit=3')).json(),
    );
    expect(first.items).toHaveLength(3);
    expect(first.items[0]!.requestedByName).toBeTruthy();
    expect(first.nextCursor).toBeTruthy();
    const next = OverrideLogResponse.parse(
      (
        await as('Leadership').get(`/api/v1/admin/override-log?limit=3&cursor=${first.nextCursor}`)
      ).json(),
    );
    expect(next.items.map((i) => i.id)).not.toContain(first.items[0]!.id);
    const filtered = OverrideLogResponse.parse(
      (await as('Admin').get('/api/v1/admin/override-log?status=reverted&field=ship_to')).json(),
    );
    expect(filtered.items.every((i) => i.status === 'reverted' && i.field === 'ship_to')).toBe(
      true,
    );
    expect((await as('Admin').get('/api/v1/admin/override-log?cursor=nope')).statusCode).toBe(400);
  });
});
