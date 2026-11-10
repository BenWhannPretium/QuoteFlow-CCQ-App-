import {
  DEV_USER_HEADER,
  IntakeDraft,
  MeResponse,
  NotificationListResponse,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { FakeMailTransport } from '@ccq/integrations';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prepareModels } from './model-helpers';
import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * FB-05 (F-079, F-034), through the API on a real Postgres:
 * - every hand-off, send-back, hold and closure tells the next owner and the KAM, once each, in-app and
 *   by email, and never the person who did it (T-037; T-014 re-checked);
 * - a KAM's comment reaches the assignee, the stage lead and earlier commenters (T-010), a mentioned
 *   user gets the mention instead, the email never carries the text, and a burst goes out as one email;
 * - the G3 -> KAM -> resubmit loop tells the pricer and the PricingLead.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
/** The test clock: real time plus an offset, so rows written with the database's clock are due "now". */
let offsetMs = 0;
const clock = () => new Date(Date.now() + offsetMs);
const MIN = 60_000;
const HOUR = 60 * MIN;
const tick = (ms = HOUR) => {
  offsetMs += ms;
};
const mail = new FakeMailTransport();

const ROLES: Role[] = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'Pricing',
  'PricingLead',
  'Finance',
  'Approver',
  'Leadership',
  'Admin',
];
const PERSONA: Record<Role, string> = {
  KAM: 'kam',
  SalesLeader: 'sales-leader',
  EngLead: 'eng-lead',
  Engineer: 'engineer',
  Pricing: 'pricing',
  PricingLead: 'pricing-lead',
  Finance: 'finance',
  Approver: 'approver',
  Leadership: 'leadership',
  Admin: 'admin',
  PostAward: 'admin',
};

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

const as = (role: Role) => asRole(app, role);
const ids: Record<string, string> = {};
async function userId(role: Role): Promise<string> {
  ids[role] ??= MeResponse.parse(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { [DEV_USER_HEADER]: PERSONA[role] },
      })
    ).json(),
  ).user.id;
  return ids[role];
}
const ok = (res: { statusCode: number; body: string }, status = 201) =>
  expect(res.statusCode, res.body).toBe(status);
const decide = (qn: string, gate: string, body: Record<string, unknown>, by: Role) =>
  as(by).post(`/api/v1/quotes/${qn}/gates/${gate}/decisions`, body);
const quoteRow = async (qn: string) =>
  (await db.db.select().from(schema.quote).where(eq(schema.quote.quoteNumber, qn)))[0]!;

/** Active users holding a role (more than the persona may hold it). */
async function usersWithRole(role: Role): Promise<string[]> {
  const rows = await db.db
    .select({ id: schema.appUser.id })
    .from(schema.userRole)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.userRole.userId))
    .where(and(eq(schema.userRole.role, role), eq(schema.appUser.active, true)));
  return [...new Set(rows.map((r) => r.id))];
}

/** Notification rows for one quote, optionally of one type, as `userId|channel` pairs. */
async function notes(qn: string, type?: string) {
  const quoteId = (await quoteRow(qn)).id;
  return db.db
    .select()
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.quoteId, quoteId),
        ...(type ? [eq(schema.notification.type, type)] : []),
      ),
    );
}
/** The people who got an in-app notification of `type` on this quote. */
const inAppTo = async (qn: string, type: string) =>
  (await notes(qn, type)).filter((n) => n.channel === 'in_app').map((n) => n.userId);
const emailTo = async (qn: string, type: string) =>
  (await notes(qn, type)).filter((n) => n.channel === 'email').map((n) => n.userId);

/** The ids of every notification on the quote now: what a later read compares against. */
async function snapshot(qn: string): Promise<Set<string>> {
  return new Set((await notes(qn)).map((n) => n.id));
}
/** Notifications written since `seen` (a snapshot), optionally of one type and channel. */
async function since(
  qn: string,
  seen: Set<string>,
  type?: string,
  channel: 'in_app' | 'email' = 'in_app',
) {
  return (await notes(qn, type)).filter((n) => !seen.has(n.id) && n.channel === channel);
}
/** The types each person was told since `seen`, in-app. */
async function perPerson(qn: string, seen: Set<string>) {
  const byUser = new Map<string, string[]>();
  for (const r of await since(qn, seen))
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.type]);
  return byUser;
}

async function prefill(sfOpportunityId: string, over: IntakeDraftData = {}) {
  const sf = SfOpportunityDetail.parse(
    (await as('KAM').get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`)).json(),
  );
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
    neckDiameter: '38',
    neckFinishType: '400',
    pcrLevel: '0',
    colorType: 'NATURAL',
    heightMm: 180,
    widthOrDiameterMm: 65,
    depthMm: 65,
    gramWeightG: 24,
    packagingType: 'BULK',
    estAnnualVolume: 750_000,
    estAnnualRevenue: 150_000,
    quoteNeededBy: '2026-12-15',
    productNeededBy: '2027-03-01',
    containerSize: '16 oz',
    standardDescription: '16 oz Bottle, HDPE',
    drawingStatus: 'HAVE_DRAWING',
    ...over,
  };
}

async function submitted(): Promise<string> {
  const res = await as('KAM').post('/api/v1/quotes/drafts', {
    data: await prefill(await nextFree()),
  });
  ok(res);
  const sub = await as('KAM').post(
    `/api/v1/quotes/drafts/${IntakeDraft.parse(res.json()).id}/submit`,
  );
  ok(sub);
  const { quoteNumber } = SubmitIntakeResponse.parse(sub.json());
  created.push(quoteNumber);
  return quoteNumber;
}

async function engineeringFields(qn: string, by: Role, analyst: string) {
  ok(
    await as(by).put(`/api/v1/quotes/${qn}/eng-review`, {
      processType: 'EBM',
      machineType: 'EBM',
      plantCode: 'AURORA',
      cavitation: 8,
      cycleTimeS: 14.5,
      prelimCapitalUsd: 250_000,
    }),
    200,
  );
  ok(
    await as(by).put(`/api/v1/quotes/${qn}/capacity-evidence`, {
      rows: [
        {
          site: 'AURORA',
          assumedEffectivenessPct: 70,
          cycleTimeS: 14.5,
          utilizationBeforePct: 62,
          analysisDate: '2026-10-26',
          analystId: analyst,
        },
      ],
    }),
    200,
  );
}

async function inEngineering(): Promise<string> {
  const qn = await submitted();
  ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader'));
  tick();
  return qn;
}

async function inQuoting(): Promise<string> {
  const qn = await inEngineering();
  await engineeringFields(qn, 'EngLead', await userId('Engineer'));
  ok(await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }), 200);
  ok(await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'EngLead'));
  tick();
  return qn;
}

async function pricingDone(qn: string) {
  // FB-07 (F-032): the costing model (and the ROI model when needed) before costing is attested.
  await prepareModels(app, qn);
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/pricing-record`, {
      approvedBy: await userId('Pricing'),
      approvedAt: new Date(Date.now() + offsetMs - HOUR).toISOString(),
      pricingBasisNote: 'March CDI',
      costingCompleted: true,
    }),
    200,
  );
  ok(
    await as('Pricing').put(`/api/v1/quotes/${qn}/capital-readiness`, {
      capitalReadiness: 'not_required',
    }),
    200,
  );
}

/** Send everything due (the dispatcher takes a batch at a time). */
async function dispatch() {
  for (let i = 0; i < 40; i++) {
    const r = await app.notificationDispatch!.runNow();
    if (r.sent + r.retrying + r.failed + r.skipped + r.digestsQueued === 0) return;
  }
}
const setCollapse = (minutes: number) =>
  db.db.execute(
    sql`update app_setting set value = ${String(minutes)}::jsonb where key = 'comment_email_collapse_minutes'`,
  );
const sentAbout = (qn: string) => mail.sent.filter((m) => m.subject.includes(qn));
const emailOf = async (id: string) =>
  (await db.db.execute<{ email: string }>(sql`select email from app_user where id = ${id}`))[0]!
    .email;

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb05');
  db = fresh.client;
  app = await buildApp(
    testConfig({
      DATABASE_URL: fresh.url,
      RATE_LIMIT_MAX: '100000',
      NOTIFICATION_DISPATCH_INTERVAL_SECONDS: '0',
    }),
    { db, now: clock, mail },
  );
  await app.ready();
  await db.db.execute(sql`
    update app_user set email = lower(replace(display_name, ' ', '.')) || '.' || substr(id::text, 1, 6) || '@pretiumpkg.example'
    where email is null`);
  const rows = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id`);
  free = rows.map((r) => r.id);
  expect(free.length).toBeGreaterThanOrEqual(10);
  for (const role of ROLES) await userId(role);
}, 120_000);
afterAll(async () => {
  await app.close();
});

// ── F-079: hand-offs ─────────────────────────────────────────────────────────────────────────────

describe('F-079: advances tell the next owner and the KAM, once each', () => {
  it('G1 Advance: the EngLeads get in-app and email; the KAM gets "moved on"; the decider gets nothing', async () => {
    const qn = await submitted();
    const leader = await userId('SalesLeader');
    const seen = await snapshot(qn);
    ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader'));
    const leads = await usersWithRole('EngLead');
    expect((await inAppTo(qn, 'quote.ready_for_eng_review')).sort()).toEqual([...leads].sort());
    expect((await emailTo(qn, 'quote.ready_for_eng_review')).sort()).toEqual([...leads].sort());
    const kam = await userId('KAM');
    expect(await inAppTo(qn, 'quote.progress')).toEqual([kam]);
    expect(await emailTo(qn, 'quote.progress')).toEqual([kam]);
    // One notification per person for this decision; the decider is not told.
    const all = await perPerson(qn, seen);
    expect(all.has(leader)).toBe(false);
    for (const [user, types] of all) expect(types, user).toHaveLength(1);
  });

  it('T-037 (engineering): the engineer submits, the lead decides G2 Advance → the PricingLead and the KAM are told', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    ok(await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer }), 200);
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`), 200);
    await engineeringFields(qn, 'Engineer', engineer);
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/submit`), 200);

    // The KAM sees the quote reach the lead: in-app only.
    const kam = await userId('KAM');
    expect(await inAppTo(qn, 'quote.lead_review_update')).toEqual([kam]);
    expect(await emailTo(qn, 'quote.lead_review_update')).toEqual([]);

    ok(
      await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }),
      200,
    );
    ok(await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'EngLead'));
    const pricingLeads = await usersWithRole('PricingLead');
    const told = await inAppTo(qn, 'quote.ready_for_quoting');
    for (const lead of pricingLeads) expect(told).toContain(lead);
    expect(new Set(told).size).toBe(told.length);
    for (const lead of pricingLeads) {
      expect(await emailTo(qn, 'quote.ready_for_quoting')).toContain(lead);
    }
    expect((await inAppTo(qn, 'quote.progress')).filter((u) => u === kam)).toHaveLength(2); // G1, G2
    // The decider (the EngLead) is not told about their own decision.
    const lead = await userId('EngLead');
    expect(told).not.toContain(lead);
  });

  it('G3 Advance: the Approvers are told it is ready for Final Review, the KAM that it moved on', async () => {
    const qn = await inQuoting();
    await pricingDone(qn);
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
    expect((await inAppTo(qn, 'quote.ready_for_final_review')).sort()).toEqual(
      (await usersWithRole('Approver')).sort(),
    );
    const kam = await userId('KAM');
    expect((await inAppTo(qn, 'quote.progress')).filter((u) => u === kam)).toHaveLength(3);
  });

  it('T-014 (re-checked, F-003): the engineer submits → every EngLead has an in-app and an email row', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    ok(await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer }), 200);
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`), 200);
    await engineeringFields(qn, 'Engineer', engineer);
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/submit`), 200);
    const leads = await usersWithRole('EngLead');
    expect((await inAppTo(qn, 'quote.submitted_to_lead')).sort()).toEqual([...leads].sort());
    expect((await emailTo(qn, 'quote.submitted_to_lead')).sort()).toEqual([...leads].sort());
  });
});

describe('F-079: lead review of pricing (T-037)', () => {
  it('a pricer submits, the lead sends it back → the pricer and the KAM are told; the KAM sees it reach the lead', async () => {
    const qn = await inQuoting();
    const pricer = await userId('Pricing');
    const kam = await userId('KAM');
    ok(
      await as('PricingLead').post(`/api/v1/quotes/${qn}/pricing-assignment`, { pricerId: pricer }),
      200,
    );
    await pricingDone(qn);
    const seen = await snapshot(qn);
    ok(await as('Pricing').post(`/api/v1/quotes/${qn}/quoting/submit`), 200);
    const leads = await usersWithRole('PricingLead');
    expect((await since(qn, seen, 'quote.submitted_to_lead')).map((n) => n.userId).sort()).toEqual(
      [...leads].sort(),
    );
    expect((await since(qn, seen, 'quote.submitted_to_lead', 'email')).length).toBe(leads.length);
    // The KAM: in-app only.
    expect((await since(qn, seen, 'quote.lead_review_update')).map((n) => n.userId)).toEqual([kam]);
    expect(await since(qn, seen, 'quote.lead_review_update', 'email')).toEqual([]);

    const afterSubmit = await snapshot(qn);
    ok(
      await as('PricingLead').post(`/api/v1/quotes/${qn}/quoting/send-back`, {
        note: 'Use the October resin index',
      }),
      200,
    );
    const told = await since(qn, afterSubmit);
    expect(told.map((n) => [n.userId, n.type]).sort()).toEqual(
      [
        [pricer, 'quote.returned_by_lead'],
        [kam, 'quote.lead_review_update'],
      ].sort(),
    );
    expect((await since(qn, afterSubmit, undefined, 'email')).map((n) => n.userId)).toEqual([
      pricer,
    ]);
    // The lead who sent it back is not told.
    expect(told.map((n) => n.userId)).not.toContain(await userId('PricingLead'));
  });

  it('an engineer submits, the lead sends it back → the engineer and the KAM are told', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    const kam = await userId('KAM');
    ok(await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer }), 200);
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`), 200);
    await engineeringFields(qn, 'Engineer', engineer);
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/submit`), 200);
    const seen = await snapshot(qn);
    ok(
      await as('EngLead').post(`/api/v1/quotes/${qn}/eng-review/send-back`, {
        note: 'Cycle time looks optimistic',
      }),
      200,
    );
    const told = await since(qn, seen);
    expect(told.map((n) => [n.userId, n.type]).sort()).toEqual(
      [
        [engineer, 'quote.returned_by_lead'],
        [kam, 'quote.lead_review_update'],
      ].sort(),
    );
  });
});

describe('F-079: every rework and return', () => {
  it('G1 rework: "returned to you" with the reason and the note in-app; the email has neither the note nor a figure', async () => {
    const qn = await submitted();
    ok(
      await decide(
        qn,
        'G1',
        {
          outcomeKey: 'rework',
          reasonCode: 'missing_information',
          note: 'ZEBRA-NOTE $5,000 tooling',
        },
        'SalesLeader',
      ),
    );
    const kam = await userId('KAM');
    expect(await inAppTo(qn, 'quote.reworked')).toEqual([kam]);
    const [row] = (await notes(qn, 'quote.reworked')).filter((n) => n.channel === 'in_app');
    expect(row!.title).toContain('was returned to you');
    expect(row!.body).toContain('Reason: Missing information.');
    expect(row!.body).toContain('ZEBRA-NOTE');
    await dispatch();
    const mails = sentAbout(qn).filter((m) => m.subject.includes('was returned to you'));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text + mails[0]!.html).not.toContain('ZEBRA-NOTE');
    expect(mails[0]!.text).toContain('/quotes/');
  });

  it('G3 -> KAM: the KAM is told it was returned to them (reason and note); the loop back to Quoting tells the pricer and the PricingLead', async () => {
    const qn = await inQuoting();
    const pricer = await userId('Pricing');
    ok(
      await as('PricingLead').post(`/api/v1/quotes/${qn}/pricing-assignment`, { pricerId: pricer }),
      200,
    );
    await pricingDone(qn);
    ok(await as('Pricing').post(`/api/v1/quotes/${qn}/quoting/submit`), 200);
    ok(
      await decide(
        qn,
        'G3',
        {
          outcomeKey: 'rework_kam',
          reasonCode: 'missing_information',
          note: 'Volume by SKU is missing',
        },
        'PricingLead',
      ),
    );
    const kam = await userId('KAM');
    const returned = (await notes(qn, 'quote.reworked')).filter((n) => n.channel === 'in_app');
    expect(returned.map((n) => n.userId)).toEqual([kam]);
    expect(returned[0]!.title).toContain('returned to you');
    expect(returned[0]!.body).toContain('Quoting sent it back');
    expect(returned[0]!.body).toContain('Volume by SKU is missing');
    expect(await emailTo(qn, 'quote.reworked')).toEqual([kam]);

    // The KAM fixes it and resubmits with no scope change.
    tick();
    const before = await snapshot(qn);
    const draft = IntakeDraft.parse((await as('KAM').post(`/api/v1/quotes/${qn}/rework`)).json());
    ok(
      await as('KAM').patch(`/api/v1/quotes/drafts/${draft.id}`, {
        data: { estAnnualVolume: 800_000 },
      }),
      200,
    );
    ok(await as('KAM').post(`/api/v1/quotes/drafts/${draft.id}/submit`, { scopeChanged: false }));
    expect((await quoteRow(qn)).stageKey).toBe('QUOTING');
    const back = await since(qn, before, 'quote.ready_for_quoting');
    const leads = await usersWithRole('PricingLead');
    expect(back.map((n) => n.userId).sort()).toEqual([...new Set([pricer, ...leads])].sort());
    expect(back[0]!.title).toBe(`${qn} is back from the KAM`);
    const mailed = await since(qn, before, 'quote.ready_for_quoting', 'email');
    expect(mailed.map((n) => n.userId).sort()).toEqual(back.map((n) => n.userId).sort());
    // Not the KAM, who did it.
    expect(back.map((n) => n.userId)).not.toContain(kam);
  });

  it('G3 -> Engineering: the engineer and the EngLeads hear it came back from Pricing; the KAM hears it was sent back', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    ok(await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer }), 200);
    await engineeringFields(qn, 'EngLead', engineer);
    ok(
      await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }),
      200,
    );
    ok(await decide(qn, 'G2', { outcomeKey: 'proceed' }, 'EngLead'));
    tick();
    await pricingDone(qn);
    const before = await snapshot(qn);
    ok(
      await decide(
        qn,
        'G3',
        { outcomeKey: 'rework', reasonCode: 'missing_information', note: 'Check the cavitation' },
        'PricingLead',
      ),
    );
    const eng = await since(qn, before, 'quote.ready_for_eng_review');
    const leads = await usersWithRole('EngLead');
    expect(eng.map((n) => n.userId).sort()).toEqual([...new Set([engineer, ...leads])].sort());
    for (const n of eng) {
      expect(n.title).toMatch(/returned to Engineering from Pricing|back with you in Engineering/);
      expect(n.title).not.toContain('is in the engineering queue');
    }
    const kam = await userId('KAM');
    const progress = (await since(qn, before, 'quote.progress')).filter((n) => n.userId === kam);
    expect(progress).toHaveLength(1);
    expect(progress[0]!.title).toContain('was sent back to Engineering');
  });

  it('G4 return and the customer re-quote tell the next owner and the KAM', async () => {
    const qn = await inQuoting();
    await pricingDone(qn);
    ok(await decide(qn, 'G3', { outcomeKey: 'submit' }, 'PricingLead'));
    tick();
    const before = await snapshot(qn);
    ok(
      await decide(
        qn,
        'G4',
        { outcomeKey: 'return', targetStageKey: 'QUOTING', note: 'Margin looks thin' },
        'Approver',
      ),
    );
    const leads = await usersWithRole('PricingLead');
    const back = await since(qn, before, 'quote.ready_for_quoting');
    for (const lead of leads) expect(back.map((n) => n.userId)).toContain(lead);
    expect(back[0]!.title).toContain('was returned to Quoting');
    const kam = await userId('KAM');
    expect(
      (await since(qn, before, 'quote.progress')).filter((n) => n.userId === kam),
    ).toHaveLength(1);
    expect(
      (await since(qn, before, 'quote.progress', 'email')).filter((n) => n.userId === kam),
    ).toHaveLength(1);
  });
});

describe('F-079: holds and closures', () => {
  it('a hold tells the hold owner (with the review date) and the KAM', async () => {
    const qn = await submitted();
    const owner = await userId('EngLead');
    ok(
      await decide(
        qn,
        'G1',
        {
          outcomeKey: 'hold',
          reasonCode: 'awaiting_customer_info',
          note: 'Customer asked us to wait',
          holdUntil: '2026-12-01',
          holdOwnerId: owner,
        },
        'SalesLeader',
      ),
    );
    const kam = await userId('KAM');
    expect((await inAppTo(qn, 'quote.on_hold')).sort()).toEqual([kam, owner].sort());
    expect((await emailTo(qn, 'quote.on_hold')).sort()).toEqual([kam, owner].sort());
    const mine = (await notes(qn, 'quote.on_hold')).find(
      (n) => n.userId === owner && n.channel === 'in_app',
    )!;
    expect(mine.body).toContain('Review date: 2026-12-01');
    expect(mine.title).toContain('you own the hold');
  });

  it('a hold the KAM owns gives the KAM one notice', async () => {
    const qn = await submitted();
    const kam = await userId('KAM');
    ok(
      await decide(
        qn,
        'G1',
        {
          outcomeKey: 'hold',
          reasonCode: 'awaiting_customer_info',
          note: 'Waiting on a drawing',
          holdUntil: '2026-12-01',
          holdOwnerId: kam,
        },
        'SalesLeader',
      ),
    );
    expect(await inAppTo(qn, 'quote.on_hold')).toEqual([kam]);
  });

  it('a Stop tells the KAM (in-app and email) and not the person who stopped it', async () => {
    const qn = await submitted();
    const seen = await snapshot(qn);
    ok(
      await decide(
        qn,
        'G1',
        { outcomeKey: 'stop', reasonCode: 'not_strategic', note: 'Not a fit for us' },
        'SalesLeader',
      ),
    );
    const kam = await userId('KAM');
    expect(await inAppTo(qn, 'quote.closed')).toEqual([kam]);
    expect(await emailTo(qn, 'quote.closed')).toEqual([kam]);
    const [row] = (await notes(qn, 'quote.closed')).filter((n) => n.channel === 'in_app');
    expect(row!.title).toContain('was closed');
    expect((await perPerson(qn, seen)).has(await userId('SalesLeader'))).toBe(false);
  });
});

// ── F-034: comments ──────────────────────────────────────────────────────────────────────────────

describe('F-034: a comment tells the people following the quote', () => {
  // Every test here starts with the seeded 10 minute window; the ones that need none set it to 0.
  beforeEach(() => setCollapse(10));
  afterAll(() => setCollapse(10));
  const comment = (qn: string, by: Role, body: string, mentions: string[] = []) =>
    as(by).post(`/api/v1/quotes/${qn}/comments`, { body, mentions });

  it('T-010: a KAM comments while the quote is in Engineering → the assigned engineer gets in-app and email', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    ok(await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer }), 200);
    ok(await comment(qn, 'KAM', 'Customer moved the launch up, please look at the tooling'));
    expect(await inAppTo(qn, 'comment.posted')).toContain(engineer);
    expect(await emailTo(qn, 'comment.posted')).toContain(engineer);
    // The stage lead hears too; the author does not.
    const leads = await usersWithRole('EngLead');
    for (const lead of leads) expect(await inAppTo(qn, 'comment.posted')).toContain(lead);
    expect(await inAppTo(qn, 'comment.posted')).not.toContain(await userId('KAM'));
  });

  it('the KAM and earlier commenters hear a reply; the author does not; a mention replaces the notice', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    const kam = await userId('KAM');
    const lead = await userId('EngLead');
    ok(await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer }), 200);
    ok(await comment(qn, 'Pricing', 'Early heads-up from pricing'));
    const pricing = await userId('Pricing');
    // The engineer replies and @mentions the EngLead.
    const leadName = (
      await db.db.execute<{ display_name: string }>(
        sql`select display_name from app_user where id = ${lead}`,
      )
    )[0]!.display_name;
    ok(await comment(qn, 'Engineer', `Looking at it now @${leadName}`, [lead]));
    const posted = await inAppTo(qn, 'comment.posted');
    // The KAM and the earlier commenter (Pricing) are told of the reply.
    expect(posted.filter((u) => u === kam).length).toBeGreaterThanOrEqual(1);
    expect(posted).toContain(pricing);
    // The author (the engineer) is not told of their own comment (they were told of the first one).
    const engineerNotes = (await notes(qn, 'comment.posted')).filter(
      (n) => n.userId === engineer && n.channel === 'in_app',
    );
    expect(engineerNotes).toHaveLength(1); // only Pricing's earlier comment
    // The mentioned EngLead gets the mention for the reply, not "comment posted" for it.
    expect(await inAppTo(qn, 'comment.mention')).toEqual([lead]);
    const leadPosted = (await notes(qn, 'comment.posted')).filter(
      (n) => n.userId === lead && n.channel === 'in_app',
    );
    expect(leadPosted).toHaveLength(1); // only Pricing's comment
  });

  it('the email carries a link and the count, never the comment text', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    ok(await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer }), 200);
    await setCollapse(0);
    mail.sent.length = 0;
    ok(await comment(qn, 'KAM', 'Budget is $2,500,000 and the competitor is Acme'));
    await dispatch();
    const to = await emailOf(engineer);
    const m = mail.sent.filter(
      (x) => x.to.toLowerCase() === to.toLowerCase() && x.subject.includes(qn),
    );
    expect(m.some((x) => x.subject.includes('has a new comment'))).toBe(true);
    const mine = m.find((x) => x.subject.includes('has a new comment'))!;
    expect(mine.text + mine.html).not.toContain('Acme');
    expect(mine.text + mine.html).not.toContain('2,500,000');
    expect(mine.text).toContain(`/quotes/${qn}`);
    // The in-app row says a comment was posted, without the text.
    const [row] = (await notes(qn, 'comment.posted')).filter(
      (n) => n.userId === engineer && n.channel === 'in_app',
    );
    expect(row!.body).not.toContain('Acme');
  });

  it('several comments within the window go out as one email: "3 new comments"', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    ok(await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer }), 200);
    await dispatch();
    mail.sent.length = 0;
    const to = (await emailOf(engineer)).toLowerCase();
    for (const text of ['one', 'two', 'three']) {
      ok(await comment(qn, 'KAM', `Comment ${text}`));
      tick(2 * MIN);
    }
    // In-app: one per comment, at once. Email: held back, not sent yet.
    expect((await inAppTo(qn, 'comment.posted')).filter((u) => u === engineer)).toHaveLength(3);
    await dispatch();
    expect(
      mail.sent.filter((m) => m.to.toLowerCase() === to && m.subject.includes('new comment')),
    ).toHaveLength(0);
    // Once the first comment's window has passed, one email for the three.
    tick(10 * MIN);
    await dispatch();
    const sent = mail.sent.filter(
      (m) => m.to.toLowerCase() === to && m.subject.includes('new comment'),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('has 3 new comments');
    expect(sent[0]!.text).toContain('3 new comments');
    expect(sent[0]!.text + sent[0]!.html).not.toContain('Comment one');
    // The folded rows are marked, not left to send later.
    tick(HOUR);
    mail.sent.length = 0;
    await dispatch();
    expect(
      mail.sent.filter((m) => m.to.toLowerCase() === to && m.subject.includes('new comment')),
    ).toHaveLength(0);
    // The bell still has all three.
    const feed = NotificationListResponse.parse(
      (await as('Engineer').get('/api/v1/notifications?limit=50')).json(),
    );
    expect(
      feed.items.filter((i) => i.type === 'comment.posted' && i.quoteNumber === qn),
    ).toHaveLength(3);
  });

  it('a user who switched off comment emails keeps the bell and gets no email', async () => {
    const qn = await inEngineering();
    const engineer = await userId('Engineer');
    ok(await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, { engineerId: engineer }), 200);
    ok(
      await as('Engineer').put('/api/v1/me/preferences', { email: { 'comment.posted': false } }),
      200,
    );
    await setCollapse(0);
    ok(await comment(qn, 'KAM', 'Any news?'));
    expect(await inAppTo(qn, 'comment.posted')).toContain(engineer);
    expect(await emailTo(qn, 'comment.posted')).not.toContain(engineer);
    ok(
      await as('Engineer').put('/api/v1/me/preferences', { email: { 'comment.posted': true } }),
      200,
    );
  });
});

// ── Delivery rules ───────────────────────────────────────────────────────────────────────────────

describe('delivery rules', () => {
  it('turning email off in settings leaves the in-app notifications and writes no email rows', async () => {
    await db.db.execute(
      sql`update app_setting set value = 'false'::jsonb where key = 'email_notifications_enabled'`,
    );
    try {
      const qn = await submitted();
      ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader'));
      expect((await inAppTo(qn, 'quote.ready_for_eng_review')).length).toBeGreaterThan(0);
      expect((await notes(qn)).filter((n) => n.channel === 'email')).toHaveLength(0);
    } finally {
      await db.db.execute(
        sql`update app_setting set value = 'true'::jsonb where key = 'email_notifications_enabled'`,
      );
    }
  });

  it('a person who is the KAM and an EngLead gets one notice for G1 Advance, not two', async () => {
    const qn = await submitted();
    const kam = await userId('KAM');
    await db.db.insert(schema.userRole).values({ userId: kam, role: 'EngLead', createdBy: kam });
    try {
      ok(await decide(qn, 'G1', { outcomeKey: 'advance' }, 'SalesLeader'));
      const mine = (await notes(qn)).filter(
        (n) => n.userId === kam && n.channel === 'in_app' && n.type !== 'quote.submitted',
      );
      const fromDecision = mine.filter((n) =>
        ['quote.ready_for_eng_review', 'quote.progress'].includes(n.type),
      );
      expect(fromDecision.map((n) => n.type)).toEqual(['quote.ready_for_eng_review']);
    } finally {
      await db.db.execute(sql`delete from user_role where user_id = ${kam} and role = 'EngLead'`);
    }
  });

  it('only the recipients see their notifications in the bell', async () => {
    const qn = await submitted();
    ok(
      await decide(
        qn,
        'G1',
        { outcomeKey: 'rework', reasonCode: 'missing_information', note: 'Add the volume' },
        'SalesLeader',
      ),
    );
    const feed = NotificationListResponse.parse(
      (await as('KAM').get('/api/v1/notifications?limit=50')).json(),
    );
    const mine = feed.items.find((i) => i.type === 'quote.reworked' && i.quoteNumber === qn);
    expect(mine?.title).toContain('returned to you');
    const other = NotificationListResponse.parse(
      (await as('Leadership').get('/api/v1/notifications?limit=50')).json(),
    );
    expect(other.items.some((i) => i.quoteNumber === qn)).toBe(false);
    void inArray;
  });
});
