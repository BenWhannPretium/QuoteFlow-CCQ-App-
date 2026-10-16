import { DEV_USER_HEADER, MeResponse, QuoteListResponse } from '@ccq/contracts';
import { contextSettings, createDb, type DbClient } from '@ccq/db';
import { dropAll, ensureDatabase, runMigrations } from '@ccq/db/migrate';
import { listPipelineKeys, listPipelineRows } from '@ccq/db/repos';
import { seedConfig, seedSynthetic } from '@ccq/db/seeds';
import type { Role } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { testConfig } from '../../src/test-utils';
import { DEFAULT_TEST_DATABASE_URL } from '../global-setup';

/**
 * B-14 performance check (architecture §9: board < 1.5 s on 500 open quotes; this step's target:
 * list API p95 < 300 ms). Opt-in: `pnpm --filter @ccq/api test:perf`.
 *
 * Builds `<TEST_DATABASE_URL>_perf`: the synthetic seed, then its 80 open quotes cloned (with their
 * opportunities, stage history, engineering review, pricing records, decisions and holds) until
 * there are ≥ 500 open quotes. It measures the list and board APIs per role and prints EXPLAIN ANALYZE
 * of the list's two queries, run as `ccq_app` with a request context (RLS on). The database is left in
 * place so `PERF_E2E=1` Playwright (`e2e/board-perf.spec.ts`) can time the board render against it.
 */
const TARGET_OPEN = 500;
const LIST_P95_MS = 300;
const BOARD_P95_MS = 1_000;

let db: DbClient;
let url: string;
let app: Awaited<ReturnType<typeof buildApp>>;

async function amplify(target: number) {
  const open = async () =>
    (
      await db.db.execute<{ n: number }>(
        sql`select count(*)::int as n from quote where status <> 'closed'`,
      )
    )[0]!.n;
  const base = await open();
  // Clone only the seeded quotes (never earlier copies): `base` more open quotes per copy.
  const copies = Math.ceil((target - base) / base);
  for (let k = 1; k <= copies; k++) {
    await db.db.transaction(async (tx) => {
      // Opportunities: a new id per copy (18 chars, like Salesforce's).
      await tx.execute(sql`
        create temp table perf_opp on commit drop as
        select s.*, '006PRF' || substr(md5(s.sf_opportunity_id || ${k}::text), 1, 12) as new_opp
        from sf_opportunity_snapshot s
        where s.sf_opportunity_id in (select sf_opportunity_id from quote where status <> 'closed' and quote_number not like 'CCQ-2025-%')`);
      await tx.execute(
        sql`update perf_opp set id = gen_random_uuid(), sf_opportunity_id = new_opp`,
      );
      await tx.execute(sql`alter table perf_opp drop column new_opp`);
      await tx.execute(sql`insert into sf_opportunity_snapshot select * from perf_opp`);

      await tx.execute(sql`
        create temp table perf_map on commit drop as
        select id as old_id, gen_random_uuid() as new_id,
          '006PRF' || substr(md5(sf_opportunity_id || ${k}::text), 1, 12) as new_opp,
          'CCQ-2025-' || lpad((${k} * 1000 + row_number() over (order by quote_number))::text, 5, '0') as new_number
        from quote where status <> 'closed' and quote_number not like 'CCQ-2025-%'`);
      await tx.execute(sql`
        create temp table perf_quote on commit drop as
        select q.* from quote q join perf_map m on m.old_id = q.id`);
      await tx.execute(sql`
        update perf_quote q set id = m.new_id, sf_opportunity_id = m.new_opp, quote_number = m.new_number
        from perf_map m where m.old_id = q.id`);
      await tx.execute(sql`insert into quote select * from perf_quote`);

      for (const table of [
        'stage_history',
        'eng_review',
        'pricing_record',
        'gate_decision',
        'quote_hold',
        'capacity_evidence',
      ]) {
        const t = sql.raw(table);
        const tmp = sql.raw(`perf_${table}`);
        await tx.execute(sql`
          create temp table ${tmp} on commit drop as
          select x.* from ${t} x join perf_map m on m.old_id = x.quote_id`);
        await tx.execute(sql`
          update ${tmp} x set id = gen_random_uuid(), quote_id = m.new_id
          from perf_map m where m.old_id = x.quote_id`);
        await tx.execute(sql`insert into ${t} select * from ${tmp}`);
      }
    });
  }
  await db.db.execute(sql`analyze`);
  return open();
}

const percentile = (samples: number[], p: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]!;
};
const p95 = (samples: number[]) => percentile(samples, 0.95);
/** The perf report goes straight to stderr (vitest buffers console output of passing tests). */
const report = (text: string) => process.stderr.write(`[perf] ${text}\n`);

beforeAll(async () => {
  const base = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
  base.pathname = `${base.pathname}_perf`;
  url = base.toString();
  await ensureDatabase(url);
  await dropAll(url);
  await runMigrations(url);
  db = createDb(url);
  await db.db.transaction(async (tx) => {
    await seedConfig(tx);
    await seedSynthetic(tx);
  });
  const openQuotes = await amplify(TARGET_OPEN);
  report(`perf database ${base.pathname.slice(1)}: ${openQuotes} open quotes`);
  expect(openQuotes).toBeGreaterThanOrEqual(TARGET_OPEN);
  app = await buildApp(testConfig({ DATABASE_URL: url, RATE_LIMIT_MAX: '1000000' }), { db });
  await app.ready();
}, 300_000);

afterAll(async () => {
  await app?.close();
  await db?.close();
});

async function time(persona: string, path: string): Promise<number> {
  const start = performance.now();
  const res = await app.inject({
    method: 'GET',
    url: path,
    headers: { [DEV_USER_HEADER]: persona },
  });
  const ms = performance.now() - start;
  expect(res.statusCode, res.body).toBe(200);
  return ms;
}

describe('pipeline performance on ≥ 500 open quotes', () => {
  it(`list API p95 < ${LIST_P95_MS} ms across roles and filters`, async () => {
    const queries = [
      '',
      'sort=score',
      'sort=tier&status=open',
      'sort=age&agedOverDays=7',
      'stage=ENG_REVIEW,QUOTING&tier=HIGH,CRITICAL',
      'q=jar',
      'hasWarnings=true',
      'view=priority&sort=score&status=open',
    ];
    const personas = ['admin', 'kam', 'kam-owner', 'eng-lead', 'pricing'];
    for (const p of personas) await time(p, '/api/v1/me'); // provision + warm
    const samples: number[] = [];
    for (let round = 0; round < 4; round++) {
      for (const p of personas) {
        for (const q of queries) samples.push(await time(p, `/api/v1/quotes?pageSize=50&${q}`));
      }
    }
    const result = p95(samples);
    report(
      `list: n=${samples.length} p50=${percentile(samples, 0.5).toFixed(1)} p95=${result.toFixed(1)} ms`,
    );
    expect(result).toBeLessThan(LIST_P95_MS);
  });

  it(`board API p95 < ${BOARD_P95_MS} ms (all open cards + per-card gate actions)`, async () => {
    const samples: number[] = [];
    for (let round = 0; round < 5; round++) {
      for (const p of ['admin', 'eng-lead', 'approver', 'kam']) {
        samples.push(await time(p, '/api/v1/quotes/board'));
      }
    }
    report(`board: n=${samples.length} p95=${p95(samples).toFixed(1)} ms`);
    expect(p95(samples)).toBeLessThan(BOARD_P95_MS);
  });

  it('EXPLAIN ANALYZE of the list queries (as ccq_app, RLS on)', async () => {
    const me = MeResponse.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: { [DEV_USER_HEADER]: 'kam' },
        })
      ).json(),
    );
    const settings = contextSettings({
      userId: me.user.id,
      roles: me.roles as Role[],
      scope: { type: 'all' },
    });
    const keys = listPipelineKeys(db.db, {
      filter: { q: 'jar', status: 'open' },
      sort: 'score',
      dir: 'desc',
      tierOrder: ['CRITICAL', 'HIGH', 'STANDARD', 'LOW'],
    }).toSQL();
    const page = QuoteListResponse.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/quotes?pageSize=50&sort=score',
          headers: { [DEV_USER_HEADER]: 'kam' },
        })
      ).json(),
    );
    const rowsQuery = listPipelineRows(
      db.db,
      page.items.map((i) => i.id),
    );
    if (rowsQuery instanceof Promise) throw new Error('expected a page of quotes');
    const rows = rowsQuery.toSQL();
    const plans = await db.sql.begin(async (tx) => {
      await tx.unsafe('set local role ccq_app');
      for (const [k, v] of Object.entries(settings)) {
        await tx.unsafe('select set_config($1, $2, true)', [k, v]);
      }
      const out: { name: string; plan: string; ms: number }[] = [];
      for (const [name, q] of [
        ['phase 1: keys (q=jar, open, by score)', keys],
        ['phase 2: rows (one page)', rows],
      ] as const) {
        const res = await tx.unsafe(
          `explain (analyze, buffers, format text) ${q.sql}`,
          q.params as never[],
        );
        const plan = res.map((r) => (r as Record<string, string>)['QUERY PLAN']).join('\n');
        const ms = Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? NaN);
        out.push({ name, plan, ms });
      }
      return out;
    });
    for (const p of plans) {
      report(`\n── ${p.name}: ${p.ms} ms ──\n${p.plan}`);
      expect(p.ms).toBeLessThan(100);
    }
  });
});
