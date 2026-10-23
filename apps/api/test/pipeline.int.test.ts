import { DEV_USER_HEADER } from '@ccq/contracts';
import {
  BoardResponse,
  MeResponse,
  QUOTE_EXPORT_MAX_ROWS,
  QuoteListResponse,
  type QuoteListItem,
} from '@ccq/contracts';
import type { DbClient } from '@ccq/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-14 pipeline views (F-07): `GET /quotes` (list + prioritization), `GET /quotes/board` and
 * `GET /quotes/export.csv`. Filter combinations, scope (RLS + policy), priority and commercial
 * redaction, the board's per-card gate actions, the audited export and its 5,000-row cap.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const clock = new Date('2026-11-03T15:00:00Z');

const get = (persona: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { [DEV_USER_HEADER]: persona } });
async function list(persona: string, query = ''): Promise<QuoteListResponse> {
  const res = await get(persona, `/api/v1/quotes?pageSize=200${query ? `&${query}` : ''}`);
  expect(res.statusCode, res.body).toBe(200);
  return QuoteListResponse.parse(res.json());
}
async function board(persona: string, query = ''): Promise<BoardResponse> {
  const res = await get(persona, `/api/v1/quotes/board${query ? `?${query}` : ''}`);
  expect(res.statusCode, res.body).toBe(200);
  return BoardResponse.parse(res.json());
}
const ids: Record<string, string> = {};
async function userId(persona: string) {
  ids[persona] ??= MeResponse.parse((await get(persona, '/api/v1/me')).json()).user.id;
  return ids[persona];
}
const numbers = (items: QuoteListItem[]) => items.map((i) => i.quoteNumber);
async function setSetting(key: string, value: unknown) {
  await db.db.execute(
    sql`update app_setting set value = ${JSON.stringify(value)}::jsonb where key = ${key}`,
  );
}
async function exportRows() {
  const [row] = await db.db.execute<{ n: number }>(
    sql`select count(*)::int as n from audit_event where action = 'export' and entity = 'quote'`,
  );
  return row!.n;
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('pipeline');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '100000' }), {
    db,
    now: () => clock,
  });
  await app.ready();
  // Every persona exists before any scope comparison.
  for (const p of ['kam', 'kam-owner', 'eng-lead', 'pricing', 'admin', 'engineer']) await userId(p);
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('GET /quotes: filters', () => {
  it('returns every quote in scope with paging, total and the default "last updated" sort', async () => {
    const all = await list('admin');
    expect(all.total).toBe(150);
    expect(all.sort).toBe('updated');
    const p1 = QuoteListResponse.parse((await get('admin', '/api/v1/quotes?pageSize=40')).json());
    const p2 = QuoteListResponse.parse(
      (await get('admin', '/api/v1/quotes?pageSize=40&page=2')).json(),
    );
    expect(p1.items).toHaveLength(40);
    expect(new Set([...numbers(p1.items), ...numbers(p2.items)]).size).toBe(80);
    expect(numbers(all.items).slice(0, 80)).toEqual([...numbers(p1.items), ...numbers(p2.items)]);
  });

  it('stage accepts repeated, bracketed and comma-separated values', async () => {
    const a = await list('admin', 'stage=QUOTING&stage=FINAL_REVIEW');
    const b = await list('admin', 'stage[]=QUOTING&stage[]=FINAL_REVIEW');
    const c = await list('admin', 'stage=QUOTING,FINAL_REVIEW');
    expect(a.total).toBe(28);
    expect(numbers(b.items)).toEqual(numbers(a.items));
    expect(numbers(c.items)).toEqual(numbers(a.items));
    expect(a.items.every((i) => ['QUOTING', 'FINAL_REVIEW'].includes(i.stageKey))).toBe(true);
  });

  it('combines stage + tier + product family + status', async () => {
    const r = await list('admin', 'stage=ENG_REVIEW,QUOTING&tier=HIGH,CRITICAL&status=open');
    expect(r.total).toBeGreaterThan(0);
    for (const i of r.items) {
      expect(['ENG_REVIEW', 'QUOTING']).toContain(i.stageKey);
      expect(['HIGH', 'CRITICAL']).toContain(i.priority.tier);
      expect(i.status).not.toBe('closed');
    }
    const family = r.items[0]!.productFamily!;
    const narrowed = await list(
      'admin',
      `stage=ENG_REVIEW,QUOTING&tier=HIGH,CRITICAL&status=open&productFamily=${family}`,
    );
    expect(narrowed.total).toBeLessThanOrEqual(r.total);
    expect(narrowed.items.every((i) => i.productFamily === family)).toBe(true);
  });

  it('kam=me, engineer=unassigned / me', async () => {
    const mine = await list('kam', 'kam=me');
    expect(mine.total).toBeGreaterThan(0);
    expect(mine.items.every((i) => i.kamUserId === ids.kam)).toBe(true);
    const unassigned = await list('admin', 'engineer=unassigned&stage=ENG_REVIEW');
    expect(unassigned.items.every((i) => i.assignedEngineerId === null)).toBe(true);
    const engineerMine = await list('engineer', 'engineer=me');
    expect(engineerMine.items.every((i) => i.assignedEngineerId === ids.engineer)).toBe(true);
  });

  it('rejects an unknown person id with a 400 problem (not a 500)', async () => {
    const res = await get('admin', '/api/v1/quotes?kam=not-a-uuid');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe('bad_filter');
  });

  it('q searches quote number, opportunity, account and description (ILIKE, literal % and _)', async () => {
    const any = (await list('admin', 'stage=QUOTING')).items[0]!;
    const byNumber = await list('admin', `q=${any.quoteNumber.slice(-5)}`);
    expect(numbers(byNumber.items)).toContain(any.quoteNumber);
    const word = any.accountName!.split(/[\s,]+/)[0]!;
    const byAccount = await list('admin', `q=${encodeURIComponent(word.toLowerCase())}`);
    expect(numbers(byAccount.items)).toContain(any.quoteNumber);
    expect((await list('admin', 'q=%25')).total).toBe(0);
  });

  it('agedOverDays and the close-date range', async () => {
    const all = await list('admin', 'status=open');
    const days = all.items.map((i) => i.daysInStage).sort((a, b) => a - b);
    const cut = days[Math.floor(days.length / 2)]!;
    const aged = await list('admin', `agedOverDays=${cut}&status=open`);
    // "More than N days": strictly older than N × 24 h, so at least N whole days.
    expect(aged.items.every((i) => i.daysInStage >= cut)).toBe(true);
    expect(aged.total).toBeGreaterThan(0);
    expect(aged.total).toBeLessThan(all.total);
    const ranged = await list('admin', 'closeDateFrom=2026-12-01&closeDateTo=2027-01-31');
    for (const i of ranged.items) {
      expect(i.expectedCloseDate! >= '2026-12-01' && i.expectedCloseDate! <= '2027-01-31').toBe(
        true,
      );
    }
  });

  it('hasWarnings and sfMismatch split the list in two (domain-computed filters)', async () => {
    const total = (await list('admin')).total;
    const w = await list('admin', 'hasWarnings=true');
    const nw = await list('admin', 'hasWarnings=false');
    expect(w.total + nw.total).toBe(total);
    expect(w.items.every((i) => i.warnings.length > 0)).toBe(true);
    expect(nw.items.every((i) => i.warnings.length === 0)).toBe(true);
    const m = await list('admin', 'sfMismatch=true');
    const nm = await list('admin', 'sfMismatch=false');
    expect(m.total + nm.total).toBe(total);
    expect(m.items.every((i) => i.sfMismatch)).toBe(true);
  });
});

describe('GET /quotes: sort', () => {
  it('score desc, amount asc, close date asc, age desc, tier by the model order', async () => {
    const score = (await list('admin', 'sort=score')).items.map((i) => i.priority.score ?? -1);
    expect(score).toEqual([...score].sort((a, b) => b - a));
    const amount = (await list('admin', 'sort=amount&dir=asc')).items
      .map((i) => i.amount)
      .filter((a): a is number => a !== null);
    expect(amount).toEqual([...amount].sort((a, b) => a - b));
    const close = (await list('admin', 'sort=closeDate')).items
      .map((i) => i.expectedCloseDate)
      .filter((d): d is string => d !== null);
    expect(close).toEqual([...close].sort());
    const age = (await list('admin', 'sort=age')).items.map((i) => i.daysInStage);
    expect(age).toEqual([...age].sort((a, b) => b - a));
    const order = ['CRITICAL', 'HIGH', 'STANDARD', 'LOW'];
    const tiers = (await list('admin', 'sort=tier')).items.map((i) =>
      order.indexOf(i.priority.tier ?? ''),
    );
    expect(tiers.filter((t) => t >= 0)).toEqual([...tiers.filter((t) => t >= 0)].sort());
  });
});

describe('GET /quotes: scope and redaction', () => {
  it('an owner-scoped KAM sees only their own quotes (RLS + policy)', async () => {
    const r = await list('kam-owner');
    const [row] = await db.db.execute<{ n: number }>(
      sql`select count(*)::int as n from quote where kam_user_id = ${ids['kam-owner']}`,
    );
    expect(r.total).toBe(row!.n);
    expect(r.items.every((i) => i.kamUserId === ids['kam-owner'])).toBe(true);
  });

  it('commercial columns are null for KAM / Engineer and present for Pricing / EngLead', async () => {
    for (const p of ['kam', 'engineer']) {
      const r = await list(p, 'stage=QUOTING');
      expect(r.commercialVisible).toBe(false);
      expect(r.items.every((i) => i.commercial === null)).toBe(true);
      expect(JSON.stringify(r)).not.toMatch(/prelimCapital|capitalReadiness"\s*:\s*"/);
    }
    for (const p of ['pricing', 'eng-lead']) {
      const r = await list(p, 'stage=QUOTING');
      expect(r.commercialVisible).toBe(true);
      expect(r.items.every((i) => i.commercial !== null)).toBe(true);
    }
  });

  it('with kam_can_see_peer_scores=false, peers’ priority is hidden and can’t be filtered or sorted on', async () => {
    await setSetting('kam_can_see_peer_scores', false);
    try {
      const r = await list('kam');
      expect(r.peerPriorityVisible).toBe(false);
      for (const i of r.items) {
        if (i.kamUserId === ids.kam) continue;
        expect(i.priority).toMatchObject({ visible: false, score: null, tier: null });
      }
      const high = await list('kam', 'tier=HIGH,CRITICAL,STANDARD,LOW');
      expect(high.total).toBeGreaterThan(0);
      expect(high.items.every((i) => i.kamUserId === ids.kam)).toBe(true);
      // Sorting by score puts the KAM's own (visible) scores first; peers have none to order by.
      const byScore = (await list('kam', 'sort=score')).items;
      const firstPeer = byScore.findIndex((i) => i.kamUserId !== ids.kam);
      expect(byScore.slice(firstPeer).every((i) => i.kamUserId !== ids.kam)).toBe(true);
      // Other roles are unaffected.
      expect((await list('eng-lead')).peerPriorityVisible).toBe(true);
    } finally {
      await setSetting('kam_can_see_peer_scores', true);
    }
  });
});

describe('GET /quotes/board', () => {
  it('a column per configured stage; closed stages counted but collapsed', async () => {
    const b = await board('admin');
    const [stages] = [
      await db.db.execute<{ key: string }>(sql`select key from stage_definition order by sort`),
    ];
    expect(b.columns.map((c) => c.stageKey)).toEqual(stages.map((s) => s.key));
    expect(b.columns.reduce((n, c) => n + c.count, 0)).toBe(150);
    expect(b.closed.count).toBe(67);
    expect(b.columns.filter((c) => c.terminal).every((c) => c.cards.length === 0)).toBe(true);
    expect(b.columns.filter((c) => !c.terminal).every((c) => c.cards.length === c.count)).toBe(
      true,
    );
    const open = await board('admin', 'includeClosed=true');
    expect(open.closed.included).toBe(true);
    expect(open.columns.find((c) => c.stageKey === 'AWARDED')!.cards.length).toBe(
      open.columns.find((c) => c.stageKey === 'AWARDED')!.count,
    );
    // Column totals are the SF amounts (not commercial): same for a KAM.
    const kam = await board('kam');
    expect(kam.columns.map((c) => c.totalAmount)).toEqual(b.columns.map((c) => c.totalAmount));
  });

  it('cards carry the gate actions the caller may take: EngLead on ENG_REVIEW only (G2)', async () => {
    const b = await board('eng-lead');
    for (const col of b.columns) {
      for (const card of col.cards) {
        if (col.stageKey === 'ENG_REVIEW') {
          expect(card.actions.map((a) => a.gateKey)).toContain('G2');
          expect(
            card.actions.some(
              (a) => a.outcomeKey === 'proceed' && a.targetStageKeys[0] === 'QUOTING',
            ),
          ).toBe(true);
        } else {
          expect(card.actions, `${card.quoteNumber} in ${col.stageKey}`).toEqual([]);
        }
      }
    }
  });

  it('a KAM can move only their own Customer Decision quotes; Admin and Leadership move nothing', async () => {
    const b = await board('kam');
    for (const card of b.columns.flatMap((c) => c.cards)) {
      const own = card.kamUserId === ids.kam && card.stageKey === 'CUSTOMER_DECISION';
      expect(card.actions.length > 0, card.quoteNumber).toBe(own);
    }
    for (const p of ['admin', 'leadership']) {
      const all = (await board(p)).columns.flatMap((c) => c.cards);
      expect(all.every((c) => c.actions.length === 0)).toBe(true);
    }
  });

  it('applies the same filters as the list', async () => {
    const b = await board('admin', 'stage=QUOTING&tier=HIGH');
    const l = await list('admin', 'stage=QUOTING&tier=HIGH');
    expect(
      b.columns
        .find((c) => c.stageKey === 'QUOTING')!
        .cards.map((c) => c.quoteNumber)
        .sort(),
    ).toEqual(numbers(l.items).sort());
  });
});

describe('GET /quotes/export.csv', () => {
  const csv = async (persona: string, query: string) => {
    const res = await get(persona, `/api/v1/quotes/export.csv?${query}`);
    return { res, lines: res.body.trim().split('\r\n') };
  };

  it('exports the visible columns in list order and audits the export (filters + row count)', async () => {
    const before = await exportRows();
    const { res, lines } = await csv(
      'pricing',
      'stage=QUOTING&sort=amount&columns=quoteNumber,amount,prelimCapitalUsd,capitalReadiness',
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(lines[0]).toBe('"Quote","Amount (SF)","Prelim capital (USD)","Capital readiness"');
    const l = await list('pricing', 'stage=QUOTING&sort=amount');
    expect(lines.slice(1).map((line) => JSON.parse(line.split(',')[0]!) as string)).toEqual(
      numbers(l.items),
    );
    expect(await exportRows()).toBe(before + 1);
    const [audit] = await db.db.execute<{ after: Record<string, unknown>; actor_id: string }>(
      sql`select after, actor_id from audit_event where action = 'export' and entity = 'quote' order by at desc, id desc limit 1`,
    );
    expect(audit!.actor_id).toBe(ids.pricing);
    expect(audit!.after).toMatchObject({
      format: 'csv',
      rows: l.total,
      filters: { stage: ['QUOTING'], sort: 'amount' },
      columns: ['quoteNumber', 'amount', 'prelimCapitalUsd', 'capitalReadiness'],
    });
  });

  it('drops commercial columns for a KAM whatever is asked, and keeps to the KAM’s scope', async () => {
    const { lines } = await csv(
      'kam-owner',
      'columns=quoteNumber,prelimCapitalUsd,capitalReadiness,kamName',
    );
    expect(lines[0]).toBe('"Quote","KAM"');
    const own = await list('kam-owner');
    expect(lines).toHaveLength(own.total + 1);
  });

  it('neutralises spreadsheet formulas in cells', async () => {
    await db.db.execute(
      sql`update quote set description = '=HYPERLINK("x")', structured_description = '{}'::jsonb where quote_number = (select min(quote_number) from quote)`,
    );
    const { lines } = await csv('admin', 'q=HYPERLINK&columns=quoteNumber,productSummary');
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('is forbidden to roles without export.csv (Engineer)', async () => {
    const before = await exportRows();
    expect((await get('engineer', '/api/v1/quotes/export.csv')).statusCode).toBe(403);
    expect(await exportRows()).toBe(before);
  });

  it(`refuses more than ${QUOTE_EXPORT_MAX_ROWS} rows with a 422 and writes no export audit`, async () => {
    // Clone a closed quote 5,000 times (closed quotes may share an opportunity).
    await db.db.execute(sql`
      insert into quote (id, quote_number, sf_opportunity_id, customer_id, kam_user_id, stage_key, status,
        version, outcome, outcome_reason_code, closure_owner_id, closed_at, priority_score, priority_tier)
      select gen_random_uuid(), 'CCQ-2099-' || lpad(n::text, 5, '0'), q.sf_opportunity_id, q.customer_id,
        q.kam_user_id, q.stage_key, q.status, q.version, q.outcome, q.outcome_reason_code,
        q.closure_owner_id, q.closed_at, q.priority_score, q.priority_tier
      from (select * from quote where status = 'closed' order by quote_number limit 1) q,
        generate_series(1, ${QUOTE_EXPORT_MAX_ROWS}) n`);
    try {
      const before = await exportRows();
      const res = await get('admin', '/api/v1/quotes/export.csv');
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ code: 'export_too_large', limit: QUOTE_EXPORT_MAX_ROWS });
      expect(res.json<{ detail: string }>().detail).toMatch(/Narrow the filters/);
      expect(await exportRows()).toBe(before);
      // Narrowed, it works.
      expect((await get('admin', '/api/v1/quotes/export.csv?status=open')).statusCode).toBe(200);
    } finally {
      await db.db.execute(sql`delete from quote where quote_number like 'CCQ-2099-%'`);
    }
  });
});
