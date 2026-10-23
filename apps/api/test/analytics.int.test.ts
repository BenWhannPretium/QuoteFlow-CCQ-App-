import {
  ANALYTICS_DISCLAIMER,
  AdoptionResponse,
  AnalyticsFiltersResponse,
  CycleTimeResponse,
  DEV_USER_HEADER,
  DashboardResponse,
  EngineeringAnalyticsResponse,
  FirstPassResponse,
  FlowResponse,
  G1YieldResponse,
  GateComplianceResponse,
  MeResponse,
  OutcomesResponse,
  OverridesResponse,
  PipelineResponse,
  PriorityResponse,
  type DashboardRole,
  type MetricInfo,
} from '@ccq/contracts';
import type { DbClient } from '@ccq/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-17 role dashboards and operational analytics: who may call what, that KAM dashboards are scoped,
 * that every block states its definition and window, that win rate never travels without the capture
 * rate, and that the dashboards agree with the database they are computed from. The SQL view maths
 * (medians with holds, capture, win, first-pass) has its own known-answer tests in packages/db.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const clock = new Date('2026-11-03T15:00:00Z');

const get = (persona: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { [DEV_USER_HEADER]: persona } });

const ids: Record<string, string> = {};
async function userId(persona: string) {
  ids[persona] ??= MeResponse.parse((await get(persona, '/api/v1/me')).json()).user.id;
  return ids[persona];
}

async function dashboard(persona: string, role: DashboardRole) {
  const res = await get(persona, `/api/v1/dashboards/${role}`);
  expect(res.statusCode, res.body).toBe(200);
  return DashboardResponse.parse(res.json());
}

const count = async (query: ReturnType<typeof sql>) => {
  const [row] = await db.db.execute<{ n: number }>(query);
  return row!.n;
};

beforeAll(async () => {
  const fresh = await freshSfDatabase('analytics');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '100000' }), {
    db,
    now: () => clock,
  });
  await app.ready();
  for (const p of [
    'kam',
    'kam-owner',
    'kam-region',
    'eng-lead',
    'engineer',
    'pricing',
    'pricing-lead',
    'approver',
    'leadership',
    'admin',
    'sales-leader',
  ])
    await userId(p);
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

const CHARTS = [
  ['pipeline', PipelineResponse],
  ['cycle-time', CycleTimeResponse],
  ['flow', FlowResponse],
  ['outcomes', OutcomesResponse],
  ['first-pass', FirstPassResponse],
  ['g1-yield', G1YieldResponse],
  ['overrides', OverridesResponse],
  ['gate-compliance', GateComplianceResponse],
  ['priority', PriorityResponse],
] as const;

describe('analytics authorization', () => {
  it.each([...CHARTS.map(([p]) => p), 'filters', 'adoption'])(
    'a KAM and an Engineer cannot call /analytics/%s',
    async (path) => {
      for (const persona of ['kam', 'kam-owner', 'engineer']) {
        const res = await get(persona, `/api/v1/analytics/${path}`);
        expect(res.statusCode, `${persona} ${path}`).toBe(403);
      }
    },
  );

  it('analytics roles read every chart; only audit.read holders read adoption', async () => {
    for (const persona of [
      'leadership',
      'admin',
      'sales-leader',
      'eng-lead',
      'pricing',
      'approver',
    ]) {
      for (const [path] of CHARTS) {
        expect(
          (await get(persona, `/api/v1/analytics/${path}`)).statusCode,
          `${persona} ${path}`,
        ).toBe(200);
      }
    }
    // Adoption reads the audit log: Leadership and Admin only.
    for (const persona of ['sales-leader', 'eng-lead', 'pricing', 'approver']) {
      expect((await get(persona, '/api/v1/analytics/adoption')).statusCode, persona).toBe(403);
    }
    for (const persona of ['leadership', 'admin']) {
      expect((await get(persona, '/api/v1/analytics/adoption')).statusCode, persona).toBe(200);
    }
  });

  it('B-26: the Engineering lens is for the people who read the engineering queue', async () => {
    for (const persona of ['eng-lead', 'engineer', 'leadership', 'admin']) {
      expect((await get(persona, '/api/v1/analytics/engineering')).statusCode, persona).toBe(200);
    }
    for (const persona of ['kam', 'sales-leader', 'pricing', 'pricing-lead', 'approver']) {
      expect((await get(persona, '/api/v1/analytics/engineering')).statusCode, persona).toBe(403);
    }
  });

  it('the leadership dashboard is closed to a KAM (403, nothing returned)', async () => {
    const res = await get('kam', '/api/v1/dashboards/Leadership');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'dashboard_forbidden' });
    expect(res.body).not.toContain('sfAmount');
  });

  it('a dashboard opens only with the permission behind it', async () => {
    const matrix: [string, DashboardRole, number][] = [
      ['kam', 'KAM', 200],
      ['kam', 'SalesLeader', 403],
      ['kam', 'EngLead', 403],
      ['kam', 'Pricing', 403],
      ['kam', 'Approver', 403],
      ['sales-leader', 'SalesLeader', 200],
      ['sales-leader', 'Approver', 403],
      ['eng-lead', 'EngLead', 200],
      ['engineer', 'Engineer', 200],
      ['engineer', 'Leadership', 403],
      ['pricing', 'Pricing', 200],
      ['pricing', 'EngLead', 403],
      // B-26: the pricing lead's triage dashboard needs pricingQueue.assign.
      ['pricing', 'PricingLead', 403],
      ['pricing-lead', 'PricingLead', 200],
      ['pricing-lead', 'Pricing', 200],
      ['admin', 'PricingLead', 200],
      ['approver', 'Approver', 200],
      ['approver', 'Pricing', 403],
      ['leadership', 'Leadership', 200],
      ['leadership', 'KAM', 403],
      ['admin', 'Leadership', 200],
      ['admin', 'Approver', 200],
    ];
    for (const [persona, role, status] of matrix) {
      const res = await get(persona, `/api/v1/dashboards/${role}`);
      expect(res.statusCode, `${persona} → ${role}: ${res.body.slice(0, 200)}`).toBe(status);
    }
  });

  it('an unknown role is a 400, not a dashboard', async () => {
    expect((await get('leadership', '/api/v1/dashboards/Janitor')).statusCode).toBe(400);
  });
});

describe('analytics responses', () => {
  const infos = (value: unknown, found: MetricInfo[] = []): MetricInfo[] => {
    if (Array.isArray(value)) value.forEach((v) => infos(v, found));
    else if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      if (typeof o.definition === 'string' && typeof o.window === 'string')
        found.push(o as unknown as MetricInfo);
      Object.values(o).forEach((v) => infos(v, found));
    }
    return found;
  };

  it.each(CHARTS)(
    '%s parses against its contract and states a definition and a window',
    async (path, schema) => {
      const res = await get('leadership', `/api/v1/analytics/${path}`);
      const body = schema.parse(res.json());
      const found = infos(body);
      expect(found.length, `${path} has an info block`).toBeGreaterThan(0);
      for (const i of found) {
        expect(i.definition.length).toBeGreaterThan(30);
        expect(i.window.length).toBeGreaterThan(5);
      }
    },
  );

  it('adoption and filters parse', async () => {
    AdoptionResponse.parse((await get('leadership', '/api/v1/analytics/adoption')).json());
    const filters = AnalyticsFiltersResponse.parse(
      (await get('leadership', '/api/v1/analytics/filters')).json(),
    );
    expect(filters.markets.length).toBeGreaterThan(0);
    expect(filters.window.to).toBe('2026-11-03');
    expect(filters.window.from).toBe('2026-08-06'); // 90 days, today included
  });

  it('win rate always comes with the capture rate, at every level', async () => {
    const o = OutcomesResponse.parse(
      (await get('leadership', '/api/v1/analytics/outcomes')).json(),
    );
    for (const row of [o.total, ...o.byMarket, ...o.byProductFamily, ...o.byKam]) {
      expect(row).toHaveProperty('winRate');
      expect(row).toHaveProperty('captureRate');
      expect(row.recorded).toBe(row.awarded + row.lost + row.expired);
      // The win rate counts decided quotes only: expired and open ones are not in it.
      if (row.awarded + row.lost === 0) expect(row.winRate).toBeNull();
      else expect(row.winRate).toBeCloseTo(row.awarded / (row.awarded + row.lost), 3);
      expect(row.lowCapture).toBe(row.captureRate !== null && row.captureRate < o.lowCaptureBelow);
    }
    expect(o.info.definition).toMatch(/decided/i);
    expect(o.captureInfo.definition).toMatch(/gone dark/i);
  });

  it('the pipeline is labelled as the SF amount as entered and is a snapshot of open quotes', async () => {
    const p = PipelineResponse.parse(
      (await get('leadership', '/api/v1/analytics/pipeline')).json(),
    );
    expect(p.amountLabel).toBe('SF opportunity amount (as entered)');
    expect(p.info.window).toMatch(/date range does not apply/i);
    const open = await count(sql`select count(*)::int as n from quote where status <> 'closed'`);
    expect(p.totals.count).toBe(open);
    const sum = await count(sql`
      select coalesce(sum(s.amount), 0)::int as n from quote q
      join sf_opportunity_snapshot s on s.sf_opportunity_id = q.sf_opportunity_id
      where q.status <> 'closed'`);
    expect(Math.round(p.totals.sfAmount)).toBe(sum);
  });

  it('filters narrow every chart, and a bad range is a 400', async () => {
    const all = PipelineResponse.parse(
      (await get('leadership', '/api/v1/analytics/pipeline')).json(),
    );
    const filters = AnalyticsFiltersResponse.parse(
      (await get('leadership', '/api/v1/analytics/filters')).json(),
    );
    const market = filters.markets[0]!;
    const narrow = PipelineResponse.parse(
      (await get('leadership', `/api/v1/analytics/pipeline?market=${market}`)).json(),
    );
    expect(narrow.totals.count).toBeLessThan(all.totals.count);
    expect(narrow.totals.count).toBe(
      await count(
        sql`select count(*)::int as n from quote where status <> 'closed' and market = ${market}`,
      ),
    );
    const bad = await get('leadership', '/api/v1/analytics/flow?from=2026-10-10&to=2026-10-01');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 'analytics_bad_range' });
    expect(
      (await get('leadership', '/api/v1/analytics/flow?from=2020-01-01&to=2026-10-01')).statusCode,
    ).toBe(400);
  });

  it('cycle time excludes holds: the active median never exceeds the elapsed median', async () => {
    const c = CycleTimeResponse.parse(
      (
        await get('leadership', '/api/v1/analytics/cycle-time?from=2026-01-01&to=2026-11-03')
      ).json(),
    );
    expect(c.stages.length).toBeGreaterThan(0);
    for (const s of c.stages) {
      if (s.medianDays !== null && s.medianElapsedDays !== null)
        expect(s.medianDays).toBeLessThanOrEqual(s.medianElapsedDays);
      if (s.medianDays !== null && s.p75Days !== null)
        expect(s.p75Days).toBeGreaterThanOrEqual(s.medianDays);
    }
  });

  it('the web page can show the footer text: it is part of the contract', () => {
    expect(ANALYTICS_DISCLAIMER).toBe('Operational metrics from QuoteFlow; not yet D&A-certified.');
  });

  it('an empty window is empty, not an error, and rates are null rather than 0', async () => {
    const res = await get('leadership', '/api/v1/analytics/outcomes?from=2020-01-01&to=2020-01-31');
    const o = OutcomesResponse.parse(res.json());
    expect(o.total.recorded).toBe(0);
    expect(o.total.winRate).toBeNull();
    expect(o.total.captureRate).toBeNull();
    expect(o.lossReasons).toEqual([]);
    const fp = FirstPassResponse.parse(
      (
        await get('leadership', '/api/v1/analytics/first-pass?from=2020-01-01&to=2020-01-31')
      ).json(),
    );
    expect(fp.rate).toBeNull();
  });
});

describe('role dashboards', () => {
  it('KAM dashboards are about the caller and scoped: an owner-scoped KAM sees only their own quotes', async () => {
    for (const persona of ['kam', 'kam-owner']) {
      const me = await userId(persona);
      const d = await dashboard(persona, 'KAM');
      if (d.role !== 'KAM') throw new Error('wrong dashboard');
      const mine = await count(
        sql`select count(*)::int as n from quote where kam_user_id = ${me} and status <> 'closed'`,
      );
      expect(d.pipeline.total, persona).toBe(mine);
      expect(d.pipeline.stages.reduce((n, s) => n + s.count, 0)).toBe(mine);
      // Every listed quote is the caller's.
      const listed = d.pipeline.stages.flatMap((s) => s.quotes.map((q) => q.quoteNumber));
      for (const qn of listed) {
        const owner = await count(
          sql`select count(*)::int as n from quote where quote_number = ${qn} and kam_user_id = ${me}`,
        );
        expect(owner, `${persona} lists ${qn}`).toBe(1);
      }
      const drafts = await count(
        sql`select count(*)::int as n from quote_draft where owner_user_id = ${me} and submitted_quote_id is null`,
      );
      expect(d.drafts.items.length).toBe(Math.min(drafts, 20));
      const returned = await count(sql`
        select count(*)::int as n from quote
        where kam_user_id = ${me} and stage_key = 'INTAKE' and status = 'active' and submitted_at is null`);
      expect(d.returned.items.length, persona).toBe(returned);
    }
  });

  it('a returned quote carries the reason the decider gave', async () => {
    const [row] = await db.db.execute<{ kam: string; qn: string; reason: string | null }>(sql`
      select q.kam_user_id as kam, q.quote_number as qn, g.reason_code as reason
      from quote q join gate_decision g on g.quote_id = q.id and g.outcome_key = 'rework'
      where q.stage_key = 'INTAKE' and q.status = 'active' and q.submitted_at is null
      order by g.decided_at desc limit 1`);
    expect(row, 'the synthetic seed has quotes returned to a KAM').toBeDefined();
    const persona = ['kam', 'kam-owner', 'kam-region'].find((p) => ids[p] === row!.kam);
    expect(persona, 'a KAM persona owns it').toBeDefined();
    const d = await dashboard(persona!, 'KAM');
    if (d.role !== 'KAM') throw new Error('wrong dashboard');
    const item = d.returned.items.find((i) => i.quoteNumber === row!.qn);
    expect(item).toBeDefined();
    expect(item!.reason).toBeTruthy();
    expect(item!.gateKey).toMatch(/^G[12]$/);
  });

  it('proposals expiring within 7 days (lapsed included) are the caller’s and sorted soonest first', async () => {
    for (const persona of ['kam', 'kam-owner']) {
      const d = await dashboard(persona, 'KAM');
      if (d.role !== 'KAM') throw new Error('wrong dashboard');
      const days = d.expiring.items.map((i) => i.daysLeft);
      expect(days).toEqual([...days].sort((a, b) => a - b));
      for (const i of d.expiring.items) {
        expect(i.daysLeft).toBeLessThanOrEqual(7);
        expect(i.lapsed).toBe(i.daysLeft < 0);
      }
    }
  });

  it('the capture rate on a KAM dashboard is that KAM’s own', async () => {
    const me = await userId('kam');
    const d = await dashboard('kam', 'KAM');
    if (d.role !== 'KAM') throw new Error('wrong dashboard');
    const recorded = await count(sql`
      select count(*)::int as n from quote
      where kam_user_id = ${me} and outcome in ('awarded', 'lost', 'expired')
        and coalesce(proposal_issued_at, closed_at, created_at) >= ${clock.toISOString()}::timestamptz - interval '365 days'`);
    expect(d.capture.rates.recorded).toBe(recorded);
    expect(d.capture.info.definition).toMatch(/gone dark/i);
  });

  it('SalesLeader: to-qualify, pending overrides, team pipeline and quotes past validity agree with the data', async () => {
    const d = await dashboard('sales-leader', 'SalesLeader');
    if (d.role !== 'SalesLeader') throw new Error('wrong dashboard');
    expect(d.toQualify.count).toBe(
      await count(sql`
        select count(*)::int as n from quote
        where stage_key = 'INTAKE' and status = 'active' and submitted_at is not null`),
    );
    expect(d.pendingOverrides.count).toBe(
      await count(
        sql`select count(*)::int as n from override where status = 'requested' and approval_mode = 'approver'`,
      ),
    );
    expect(d.pipeline.total).toBe(
      await count(sql`select count(*)::int as n from quote where status <> 'closed'`),
    );
    expect(d.lackingOutcomes.count).toBe(
      await count(sql`
        select count(*)::int as n from quote
        where stage_key = 'CUSTOMER_DECISION' and status <> 'closed' and validity_until < '2026-11-03'`),
    );
    for (const i of d.lackingOutcomes.items) expect(i.lapsed).toBe(true);
    // Oldest waiting first.
    const ages = d.toQualify.items.map((i) => i.daysInStage ?? 0);
    expect(ages).toEqual([...ages].sort((a, b) => b - a));
  });

  it('Engineering: queue health, buckets and per-engineer load all add up to the queue', async () => {
    for (const persona of ['eng-lead', 'engineer']) {
      const d = await dashboard(persona, persona === 'eng-lead' ? 'EngLead' : 'Engineer');
      if (d.role !== 'EngLead' && d.role !== 'Engineer') throw new Error('wrong dashboard');
      const open = await count(
        sql`select count(*)::int as n from quote where stage_key = 'ENG_REVIEW' and status <> 'closed'`,
      );
      const unassigned = await count(
        sql`select count(*)::int as n from quote where stage_key = 'ENG_REVIEW' and status <> 'closed' and assigned_engineer_id is null`,
      );
      expect(d.queue.total).toBe(open);
      expect(d.queue.unassigned).toBe(unassigned);
      expect(d.queue.buckets.map((b) => b.key)).toEqual(['fresh', 'aging', 'old']);
      expect(d.queue.buckets.map((b) => b.label)).toEqual(['< 3 days', '3–10 days', '> 10 days']);
      expect(d.queue.buckets.reduce((n, b) => n + b.count, 0)).toBe(open);
      expect(d.load.items.reduce((n, l) => n + l.open, 0)).toBe(open);
      expect(d.load.items.find((l) => l.engineerId === null)?.open ?? 0).toBe(unassigned);
      expect(d.returned.reasons.length).toBeLessThanOrEqual(5);
      for (const m of [d.timeToAssign, d.assignToG2]) {
        expect(m.info.window).toMatch(/30 days/);
        if (m.n === 0) expect(m.medianDays).toBeNull();
      }
    }
  });

  it('an Engineer’s "mine" list is only their own assignments', async () => {
    const me = await userId('engineer');
    const d = await dashboard('engineer', 'Engineer');
    if (d.role !== 'Engineer') throw new Error('wrong dashboard');
    for (const q of d.mine.items) {
      const assigned = await count(
        sql`select count(*)::int as n from quote where quote_number = ${q.quoteNumber} and assigned_engineer_id = ${me}`,
      );
      expect(assigned).toBe(1);
    }
  });

  it('Pricing: queue count and aging, capital pending, median time in Quoting', async () => {
    const d = await dashboard('pricing', 'Pricing');
    if (d.role !== 'Pricing') throw new Error('wrong dashboard');
    const open = await count(
      sql`select count(*)::int as n from quote where stage_key = 'QUOTING' and status <> 'closed'`,
    );
    expect(d.queue.total).toBe(open);
    expect(d.queue.unassigned).toBeNull();
    expect(d.load).toBeNull();
    expect(d.queue.buckets.reduce((n, b) => n + b.count, 0)).toBe(open);
    expect(d.capitalPending.count).toBe(
      await count(sql`
        select count(*)::int as n from quote q join pricing_record p on p.quote_id = q.id and p.quote_version = q.version
        where q.stage_key = 'QUOTING' and q.status <> 'closed' and p.capital_readiness = 'pending'`),
    );
    expect(d.medianInQuoting.info.window).toMatch(/90 days/);
  });

  it('B-26 PricingLead: the pricing dashboard plus each pricer’s load and the unassigned count', async () => {
    const d = await dashboard('pricing-lead', 'PricingLead');
    if (d.role !== 'PricingLead') throw new Error('wrong dashboard');
    const open = await count(
      sql`select count(*)::int as n from quote where stage_key = 'QUOTING' and status <> 'closed'`,
    );
    const unassigned = await count(
      sql`select count(*)::int as n from quote where stage_key = 'QUOTING' and status <> 'closed' and assigned_pricer_id is null`,
    );
    expect(d.queue.total).toBe(open);
    expect(d.queue.unassigned).toBe(unassigned);
    expect(d.load!.items.reduce((n, l) => n + l.open, 0)).toBe(open);
    expect(d.load!.items.find((l) => l.pricerId === null)?.open ?? 0).toBe(unassigned);
  });

  it('B-26 Engineering lens: snapshot blocks add up to the queue; G2 outcomes match the window', async () => {
    const res = await get(
      'eng-lead',
      '/api/v1/analytics/engineering?from=2026-08-01&to=2026-11-03',
    );
    expect(res.statusCode, res.body).toBe(200);
    const e = EngineeringAnalyticsResponse.parse(res.json());
    const open = await count(
      sql`select count(*)::int as n from quote where stage_key = 'ENG_REVIEW' and status <> 'closed'`,
    );
    expect(e.queue.total).toBe(open);
    expect(e.load.items.reduce((n, l) => n + l.open, 0)).toBe(open);
    expect(e.capacity.pending + e.capacity.approved + e.capacity.blocked).toBe(open);
    expect(e.capacity.approved).toBe(
      await count(sql`
        select count(*)::int as n from quote q join eng_review r on r.quote_id = q.id
        where q.stage_key = 'ENG_REVIEW' and q.status <> 'closed' and r.capacity_signoff_status = 'approved'`),
    );
    const g2 = await count(sql`
      select count(*)::int as n from gate_decision
      where gate_key = 'G2' and decided_at >= '2026-08-01T05:00:00Z' and decided_at < '2026-11-04T06:00:00Z'`);
    expect(e.g2Outcomes.total).toBe(g2);
    expect(e.g2Outcomes.byOutcome.reduce((n, o) => n + o.count, 0)).toBe(g2);
    expect(e.returned.reasons.length).toBeLessThanOrEqual(5);
    if (e.stageTime.n === 0) expect(e.stageTime.medianDays).toBeNull();
    // Nothing commercial in the lens.
    expect(res.body).not.toMatch(/capital_usd|prelimCapital|sfAmount|price/i);
  });

  it('B-26 outcomes: awards waiting in Commit & Hand Off are reported beside the win rate', async () => {
    const o = OutcomesResponse.parse(
      (await get('leadership', '/api/v1/analytics/outcomes')).json(),
    );
    expect(o.commitmentPending.count).toBe(
      await count(
        sql`select count(*)::int as n from quote where stage_key = 'COMMIT_HANDOFF' and status <> 'closed'`,
      ),
    );
    expect(o.commitmentPending.count).toBeGreaterThan(0);
  });

  it('Approver: pending G4 with age, decided in the last 30 days', async () => {
    const d = await dashboard('approver', 'Approver');
    if (d.role !== 'Approver') throw new Error('wrong dashboard');
    expect(d.pending.count).toBe(
      await count(
        sql`select count(*)::int as n from quote where stage_key = 'FINAL_REVIEW' and status <> 'closed'`,
      ),
    );
    const decided = await count(sql`
      select count(*)::int as n from gate_decision
      where gate_key = 'G4' and decided_at >= ${clock.toISOString()}::timestamptz - interval '30 days'`);
    expect(d.decided.total).toBe(decided);
    expect(d.decided.byOutcome.reduce((n, o) => n + o.count, 0)).toBe(decided);
    for (const i of d.pending.items) expect(i.daysInStage).not.toBeNull();
  });

  it('Leadership dashboard is the same numbers as /analytics, not a second computation', async () => {
    const d = await dashboard('leadership', 'Leadership');
    if (d.role !== 'Leadership') throw new Error('wrong dashboard');
    const p = PipelineResponse.parse(
      (await get('leadership', '/api/v1/analytics/pipeline')).json(),
    );
    const o = OutcomesResponse.parse(
      (await get('leadership', '/api/v1/analytics/outcomes')).json(),
    );
    const f = FirstPassResponse.parse(
      (await get('leadership', '/api/v1/analytics/first-pass')).json(),
    );
    expect(d.openQuotes.count).toBe(p.totals.count);
    expect(d.openQuotes.sfAmount).toBe(p.totals.sfAmount);
    expect(d.outcomes.rates).toEqual(o.total);
    expect(d.firstPass.rate).toBe(f.rate);
    // The headline pairs the two rates.
    expect(d.outcomes.rates).toHaveProperty('winRate');
    expect(d.outcomes.rates).toHaveProperty('captureRate');
  });

  it('every dashboard block states its definition and window', async () => {
    const cases: [string, DashboardRole][] = [
      ['kam', 'KAM'],
      ['sales-leader', 'SalesLeader'],
      ['eng-lead', 'EngLead'],
      ['pricing', 'Pricing'],
      ['pricing-lead', 'PricingLead'],
      ['approver', 'Approver'],
      ['leadership', 'Leadership'],
    ];
    for (const [persona, role] of cases) {
      const body = JSON.stringify(await dashboard(persona, role));
      const found = [...body.matchAll(/"definition":"([^"]+)","window":"([^"]+)"/g)];
      expect(found.length, role).toBeGreaterThanOrEqual(2);
      for (const m of found) {
        expect(m[1]!.length, role).toBeGreaterThan(20);
        expect(m[2]!.length, role).toBeGreaterThan(3);
      }
    }
  });
});
