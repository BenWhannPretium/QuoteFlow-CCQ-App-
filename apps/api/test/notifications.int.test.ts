import {
  GateQueueResponse,
  IntakeDraft,
  MeResponse,
  NotificationListResponse,
  OverrideResponse,
  PreferencesResponse,
  ProblemDetails,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { ADVISORY_LOCKS, schema, type DbClient } from '@ccq/db';
import {
  addCalendarDays,
  asUserId,
  hasCommercialFigure,
  proposalCalendarDate,
  type Role,
} from '@ccq/domain';
import { FakeMailTransport, MailError, type MailMessage } from '@ccq/integrations';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { persistNotifications } from '../src/services/notificationService';
import { testConfig } from '../src/test-utils';

/**
 * B-18: who is told about what (in-app + email), that a notification exists only if the change that
 * caused it committed, the email dispatcher (retries, backoff, owner-only alert, the 7:00 AM Central
 * digest), per-user email preferences, what an email may say (never an amount of money, never more than
 * the recipient may see) and the bell's feed API.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const mail = new FakeMailTransport();
/** Every message ever sent in this file (tests clear `mail.sent` to isolate their own). */
const allSent: MailMessage[] = [];
const sendThroughFake = mail.send.bind(mail);
mail.send = async (message) => {
  await sendThroughFake(message);
  allSent.push(message);
};

/** The test clock: real time plus an offset (rows are due "now"), or a fixed instant for the digest. */
let offsetMs = 60_000;
let fixed: Date | null = null;
const clock = () => fixed ?? new Date(Date.now() + offsetMs);

let free: string[] = [];
const created: string[] = [];
async function nextFree(): Promise<string> {
  const id = free.shift();
  if (id) return id;
  const old = created.shift();
  if (!old) throw new Error('test ran out of free opportunities');
  const [row] = await db.db.execute<{ id: string }>(sql`
    update quote set stage_key = 'DECLINED', status = 'closed', outcome = 'declined', closed_at = now(),
      outcome_reason_code = 'other', closure_owner_id = kam_user_id
    where quote_number = ${old} returning sf_opportunity_id as id`);
  return row!.id;
}

const as = (role: Role, scope?: 'all' | 'owner') => asRole(app, role, scope);
const ids: Record<string, string> = {};
async function userId(role: Role, scope: 'all' | 'owner' = 'all'): Promise<string> {
  const key = `${role}:${scope}`;
  ids[key] ??= MeResponse.parse((await as(role, scope).get('/api/v1/me')).json()).user.id;
  return ids[key];
}

async function prefill(sfOpportunityId: string, over: IntakeDraftData = {}) {
  const res = await as('KAM').get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`);
  expect(res.statusCode, res.body).toBe(200);
  const sf = SfOpportunityDetail.parse(res.json());
  const shipTo = {
    line1: '1 Test St',
    city: 'Testville',
    state: 'MO',
    postal: '63101',
    country: 'US',
  };
  return {
    sfOpportunityId,
    sfOpportunityName: sf.opportunity.name,
    customer: {
      status: 'existing' as const,
      sfAccountId: sf.account?.id ?? sf.opportunity.accountId,
      name: sf.account?.name ?? sf.opportunity.accountName,
    },
    shipTo,
    shipToDefault: shipTo,
    requestClass: 'CCQ',
    productFamily: 'BOTTLE',
    components: ['CONTAINER'],
    market: 'FOOD',
    resin: 'HDPE',
    neckFinish: '38-400',
    packagingType: 'BULK',
    estAnnualVolume: 750_000,
    estAnnualRevenue: 150_000,
    expectedCloseDate: '2026-12-15',
    containerSize: '16 oz',
    standardDescription: '16 oz Bottle, HDPE',
    drawingStatus: 'HAVE_DRAWING',
    ...over,
  };
}

/** A quote the KAM submitted that is waiting at G1. */
async function submitted(over: IntakeDraftData = {}): Promise<string> {
  const res = await as('KAM').post('/api/v1/quotes/drafts', {
    data: await prefill(await nextFree(), over),
  });
  expect(res.statusCode, res.body).toBe(201);
  const draft = IntakeDraft.parse(res.json());
  const sub = await as('KAM').post(`/api/v1/quotes/drafts/${draft.id}/submit`);
  expect(sub.statusCode, sub.body).toBe(201);
  const { quoteNumber, routedTo } = SubmitIntakeResponse.parse(sub.json());
  expect(routedTo).toBe('G1');
  created.push(quoteNumber);
  return quoteNumber;
}

const decide = (qn: string, gate: string, body: Record<string, unknown>, role: Role = 'EngLead') =>
  as(role).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);

/** A quote the SalesLeader advanced into Engineering Review. */
async function inQueue(over: IntakeDraftData = {}): Promise<string> {
  const qn = await submitted(over);
  const adv = await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader');
  expect(adv.statusCode, adv.body).toBe(201);
  return qn;
}

const quoteIdOf = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!.id;

async function rows(qn: string, type: string, channel?: 'in_app' | 'email') {
  return db.db
    .select()
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.quoteId, await quoteIdOf(qn)),
        eq(schema.notification.type, type),
        ...(channel ? [eq(schema.notification.channel, channel)] : []),
      ),
    )
    .orderBy(asc(schema.notification.createdAt), asc(schema.notification.id));
}

const usersWithRole = async (role: Role) =>
  db.db.execute<{ id: string; email: string; display_name: string }>(sql`
    select u.id, u.email, u.display_name from app_user u join user_role r on r.user_id = u.id
    where r.role = ${role} and u.active order by u.id`);

const emailOf = async (id: string) =>
  (await db.db.execute<{ email: string }>(sql`select email from app_user where id = ${id}`))[0]!
    .email;

const dispatch = () => app.notificationDispatch!.runNow();
/** Send everything due, so the next assertion starts from an empty outbox. */
async function drain() {
  mail.recover();
  await dispatch();
}
const sentAbout = (text: string): MailMessage[] =>
  mail.sent.filter((m) => m.subject.includes(text) || m.text.includes(text));
const sentTo = (email: string, text: string) =>
  sentAbout(text).filter((m) => m.to.toLowerCase() === email.toLowerCase());

beforeAll(async () => {
  const fresh = await freshSfDatabase('notifications');
  db = fresh.client;
  app = await buildApp(
    testConfig({ DATABASE_URL: fresh.url, NOTIFICATION_DISPATCH_INTERVAL_SECONDS: '0' }),
    { db, now: clock, mail },
  );
  await app.ready();
  // Every user gets an address, so who is emailed depends on the rules under test, not on the seed.
  await db.db.execute(sql`
    update app_user set email = lower(replace(display_name, ' ', '.')) || '.' || substr(id::text, 1, 6) || '@pretiumpkg.example'
    where email is null`);
  const opps = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id`);
  free = opps.map((r) => r.id);
  expect(free.length).toBeGreaterThanOrEqual(12);
}, 120_000);
afterAll(async () => {
  await app.close();
});

// ── Who is told about what ──────────────────────────────────────────────────────────────────────

describe('quote entered the engineering queue', () => {
  it('tells every EngLead and every backup assigner, in-app and by email, never the person who did it', async () => {
    const backup = await userId('Engineer');
    await db.db.execute(
      sql`update app_setting set value = ${JSON.stringify([backup])}::jsonb where key = 'eng_queue_backup_assigner_user_ids'`,
    );
    try {
      const qn = await inQueue();
      const leads = (await usersWithRole('EngLead')).map((u) => u.id);
      const expected = [...new Set([...leads, backup])].sort();

      const inApp = await rows(qn, 'quote.ready_for_eng_review', 'in_app');
      const email = await rows(qn, 'quote.ready_for_eng_review', 'email');
      expect(inApp.map((r) => r.userId).sort()).toEqual(expected);
      expect(email.map((r) => r.userId).sort()).toEqual(expected);
      expect(inApp.map((r) => r.userId)).not.toContain(await userId('SalesLeader'));
      for (const r of email) {
        expect(r).toMatchObject({ attempts: 0, sentAt: null, failedAt: null, error: null });
        expect(r.nextAttemptAt).not.toBeNull();
      }

      await dispatch();
      const subject = `[QuoteFlow] ${qn} needs your review: Engineering queue`;
      for (const id of expected) {
        const [m] = sentTo(await emailOf(id), qn);
        expect(m, `email to ${id}`).toBeDefined();
        expect(m!.subject).toBe(subject);
        expect(m!.from).toBe('ccq-noreply@pretiumpkg.com');
        expect(m!.html).toContain(`http://localhost:5173/quotes/${qn}?tab=engineering`);
        expect(m!.text).toContain(`Quote: ${qn}`);
        expect(m!.text).toMatch(/Account: \S/);
        expect(m!.text).toMatch(/Product: .*HDPE/);
        expect(m!.text).toMatch(/Priority: \S/);
        expect(m!.text).toContain(`http://localhost:5173/quotes/${qn}?tab=engineering`);
      }
      const sent = await rows(qn, 'quote.ready_for_eng_review', 'email');
      expect(sent.every((r) => r.sentAt !== null && r.attempts === 1 && r.error === null)).toBe(
        true,
      );
    } finally {
      await db.db.execute(
        sql`update app_setting set value = '[]'::jsonb where key = 'eng_queue_backup_assigner_user_ids'`,
      );
    }
  });
});

describe('quote assigned or reassigned', () => {
  it('tells the engineer, in-app and by email', async () => {
    await drain();
    const qn = await inQueue();
    const engineer = await userId('Engineer');
    const res = await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, {
      engineerId: engineer,
    });
    expect(res.statusCode, res.body).toBe(200);

    expect((await rows(qn, 'quote.assigned', 'in_app')).map((r) => r.userId)).toEqual([engineer]);
    const [email] = await rows(qn, 'quote.assigned', 'email');
    expect(email).toMatchObject({ userId: engineer, payload: { reassigned: 'no' } });

    await dispatch();
    const [m] = sentTo(await emailOf(engineer), `${qn} is assigned to you`);
    expect(m!.subject).toBe(`[QuoteFlow] ${qn} is assigned to you: Engineering review`);
    expect(m!.text).toContain('You have a new engineering review.');
    expect(m!.html).toContain(`/quotes/${qn}?tab=engineering`);
  });
});

describe('returned to the KAM (G1 and G2 rework)', () => {
  it('G1 rework: the KAM is told, in-app and by email, with the reason but not the note', async () => {
    await drain();
    const qn = await submitted();
    const res = await decide(
      qn,
      'G1',
      {
        outcomeKey: 'rework',
        reasonCode: 'missing_information',
        note: 'ZEBRA-NOTE the SKU split and the drawing are missing',
      },
      'SalesLeader',
    );
    expect(res.statusCode, res.body).toBe(201);
    const kam = await userId('KAM');
    expect((await rows(qn, 'quote.reworked', 'in_app')).map((r) => r.userId)).toEqual([kam]);
    expect((await rows(qn, 'quote.reworked', 'email')).map((r) => r.userId)).toEqual([kam]);

    await dispatch();
    const [m] = sentTo(await emailOf(kam), qn);
    expect(m!.subject).toBe(`[QuoteFlow] ${qn} was returned to you: Rework needed`);
    expect(m!.text).toContain('Reason: Missing information.');
    expect(m!.text + m!.html).not.toContain('ZEBRA-NOTE');
  });

  it('G2 rework ("Return to KAM") tells the KAM too', async () => {
    await drain();
    const qn = await inQueue();
    const res = await decide(qn, 'G2', {
      outcomeKey: 'rework',
      reasonCode: 'missing_information',
      note: 'Need the neck finish drawing',
    });
    expect(res.statusCode, res.body).toBe(201);
    const kam = await userId('KAM');
    expect((await rows(qn, 'quote.reworked', 'in_app')).map((r) => r.userId)).toEqual([kam]);
    await dispatch();
    expect(sentTo(await emailOf(kam), qn)).toHaveLength(1);
  });

  it('a rework that goes to a group (G3 → Engineering) is announced once, by the arrival alert', async () => {
    // The planned `quote.reworked` is addressed to a role there, so only the arrival alert is written.
    const qn = await inQueue();
    expect(await rows(qn, 'quote.reworked')).toHaveLength(0);
  });
});

describe('to qualify (G1)', () => {
  it('is in-app at once for the SalesLeaders and an email only in the 7:00 AM Central digest', async () => {
    await drain();
    const qn = await submitted();
    const leaders = await usersWithRole('SalesLeader');
    expect(leaders.length).toBeGreaterThan(0);

    const inApp = await rows(qn, 'quote.to_qualify', 'in_app');
    expect(inApp.map((r) => r.userId).sort()).toEqual(leaders.map((u) => u.id).sort());
    expect(inApp[0]!.title).toBe(`${qn} is waiting to qualify`);
    expect(await rows(qn, 'quote.to_qualify', 'email')).toHaveLength(0);
    await dispatch();
    expect(sentAbout(qn).filter((m) => m.subject.includes('waiting to qualify'))).toHaveLength(0);

    // The queue as a SalesLeader sees it is what the digest lists.
    const queue = GateQueueResponse.parse(
      (await as('SalesLeader').get('/api/v1/gates/G1/queue')).json(),
    );
    expect(queue.items.map((i) => i.quoteNumber)).toContain(qn);

    // 6:59 AM Central: nothing yet.
    mail.sent.length = 0;
    fixed = new Date('2026-10-27T11:59:00Z');
    expect((await dispatch()).digestsQueued).toBe(0);
    expect(mail.sent.filter((m) => m.subject.includes('waiting to qualify'))).toHaveLength(0);

    // 7:05 AM Central: one email per SalesLeader, listing every quote waiting.
    fixed = new Date('2026-10-27T12:05:00Z');
    const run = await dispatch();
    const everyone = await usersWithRole('SalesLeader');
    expect(run.digestsQueued).toBe(everyone.length);
    const digests = mail.sent.filter((m) =>
      m.subject.endsWith('waiting to qualify: Daily summary'),
    );
    expect(digests.map((m) => m.to.toLowerCase()).sort()).toEqual(
      everyone.map((u) => u.email.toLowerCase()).sort(),
    );
    for (const d of digests) {
      expect(d.subject).toBe(
        `[QuoteFlow] ${queue.items.length} quote${queue.items.length === 1 ? '' : 's'} waiting to qualify: Daily summary`,
      );
      expect(d.text).toContain(qn);
      expect(d.text).toContain('http://localhost:5173/approvals?gate=G1');
    }

    // The same day again, or later in the window: no second digest.
    mail.sent.length = 0;
    fixed = new Date('2026-10-27T13:30:00Z');
    expect((await dispatch()).digestsQueued).toBe(0);
    expect(mail.sent.filter((m) => m.subject.includes('waiting to qualify'))).toHaveLength(0);

    // A new day: a new digest.
    fixed = new Date('2026-10-28T12:10:00Z');
    expect((await dispatch()).digestsQueued).toBe(everyone.length);
    fixed = null;
  });

  it('sends no digest when nothing is waiting, and none to someone who opted out', async () => {
    await drain();
    const sl = await userId('SalesLeader');
    const put = await as('SalesLeader').put('/api/v1/me/preferences', {
      email: { 'quote.to_qualify': false },
    });
    expect(put.statusCode, put.body).toBe(200);
    try {
      mail.sent.length = 0;
      fixed = new Date('2026-10-29T12:05:00Z');
      await dispatch();
      const to = mail.sent.filter((m) => m.subject.includes('waiting to qualify')).map((m) => m.to);
      expect(to).not.toContain(await emailOf(sl));
      expect(to.length).toBeGreaterThan(0); // the multi-role SalesLeader still gets theirs
    } finally {
      fixed = null;
      await as('SalesLeader').put('/api/v1/me/preferences', {
        email: { 'quote.to_qualify': true },
      });
    }

    // Empty queue: close every quote waiting at G1 and the day's digest is not sent at all.
    await db.db.execute(
      sql`update quote set submitted_at = null where stage_key = 'INTAKE' and status <> 'closed'`,
    );
    mail.sent.length = 0;
    fixed = new Date('2026-10-30T12:05:00Z');
    expect((await dispatch()).digestsQueued).toBe(0);
    expect(mail.sent.filter((m) => m.subject.includes('waiting to qualify'))).toHaveLength(0);
    fixed = null;
  });
});

describe('@mentions', () => {
  it('tells the mentioned user, in-app and by email, saying who and where but never repeating the comment', async () => {
    await drain();
    const qn = await inQueue();
    const pricing = MeResponse.parse((await as('Pricing').get('/api/v1/me')).json()).user;
    const author = MeResponse.parse((await as('EngLead').get('/api/v1/me')).json()).user;
    const res = await as('EngLead').post(`/api/v1/quotes/${qn}/comments`, {
      body: `@${pricing.displayName} tooling is $250,000 and the capital ask is 1,800,000 USD`,
      mentions: [pricing.id],
    });
    expect(res.statusCode, res.body).toBe(201);

    expect((await rows(qn, 'comment.mention', 'in_app')).map((r) => r.userId)).toEqual([
      pricing.id,
    ]);
    expect((await rows(qn, 'comment.mention', 'email')).map((r) => r.userId)).toEqual([pricing.id]);

    await dispatch();
    const [m] = sentTo(await emailOf(pricing.id), qn);
    expect(m!.subject).toBe(`[QuoteFlow] ${qn} has a comment for you: Mention`);
    expect(m!.text).toContain(`${author.displayName} mentioned you.`);
    for (const part of [m!.subject, m!.html, m!.text]) {
      expect(part).not.toMatch(/250,000|1,800,000|tooling is|capital ask/i);
      expect(hasCommercialFigure(part)).toBe(false);
    }
  });

  it('shows a recipient who may not see the quote its number and link, and nothing else', async () => {
    await drain();
    const qn = await inQueue();
    const stranger = await userId('KAM', 'owner'); // owner scope: this quote is the other KAM's
    expect((await as('KAM', 'owner').get(`/api/v1/quotes/${qn}`)).statusCode).toBe(404);
    const name = MeResponse.parse((await as('KAM', 'owner').get('/api/v1/me')).json()).user
      .displayName;
    const res = await as('EngLead').post(`/api/v1/quotes/${qn}/comments`, {
      body: `@${name} please look`,
      mentions: [stranger],
    });
    expect(res.statusCode, res.body).toBe(201);
    await dispatch();
    const [m] = sentTo(await emailOf(stranger), qn);
    expect(m, 'the mention is still emailed').toBeDefined();
    expect(m!.text).toContain(`Quote: ${qn}`);
    expect(m!.text).toContain(`http://localhost:5173/quotes/${qn}`);
    expect(m!.text).not.toMatch(/Account:|Product:|Priority:/);
  });
});

describe('what the recipient may see of a quote', () => {
  it('leaves out the priority tier of a peer’s quote when KAMs may not see peer scores', async () => {
    await drain();
    const qn = await inQueue(); // the "kam" persona's quote
    const peer = await userId('KAM', 'owner'); // another KAM; sees only their own quotes (owner scope)
    // A peer KAM that can see this quote needs scope "all": make that user one for this test.
    await db.db.execute(sql`update user_scope set scope_type = 'all' where user_id = ${peer}`);
    const mention = async () => {
      mail.sent.length = 0;
      const name = MeResponse.parse((await as('KAM', 'owner').get('/api/v1/me')).json()).user
        .displayName;
      const res = await as('EngLead').post(`/api/v1/quotes/${qn}/comments`, {
        body: `@${name} FYI`,
        mentions: [peer],
      });
      expect(res.statusCode, res.body).toBe(201);
      await dispatch();
      const [m] = sentTo(await emailOf(peer), qn);
      expect(m, 'the mention is emailed').toBeDefined();
      return m!;
    };
    const setPeerScores = (on: boolean) =>
      db.db.execute(
        sql`update app_setting set value = ${JSON.stringify(on)}::jsonb where key = 'kam_can_see_peer_scores'`,
      );
    try {
      await setPeerScores(true);
      const shown = await mention();
      expect(shown.text).toMatch(/Account: \S/);
      expect(shown.text).toMatch(/Priority: \S/);

      await setPeerScores(false);
      const hidden = await mention();
      expect(hidden.text).toMatch(/Account: \S/); // the quote is theirs to see…
      expect(hidden.text).not.toMatch(/Priority:/); // …its score is not
    } finally {
      await setPeerScores(true);
      await db.db.execute(sql`update user_scope set scope_type = 'owner' where user_id = ${peer}`);
    }
  });
});

describe('proposal validity', () => {
  const setValidity = (id: string, date: string) =>
    db.db.execute(
      sql`update quote set validity_until = ${date}, validity_expired_flagged_at = null where id = ${id}`,
    );

  it('warns the KAM once when the date is within 7 days, and once more when it has passed', async () => {
    await drain();
    const open = await db.db.execute<{ id: string; quote_number: string; kam_user_id: string }>(sql`
      select q.id, q.quote_number, q.kam_user_id from quote q
      join app_user k on k.id = q.kam_user_id and k.active
      where q.stage_key = 'CUSTOMER_DECISION' and q.status <> 'closed' order by q.quote_number limit 2`);
    const [soon, far] = open;
    expect(soon && far).toBeTruthy();
    const today = proposalCalendarDate(clock());
    await setValidity(soon!.id, addCalendarDays(today, 5));
    await setValidity(far!.id, addCalendarDays(today, 30));
    const job = app.validityExpiry!;

    const first = await job.runNow();
    expect(first.warnedQuoteNumbers).toContain(soon!.quote_number);
    expect(first.warnedQuoteNumbers).not.toContain(far!.quote_number);
    const count = async (id: string, type: string, channel: 'in_app' | 'email') =>
      (
        await db.db
          .select()
          .from(schema.notification)
          .where(
            and(
              eq(schema.notification.quoteId, id),
              eq(schema.notification.type, type),
              eq(schema.notification.channel, channel),
            ),
          )
      ).length;
    expect(await count(soon!.id, 'quote.validity_expiring', 'in_app')).toBe(1);
    expect(await count(soon!.id, 'quote.validity_expiring', 'email')).toBe(1);
    expect(await count(far!.id, 'quote.validity_expiring', 'in_app')).toBe(0);

    // Once per state: a second run, a restart, another instance: nothing new.
    expect((await job.runNow()).warnedQuoteNumbers).not.toContain(soon!.quote_number);
    expect(await count(soon!.id, 'quote.validity_expiring', 'in_app')).toBe(1);
    expect(await count(soon!.id, 'quote.validity_expiring', 'email')).toBe(1);

    await dispatch();
    const [warn] = sentTo(await emailOf(soon!.kam_user_id), 'proposal expires soon').filter((m) =>
      m.subject.includes(soon!.quote_number),
    );
    expect(warn!.text).toContain('5 days left');
    expect(warn!.text).toContain(`valid until ${addCalendarDays(today, 5)}`);

    // The date passes: the expiry notice, once.
    await setValidity(soon!.id, addCalendarDays(today, -1));
    const expired = await job.runNow();
    expect(expired.quoteNumbers).toContain(soon!.quote_number);
    await job.runNow();
    expect(await count(soon!.id, 'quote.validity_expired', 'in_app')).toBe(1);
    expect(await count(soon!.id, 'quote.validity_expired', 'email')).toBe(1);
    await dispatch();
    expect(
      sentAbout('proposal validity has passed').filter((m) =>
        m.subject.includes(soon!.quote_number),
      ),
    ).toHaveLength(1);

    // A revalidation (a new date) starts the states over.
    await setValidity(soon!.id, addCalendarDays(today, 3));
    expect((await job.runNow()).warnedQuoteNumbers).toContain(soon!.quote_number);
    expect(await count(soon!.id, 'quote.validity_expiring', 'in_app')).toBe(2);
  });
});

describe('overrides are in-app only', () => {
  it('alerts the approvers on request and the requester on the decision, without any email', async () => {
    await drain();
    const qn = await inQueue();
    const [current] = await db.db.execute<{ tier: string }>(
      sql`select priority_tier as tier from quote where quote_number = ${qn}`,
    );
    const tier = current!.tier;
    const req = await as('KAM').post(`/api/v1/quotes/${qn}/overrides`, {
      field: 'priority_tier',
      requestedValue: tier === 'LOW' ? 'HIGH' : 'LOW',
      justification: 'Customer line-down; escalated this morning',
    });
    expect(req.statusCode, req.body).toBe(201);
    const id = OverrideResponse.parse(req.json()).override.id;
    const asked = await rows(qn, 'override.requested');
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((r) => r.channel === 'in_app')).toBe(true);

    const approve = await as('SalesLeader').post(`/api/v1/overrides/${id}/approve`, {
      note: 'Approved: line-down',
    });
    expect(approve.statusCode, approve.body).toBe(200);
    const decided = await rows(qn, 'override.approved');
    expect(decided.map((r) => [r.userId, r.channel])).toEqual([[await userId('KAM'), 'in_app']]);
    const emails = await db.db
      .select()
      .from(schema.notification)
      .where(and(eq(schema.notification.channel, 'email'), sql`type like 'override.%'`));
    expect(emails).toHaveLength(0);
  });
});

// ── Transactions ────────────────────────────────────────────────────────────────────────────────

describe('created with the change, never without it', () => {
  it('a rolled-back change leaves no notification, in-app or email', async () => {
    const qn = await inQueue();
    const quoteId = await quoteIdOf(qn);
    const engineer = await userId('Engineer');
    const before = (await db.db.select().from(schema.notification)).length;
    await expect(
      db.db.transaction(async (tx) => {
        const n = await persistNotifications(
          tx,
          [{ type: 'quote.assigned', recipient: { kind: 'user', userId: asUserId(engineer) } }],
          { quoteId, title: `${qn} ROLLBACK-PROBE`, body: 'never committed' },
        );
        expect(n).toBe(1);
        const inside = await tx
          .select()
          .from(schema.notification)
          .where(eq(schema.notification.title, `${qn} ROLLBACK-PROBE`));
        expect(inside).toHaveLength(2); // in-app + email, visible inside the transaction
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    expect((await db.db.select().from(schema.notification)).length).toBe(before);
  });

  it('a rejected decision (422) writes nothing', async () => {
    const qn = await submitted();
    const before = (await db.db.select().from(schema.notification)).length;
    const res = await decide(qn, 'G1', { outcomeKey: 'rework' }, 'SalesLeader'); // no reason, no note
    expect(res.statusCode).toBe(422);
    expect((await db.db.select().from(schema.notification)).length).toBe(before);
    expect(await rows(qn, 'quote.reworked')).toHaveLength(0);
  });

  it('a decision by someone who may not make it (403) writes nothing', async () => {
    const qn = await submitted();
    const before = (await db.db.select().from(schema.notification)).length;
    const res = await decide(qn, 'G1', { outcomeKey: 'advance' }, 'Engineer');
    expect(res.statusCode).toBe(403);
    expect((await db.db.select().from(schema.notification)).length).toBe(before);
  });
});

// ── Preferences ─────────────────────────────────────────────────────────────────────────────────

describe('email preferences', () => {
  const prefs = async (role: Role) =>
    PreferencesResponse.parse((await as(role).get('/api/v1/me/preferences')).json());

  it('lists one switch per emailed type, on by default; in-app events have none', async () => {
    const p = await prefs('Engineer');
    expect(p.emailAvailable).toBe(true);
    expect(p.email.map((e) => e.type).sort()).toEqual(
      [
        'comment.mention',
        'quote.approved_for_customer',
        'quote.assigned',
        'quote.capital_likely',
        'quote.declined',
        'quote.escalated',
        'quote.market_dev',
        'quote.pricing_assigned',
        'quote.ready_for_eng_review',
        'quote.ready_for_final_review',
        'quote.reworked',
        'quote.to_qualify',
        'quote.validity_expired',
        'quote.validity_expiring',
      ].sort(),
    );
    expect(p.email.every((e) => e.enabled)).toBe(true);
    expect(p.email.find((e) => e.type === 'quote.to_qualify')!.delivery).toBe('daily_digest');
    expect(p.email.find((e) => e.type === 'quote.assigned')!.delivery).toBe('immediate');
  });

  it('an opt-out keeps the in-app notification and drops the email; opting back in restores it', async () => {
    await drain();
    const engineer = await userId('Engineer');
    const off = await as('Engineer').put('/api/v1/me/preferences', {
      email: { 'quote.assigned': false },
    });
    expect(off.statusCode, off.body).toBe(200);
    expect(
      PreferencesResponse.parse(off.json()).email.find((e) => e.type === 'quote.assigned')!.enabled,
    ).toBe(false);

    const qn1 = await inQueue();
    await as('EngLead').post(`/api/v1/quotes/${qn1}/assignment`, { engineerId: engineer });
    expect(await rows(qn1, 'quote.assigned', 'in_app')).toHaveLength(1);
    expect(await rows(qn1, 'quote.assigned', 'email')).toHaveLength(0);
    await dispatch();
    expect(sentAbout(`${qn1} is assigned`)).toHaveLength(0);

    // Other types, and other people, are unaffected.
    expect((await prefs('KAM')).email.find((e) => e.type === 'quote.assigned')!.enabled).toBe(true);
    expect((await prefs('Engineer')).email.find((e) => e.type === 'quote.reworked')!.enabled).toBe(
      true,
    );

    const on = await as('Engineer').put('/api/v1/me/preferences', {
      email: { 'quote.assigned': true },
    });
    expect(on.statusCode, on.body).toBe(200);
    const qn2 = await inQueue();
    await as('EngLead').post(`/api/v1/quotes/${qn2}/assignment`, { engineerId: engineer });
    expect(await rows(qn2, 'quote.assigned', 'email')).toHaveLength(1);
  });

  it('an opt-out after the email was queued still stops it', async () => {
    const engineer = await userId('Engineer');
    const qn = await inQueue();
    await drain();
    await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer });
    const [queued] = await rows(qn, 'quote.assigned', 'email');
    expect(queued).toBeDefined();
    await as('Engineer').put('/api/v1/me/preferences', { email: { 'quote.assigned': false } });
    try {
      const run = await dispatch();
      expect(run.skipped).toBeGreaterThanOrEqual(1);
      expect(sentAbout(`${qn} is assigned`)).toHaveLength(0);
      const [row] = await rows(qn, 'quote.assigned', 'email');
      expect(row).toMatchObject({ sentAt: null, failedAt: null, nextAttemptAt: null });
      expect(row!.error).toBe('skipped: recipient opted out');
    } finally {
      await as('Engineer').put('/api/v1/me/preferences', { email: { 'quote.assigned': true } });
    }
  });

  it('refuses a type that has no email, and an unknown one; in-app cannot be switched off', async () => {
    for (const type of ['override.requested', 'integration.failed', 'no.such.type']) {
      const res = await as('Engineer').put('/api/v1/me/preferences', { email: { [type]: false } });
      expect(res.statusCode, type).toBe(422);
      expect(ProblemDetails.parse(res.json()).code).toBe('unknown_notification_type');
    }
    const bad = await as('Engineer').put('/api/v1/me/preferences', {
      email: { 'quote.assigned': 'no' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('is audited, with before and after', async () => {
    const kam = await userId('KAM');
    await as('KAM').put('/api/v1/me/preferences', { email: { 'quote.reworked': false } });
    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.entity, 'user_preference'), eq(schema.auditEvent.actorId, kam)),
      )
      .orderBy(sql`at desc`)
      .limit(1);
    expect(audit).toMatchObject({
      action: 'update',
      before: { 'quote.reworked': true },
      after: { 'quote.reworked': false },
    });
    await as('KAM').put('/api/v1/me/preferences', { email: { 'quote.reworked': true } });
  });

  it('a user without an address, an inactive user and the app-wide switch: in-app only', async () => {
    await drain();
    const engineer = await userId('Engineer');
    const address = await emailOf(engineer);
    await db.db.execute(sql`update app_user set email = null where id = ${engineer}`);
    const qn1 = await inQueue();
    await as('EngLead').post(`/api/v1/quotes/${qn1}/assignment`, { engineerId: engineer });
    expect(await rows(qn1, 'quote.assigned', 'in_app')).toHaveLength(1);
    expect(await rows(qn1, 'quote.assigned', 'email')).toHaveLength(0);
    await db.db.execute(sql`update app_user set email = ${address} where id = ${engineer}`);

    await db.db.execute(
      sql`update app_setting set value = 'false'::jsonb where key = 'email_notifications_enabled'`,
    );
    try {
      expect((await prefs('Engineer')).emailAvailable).toBe(false);
      const qn2 = await inQueue();
      await as('EngLead').post(`/api/v1/quotes/${qn2}/assignment`, { engineerId: engineer });
      expect(await rows(qn2, 'quote.assigned', 'in_app')).toHaveLength(1);
      expect(await rows(qn2, 'quote.assigned', 'email')).toHaveLength(0);
      expect(await rows(qn2, 'quote.ready_for_eng_review', 'email')).toHaveLength(0);
    } finally {
      await db.db.execute(
        sql`update app_setting set value = 'true'::jsonb where key = 'email_notifications_enabled'`,
      );
    }
  });
});

// ── The dispatcher ──────────────────────────────────────────────────────────────────────────────

describe('the dispatcher', () => {
  const MIN = 60_000;
  /** A queued email to the Engineer, by assigning a fresh quote. */
  async function queueOne() {
    const engineer = await userId('Engineer');
    const qn = await inQueue();
    // The arrival emails to the EngLeads would muddy the counts: send them first.
    await drain();
    await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer });
    mail.sent.length = 0;
    const [row] = await rows(qn, 'quote.assigned', 'email');
    return { qn, id: row!.id, engineer };
  }
  const state = async (id: string) =>
    (await db.db.select().from(schema.notification).where(eq(schema.notification.id, id)))[0]!;

  it('retries a failed send after 1 minute, then 5, and the third failure is final: 3 tries', async () => {
    const { qn, id } = await queueOne();
    mail.failAlways();
    offsetMs = 60_000;
    const t0 = clock().getTime();

    const r1 = await dispatch();
    expect(r1).toMatchObject({ outcome: 'succeeded', retrying: 1, failed: 0 });
    let row = await state(id);
    expect(row.attempts).toBe(1);
    expect(row.error).toMatch(/^UNAVAILABLE 503: /);
    expect(row.sentAt).toBeNull();
    expect(row.failedAt).toBeNull();
    expect(row.nextAttemptAt!.getTime() - t0).toBeGreaterThanOrEqual(MIN - 5_000);
    expect(row.nextAttemptAt!.getTime() - t0).toBeLessThanOrEqual(MIN + 5_000);

    // 30 seconds later: not due yet.
    offsetMs += 30_000;
    expect((await dispatch()).retrying).toBe(0);
    expect((await state(id)).attempts).toBe(1);

    // After the first wait: the second try, next one in 5 minutes.
    offsetMs += MIN;
    expect((await dispatch()).retrying).toBe(1);
    row = await state(id);
    expect(row.attempts).toBe(2);
    const second = clock().getTime();
    expect(row.nextAttemptAt!.getTime() - second).toBeGreaterThanOrEqual(5 * MIN - 5_000);
    expect(row.nextAttemptAt!.getTime() - second).toBeLessThanOrEqual(5 * MIN + 5_000);

    // After the second wait: the third and last.
    offsetMs += 5 * MIN + 1_000;
    expect(await dispatch()).toMatchObject({ retrying: 0, failed: 1 });
    row = await state(id);
    expect(row).toMatchObject({ attempts: 3, sentAt: null });
    expect(row.failedAt).not.toBeNull();
    expect(row.error).toMatch(/^UNAVAILABLE 503: /);
    expect(row.error).not.toContain(qn);

    // Never tried again.
    offsetMs += 60 * MIN;
    expect(await dispatch()).toMatchObject({ sent: 0, retrying: 0, failed: 0 });
    expect((await state(id)).attempts).toBe(3);
    mail.recover();
  });

  it('on a final failure alerts the owners (Admins) only: in-app, no email, never the recipient', async () => {
    const { qn, id, engineer } = await queueOne();
    mail.failAlways();
    for (const wait of [0, MIN + 1_000, 5 * MIN + 2_000]) {
      offsetMs += wait;
      await dispatch();
    }
    expect((await state(id)).failedAt).not.toBeNull();
    mail.recover();

    const admins = (await usersWithRole('Admin')).map((u) => u.id).sort();
    expect(admins.length).toBeGreaterThan(0);
    const alerts = await db.db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.type, 'notification.delivery_failed'));
    const forThis = alerts.filter((a) => a.body.includes(qn));
    expect(forThis.map((a) => a.userId).sort()).toEqual(admins);
    expect(forThis.every((a) => a.channel === 'in_app')).toBe(true);
    expect(forThis[0]!.title).toMatch(/email could not be sent/);
    expect(forThis[0]!.body).toContain('quote.assigned');
    expect(forThis[0]!.body).toContain('UNAVAILABLE');
    // Not the person the email was for, nor the KAM, nor anyone else.
    const alerted = new Set(alerts.map((a) => a.userId));
    expect(alerted.has(engineer)).toBe(false);
    expect(alerted.has(await userId('KAM'))).toBe(false);
    expect([...alerted].every((u) => admins.includes(u))).toBe(true);
    // And the alert itself is not emailed.
    expect(
      await db.db
        .select()
        .from(schema.notification)
        .where(
          and(
            eq(schema.notification.type, 'notification.delivery_failed'),
            eq(schema.notification.channel, 'email'),
          ),
        ),
    ).toHaveLength(0);
  });

  it('a send that works on the second try is delivered once, with the error cleared', async () => {
    const { qn, id } = await queueOne();
    mail.failNext(1);
    expect((await dispatch()).retrying).toBe(1);
    offsetMs += MIN + 1_000;
    expect(await dispatch()).toMatchObject({ sent: 1, failed: 0 });
    const row = await state(id);
    expect(row).toMatchObject({ attempts: 2, error: null, failedAt: null, nextAttemptAt: null });
    expect(row.sentAt).not.toBeNull();
    expect(sentAbout(`${qn} is assigned`)).toHaveLength(1);
    offsetMs += MIN;
    await dispatch();
    expect(sentAbout(`${qn} is assigned`)).toHaveLength(1);
  });

  it('a message the mail system refuses (REJECTED) is final at once and not retried', async () => {
    const { id } = await queueOne();
    mail.failNext(1, new MailError('REJECTED', 'mailbox unavailable', 550));
    expect(await dispatch()).toMatchObject({ retrying: 0, failed: 1 });
    expect(await state(id)).toMatchObject({ attempts: 1 });
    expect((await state(id)).failedAt).not.toBeNull();
  });

  it('only one instance dispatches at a time (advisory lock)', async () => {
    await drain();
    const held = await db.sql.reserve();
    try {
      await held`select pg_advisory_lock(${ADVISORY_LOCKS.notificationDispatch.toString()}::bigint)`;
      expect(await dispatch()).toMatchObject({ outcome: 'skipped', sent: 0 });
    } finally {
      await held`select pg_advisory_unlock(${ADVISORY_LOCKS.notificationDispatch.toString()}::bigint)`;
      held.release();
    }
    expect((await dispatch()).outcome).toBe('succeeded');
  });

  it('skips a row whose recipient has gone', async () => {
    const { id, engineer } = await queueOne();
    await db.db.execute(sql`update app_user set active = false where id = ${engineer}`);
    try {
      expect((await dispatch()).skipped).toBe(1);
      expect((await state(id)).error).toBe('skipped: recipient has no active address');
    } finally {
      await db.db.execute(sql`update app_user set active = true where id = ${engineer}`);
    }
  });
});

// ── The bell's feed ─────────────────────────────────────────────────────────────────────────────

describe('the in-app feed', () => {
  const feed = async (role: Role, query = '') => {
    const res = await as(role).get(`/api/v1/notifications${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return NotificationListResponse.parse(res.json());
  };

  it('is the caller’s own, newest first, paged by cursor, and counts unread in total', async () => {
    const engineer = await userId('Engineer');
    for (let i = 0; i < 3; i++) {
      const qn = await inQueue();
      await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer });
    }
    const all = await feed('Engineer', '?limit=50');
    expect(all.items.length).toBeGreaterThanOrEqual(3);
    expect(all.unread).toBe(all.items.filter((i) => i.readAt === null).length);
    const times = all.items.map((i) => Date.parse(i.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // Nobody else's, and never an email row.
    const mine = await db.db
      .select()
      .from(schema.notification)
      .where(
        and(eq(schema.notification.userId, engineer), eq(schema.notification.channel, 'in_app')),
      );
    expect(all.items.map((i) => i.id).sort()).toEqual(mine.map((m) => m.id).sort());

    const first = await feed('Engineer', '?limit=2');
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.unread).toBe(all.unread);
    const second = await feed('Engineer', `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items[0]!.id).toBe(all.items[2]!.id);
    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const page: NotificationListResponse = await feed(
        'Engineer',
        `?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      walked.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(walked).toEqual(all.items.map((i) => i.id));

    expect((await as('Engineer').get('/api/v1/notifications?cursor=nonsense')).statusCode).toBe(
      400,
    );
    expect((await as('Engineer').get('/api/v1/notifications?limit=500')).statusCode).toBe(400);
  });

  it('marks one read (only the caller’s own) and all read; unread filters', async () => {
    const before = await feed('Engineer', '?limit=50');
    expect(before.unread).toBeGreaterThan(1);
    const target = before.items.find((i) => i.readAt === null)!;

    // Somebody else's id is a 404, and the notification stays unread.
    expect((await as('KAM').post(`/api/v1/notifications/${target.id}/read`)).statusCode).toBe(404);
    expect((await feed('Engineer', '?limit=50')).unread).toBe(before.unread);

    const res = await as('Engineer').post(`/api/v1/notifications/${target.id}/read`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ unread: before.unread - 1 });
    const after = await feed('Engineer', '?limit=50');
    expect(after.items.find((i) => i.id === target.id)!.readAt).not.toBeNull();
    // Reading it again is harmless and keeps the first read time.
    const readAt = after.items.find((i) => i.id === target.id)!.readAt;
    expect((await as('Engineer').post(`/api/v1/notifications/${target.id}/read`)).statusCode).toBe(
      200,
    );
    expect(
      (await feed('Engineer', '?limit=50')).items.find((i) => i.id === target.id)!.readAt,
    ).toBe(readAt);

    const unread = await feed('Engineer', '?unread=true&limit=50');
    expect(unread.items.every((i) => i.readAt === null)).toBe(true);
    expect(unread.items).toHaveLength(unread.unread);

    const everything = await as('Engineer').post('/api/v1/notifications/read');
    expect(everything.json()).toEqual({ marked: unread.unread });
    expect((await feed('Engineer')).unread).toBe(0);
    expect((await feed('Engineer', '?unread=true')).items).toHaveLength(0);
    // Someone else's unread count is untouched.
    expect((await feed('EngLead')).unread).toBeGreaterThan(0);
  });

  it('every role has a feed and preferences (they are their own)', async () => {
    for (const role of [
      'KAM',
      'SalesLeader',
      'EngLead',
      'Engineer',
      'Pricing',
      'Approver',
      'Leadership',
      'Admin',
    ] as const) {
      expect((await as(role).get('/api/v1/notifications')).statusCode, role).toBe(200);
      expect((await as(role).get('/api/v1/me/preferences')).statusCode, role).toBe(200);
    }
  });
});

// ── What an email may say ───────────────────────────────────────────────────────────────────────

describe('no pricing or capital figure in any email', () => {
  it('a quote carrying revenue, capital and tooling figures emails none of them, to anyone', async () => {
    await drain();
    // Intake carries a revenue estimate and Engineering types a preliminary capital figure and a tooling
    // note: none of them may appear in anything sent, whoever the recipient.
    const qn = await inQueue({ estAnnualRevenue: 4_321_987 });
    const put = await as('EngLead').put(`/api/v1/quotes/${qn}/eng-review`, {
      prelimCapitalUsd: 7_654_321,
      toolingNotes: 'Tooling budget about $875,000',
    });
    expect(put.statusCode, put.body).toBe(200);
    await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, {
      engineerId: await userId('Engineer'),
    });
    await dispatch();
    expect(sentAbout(qn).length).toBeGreaterThan(1);
  });

  it('nothing sent in this whole run contains an amount of money or a commercial figure', () => {
    expect(allSent.length).toBeGreaterThan(10);
    for (const m of allSent) {
      for (const part of [m.subject, m.html, m.text]) {
        expect(hasCommercialFigure(part), m.subject).toBe(false);
        expect(part).not.toMatch(/7,?654,?321|4,?321,?987|875,?000|150,?000|1,?800,?000|\$/);
      }
    }
    // The run reached every kind of recipient: no role is sent figures.
    const recipients = new Set(allSent.map((m) => m.to));
    expect(recipients.size).toBeGreaterThan(3);
  });

  it('every message carries an HTML part and a plain-text part, from the shared mailbox', () => {
    for (const m of allSent) {
      expect(m.html.length).toBeGreaterThan(200);
      expect(m.text.length).toBeGreaterThan(50);
      expect(m.from).toBe('ccq-noreply@pretiumpkg.com');
      expect(m.subject.startsWith('[QuoteFlow] ')).toBe(true);
      expect(m.html).toMatch(/^<!doctype html>/);
      expect(m.text).not.toMatch(/<[a-z!]/i);
    }
  });
});
