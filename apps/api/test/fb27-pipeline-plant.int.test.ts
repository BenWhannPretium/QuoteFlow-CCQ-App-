import {
  DEV_USER_HEADER,
  BoardResponse,
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
 * FB-27 (N17-17, Faron Ipox): the pipeline shows the plants Engineering chose for a quote's items and filters
 * by plant, on the list, the board and the CSV. A quote matches when ANY item is at the plant; a quote
 * whose items have no plant yet shows nothing and never matches. Scope (RLS + policy) is unchanged.
 * Synthetic data only.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
const clock = new Date('2026-11-19T15:00:00Z');

const get = (persona: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { [DEV_USER_HEADER]: persona } });
async function list(persona: string, query = ''): Promise<QuoteListResponse> {
  const res = await get(persona, `/api/v1/quotes?pageSize=200${query ? `&${query}` : ''}`);
  expect(res.statusCode, res.body).toBe(200);
  return QuoteListResponse.parse(res.json());
}
const numbers = (items: QuoteListItem[]) => items.map((i) => i.quoteNumber);

interface Q {
  id: string;
  quoteNumber: string;
}
let multi: Q; // item 1 at AURORA, item 2 added at CARROLLTON
let none: Q; // an item with no plant yet
let noReview: Q; // no engineering review row at all

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb27plant');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url, RATE_LIMIT_MAX: '100000' }), {
    db,
    now: () => clock,
  });
  await app.ready();
  await get('kam-owner', '/api/v1/me');

  const pick = async (where: ReturnType<typeof sql>): Promise<Q> => {
    const [row] = await db.db.execute<{ id: string; quote_number: string }>(
      sql`select q.id, q.quote_number from quote q where ${where} order by q.quote_number limit 1`,
    );
    return { id: row!.id, quoteNumber: row!.quote_number };
  };
  multi = await pick(
    sql`exists (select 1 from eng_review er where er.quote_id = q.id and er.plant_code = 'AURORA')`,
  );
  noReview = await pick(sql`not exists (select 1 from eng_review er where er.quote_id = q.id)`);
  none = await pick(sql`q.id not in (${multi.id}, ${noReview.id})`);
  // `none`: its review row has no plant (or gets none).
  await db.db.execute(sql`update eng_review set plant_code = null where quote_id = ${none.id}`);
  // `multi`: a second item with its own engineering row at CARROLLTON (copy of item 1's rows).
  await db.db.execute(
    sql`create temp table fb27_item as select * from quote_item where quote_id = ${multi.id}`,
  );
  await db.db.execute(
    sql`update fb27_item set id = gen_random_uuid(), item_no = 2, label = 'Second item'`,
  );
  await db.db.execute(
    sql`create temp table fb27_review as select * from eng_review where quote_id = ${multi.id}`,
  );
  await db.db.execute(
    sql`update fb27_review set id = gen_random_uuid(), quote_item_id = (select id from fb27_item), plant_code = 'CARROLLTON'`,
  );
  await db.db.execute(sql`insert into quote_item select * from fb27_item`);
  await db.db.execute(sql`insert into eng_review select * from fb27_review`);
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('the Plant column', () => {
  it('lists the distinct plant labels in item order; none shows nothing', async () => {
    const all = await list('admin');
    const byNumber = new Map(all.items.map((i) => [i.quoteNumber, i]));
    expect(byNumber.get(multi.quoteNumber)!.plants).toEqual(['Aurora', 'Carrollton']);
    expect(byNumber.get(none.quoteNumber)!.plants).toEqual([]);
    expect(byNumber.get(noReview.quoteNumber)!.plants).toEqual([]);
    // Every other quote shows its own plant label or nothing.
    for (const i of all.items) expect(i.plants.length).toBeLessThanOrEqual(2);
  });

  it('a plant used by two items of one quote is listed once', async () => {
    await db.db.execute(
      sql`update eng_review set plant_code = 'AURORA' where quote_id = ${multi.id}`,
    );
    try {
      const i = (await list('admin', `q=${multi.quoteNumber}`)).items.find(
        (x) => x.quoteNumber === multi.quoteNumber,
      )!;
      expect(i.plants).toEqual(['Aurora']);
    } finally {
      await db.db.execute(
        sql`update eng_review set plant_code = 'CARROLLTON' where quote_item_id = (select id from quote_item where quote_id = ${multi.id} and item_no = 2)`,
      );
    }
  });
});

describe('the Plant filter', () => {
  it('matches a quote when any of its items is at the plant', async () => {
    const aurora = await list('admin', 'plant=AURORA');
    const carrollton = await list('admin', 'plant=CARROLLTON');
    expect(numbers(aurora.items)).toContain(multi.quoteNumber);
    expect(numbers(carrollton.items)).toContain(multi.quoteNumber);
    expect(carrollton.items.every((i) => i.plants.includes('Carrollton'))).toBe(true);
    expect(aurora.items.every((i) => i.plants.includes('Aurora'))).toBe(true);
  });

  it('several plants are an "or"; comma, repeated and bracketed forms agree', async () => {
    const a = await list('admin', 'plant=AURORA,BETHLEHEM');
    const b = await list('admin', 'plant=AURORA&plant=BETHLEHEM');
    const c = await list('admin', 'plant[]=AURORA&plant[]=BETHLEHEM');
    expect(a.total).toBeGreaterThan((await list('admin', 'plant=AURORA')).total);
    expect(numbers(b.items)).toEqual(numbers(a.items));
    expect(numbers(c.items)).toEqual(numbers(a.items));
  });

  it('a quote with no plant yet never matches, and an unknown plant matches nothing (no error)', async () => {
    const everyPlant = await list(
      'admin',
      'plant=AURORA,BETHLEHEM,BOXMORE,CARROLLTON,CLEVELAND_OH,CLEVELAND_TN,PLANT_01,PLANT_02,PLANT_03',
    );
    expect(numbers(everyPlant.items)).not.toContain(none.quoteNumber);
    expect(numbers(everyPlant.items)).not.toContain(noReview.quoteNumber);
    const unknown = await list('admin', 'plant=NOT_A_PLANT');
    expect(unknown.total).toBe(0);
  });

  it('combines with the other filters', async () => {
    const stage = (await list('admin', 'plant=AURORA')).items[0]!.stageKey;
    const r = await list('admin', `plant=AURORA&stage=${stage}`);
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.every((i) => i.stageKey === stage && i.plants.includes('Aurora'))).toBe(true);
  });

  it('RLS and the policy are unchanged: an owner-scoped KAM sees only their own quotes', async () => {
    const unfiltered = await list('kam-owner');
    const filtered = await list('kam-owner', 'plant=AURORA,BETHLEHEM,CARROLLTON');
    const expected = unfiltered.items.filter((i) =>
      i.plants.some((p) => ['Aurora', 'Bethlehem', 'Carrollton'].includes(p)),
    );
    expect(numbers(filtered.items).sort()).toEqual(numbers(expected).sort());
    const admin = await list('admin', 'plant=AURORA,BETHLEHEM,CARROLLTON');
    expect(filtered.total).toBeLessThan(admin.total);
  });

  it('the board shares the filter', async () => {
    const res = await get('admin', '/api/v1/quotes/board?plant=CARROLLTON&includeClosed=true');
    expect(res.statusCode, res.body).toBe(200);
    const b = BoardResponse.parse(res.json());
    const cards = b.columns.flatMap((c) => c.cards).map((c) => c.quoteNumber);
    expect(cards).toContain(multi.quoteNumber);
    const expected = (await list('admin', 'plant=CARROLLTON')).items.map((i) => i.quoteNumber);
    expect([...cards].sort()).toEqual([...expected].sort());
  });
});

describe('the CSV', () => {
  it('has a Plant column ("Aurora · Carrollton") and honours the plant filter', async () => {
    const res = await get(
      'admin',
      '/api/v1/quotes/export.csv?plant=CARROLLTON&columns=quoteNumber,plant',
    );
    expect(res.statusCode, res.body).toBe(200);
    const lines = res.body.trim().split(/\r?\n/);
    expect(lines[0]).toBe('"Quote","Plant"');
    const row = lines.find((l) => l.startsWith(`"${multi.quoteNumber}"`))!;
    expect(row).toBe(`"${multi.quoteNumber}","Aurora · Carrollton"`);
    const expected = (await list('admin', 'plant=CARROLLTON')).total;
    expect(lines).toHaveLength(expected + 1);
  });

  it('an empty plant is an empty cell; the filter is recorded in the export audit', async () => {
    const res = await get(
      'admin',
      `/api/v1/quotes/export.csv?q=${none.quoteNumber}&columns=quoteNumber,plant`,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body.trim().split(/\r?\n/)[1]).toBe(`"${none.quoteNumber}",""`);
    await get('admin', '/api/v1/quotes/export.csv?plant=AURORA&columns=quoteNumber');
    const audits = await db.db.execute<{ n: number }>(
      sql`select count(*)::int as n from audit_event where action = 'export' and entity = 'quote' and after->'filters'->'plant' = '["AURORA"]'::jsonb`,
    );
    expect(audits[0]!.n).toBe(1);
  });
});
