import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { asPersona, persona, raw, testDb } from './helpers';
import type { Tx } from '../src/client';
import {
  adoption,
  cycleByStage,
  cycleEndToEndTotal,
  cycleEndToEndWeekly,
  flowWeekly,
  gateCompliance,
  intakeFirstPass,
  lossReasons,
  outcomeCohort,
  overrideFrequency,
  pipelineByStage,
  tierVsAssign,
  wipWeekly,
  type AnalyticsFilters,
} from '../src/repos/index';
import {
  gateDecision,
  override,
  quote,
  quoteHold,
  sfOpportunitySnapshot,
  stageHistory,
} from '../src/schema/index';

/**
 * B-17 analytics views with deterministic synthetic data and known answers. Each group of quotes has
 * its own market code, so the seeded data never leaks in; each test rolls back what it inserted.
 * The expected values are worked out by hand in the comments.
 */
const { db } = testDb();

const KAM = () => persona('kam').id;
const ENG = () => persona('eng-lead').id;
const APPROVER = () => persona('approver').id;
const at = (iso: string) => new Date(`${iso}Z`);

/** Run `fn` in a transaction and always roll it back. */
async function scratch(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const rollback = new Error('rollback');
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw rollback;
    })
    .catch((err: unknown) => {
      if (err !== rollback) throw err;
    });
}

let seq = 0;
interface QuoteSpec {
  market: string;
  stage?: string;
  status?: 'active' | 'on_hold' | 'closed';
  created?: Date;
  closedAt?: Date;
  outcome?: string;
  reason?: string;
  proposalAt?: Date;
  validity?: string;
  amount?: number | null;
  tier?: string;
  version?: number;
  assignedAt?: Date;
  engineer?: string;
}

async function mkQuote(tx: Tx, s: QuoteSpec) {
  seq += 1;
  const n = String(seq).padStart(5, '0');
  const oppId = `006B17${n}`;
  await tx.insert(sfOpportunitySnapshot).values({
    sfOpportunityId: oppId,
    name: `B17 opp ${n}`,
    amount: s.amount === undefined ? 1000 : s.amount,
    syncedAt: at('2030-01-01T00:00:00'),
  });
  const closed = s.status === 'closed';
  const [q] = await tx
    .insert(quote)
    .values({
      quoteNumber: `CCQ-9017-${n}`,
      sfOpportunityId: oppId,
      kamUserId: KAM(),
      stageKey: s.stage ?? 'ENG_REVIEW',
      status: s.status ?? 'active',
      market: s.market,
      region: 'ZZ',
      priorityTier: s.tier ?? null,
      version: s.version ?? 1,
      proposalIssuedAt: s.proposalAt ?? null,
      validityUntil: s.validity ?? null,
      assignedAt: s.assignedAt ?? null,
      assignedEngineerId: s.assignedAt ? (s.engineer ?? ENG()) : null,
      ...(s.created ? { createdAt: s.created } : {}),
      ...(closed
        ? {
            closedAt: s.closedAt ?? at('2030-01-20T00:00:00'),
            outcome: s.outcome ?? 'declined',
            outcomeReasonCode: s.reason ?? 'other',
            closureOwnerId: KAM(),
          }
        : {}),
    })
    .returning();
  return q!;
}

const stay = (tx: Tx, quoteId: string, stageKey: string, from: string, to?: string) =>
  tx.insert(stageHistory).values({
    quoteId,
    stageKey,
    enteredAt: at(from),
    exitedAt: to ? at(to) : null,
  });

const hold = (tx: Tx, quoteId: string, stageKey: string, from: string, to: string) =>
  tx.insert(quoteHold).values({ quoteId, stageKey, startedAt: at(from), endedAt: at(to) });

const decide = (
  tx: Tx,
  quoteId: string,
  gateKey: string,
  outcomeKey: string,
  when: string,
  extra: { reason?: string; target?: string } = {},
) =>
  tx.insert(gateDecision).values({
    quoteId,
    gateKey,
    outcomeKey,
    decidedBy: gateKey === 'G4' ? APPROVER() : ENG(),
    decidedAt: at(when),
    quoteVersion: 1,
    reasonCode: extra.reason ?? null,
    targetStageKey: extra.target ?? null,
  });

const filters = (market: string, over: Partial<AnalyticsFilters> = {}): AnalyticsFilters => ({
  from: at('2030-01-01T00:00:00'),
  to: at('2030-02-01T00:00:00'),
  market: [market],
  productFamily: [],
  kam: [],
  region: [],
  ...over,
});

describe('analytics views: cycle time (CR-55/57)', () => {
  /*
   * Three quotes, each Intake → Engineering → … → G4 Approve (all times 09:00 UTC, January 2030).
   *   Q1  intake 01-07 · ENG 01-08→01-11 (72 h, 24 h of it on hold) · G4 approve 01-15
   *   Q2  intake 01-08 · ENG 01-08→01-09 (24 h)                      · G4 approve 01-12
   *   Q3  intake 01-09 · ENG 01-09→01-13 (96 h)                      · G4 approve 01-19
   * Engineering active time: 48 h, 24 h, 96 h → median 48 h, p75 = 48 + ½(96 − 48) = 72 h.
   * Engineering elapsed time: 72, 24, 96 → median 72 h; one stay carried a hold.
   * End to end active: Q1 8 d − 1 d hold = 7 d; Q2 4 d; Q3 10 d → median 7 d, p75 = 7 + ½·3 = 8.5 d.
   * Weeks (Mon 01-07, Mon 01-14): Q2 released Sat 01-12 → week 01-07 (n 1, 4 d);
   *   Q1 Tue 01-15 and Q3 Sat 01-19 → week 01-14 (n 2, median 8.5 d, p75 = 7 + ¾·3 = 9.25 d).
   */
  async function seedCycle(tx: Tx) {
    const m = 'ZZ-CYCLE';
    const q1 = await mkQuote(tx, { market: m });
    await stay(tx, q1.id, 'INTAKE', '2030-01-07T09:00:00', '2030-01-08T09:00:00');
    await stay(tx, q1.id, 'ENG_REVIEW', '2030-01-08T09:00:00', '2030-01-11T09:00:00');
    await hold(tx, q1.id, 'ENG_REVIEW', '2030-01-09T09:00:00', '2030-01-10T09:00:00');
    await decide(tx, q1.id, 'G4', 'approve', '2030-01-15T09:00:00');
    const q2 = await mkQuote(tx, { market: m });
    await stay(tx, q2.id, 'INTAKE', '2030-01-08T09:00:00', '2030-01-08T09:00:00');
    await stay(tx, q2.id, 'ENG_REVIEW', '2030-01-08T09:00:00', '2030-01-09T09:00:00');
    await decide(tx, q2.id, 'G4', 'approve', '2030-01-12T09:00:00');
    const q3 = await mkQuote(tx, { market: m });
    await stay(tx, q3.id, 'INTAKE', '2030-01-09T09:00:00', '2030-01-09T09:00:00');
    await stay(tx, q3.id, 'ENG_REVIEW', '2030-01-09T09:00:00', '2030-01-13T09:00:00');
    await decide(tx, q3.id, 'G4', 'approve', '2030-01-19T09:00:00');
    return m;
  }

  it('takes the median and p75 of time in stage with holds excluded', async () => {
    await scratch(async (tx) => {
      const m = await seedCycle(tx);
      const rows = await cycleByStage(tx, filters(m));
      const eng = rows.find((r) => r.stage_key === 'ENG_REVIEW')!;
      expect(eng.n).toBe(3);
      expect(eng.median_active_s).toBe(48 * 3600);
      expect(eng.p75_active_s).toBe(72 * 3600);
      expect(eng.median_elapsed_s).toBe(72 * 3600);
      expect(eng.held_stays).toBe(1);
    });
  });

  it('measures end-to-end intake → G4 net of every hold, in total and by week', async () => {
    await scratch(async (tx) => {
      const m = await seedCycle(tx);
      const total = await cycleEndToEndTotal(tx, filters(m));
      expect(total.n).toBe(3);
      expect(total.median_active_s).toBe(7 * 86400);
      expect(total.p75_active_s).toBe(8.5 * 86400);
      // Elapsed is 8, 4 and 10 days: the hold really is what separates the two.
      expect(total.median_elapsed_s).toBe(8 * 86400);

      const weekly = await cycleEndToEndWeekly(tx, filters(m));
      expect(weekly.map((w) => [w.week, w.n])).toEqual([
        ['2030-01-07', 1],
        ['2030-01-14', 2],
      ]);
      expect(weekly[0]!.median_active_s).toBe(4 * 86400);
      expect(weekly[1]!.median_active_s).toBe(8.5 * 86400);
      expect(weekly[1]!.p75_active_s).toBe(9.25 * 86400);
    });
  });

  it('only counts stays that exited inside the window', async () => {
    await scratch(async (tx) => {
      const m = await seedCycle(tx);
      const narrow = filters(m, { from: at('2030-01-10T00:00:00'), to: at('2030-01-12T00:00:00') });
      const eng = (await cycleByStage(tx, narrow)).find((r) => r.stage_key === 'ENG_REVIEW')!;
      expect(eng.n).toBe(1); // only Q1's stay ended on 01-11
      expect(eng.median_active_s).toBe(48 * 3600);
    });
  });

  it('an open hold at the end of a stay is clipped to the stay, never negative', async () => {
    await scratch(async (tx) => {
      const q = await mkQuote(tx, { market: 'ZZ-CLIP' });
      await stay(tx, q.id, 'QUOTING', '2030-01-05T00:00:00', '2030-01-06T00:00:00');
      // A hold that started inside the stay and was never closed (the transition ended it logically).
      await tx.insert(quoteHold).values({
        quoteId: q.id,
        stageKey: 'QUOTING',
        startedAt: at('2030-01-05T12:00:00'),
      });
      const [row] = await cycleByStage(tx, filters('ZZ-CLIP'));
      // 24 h elapsed, 12 h held (clipped to the stay's end), 12 h active.
      expect(row!.median_active_s).toBe(12 * 3600);
    });
  });
});

describe('analytics views: outcomes and the capture rate', () => {
  /*
   * Proposals issued in January 2030 (cohort), as of 2030-02-15:
   *   awarded ×2 (SF amount 1000, 500) · lost ×3 (200 price, 300 price, 100 lead_time) · expired ×1
   *   open in Customer Decision: one past validity (gone dark), one still valid (awaiting)
   *   a Declined quote is internal: in no outcome cohort.
   * Recorded = 2 + 3 + 1 = 6, gone dark 1 → capture = 6/7. Win rate (decided only) = 2/(2+3) = 40 %.
   */
  async function seedOutcomes(tx: Tx) {
    const m = 'ZZ-OUT';
    const proposalAt = at('2030-01-10T12:00:00');
    const closed = (outcome: string, reason: string, amount: number) =>
      mkQuote(tx, {
        market: m,
        stage: outcome === 'awarded' ? 'AWARDED' : outcome === 'lost' ? 'CLOSED_LOST' : 'EXPIRED',
        status: 'closed',
        outcome,
        reason,
        amount,
        proposalAt,
      });
    await closed('awarded', 'po', 1000);
    await closed('awarded', 'verbal', 500);
    await closed('lost', 'price', 200);
    await closed('lost', 'price', 300);
    await closed('lost', 'lead_time', 100);
    await closed('expired', 'no_response', 50);
    await mkQuote(tx, {
      market: m,
      stage: 'CUSTOMER_DECISION',
      proposalAt,
      validity: '2030-02-01',
    });
    await mkQuote(tx, {
      market: m,
      stage: 'CUSTOMER_DECISION',
      proposalAt,
      validity: '2030-03-01',
    });
    await mkQuote(tx, { market: m, stage: 'DECLINED', status: 'closed', proposalAt });
    return m;
  }

  it('counts awarded, lost, expired, awaiting and gone dark for the proposal cohort', async () => {
    await scratch(async (tx) => {
      const m = await seedOutcomes(tx);
      const [row] = await outcomeCohort(tx, filters(m), 'total', at('2030-02-15T12:00:00'));
      expect(row).toMatchObject({
        awarded: 2,
        lost: 3,
        expired: 1,
        awaiting: 1,
        gone_dark: 1,
        awarded_amount: 1500,
        lost_amount: 600,
      });
      // The two rates the dashboards show, and why they are shown together.
      const recorded = row!.awarded + row!.lost + row!.expired;
      expect(recorded / (recorded + row!.gone_dark)).toBeCloseTo(6 / 7, 10);
      expect(row!.awarded / (row!.awarded + row!.lost)).toBeCloseTo(0.4, 10);
    });
  });

  it('moves a proposal from awaiting to gone dark as time passes', async () => {
    await scratch(async (tx) => {
      const m = await seedOutcomes(tx);
      const [early] = await outcomeCohort(tx, filters(m), 'total', at('2030-01-20T12:00:00'));
      expect([early!.awaiting, early!.gone_dark]).toEqual([2, 0]);
      const [late] = await outcomeCohort(tx, filters(m), 'total', at('2030-04-01T12:00:00'));
      expect([late!.awaiting, late!.gone_dark]).toEqual([0, 2]);
    });
  });

  it('splits by market and by KAM, and leaves the other markets out', async () => {
    await scratch(async (tx) => {
      const m = await seedOutcomes(tx);
      const byMarket = await outcomeCohort(
        tx,
        filters(m, { market: [] }),
        'market',
        at('2030-02-15T12:00:00'),
      );
      expect(byMarket.find((r) => r.key === m)?.awarded).toBe(2);
      const byKam = await outcomeCohort(tx, filters(m), 'kam', at('2030-02-15T12:00:00'));
      expect(byKam).toHaveLength(1);
      expect(byKam[0]!.lost).toBe(3);
    });
  });

  it('ranks loss reasons by count, with labels and amounts (the Pareto)', async () => {
    await scratch(async (tx) => {
      const m = await seedOutcomes(tx);
      const reasons = await lossReasons(tx, filters(m));
      expect(reasons.map((r) => [r.code, r.label, r.count, r.amount])).toEqual([
        ['price', 'Price', 2, 500],
        ['lead_time', 'Lead time', 1, 100],
      ]);
    });
  });

  it('excludes proposals issued outside the window', async () => {
    await scratch(async (tx) => {
      const m = await seedOutcomes(tx);
      const [row] = await outcomeCohort(
        tx,
        filters(m, { from: at('2030-02-01T00:00:00'), to: at('2030-03-01T00:00:00') }),
        'total',
        at('2030-02-15T12:00:00'),
      );
      expect(row).toBeUndefined();
    });
  });
});

describe('analytics views: intake quality and governance', () => {
  /*
   * First-pass completeness (S-03). Quotes created in January:
   *   F1, F2  reached Engineering, never reworked           → first pass
   *   F3      G1 Rework, then reached Engineering           → resolved, not first pass
   *   F4      G1 Rework, still back in Intake               → resolved, not first pass
   *   F5      submitted, waiting for G1                     → not judged yet (excluded)
   *   F6      on hold at G1                                 → excluded
   * 2 first pass of 4 resolved = 50 %.
   */
  it('computes first-pass completeness over resolved intakes only', async () => {
    await scratch(async (tx) => {
      const m = 'ZZ-FP';
      const created = at('2030-01-05T00:00:00');
      for (const rework of [false, false, true]) {
        const q = await mkQuote(tx, { market: m, created });
        await stay(tx, q.id, 'INTAKE', '2030-01-05T00:00:00', '2030-01-06T00:00:00');
        if (rework)
          await decide(tx, q.id, 'G1', 'rework', '2030-01-05T12:00:00', {
            reason: 'missing_information',
          });
        await stay(tx, q.id, 'ENG_REVIEW', '2030-01-06T00:00:00');
      }
      const f4 = await mkQuote(tx, { market: m, created, stage: 'INTAKE' });
      await stay(tx, f4.id, 'INTAKE', '2030-01-05T00:00:00');
      await decide(tx, f4.id, 'G1', 'rework', '2030-01-05T12:00:00', { reason: 'scope_unclear' });
      const f5 = await mkQuote(tx, { market: m, created, stage: 'INTAKE' });
      await stay(tx, f5.id, 'INTAKE', '2030-01-05T00:00:00');
      const f6 = await mkQuote(tx, { market: m, created, stage: 'INTAKE', status: 'on_hold' });
      await stay(tx, f6.id, 'INTAKE', '2030-01-05T00:00:00');
      await decide(tx, f6.id, 'G1', 'hold', '2030-01-05T12:00:00');

      expect(await intakeFirstPass(tx, filters(m))).toEqual({ resolved: 4, first_pass: 2 });
    });
  });

  it('a G2 rework (engineering sending it back) also breaks first pass', async () => {
    await scratch(async (tx) => {
      const q = await mkQuote(tx, { market: 'ZZ-FP2', created: at('2030-01-05T00:00:00') });
      await stay(tx, q.id, 'ENG_REVIEW', '2030-01-06T00:00:00', '2030-01-07T00:00:00');
      await decide(tx, q.id, 'G2', 'rework', '2030-01-07T00:00:00', {
        reason: 'wrong_specification',
      });
      expect(await intakeFirstPass(tx, filters('ZZ-FP2'))).toEqual({ resolved: 1, first_pass: 0 });
    });
  });

  it('gate compliance: a proposal is compliant only with G1–G4 all recorded', async () => {
    await scratch(async (tx) => {
      const m = 'ZZ-GC';
      const proposalAt = at('2030-01-10T00:00:00');
      const full = await mkQuote(tx, { market: m, proposalAt });
      for (const [g, o] of [
        ['G1', 'advance'],
        ['G2', 'proceed'],
        ['G3', 'submit'],
        ['G4', 'approve'],
      ] as const) {
        await decide(tx, full.id, g, o, '2030-01-09T00:00:00');
      }
      const missingG3 = await mkQuote(tx, { market: m, proposalAt });
      for (const [g, o] of [
        ['G1', 'advance'],
        ['G2', 'proceed'],
        ['G4', 'approve'],
      ] as const) {
        await decide(tx, missingG3.id, g, o, '2030-01-09T00:00:00');
      }
      // The no-G1 path (SUBMIT gate) counts as the first gate.
      const noG1 = await mkQuote(tx, { market: m, proposalAt });
      for (const [g, o] of [
        ['SUBMIT', 'submit'],
        ['G2', 'proceed'],
        ['G3', 'submit'],
        ['G4', 'approve'],
      ] as const) {
        await decide(tx, noG1.id, g, o, '2030-01-09T00:00:00');
      }
      // No proposal issued: not in the base.
      await mkQuote(tx, { market: m });
      expect(await gateCompliance(tx, filters(m))).toEqual({
        proposals: 3,
        compliant: 2,
        has_g1: 3,
        has_g2: 3,
        has_g3: 2,
        has_g4: 3,
      });
    });
  });

  it('override frequency by field and approver, against quotes created', async () => {
    await scratch(async (tx) => {
      const m = 'ZZ-OV';
      const q1 = await mkQuote(tx, { market: m, created: at('2030-01-05T00:00:00') });
      await mkQuote(tx, { market: m, created: at('2030-01-06T00:00:00') });
      const base = {
        requestedBy: KAM(),
        justification: 'because',
        createdAt: at('2030-01-07T00:00:00'),
      };
      await tx.insert(override).values([
        {
          ...base,
          quoteId: q1.id,
          field: 'priority_tier',
          requestedValue: 'HIGH',
          status: 'applied',
          decidedBy: ENG(),
        },
        {
          ...base,
          quoteId: q1.id,
          field: 'queue_position',
          requestedValue: 1,
          status: 'rejected',
          decidedBy: ENG(),
        },
        {
          ...base,
          quoteId: q1.id,
          field: 'ship_to',
          requestedValue: {},
          status: 'requested',
          approvalMode: 'self',
        },
      ]);
      const r = await overrideFrequency(tx, filters(m));
      expect(r.quotes_created).toBe(2);
      expect(r.total).toBe(3);
      expect(r.by_field.map((x) => [x.field, x.count, x.applied])).toEqual([
        ['priority_tier', 1, 1],
        ['queue_position', 1, 0],
        ['ship_to', 1, 0],
      ]);
      expect(r.by_approver.map((x) => x.count).sort()).toEqual([1, 2]);
    });
  });
});

describe('analytics views: priority, flow and pipeline', () => {
  /*
   * Time to assign by tier. Quotes enter Engineering Review 01-07 09:00.
   *   High A  assigned 01-07 21:00                                  → 12 h
   *   High B  24 h hold in the queue, assigned 01-09 09:00 (48 h)   → 24 h active
   *   Low C   assigned 01-10 09:00                                  → 72 h
   * High median = 18 h. Assign-to-G2 for A: assigned 01-07 21:00, G2 01-08 21:00 → 24 h.
   */
  it('compares time-to-assign across priority tiers with holds excluded', async () => {
    await scratch(async (tx) => {
      const m = 'ZZ-ASG';
      const mk = async (tier: string, assigned: string, holdTo?: string) => {
        const q = await mkQuote(tx, { market: m, tier, assignedAt: at(assigned) });
        await stay(tx, q.id, 'ENG_REVIEW', '2030-01-07T09:00:00');
        if (holdTo) await hold(tx, q.id, 'ENG_REVIEW', '2030-01-07T09:00:00', holdTo);
        return q;
      };
      const a = await mk('High', '2030-01-07T21:00:00');
      await decide(tx, a.id, 'G2', 'proceed', '2030-01-08T21:00:00');
      await mk('High', '2030-01-09T09:00:00', '2030-01-08T09:00:00');
      await mk('Low', '2030-01-10T09:00:00');

      const rows = await tierVsAssign(tx, filters(m));
      const high = rows.find((r) => r.tier === 'High')!;
      expect(high.n).toBe(2);
      expect(high.median_s).toBe(18 * 3600);
      expect(rows.find((r) => r.tier === 'Low')!.median_s).toBe(72 * 3600);

      const [view] = await raw<{ assign_to_g2_s: number | null }>(
        tx,
        sql`select assign_to_g2_s from analytics_assignment where quote_id = ${a.id}`,
      );
      expect(view!.assign_to_g2_s).toBe(24 * 3600);
    });
  });

  it('counts quotes created and closed per US Central week', async () => {
    await scratch(async (tx) => {
      const m = 'ZZ-FLOW';
      // Created: three in the week of Mon 01-07, one in the week of Mon 01-14.
      // The 01-07 02:00Z quote is Sunday evening in Chicago: it belongs to the week of 12-31.
      for (const d of ['2030-01-08T10:00:00', '2030-01-09T10:00:00', '2030-01-13T10:00:00']) {
        await mkQuote(tx, { market: m, created: at(d) });
      }
      await mkQuote(tx, { market: m, created: at('2030-01-15T10:00:00') });
      await mkQuote(tx, { market: m, created: at('2030-01-07T02:00:00') });
      await mkQuote(tx, {
        market: m,
        stage: 'DECLINED',
        status: 'closed',
        created: at('2030-01-08T10:00:00'),
        closedAt: at('2030-01-16T10:00:00'),
      });
      const rows = await flowWeekly(tx, filters(m));
      const byWeek = Object.fromEntries(rows.map((r) => [r.week, [r.created, r.closed]]));
      expect(byWeek['2029-12-31']).toEqual([1, 0]);
      expect(byWeek['2030-01-07']).toEqual([4, 0]); // 3 + the closed one's creation
      expect(byWeek['2030-01-14']).toEqual([1, 1]);
    });
  });

  it('reconstructs work in progress by stage at the end of each week', async () => {
    await scratch(async (tx) => {
      const m = 'ZZ-WIP';
      // W1: Engineering 01-08 → 01-16. W2: Quoting from 01-10, still open.
      // End of week 01-07 is Mon 01-14 00:00 Chicago: both are in progress.
      // End of week 01-14 is Mon 01-21: only W2 is.
      const w1 = await mkQuote(tx, { market: m });
      await stay(tx, w1.id, 'ENG_REVIEW', '2030-01-08T09:00:00', '2030-01-16T09:00:00');
      await stay(tx, w1.id, 'AWARDED', '2030-01-16T09:00:00'); // terminal: never WIP
      const w2 = await mkQuote(tx, { market: m, stage: 'QUOTING' });
      await stay(tx, w2.id, 'QUOTING', '2030-01-10T09:00:00');
      const rows = await wipWeekly(
        tx,
        filters(m, { from: at('2030-01-07T12:00:00'), to: at('2030-01-20T12:00:00') }),
        at('2030-02-01T00:00:00'),
      );
      const shape = rows.map((r) => `${r.week} ${r.stage_key} ${r.count}`);
      expect(shape).toEqual([
        '2030-01-07 ENG_REVIEW 1',
        '2030-01-07 QUOTING 1',
        '2030-01-14 QUOTING 1',
      ]);
    });
  });

  it('pipeline: open quotes by stage with the SF amount as entered, counting missing amounts', async () => {
    await scratch(async (tx) => {
      const m = 'ZZ-PIPE';
      await mkQuote(tx, { market: m, amount: 100 });
      await mkQuote(tx, { market: m, amount: null });
      await mkQuote(tx, { market: m, stage: 'QUOTING', amount: 50 });
      await mkQuote(tx, { market: m, stage: 'ENG_REVIEW', status: 'on_hold', amount: 25 });
      await mkQuote(tx, {
        market: m,
        stage: 'AWARDED',
        status: 'closed',
        outcome: 'awarded',
        amount: 999,
      });
      const rows = await pipelineByStage(tx, filters(m));
      expect(
        rows.map((r) => [r.stage_key, r.count, r.sf_amount, r.amount_missing, r.on_hold]),
      ).toEqual([
        ['ENG_REVIEW', 3, 125, 1, 1],
        ['QUOTING', 1, 50, 0, 0],
      ]);
    });
  });
});

describe('analytics views: adoption and row-level security', () => {
  it('weekly active users by role and intakes created come from the audit log', async () => {
    await scratch(async (tx) => {
      const q = await mkQuote(tx, { market: 'ZZ-AD' });
      const base = { at: at('2030-01-08T10:00:00'), actorRoles: ['KAM'] };
      await raw(
        tx,
        sql`insert into audit_event (id, at, actor_id, actor_roles, action, entity, quote_id)
            values (gen_random_uuid(), ${base.at.toISOString()}::timestamptz, ${KAM()}, ${'{KAM}'}::text[], 'create', 'quote', ${q.id}),
                   (gen_random_uuid(), ${'2030-01-09T10:00:00Z'}::timestamptz, ${KAM()}, ${'{KAM}'}::text[], 'view', 'quote', ${q.id}),
                   (gen_random_uuid(), ${'2030-01-16T10:00:00Z'}::timestamptz, ${KAM()}, ${'{KAM,SalesLeader}'}::text[], 'view', 'quote', ${q.id})`,
      );
      const r = await adoption(tx, {
        ...filters('ZZ-AD'),
        from: at('2030-01-07T12:00:00'),
        to: at('2030-01-20T12:00:00'),
      });
      const kam = r.weekly_active.filter((x) => x.role === 'KAM');
      expect(kam.map((x) => [x.week, x.users])).toEqual([
        ['2030-01-07', 1],
        ['2030-01-14', 1],
      ]);
      expect(r.weekly_active.find((x) => x.role === 'SalesLeader')?.week).toBe('2030-01-14');
      expect(r.intakes.map((x) => [x.week, x.count])).toEqual([
        ['2030-01-07', 1],
        ['2030-01-14', 0],
      ]);
    });
  });

  it('views are security_invoker: an owner-scoped KAM sees only their own quotes through them', async () => {
    const [all] = await raw<{ n: number }>(
      db as unknown as Tx,
      sql`select count(*)::int as n from analytics_quote`,
    );
    const mine = await asPersona(db, 'kam-owner', async (tx) => {
      const rows = await raw<{ kam_user_id: string }>(
        tx,
        sql`select kam_user_id from analytics_quote`,
      );
      return rows;
    });
    expect(all!.n).toBeGreaterThan(mine.length);
    expect(mine.length).toBeGreaterThan(0);
    expect(new Set(mine.map((r) => r.kam_user_id))).toEqual(new Set([persona('kam-owner').id]));
    // The stage-stay and gate-decision views follow the quote's visibility too.
    const stays = await asPersona(db, 'kam-owner', (tx) =>
      raw<{ kam_user_id: string }>(tx, sql`select distinct kam_user_id from analytics_stage_stay`),
    );
    expect(stays.map((r) => r.kam_user_id)).toEqual([persona('kam-owner').id]);
  });

  it('audit-based views show a KAM only their own activity', async () => {
    const rows = await asPersona(db, 'kam', (tx) =>
      raw<{ actor_id: string }>(
        tx,
        sql`select distinct actor_id from analytics_user_activity_weekly`,
      ),
    );
    expect(rows.every((r) => r.actor_id === persona('kam').id)).toBe(true);
  });
});
