import { ADVISORY_LOCKS, schema, type DbClient } from '@ccq/db';
import { listIntegrationRuns } from '@ccq/db/repos';
import {
  FakeSalesforceReader,
  loadSyntheticFixture,
  silentLogger,
  type SfFixture,
  type SfLogger,
} from '@ccq/integrations';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { freshSfDatabase } from './sf-helpers';
import { createSfSyncScheduler, runSfSync, type SfSyncDeps } from '../src/jobs/sfSync';

const { quote, sfOpportunitySnapshot, customer, notification, activityEvent } = schema;

/**
 * Fixture SystemModstamps sit in the 3 weeks before 2026-10-15T15:00Z. Runs at T0 (before them)
 * re-read the whole fixture; delta runs start from D0, after every fixture modstamp.
 */
const T0 = new Date('2026-09-15T12:00:00Z');
const D0 = new Date('2026-10-16T12:00:00Z');
const hours = (n: number) => new Date(D0.getTime() + n * 3_600_000);

let db: DbClient;
let fixture: SfFixture;
let reader: FakeSalesforceReader;
let clock: Date;

const deps = (overrides: Partial<SfSyncDeps> = {}): SfSyncDeps => ({
  database: db.db,
  sql: db.sql,
  reader,
  logger: silentLogger,
  now: () => clock,
  ...overrides,
});

const count = async (table: typeof sfOpportunitySnapshot | typeof customer) =>
  (await db.db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

beforeAll(async () => {
  db = (await freshSfDatabase('sfsync')).client;
  fixture = loadSyntheticFixture();
}, 120_000);
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  clock = T0;
});

describe('sfSync against the fake reader', () => {
  it('first run reads everything and fills snapshots and customers', async () => {
    reader = new FakeSalesforceReader(loadSyntheticFixture());
    const result = await runSfSync(deps());
    expect(result.outcome).toBe('succeeded');
    // The synthetic seed already holds the 102 snapshots; SF adds SystemModstamp, raw and flags.
    expect(result.counts).toMatchObject({ fetched: 102, inserted: 0, updated: 102, errors: 0 });
    expect(await count(sfOpportunitySnapshot)).toBe(102);

    const placeholder = fixture.opportunities.find((o) => o.Amount === 0.31)!;
    const [snap] = await db.db
      .select()
      .from(sfOpportunitySnapshot)
      .where(eq(sfOpportunitySnapshot.sfOpportunityId, placeholder.Id as string));
    expect(snap!.amount).toBe(0.31);
    expect(snap!.dataQuality).toContain('amount_suspect');
    expect(snap!.systemModstamp).toBeInstanceOf(Date);
    expect(snap!.raw).toMatchObject({ Id: placeholder.Id, Name: placeholder.Name });

    // Customers: existing, default ship-to in the structured shape.
    const withAccount = fixture.opportunities.find((o) => o.AccountId)!;
    const [cust] = await db.db
      .select()
      .from(customer)
      .where(eq(customer.sfAccountId, withAccount.AccountId as string));
    expect(cust!.status).toBe('existing');
    expect(cust!.defaultShipTo).toEqual({
      line1: expect.any(String) as string,
      city: expect.any(String) as string,
      state: expect.any(String) as string,
      postal: expect.any(String) as string,
      country: expect.any(String) as string,
    });

    const [run] = await listIntegrationRuns(db.db, { source: 'salesforce', limit: 1 });
    expect(run).toMatchObject({ status: 'succeeded', error: null });
    expect(run!.counts).toMatchObject({ fetched: 102, inserted: 0, updated: 102, errors: 0 });
    expect(run!.finishedAt).toBeInstanceOf(Date);
  });

  it('flags quotes whose opportunity is closed in SF, and nothing else', async () => {
    const closed = await db.db
      .select({ flag: quote.sfStatusFlag, stage: sfOpportunitySnapshot.sfStage })
      .from(quote)
      .innerJoin(
        sfOpportunitySnapshot,
        eq(sfOpportunitySnapshot.sfOpportunityId, quote.sfOpportunityId),
      )
      .where(isNotNull(quote.sfStatusFlag));
    expect(closed.length).toBeGreaterThan(0);
    for (const row of closed) {
      expect(row.flag).toBe(row.stage!.startsWith('Closed Won') ? 'closed_won' : 'closed_lost');
    }
  });

  it('is idempotent: re-reading the same window changes nothing', async () => {
    const before = await count(customer);
    const result = await runSfSync(deps());
    expect(result.outcome).toBe('succeeded');
    // Same clock, so the window (last run − 5 min) covers every record again.
    expect(result.counts).toMatchObject({
      fetched: 102,
      inserted: 0,
      updated: 0,
      unchanged: 102,
      customersInserted: 0,
      customersUpdated: 0,
      quotesFlagged: 0,
      quotesUnflagged: 0,
    });
    expect(await count(sfOpportunitySnapshot)).toBe(102);
    expect(await count(customer)).toBe(before);
  });

  it('delta: only changes since the last run; deletes and closures flag the quote', async () => {
    const linked = await db.db
      .select({ id: quote.id, sfOpportunityId: quote.sfOpportunityId })
      .from(quote)
      // Opportunities with exactly one quote, so each SF change flags exactly one quote (the B-07
      // seed lets closed quotes share an opportunity).
      .where(
        and(
          sql`${quote.sfStatusFlag} is null`,
          sql`(select count(*) from quote q2 where q2.sf_opportunity_id = ${quote.sfOpportunityId}) = 1`,
        ),
      )
      .limit(2);
    const [toClose, toDelete] = linked as [(typeof linked)[0], (typeof linked)[0]];

    // Baseline run after the fixture's modstamps: the watermark moves to D0.
    clock = D0;
    expect((await runSfSync(deps())).counts).toMatchObject({ updated: 0, unchanged: 102 });

    clock = hours(2);
    const edited = reader.raw(toClose.sfOpportunityId)!;
    reader.put({
      ...edited,
      StageName: 'Closed Lost',
      IsClosed: true,
      IsWon: false,
      SystemModstamp: hours(1).toISOString(),
    });
    reader.put({
      ...edited,
      Id: '006SYNnewOpportun1',
      Name: 'New in SF (synthetic) / 16oz PET Oval 28-410',
      SystemModstamp: hours(1).toISOString(),
    });
    reader.remove(toDelete.sfOpportunityId, hours(1));

    const result = await runSfSync(deps());
    expect(result.outcome).toBe('succeeded');
    expect(result.counts).toMatchObject({
      fetched: 2,
      inserted: 1,
      updated: 1,
      deleted: 1,
      quotesFlagged: 2,
    });

    const flags = await db.db
      .select({ id: quote.id, flag: quote.sfStatusFlag, at: quote.sfStatusFlaggedAt })
      .from(quote)
      .where(inArray(quote.id, [toClose.id, toDelete.id]));
    expect(Object.fromEntries(flags.map((f) => [f.id, f.flag]))).toEqual({
      [toClose.id]: 'closed_lost',
      [toDelete.id]: 'deleted',
    });
    expect(flags.every((f) => f.at?.getTime() === clock.getTime())).toBe(true);

    // Nothing is deleted locally: the snapshot stays, marked.
    const [gone] = await db.db
      .select()
      .from(sfOpportunitySnapshot)
      .where(eq(sfOpportunitySnapshot.sfOpportunityId, toDelete.sfOpportunityId));
    expect(gone!.deletedInSfAt?.getTime()).toBe(clock.getTime());

    // The quote timeline shows the SF change (system actor).
    const events = await db.db
      .select()
      .from(activityEvent)
      .where(
        and(eq(activityEvent.quoteId, toClose.id), eq(activityEvent.type, 'sf_status_changed')),
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBeNull();
  });

  it('a reopened opportunity clears the flag', async () => {
    const [flagged] = await db.db
      .select({ id: quote.id, sfOpportunityId: quote.sfOpportunityId })
      .from(quote)
      .where(
        and(
          eq(quote.sfStatusFlag, 'closed_lost'),
          sql`(select count(*) from quote q2 where q2.sf_opportunity_id = ${quote.sfOpportunityId}) = 1`,
        ),
      )
      .limit(1);
    clock = hours(4);
    reader.put({
      ...reader.raw(flagged!.sfOpportunityId)!,
      StageName: 'Negotiating',
      IsClosed: false,
      SystemModstamp: hours(3).toISOString(),
    });
    const result = await runSfSync(deps());
    expect(result.counts).toMatchObject({ fetched: 1, updated: 1, quotesUnflagged: 1 });
    const [row] = await db.db.select().from(quote).where(eq(quote.id, flagged!.id));
    expect(row!.sfStatusFlag).toBeNull();
    expect(row!.sfStatusFlaggedAt).toBeNull();
  });

  it('the advisory lock prevents a second run while one holds it', async () => {
    const runsBefore = (await listIntegrationRuns(db.db, { limit: 500 })).length;
    const holder = await db.sql.reserve();
    try {
      await holder`select pg_advisory_lock(${ADVISORY_LOCKS.sfSync.toString()}::bigint)`;
      const result = await runSfSync(deps());
      expect(result).toEqual({ outcome: 'skipped', runId: null, counts: {} });
      await holder`select pg_advisory_unlock(${ADVISORY_LOCKS.sfSync.toString()}::bigint)`;
    } finally {
      holder.release();
    }
    expect((await listIntegrationRuns(db.db, { limit: 500 })).length).toBe(runsBefore);
    // Released: the next run goes ahead.
    expect((await runSfSync(deps())).outcome).toBe('succeeded');
  });

  it('two concurrent runs (two instances): exactly one does the work', async () => {
    const slow = new FakeSalesforceReader(loadSyntheticFixture());
    const changed = slow.listChangedOpportunities.bind(slow);
    slow.listChangedOpportunities = async function* (since) {
      await new Promise((r) => setTimeout(r, 300));
      yield* changed(since);
    };
    const outcomes = (
      await Promise.all([runSfSync(deps({ reader: slow })), runSfSync(deps({ reader: slow }))])
    )
      .map((r) => r.outcome)
      .sort();
    expect(outcomes).toEqual(['skipped', 'succeeded']);
  });

  it('the scheduler coalesces triggers within one process', async () => {
    const scheduler = createSfSyncScheduler(deps(), 0);
    const [a, b] = await Promise.all([scheduler.runNow(), scheduler.runNow()]);
    expect(a).toBe(b);
    await scheduler.stop();
  });

  it('on failure: run recorded as failed, admins notified, logs carry codes only, no throw', async () => {
    const lines: string[] = [];
    const logger: SfLogger = {
      info: () => {},
      warn: () => {},
      error: (obj, msg) => lines.push(JSON.stringify({ obj, msg })),
    };
    const failing = new FakeSalesforceReader(loadSyntheticFixture());
    failing.failWith = Object.assign(new Error('Customer Foo Inc limit message'), {
      errorCode: 'REQUEST_LIMIT_EXCEEDED',
    });
    clock = hours(6);
    const result = await runSfSync(deps({ reader: failing, logger }));
    expect(result.outcome).toBe('failed');

    const [run] = await listIntegrationRuns(db.db, { source: 'salesforce', limit: 1 });
    expect(run).toMatchObject({
      id: result.runId,
      status: 'failed',
      error: 'Salesforce sync failed: REQUEST_LIMIT_EXCEEDED',
    });

    const alerts = await db.db
      .select()
      .from(notification)
      .where(eq(notification.type, 'integration.failed'));
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]!.body).toContain(result.runId!);
    expect(lines.join('\n')).toContain('REQUEST_LIMIT_EXCEEDED');
    expect(lines.join('\n')).not.toContain('Customer Foo');

    // A failed run doesn't advance the watermark: the next good run re-reads from the last success.
    clock = hours(7);
    const next = await runSfSync(deps());
    expect(next.outcome).toBe('succeeded');
  });

  it('a full re-sync rewrites snapshots SF has not changed (a backfill after a field-map change)', async () => {
    const s = sfOpportunitySnapshot;
    const filled = async () =>
      (
        await db.db
          .select({ n: sql<number>`count(*)::int` })
          .from(s)
          .where(isNotNull(s.quoteSourceSf))
      )[0]!.n;
    // As if quote source had been mapped to the wrong field: blank on every snapshot.
    await db.db.update(s).set({ quoteSourceSf: null });

    clock = hours(8);
    const delta = await runSfSync(deps());
    expect(delta.outcome).toBe('succeeded');
    expect(delta.counts.updated).toBe(0);
    expect(await filled()).toBe(0);

    clock = hours(9);
    const full = await runSfSync(deps(), { full: true });
    expect(full.outcome).toBe('succeeded');
    expect(full.counts.fetched).toBeGreaterThanOrEqual(100);
    expect(full.counts.updated! + full.counts.inserted!).toBe(full.counts.fetched);
    expect(await filled()).toBeGreaterThan(0);
  });

  it('the scheduler queues a full re-sync behind a running delta instead of folding it in', async () => {
    clock = hours(10);
    const scheduler = createSfSyncScheduler(deps(), 0);
    const delta = scheduler.runNow();
    const full = scheduler.runNow({ full: true });
    expect(full).not.toBe(delta);
    const [d, f] = await Promise.all([delta, full]);
    expect([d.outcome, f.outcome]).toEqual(['succeeded', 'succeeded']);
    expect(f.runId).not.toBe(d.runId);
    expect(f.counts.updated).toBe(f.counts.fetched);
    await scheduler.stop();
  });
});
