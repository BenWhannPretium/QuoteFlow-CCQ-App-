import {
  OverrideResponse,
  CommentResponse,
  MeResponse,
  TimelineResponse,
  UserSearchResponse,
  type TimelineItem,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-09 timeline (F-08): every event type merged with comments, newest first; filter chips; keyset
 * paging; comments with sanitized markdown-lite and @mentions that notify; revert from the entry;
 * priority redaction for KAMs when peer scores are hidden.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-10-27T15:00:00Z');
const tick = () => (clock = new Date(clock.getTime() + 60_000));

const as = (role: Role, scope?: 'all' | 'owner' | 'region') => asRole(app, role, scope);
async function me(role: Role) {
  return MeResponse.parse((await as(role).get('/api/v1/me')).json()).user;
}

async function timeline(qn: string, query = '', role: Role = 'SalesLeader') {
  const res = await as(role).get(`/api/v1/quotes/${qn}/timeline${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return TimelineResponse.parse(res.json());
}

async function allItems(qn: string, filter = 'all', role: Role = 'SalesLeader') {
  const items: TimelineItem[] = [];
  let cursor: string | null = null;
  do {
    const page: TimelineResponse = await timeline(
      qn,
      `?filter=${filter}&limit=4${cursor ? `&cursor=${cursor}` : ''}`,
      role,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

let qn: string;
let quoteId: string;
let kamId: string;
let overrideId: string;

beforeAll(async () => {
  const fresh = await freshSfDatabase('timeline');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db, now: () => clock });
  await app.ready();

  // A quote past G1 (stage changes and gate decisions are already in its activity from the seed).
  const [row] = await db.db.execute<{ quote_number: string; id: string; kam_user_id: string }>(sql`
    select q.quote_number, q.id, q.kam_user_id from quote q
    where q.stage_key = 'QUOTING' and q.status = 'active'
      and exists (select 1 from activity_event a where a.quote_id = q.id and a.type = 'gate_decided')
    order by q.quote_number limit 1`);
  qn = row!.quote_number;
  quoteId = row!.id;
  kamId = row!.kam_user_id;

  // An override (self-applied ship-to by a SalesLeader), an upload and an SF flag change.
  tick();
  const o = await as('SalesLeader').post(`/api/v1/quotes/${qn}/overrides`, {
    field: 'ship_to',
    requestedValue: { line1: '1 Dock Rd', city: 'Elsewhere' },
    justification: 'Customer moved the filling to a co-packer',
  });
  expect(o.statusCode, o.body).toBe(201);
  overrideId = OverrideResponse.parse(o.json()).override.id;
  tick();
  await db.db.insert(schema.activityEvent).values([
    {
      quoteId,
      type: 'attachment_uploaded',
      actorId: kamId,
      at: clock,
      payload: { fileName: 'drawing.pdf', kind: 'bottle_drawing' },
    },
    {
      quoteId,
      type: 'sf_status_changed',
      actorId: null,
      at: new Date(clock.getTime() + 1),
      payload: { sfStatusFlag: 'closed_won' },
    },
  ]);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('comments', () => {
  it('stores sanitized markdown-lite, notifies @mentioned users still named in the text', async () => {
    const engLead = await me('EngLead');
    const pricing = await me('Pricing');
    tick();
    const res = await as('SalesLeader').post(`/api/v1/quotes/${qn}/comments`, {
      body: `<b>Heads up</b> @${engLead.displayName}: **sample** due _Friday_ <script>x()</script>`,
      mentions: [engLead.id, pricing.id],
    });
    expect(res.statusCode, res.body).toBe(201);
    const { item } = CommentResponse.parse(res.json());
    expect(item).toMatchObject({ kind: 'comment', category: 'comment', type: 'comment_added' });
    expect(item.comment!.body).toBe(
      `Heads up @${engLead.displayName}: **sample** due _Friday_ x()`,
    );
    expect(item.comment!.mentions).toEqual([{ userId: engLead.id, name: engLead.displayName }]);

    const notes = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.quoteId, quoteId),
          eq(schema.notification.type, 'comment.mention'),
        ),
      );
    expect(notes.map((n) => n.userId)).toEqual([engLead.id]);
    expect(notes[0]!.title).toContain(qn);
    expect(notes[0]!.body).toContain('sample');
    expect(notes[0]!.body).not.toContain('**');

    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.entity, 'comment'), eq(schema.auditEvent.entityId, item.id)));
    expect(audit).toMatchObject({ action: 'create', quoteId });
  });

  it('refuses a comment that is empty once sanitized', async () => {
    const res = await as('SalesLeader').post(`/api/v1/quotes/${qn}/comments`, { body: '<p></p>' });
    expect(res.statusCode).toBe(422);
  });

  it('the user picker finds active users', async () => {
    const leader = await me('SalesLeader');
    const res = await as('KAM').get(
      `/api/v1/users?q=${encodeURIComponent(leader.displayName.slice(0, 4))}`,
    );
    expect(res.statusCode).toBe(200);
    expect(UserSearchResponse.parse(res.json()).items.map((u) => u.id)).toContain(leader.id);
  });
});

describe('the timeline', () => {
  it('merges every event type with comments, newest first, with who / when / what', async () => {
    const items = await allItems(qn);
    const types = new Set(items.map((i) => i.type));
    for (const t of [
      'quote_created',
      'gate_decided',
      'stage_changed',
      'override_applied',
      'attachment_uploaded',
      'sf_status_changed',
      'comment_added',
    ]) {
      expect(types, t).toContain(t);
    }
    const ats = items.map((i) => i.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length); // paging neither skips nor repeats
    const decision = items.find((i) => i.type === 'gate_decided')!;
    expect(decision).toMatchObject({ category: 'decision', kind: 'activity' });
    expect(decision.actorName).toBeTruthy();
    expect(decision.payload).toHaveProperty('gateKey');
    const sf = items.find((i) => i.type === 'sf_status_changed')!;
    expect(sf).toMatchObject({ category: 'other', actorId: null, actorName: null });
  });

  it.each([
    ['decisions', 'decision'],
    ['overrides', 'override'],
    ['files', 'file'],
    ['comments', 'comment'],
  ])('filter=%s shows only %s items', async (filter, category) => {
    const items = await allItems(qn, filter);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.category === category)).toBe(true);
  });

  it('an override entry carries the override, revertable by who may revert it', async () => {
    const entry = (await allItems(qn, 'overrides')).find((i) => i.type === 'override_applied')!;
    expect(entry.override).toEqual({ id: overrideId, status: 'applied', canRevert: true });
    expect(entry.payload).toMatchObject({
      field: 'ship_to',
      justification: 'Customer moved the filling to a co-packer',
    });
    const asKam = (await allItems(qn, 'overrides', 'Leadership')).find(
      (i) => i.type === 'override_applied',
    )!;
    expect(asKam.override?.canRevert).toBe(false);

    tick();
    expect(
      (await as('SalesLeader').post(`/api/v1/overrides/${overrideId}/revert`)).statusCode,
    ).toBe(200);
    const after = await allItems(qn, 'overrides');
    expect(after[0]!.type).toBe('override_reverted');
    expect(after.find((i) => i.type === 'override_applied')!.override).toMatchObject({
      status: 'reverted',
      canRevert: false,
    });
  });

  it('rejects a bad cursor and 404s an unknown quote', async () => {
    expect(
      (await as('SalesLeader').get(`/api/v1/quotes/${qn}/timeline?cursor=bad`)).statusCode,
    ).toBe(400);
    expect((await as('SalesLeader').get('/api/v1/quotes/CCQ-2099-99999/timeline')).statusCode).toBe(
      404,
    );
  });

  it("hides priority events from a KAM on another KAM's quote when peer scores are hidden", async () => {
    tick();
    await db.db.insert(schema.activityEvent).values({
      quoteId,
      type: 'priority_tier_changed',
      actorId: null,
      at: clock,
      payload: { from: 'LOW', to: 'HIGH', score: 71 },
    });
    const viewer = await me('KAM');
    expect(viewer.id).not.toBe(kamId);
    expect((await allItems(qn, 'all', 'KAM')).map((i) => i.type)).toContain(
      'priority_tier_changed',
    );
    await db.db.execute(
      sql`update app_setting set value = 'false'::jsonb where key = 'kam_can_see_peer_scores'`,
    );
    try {
      expect((await allItems(qn, 'all', 'KAM')).map((i) => i.type)).not.toContain(
        'priority_tier_changed',
      );
      expect((await allItems(qn, 'all', 'SalesLeader')).map((i) => i.type)).toContain(
        'priority_tier_changed',
      );
    } finally {
      await db.db.execute(
        sql`update app_setting set value = 'true'::jsonb where key = 'kam_can_see_peer_scores'`,
      );
    }
  });
});
