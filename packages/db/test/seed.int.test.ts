import { PERMISSION_MATRIX, hybridConfig, parseWorkflowConfig } from '@ccq/domain';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import { seedConfig } from '../seeds/config/index';
import { QUOTE_STAGE_TARGETS, SF_STAGE_COUNTS, seedSynthetic } from '../seeds/synthetic/index';
import { getSetting, loadWorkflowConfigInput } from '../src/repos/index';
import { appSetting, valueList } from '../src/schema/index';

const { db } = testDb();
const q = <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  raw<R>(db as never, query);
const count = async (table: string, where = sql`true`) =>
  Number(
    (
      await q<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`,
      )
    )[0]!.n,
  );

describe('config seeds', () => {
  it('the DB workflow is exactly the domain hybrid model (single source)', async () => {
    const fromDb = parseWorkflowConfig(await loadWorkflowConfigInput(db));
    const sortKeys = <T extends Record<string, unknown>>(xs: T[], key: (x: T) => string) =>
      [...xs].sort((a, b) => key(a).localeCompare(key(b)));
    expect(fromDb.stages).toEqual(hybridConfig.stages);
    expect(fromDb.gates).toEqual(hybridConfig.gates);
    expect(fromDb.outcomes).toEqual(hybridConfig.outcomes);
    expect(sortKeys(fromDb.transitions, (t) => t.gateKey + t.outcomeKey)).toEqual(
      sortKeys(hybridConfig.transitions, (t) => t.gateKey + t.outcomeKey),
    );
    expect(sortKeys(fromDb.reasonCodes, (r) => r.context + r.code)).toEqual(
      sortKeys(hybridConfig.reasonCodes, (r) => r.context + r.code),
    );
    expect(sortKeys(fromDb.segregation, (r) => r.id)).toEqual(
      sortKeys(hybridConfig.segregation, (r) => r.id),
    );
  });

  it('role_permission mirrors the policy matrix, qualifiers included', async () => {
    const expected = Object.values(PERMISSION_MATRIX).reduce(
      (n, grants) => n + Object.keys(grants).length,
      0,
    );
    expect(await count('role_permission')).toBe(expected);
    const [row] = await q<{ qualifier: unknown }>(
      sql`select qualifier from role_permission where role = 'Engineer' and permission = 'engReview.edit'`,
    );
    expect(row!.qualifier).toEqual({ kind: 'assigned' });
  });

  it('value lists match the ERF template counts', async () => {
    const rows = await q<{ list_key: string; n: number }>(
      sql`select list_key, count(*)::int as n from value_list group by 1`,
    );
    const counts = Object.fromEntries(rows.map((r) => [r.list_key, r.n]));
    expect(counts).toMatchObject({
      process_type: 8,
      resin: 11,
      market: 8,
      product_family: 7,
      component: 5,
      request_class: 4,
      drawing_status: 4,
      packaging_type: 5,
      plant: 3,
    });
    const [other] = await q<{ meta: unknown }>(
      sql`select meta from value_list where list_key = 'neck_finish' and code = 'OTHER'`,
    );
    expect(other!.meta).toEqual({ freeText: true });
  });

  it('settings, scoring v1 and sf_stage_map are seeded', async () => {
    expect(await getSetting(db, 'validity_days_default')).toBe(30);
    expect(await getSetting(db, 'g1_enabled')).toBe(true);
    expect(await getSetting(db, 'min_opportunity_value_warning_usd')).toBeNull();
    expect(await getSetting(db, 'min_volume_warning_by_process')).toEqual({});
    expect(await getSetting(db, 'sla_hours_by_stage')).toBeNull();
    expect(await getSetting(db, 'kam_can_see_peer_scores')).toBe(true);
    const [model] = await q<{
      attributes: { key: string; weight: number }[];
      tier_thresholds: unknown;
    }>(sql`select attributes, tier_thresholds from scoring_model where model_version = 1`);
    expect(model!.attributes.map((a) => a.key)).toEqual([
      'revenue',
      'volume',
      'strategic_fit',
      'capital_exposure',
      'customer_risk',
      'product_fit',
      'timing',
    ]);
    // Provisional PRD weights (D-19) that sum to 1; the row parses back into the domain model.
    expect(model!.attributes.reduce((n, a) => n + a.weight, 0)).toBeCloseTo(1, 6);
    expect(await getSetting(db, 'qualification_exception_note_outcomes')).toEqual(['G1:advance']);
    expect(await count('sf_stage_map')).toBe(8);
    const [lostOther] = await q<{ requires_note: boolean }>(
      sql`select requires_note from reason_code where context = 'lost' and code = 'other'`,
    );
    expect(lostOther!.requires_note).toBe(true);
  });

  it('every config row is provisional', async () => {
    for (const table of [
      'stage_definition',
      'gate_definition',
      'gate_outcome_definition',
      'transition_rule',
      'segregation_rule',
      'reason_code',
      'role_permission',
      'value_list',
      'app_setting',
      'scoring_model',
      'sf_stage_map',
    ]) {
      expect(await count(table, sql`provisional = false`), table).toBe(0);
    }
  });

  it('re-running is idempotent and never overwrites an approved value', async () => {
    const tables = [
      'stage_definition',
      'gate_outcome_definition',
      'reason_code',
      'role_permission',
      'value_list',
      'app_setting',
    ];
    const before = await Promise.all(tables.map((t) => count(t)));
    await db
      .transaction(async (tx) => {
        await tx
          .update(appSetting)
          .set({ value: 45, provisional: false, approvedAt: new Date() })
          .where(eq(appSetting.key, 'validity_days_default'));
        await tx
          .update(valueList)
          .set({ label: 'Edited while provisional' })
          .where(eq(valueList.code, 'HDPE'));
        await seedConfig(tx);
        expect(await Promise.all(tables.map((t) => count(t)))).toEqual(before);
        expect(await getSetting(tx, 'validity_days_default')).toBe(45); // approved: kept
        const [hdpe] = await tx.select().from(valueList).where(eq(valueList.code, 'HDPE'));
        expect(hdpe!.label).toBe('HDPE'); // provisional: refreshed from the seed
        tx.rollback();
      })
      .catch((err: Error) => {
        if (!/rollback/i.test(err.message)) throw err;
      });
  });
});

describe('synthetic data', () => {
  it('has 12 users, ~70 customers (some not yet established) and 102 opportunities in the report mix', async () => {
    expect(await count('app_user')).toBe(12);
    expect(await count('customer')).toBe(70);
    expect(
      await count('customer', sql`status = 'not_yet_established' and sf_account_id is null`),
    ).toBeGreaterThan(0);
    const rows = await q<{ sf_stage: string; n: number }>(
      sql`select sf_stage, count(*)::int as n from sf_opportunity_snapshot group by 1`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.sf_stage, r.n]))).toEqual(
      Object.fromEntries(SF_STAGE_COUNTS),
    );
    const [range] = await q<{ lo: number; hi: number }>(
      sql`select min(amount)::float as lo, max(amount)::float as hi from sf_opportunity_snapshot`,
    );
    expect(range!.lo).toBeGreaterThanOrEqual(1_000);
    expect(range!.hi).toBeLessThanOrEqual(1_400_000);
    const [bad] = await q<{ n: number }>(
      sql`select count(*)::int as n from sf_opportunity_snapshot where name !~ '^.+ / .+ / [0-9]+oz .+$'`,
    );
    expect(bad!.n).toBe(0);
  });

  it('has 150 quotes across every stage', async () => {
    const rows = await q<{ stage_key: string; n: number }>(
      sql`select stage_key, count(*)::int as n from quote group by 1`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.stage_key, r.n]))).toEqual(
      Object.fromEntries(QUOTE_STAGE_TARGETS),
    );
    expect(new Set(rows.map((r) => r.stage_key))).toEqual(
      new Set(hybridConfig.stages.map((s) => s.key)),
    );
  });

  it('every quote carries an engine score; G1 rework quotes are back with the KAM', async () => {
    const tiers = await q<{ priority_tier: string; n: number }>(
      sql`select priority_tier, count(*)::int as n from quote
          where priority_score is null or scoring_model_version is distinct from 1 group by 1`,
    );
    expect(tiers).toEqual([]);
    const keys = await q<{ priority_tier: string }>(sql`select distinct priority_tier from quote`);
    for (const k of keys)
      expect(['CRITICAL', 'HIGH', 'STANDARD', 'LOW']).toContain(k.priority_tier);
    // 3 INTAKE quotes were reworked at G1 and not resubmitted: submitted_at is cleared.
    expect(
      await count('quote', sql`stage_key = 'INTAKE' and submitted_at is null and version = 2`),
    ).toBe(3);
    expect(await count('quote', sql`submitted_at is null and stage_key <> 'INTAKE'`)).toBe(0);
  });

  it('history is consistent with each quote’s current state', async () => {
    // Exactly one open stage_history row, matching the quote's stage.
    const [mismatch] = await q<{ n: number }>(sql`
      select count(*)::int as n from quote q
      where (select count(*) from stage_history h where h.quote_id = q.id and h.exited_at is null) <> 1
         or (select h.stage_key from stage_history h where h.quote_id = q.id and h.exited_at is null) <> q.stage_key`);
    expect(mismatch!.n).toBe(0);
    // On-hold quotes have one open hold; others none.
    const [holds] = await q<{ n: number }>(sql`
      select count(*)::int as n from quote q
      where (q.status = 'on_hold') <> exists (select 1 from quote_hold h where h.quote_id = q.id and h.ended_at is null)`);
    expect(holds!.n).toBe(0);
    // Closed quotes carry outcome, closure owner and date (CR-39); reason codes on all but awarded.
    expect(
      await count(
        'quote',
        sql`status = 'closed' and (outcome is null or closure_owner_id is null or closed_at is null)`,
      ),
    ).toBe(0);
    expect(
      await count(
        'quote',
        sql`status = 'closed' and outcome <> 'awarded' and outcome_reason_code is null`,
      ),
    ).toBe(0);
    // Version bumps are explained by return/rework/requote decisions.
    expect(await count('quote', sql`version > 1`)).toBeGreaterThan(0);
    // Every stage move left a gate decision, activity and audit trail.
    expect(await count('gate_decision')).toBeGreaterThan(300);
    expect(
      await count(
        'quote',
        sql`not exists (select 1 from audit_event a where a.quote_id = quote.id and a.action = 'create')`,
      ),
    ).toBe(0);
    // Awarded quotes have a hand-off record; quotes past G2 have capacity evidence.
    expect(
      await count(
        'quote',
        sql`stage_key = 'AWARDED' and not exists (select 1 from handoff_record h where h.quote_id = quote.id)`,
      ),
    ).toBe(0);
    expect(
      await count(
        'quote',
        sql`stage_key in ('QUOTING','FINAL_REVIEW','CUSTOMER_DECISION','AWARDED') and not exists (select 1 from capacity_evidence c where c.quote_id = quote.id)`,
      ),
    ).toBe(0);
    // Extras exist: overrides, holds and returns, attachments (metadata only).
    expect(await count('override')).toBeGreaterThan(5);
    expect(
      await count('gate_decision', sql`outcome_key in ('return','rework','requote')`),
    ).toBeGreaterThan(5);
    expect(await count('attachment', sql`sp_item_id is not null`)).toBe(0);
    // Quote numbers are chronological.
    const [order] = await q<{ n: number }>(
      sql`select count(*)::int as n from (select created_at, lag(created_at) over (order by quote_number) prev from quote) x where created_at < prev`,
    );
    expect(order!.n).toBe(0);
  });

  it('a re-run is a no-op', async () => {
    const before = await count('gate_decision');
    const result = await db.transaction((tx) => seedSynthetic(tx));
    expect(result.quotes).toBe('already-present');
    expect(await count('gate_decision')).toBe(before);
    expect(await count('app_user')).toBe(12);
  });
});
