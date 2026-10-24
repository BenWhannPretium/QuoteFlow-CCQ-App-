import {
  ErfLinkageResponse,
  IntegrationRunsResponse,
  MeResponse,
  SfOpportunityDetail,
  SfOpportunitySearchResponse,
  SfSyncTriggerResponse,
} from '@ccq/contracts';
import type { DbClient } from '@ccq/db';
import { FakeSalesforceReader, loadSyntheticFixture, type SfFixture } from '@ccq/integrations';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { DETAIL_CACHE_MS } from '../src/services/salesforce';
import { testConfig } from '../src/test-utils';

let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let reader: FakeSalesforceReader;
let fixture: SfFixture;
let clock = new Date('2026-10-16T12:00:00Z');

const search = async (role: Parameters<typeof asRole>[1], query: string) => {
  const res = await asRole(app, role).get(`/api/v1/salesforce/opportunities?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return SfOpportunitySearchResponse.parse(res.json());
};
const detail = async (id: string, role: Parameters<typeof asRole>[1] = 'Engineer') =>
  asRole(app, role).get(`/api/v1/salesforce/opportunities/${id}`);

beforeAll(async () => {
  const fresh = await freshSfDatabase('sfroutes');
  db = fresh.client;
  fixture = loadSyntheticFixture();
  reader = new FakeSalesforceReader(loadSyntheticFixture());
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), {
    db,
    salesforce: reader,
    now: () => clock,
  });
  await app.ready();
  // Load SF into the snapshots, as the 15-min job would.
  const res = await asRole(app, 'Admin').post('/api/v1/admin/salesforce/sync');
  expect(SfSyncTriggerResponse.parse(res.json()).outcome).toBe('succeeded');
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/salesforce/opportunities', () => {
  it('searches the snapshot first; no live call with enough hits', async () => {
    const before = reader.calls.searchOpportunities ?? 0;
    const body = await search('KAM', 'q=packaging&limit=10');
    expect(body.items).toHaveLength(10);
    expect(body.items.every((i) => i.source === 'snapshot')).toBe(true);
    expect(body.liveSearched).toBe(false);
    expect(reader.calls.searchOpportunities ?? 0).toBe(before);
  });

  it('fuzzy on name and account: a typo and an account name both match', async () => {
    const typo = await search('KAM', 'q=pakaging%20supply&openOnly=false&limit=5');
    expect(typo.items.length).toBe(5);
    const withAccount = fixture.opportunities.find((o) => o.AccountId)!;
    const accountName = (withAccount.Account as { Name: string }).Name.split(/[ ,-]/)[0]!;
    const byAccount = await search(
      'SalesLeader',
      `q=${encodeURIComponent(accountName)}&openOnly=false`,
    );
    expect(byAccount.items.map((i) => i.accountName)).toContain(
      (withAccount.Account as { Name: string }).Name,
    );
  });

  it('openOnly (default) hides closed opportunities', async () => {
    const open = await search('KAM', 'q=&limit=50');
    expect(open.items.every((i) => !i.isClosed)).toBe(true);
    const closed = fixture.opportunities.find((o) => o.IsClosed)!;
    const q = encodeURIComponent(closed.Name as string);
    expect((await search('KAM', `q=${q}&openOnly=false`)).items.map((i) => i.id)).toContain(
      closed.Id,
    );
    expect((await search('KAM', `q=${q}`)).items.map((i) => i.id)).not.toContain(closed.Id);
  });

  it('mine=true returns only the caller’s SF opportunities (email matched to the SF owner)', async () => {
    const me = MeResponse.parse((await asRole(app, 'KAM').get('/api/v1/me')).json());
    const mine = await search('KAM', 'q=&mine=true&openOnly=false&limit=50');
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((i) => i.ownerEmail === me.user.email?.toLowerCase())).toBe(true);
  });

  it('falls back to a live SF search under 5 snapshot hits', async () => {
    reader.put({
      Id: '006SYNliveOnly0001',
      Name: 'Zephyrine Bottling / Quokka Tonic / 33oz PET Cylinder 38-400 (synthetic)',
      AccountId: null,
      Account: null,
      Amount: 50,
      StageName: 'Qualifying',
      IsClosed: false,
      IsWon: false,
      SystemModstamp: '2026-10-16T11:00:00.000+0000',
    });
    const body = await search('Admin', 'q=quokka%20tonic');
    expect(body.liveSearched).toBe(true);
    expect(body.items).toEqual([
      expect.objectContaining({
        id: '006SYNliveOnly0001',
        source: 'live',
        dataQuality: expect.arrayContaining(['amount_suspect', 'account_missing']) as string[],
      }),
    ]);
  });

  it('a live failure still returns the snapshot hits, with the error code', async () => {
    reader.failWith = Object.assign(new Error('down'), { errorCode: 'SERVER_UNAVAILABLE' });
    try {
      const body = await search('KAM', 'q=zzzznothing');
      expect(body).toEqual({
        items: [],
        liveSearched: true,
        liveError: 'Salesforce search unavailable (SERVER_UNAVAILABLE)',
      });
    } finally {
      reader.failWith = null;
    }
  });

  it('rejects an over-long query', async () => {
    const res = await asRole(app, 'KAM').get(
      `/api/v1/salesforce/opportunities?q=${'x'.repeat(201)}`,
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/salesforce/opportunities/:id', () => {
  const withSpecs = () => fixture.productSpecs[0]!.Opportunity__c as string;

  it('returns snapshot + live: account, ship-to, ERF, quote source, stage, specs, stage hint', async () => {
    const id = withSpecs();
    const raw = fixture.opportunities.find((o) => o.Id === id)!;
    const res = await detail(id);
    expect(res.statusCode, res.body).toBe(200);
    const body = SfOpportunityDetail.parse(res.json());
    expect(body.opportunity).toMatchObject({
      id,
      name: raw.Name,
      stage: raw.StageName,
      erfNumber: (raw.ERF_Number__c as string | null)?.trim() || null,
    });
    expect(body.productSpecs.length).toBeGreaterThan(0);
    expect(body.ccqStageHint).not.toBeUndefined();
    expect(body.snapshotSyncedAt).not.toBeNull();
    expect(body.liveRefreshedAt).toBe(clock.toISOString());
    expect(body.liveError).toBeNull();
    expect(body.deletedInSf).toBe(false);
    if (raw.AccountId) {
      expect(body.account?.shipTo).toMatchObject({ state: expect.any(String) as string });
    }
  });

  it('caches the live read for 60 s', async () => {
    const id = fixture.opportunities[5]!.Id as string;
    const before = reader.calls.getOpportunity ?? 0;
    await detail(id);
    await detail(id);
    expect(reader.calls.getOpportunity).toBe(before + 1);
    clock = new Date(clock.getTime() + DETAIL_CACHE_MS);
    await detail(id);
    expect(reader.calls.getOpportunity).toBe(before + 2);
  });

  it('SF down: the snapshot is shown with the error', async () => {
    const id = fixture.opportunities[7]!.Id as string;
    reader.failWith = Object.assign(new Error('x'), { errorCode: 'REQUEST_LIMIT_EXCEEDED' });
    try {
      const body = SfOpportunityDetail.parse((await detail(id)).json());
      expect(body.opportunity.id).toBe(id);
      expect(body.liveRefreshedAt).toBeNull();
      expect(body.liveError).toContain('REQUEST_LIMIT_EXCEEDED');
      expect(body.productSpecs).toEqual([]);
    } finally {
      reader.failWith = null;
    }
  });

  it('deleted in SF: snapshot shown, flagged', async () => {
    const id = fixture.opportunities[9]!.Id as string;
    reader.remove(id, clock);
    clock = new Date(clock.getTime() + DETAIL_CACHE_MS);
    const body = SfOpportunityDetail.parse((await detail(id)).json());
    expect(body.deletedInSf).toBe(true);
    expect(body.opportunity.id).toBe(id);
  });

  it('flags a suspect amount', async () => {
    const id = fixture.opportunities.find((o) => o.Amount === 0.31)!.Id as string;
    const body = SfOpportunityDetail.parse((await detail(id, 'KAM')).json());
    expect(body.opportunity.dataQuality).toContain('amount_suspect');
  });

  it('404 for an unknown id, 400 for a malformed one', async () => {
    expect((await detail('006000000000000AAA')).statusCode).toBe(404);
    expect((await detail('not-an-id')).statusCode).toBe(400);
  });
});

describe('admin', () => {
  it('GET /admin/integrations lists runs, newest first', async () => {
    const res = await asRole(app, 'Admin').get('/api/v1/admin/integrations?source=salesforce');
    expect(res.statusCode, res.body).toBe(200);
    const { items } = IntegrationRunsResponse.parse(res.json());
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toMatchObject({ source: 'salesforce', status: 'succeeded' });
    expect(items[0]!.counts).toMatchObject({ fetched: 102 });
  });

  it('GET /admin/reports/erf-linkage compares SF and CCQ ERF numbers', async () => {
    const res = await asRole(app, 'Admin').get('/api/v1/admin/reports/erf-linkage');
    expect(res.statusCode, res.body).toBe(200);
    const body = ErfLinkageResponse.parse(res.json());
    expect(body.summary.quotes).toBe(150);
    expect(body.items).toHaveLength(150);
    expect(body.summary.sfLinked).toBe(body.items.filter((i) => i.sfErfNumber).length);
    expect(body.summary.sfLinkedPct).toBeCloseTo(body.summary.sfLinked / 150);
    for (const item of body.items) {
      expect(item.mismatch).toBe(item.linkage === 'mismatch');
      if (item.linkage === 'match') expect(item.sfErfNumber).not.toBeNull();
    }
  });

  it('POST /admin/salesforce/sync?full=true re-reads and rewrites every opportunity', async () => {
    const res = await asRole(app, 'Admin').post('/api/v1/admin/salesforce/sync?full=true');
    expect(res.statusCode, res.body).toBe(200);
    const body = SfSyncTriggerResponse.parse(res.json());
    expect(body.outcome).toBe('succeeded');
    expect(body.counts.fetched).toBeGreaterThanOrEqual(102);
    expect(body.counts.updated! + body.counts.inserted!).toBe(body.counts.fetched);
    expect(
      (await asRole(app, 'KAM').post('/api/v1/admin/salesforce/sync?full=true')).statusCode,
    ).toBe(403);
  });

  it('POST /admin/salesforce/sync runs a delta and reports counts', async () => {
    const res = await asRole(app, 'Admin').post('/api/v1/admin/salesforce/sync');
    expect(res.statusCode, res.body).toBe(200);
    const body = SfSyncTriggerResponse.parse(res.json());
    expect(body.outcome).toBe('succeeded');
    expect(body.runId).not.toBeNull();
  });
});

describe('opportunity visibility follows CCQ data scope (L-6)', () => {
  const emailOf = async (scope: 'owner' | 'region') =>
    MeResponse.parse((await asRole(app, 'KAM', scope).get('/api/v1/me')).json()).user.email!;
  /** Opportunities an owner-scoped KAM may see: owned in SF, or linked to one of their quotes. */
  const ownerVisible = async (email: string) => {
    const rows = await db.db.execute<{ id: string }>(sql`
      select s.sf_opportunity_id as id from sf_opportunity_snapshot s
      where lower(s.owner_email) = lower(${email})
         or exists (select 1 from quote q join app_user u on u.id = q.kam_user_id
                    where q.sf_opportunity_id = s.sf_opportunity_id and lower(u.email) = lower(${email}))`);
    return new Set([...rows].map((r) => r.id));
  };

  it('search: an owner-scoped KAM sees only their own; a KAM with scope all sees more', async () => {
    const allowed = await ownerVisible(await emailOf('owner'));
    const own = await asRole(app, 'KAM', 'owner').get(
      '/api/v1/salesforce/opportunities?q=&openOnly=false&limit=50',
    );
    expect(own.statusCode, own.body).toBe(200);
    const ownItems = SfOpportunitySearchResponse.parse(own.json()).items;
    expect(ownItems.length).toBeGreaterThan(0);
    expect(ownItems.every((i) => allowed.has(i.id))).toBe(true);
    const all = await search('KAM', 'q=&openOnly=false&limit=50');
    expect(all.items.length).toBeGreaterThan(ownItems.length);
  });

  it('detail: 404 for an opportunity outside the caller’s scope, 200 for Admin', async () => {
    const allowed = await ownerVisible(await emailOf('owner'));
    const hidden = fixture.opportunities.find((o) => !allowed.has(o.Id as string))!;
    clock = new Date(clock.getTime() + DETAIL_CACHE_MS + 1);
    const res = await asRole(app, 'KAM', 'owner').get(
      `/api/v1/salesforce/opportunities/${hidden.Id as string}`,
    );
    expect(res.statusCode).toBe(404);
    expect((await detail(hidden.Id as string, 'Admin')).statusCode).toBe(200);
  });

  it('live search results pass the same rule: another KAM’s new opportunity is left out', async () => {
    const mine = await emailOf('owner');
    const theirs = await emailOf('region');
    const base = {
      AccountId: null,
      Account: null,
      Amount: 25_000,
      StageName: 'Qualifying',
      IsClosed: false,
      IsWon: false,
      SystemModstamp: '2026-10-16T11:30:00.000+0000',
    };
    reader.put({
      ...base,
      Id: '006SYNscopeMine01',
      Name: 'Wombatique Foods / Scoped Live Mine (synthetic)',
      Owner: { Email: mine, Name: 'Me', Alias: 'me' },
    });
    reader.put({
      ...base,
      Id: '006SYNscopeTheirs',
      Name: 'Wombatique Foods / Scoped Live Theirs (synthetic)',
      Owner: { Email: theirs, Name: 'Them', Alias: 'them' },
    });
    const res = await asRole(app, 'KAM', 'owner').get(
      '/api/v1/salesforce/opportunities?q=wombatique%20scoped&openOnly=false',
    );
    expect(res.statusCode, res.body).toBe(200);
    const body = SfOpportunitySearchResponse.parse(res.json());
    expect(body.liveSearched).toBe(true);
    expect(body.items.map((i) => i.id)).toEqual(['006SYNscopeMine01']);
    // The region KAM (and Admin) see the other one.
    const admin = await search('Admin', 'q=wombatique%20scoped&openOnly=false');
    expect(admin.items.map((i) => i.id).sort()).toEqual(['006SYNscopeMine01', '006SYNscopeTheirs']);
  });
});
