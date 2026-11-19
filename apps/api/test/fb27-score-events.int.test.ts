import { randomUUID } from 'node:crypto';

import { schema, withRequestContext, type DbClient, type Tx } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshSfDatabase } from './sf-helpers';
import { ScoringService, type ScoringTrigger } from '../src/services/scoring';

/**
 * FB-27 (N17-15, Bailey Schmitt): every recalculation that moves a quote's score writes ONE
 * `priority_score_changed` event (score from / to, tier before / after, the trigger), including a move
 * inside a tier. The old tier-only event is no longer written. The quote's first score has no "from".
 * Synthetic data only.
 */
let db: DbClient;
const scoring = new ScoringService();
const at = new Date('2026-11-19T15:00:00Z');
const admin = { userId: randomUUID(), roles: ['Admin'] as Role[], scope: { type: 'all' as const } };

let quoteId = '';
let actorId = '';

const run = <T>(fn: (tx: Tx) => Promise<T>) => withRequestContext(db.db, admin, fn);
const recalc = (trigger: ScoringTrigger = 'input_change') =>
  run((tx) => scoring.recalculate(tx, quoteId, actorId, at, trigger));
const events = async (type: string) =>
  db.db
    .select()
    .from(schema.activityEvent)
    .where(and(eq(schema.activityEvent.quoteId, quoteId), eq(schema.activityEvent.type, type)))
    .orderBy(asc(schema.activityEvent.createdAt), asc(schema.activityEvent.id));
const clearEvents = () =>
  db.db.execute(
    sql`delete from activity_event where quote_id = ${quoteId} and type in ('priority_score_changed', 'priority_tier_changed')`,
  );
/** Put the stored score (and computed tier) back to a chosen "before". */
const setBefore = (score: number | null, computedTier?: string, tier?: string) =>
  db.db.execute(
    sql`update quote set priority_score = ${score},
        priority_tier = coalesce(${tier ?? null}, priority_tier),
        priority_breakdown = case when ${computedTier ?? null}::text is null then priority_breakdown
          else jsonb_set(coalesce(priority_breakdown, '{}'::jsonb), '{computedTier}', to_jsonb(${computedTier ?? null}::text)) end,
        priority_tier_overridden = false
        where id = ${quoteId}`,
  );

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb27score');
  db = fresh.client;
  const [row] = await db.db.execute<{ id: string; kam: string }>(
    sql`select id, kam_user_id as kam from quote where status = 'active' order by quote_number limit 1`,
  );
  quoteId = row!.id;
  actorId = row!.kam;
  // Settle: the stored score is what the model computes now.
  await recalc();
});

afterAll(async () => {
  await db?.close();
});

describe('priority_score_changed', () => {
  it('writes nothing when the score and tier are unchanged', async () => {
    await clearEvents();
    const r = await recalc();
    expect(r!.tierChanged).toBe(false);
    expect(await events('priority_score_changed')).toHaveLength(0);
    expect(await events('priority_tier_changed')).toHaveLength(0);
  });

  it('a rise inside a tier: one event, from → to, same tier, no tier change', async () => {
    await clearEvents();
    const now = (await recalc())!;
    await clearEvents();
    await setBefore(Math.max(0, now.total - 8));
    const r = (await recalc('input_change'))!;
    expect(r.tierChanged).toBe(false);
    const written = await events('priority_score_changed');
    expect(written).toHaveLength(1);
    expect(written[0]!.payload).toMatchObject({
      to: now.total,
      tierFrom: now.tier,
      tierTo: now.tier,
      tierChanged: false,
      trigger: 'input_change',
      modelVersion: now.modelVersion,
    });
    expect(written[0]!.payload.from).toBeLessThan(written[0]!.payload.to as number);
    expect(written[0]!.actorId).toBe(actorId);
    expect(await events('priority_tier_changed')).toHaveLength(0);
  });

  it('a fall inside a tier is one event too', async () => {
    await clearEvents();
    const now = (await recalc())!;
    await clearEvents();
    await setBefore(Math.min(100, now.total + 6));
    await recalc();
    const written = await events('priority_score_changed');
    expect(written).toHaveLength(1);
    expect(written[0]!.payload.from).toBeGreaterThan(written[0]!.payload.to as number);
    expect(written[0]!.payload).toMatchObject({ tierChanged: false });
  });

  it('a change that also moves the tier is ONE event carrying both (no second tier event)', async () => {
    await clearEvents();
    const now = (await recalc())!;
    await clearEvents();
    await setBefore(Math.max(0, now.total - 40), 'LOW_BEFORE', 'LOW_BEFORE');
    const r = (await recalc('gate:G1'))!;
    expect(r.tierChanged).toBe(true);
    const written = await events('priority_score_changed');
    expect(written).toHaveLength(1);
    expect(written[0]!.payload).toMatchObject({
      tierFrom: 'LOW_BEFORE',
      tierTo: now.tier,
      tierChanged: true,
      trigger: 'gate:G1',
    });
    expect(await events('priority_tier_changed')).toHaveLength(0);
  });

  it('a tier moved by new bands with the same score is still recorded (a model activation)', async () => {
    await clearEvents();
    const now = (await recalc())!;
    await clearEvents();
    await setBefore(now.total, 'OLD_BAND', 'OLD_BAND');
    const r = (await recalc('model_change'))!;
    expect(r.tierChanged).toBe(true);
    const written = await events('priority_score_changed');
    expect(written).toHaveLength(1);
    expect(written[0]!.payload).toMatchObject({
      from: now.total,
      to: now.total,
      tierFrom: 'OLD_BAND',
      tierTo: now.tier,
      trigger: 'model_change',
    });
  });

  it("a quote's first score has no 'from', so no event", async () => {
    await clearEvents();
    await setBefore(null);
    await recalc('intake_submit');
    expect(await events('priority_score_changed')).toHaveLength(0);
  });

  it('a stored rounding wobble below a hundredth is not a change', async () => {
    await clearEvents();
    const now = (await recalc())!;
    await clearEvents();
    await setBefore(now.total + 0.004);
    await recalc();
    expect(await events('priority_score_changed')).toHaveLength(0);
  });
});
