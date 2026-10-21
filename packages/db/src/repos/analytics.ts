import { sql, type SQL } from 'drizzle-orm';

import type { DbOrTx } from '../client';

/**
 * B-17 operational analytics: one function per chart, each a thin aggregation over the
 * `analytics_*` views (`packages/db/sql/analytics/*.sql`, which hold the business definitions).
 * Everything runs in the caller's request transaction, so row-level security applies.
 *
 * Durations leave here in seconds, as the views store them; the API turns them into days. Nothing
 * in this file decides what is "good": it counts and takes medians.
 */

/** Filters shared by every chart. `from` is inclusive, `to` exclusive (instants; the API aligns them to US Central days). */
export interface AnalyticsFilters {
  from: Date;
  to: Date;
  market: readonly string[];
  productFamily: readonly string[];
  /** KAM user ids. */
  kam: readonly string[];
  region: readonly string[];
}

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const list = (xs: readonly string[]) =>
  sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  );

/** ` and market in (…) and …` for the dimensions the views share (empty when no filter is set). */
function dims(f: AnalyticsFilters): SQL {
  const parts: SQL[] = [];
  if (f.market.length) parts.push(sql`market in (${list(f.market)})`);
  if (f.productFamily.length) parts.push(sql`product_family in (${list(f.productFamily)})`);
  if (f.kam.length) parts.push(sql`kam_user_id in (${list(f.kam)})`);
  if (f.region.length) parts.push(sql`region in (${list(f.region)})`);
  return parts.length ? sql` and ${sql.join(parts, sql` and `)}` : sql``;
}

async function rows<T extends object>(db: DbOrTx, query: SQL): Promise<T[]> {
  return [...(await db.execute<Record<string, unknown>>(query))] as T[];
}

/** Quartile summary of a duration column, in seconds. */
const median = (col: SQL) => sql`percentile_cont(0.5) within group (order by ${col})::float8`;
const p75 = (col: SQL) => sql`percentile_cont(0.75) within group (order by ${col})::float8`;

// ── Pipeline ───────────────────────────────────────────────────────────────────────────────────

export interface PipelineStageRow {
  stage_key: string;
  stage_label: string;
  stage_sort: number;
  count: number;
  /** Sum of the Salesforce opportunity amounts as entered; null amounts count as 0. */
  sf_amount: number;
  /** Quotes in the stage whose SF amount is missing or 0. */
  amount_missing: number;
  on_hold: number;
}

/** Open quotes by stage right now. The date range does not apply (it is a snapshot). */
export function pipelineByStage(db: DbOrTx, f: AnalyticsFilters): Promise<PipelineStageRow[]> {
  return rows(
    db,
    sql`
    select stage_key, stage_label, stage_sort,
      count(*)::int as count,
      coalesce(sum(sf_amount), 0)::float8 as sf_amount,
      count(*) filter (where coalesce(sf_amount, 0) = 0)::int as amount_missing,
      count(*) filter (where status = 'on_hold')::int as on_hold
    from analytics_quote
    where status <> 'closed' and not is_terminal ${dims(f)}
    group by stage_key, stage_label, stage_sort
    order by stage_sort`,
  );
}

// ── Cycle time ─────────────────────────────────────────────────────────────────────────────────

export interface CycleStageRow {
  stage_key: string;
  stage_label: string;
  stage_sort: number;
  n: number;
  median_active_s: number;
  p75_active_s: number;
  /** Median wall-clock time, so the effect of holds is visible next to it. */
  median_elapsed_s: number;
  /** Stays in the sample that included recorded hold time. */
  held_stays: number;
}

/** Completed stays that exited inside the window, by stage. */
export function cycleByStage(db: DbOrTx, f: AnalyticsFilters): Promise<CycleStageRow[]> {
  return rows(
    db,
    sql`
    select stage_key, stage_label, stage_sort,
      count(*)::int as n,
      ${median(sql`active_s`)} as median_active_s,
      ${p75(sql`active_s`)} as p75_active_s,
      ${median(sql`elapsed_s`)} as median_elapsed_s,
      count(*) filter (where held_s > 0)::int as held_stays
    from analytics_stage_stay
    where not is_open and not is_terminal
      and exited_at >= ${ts(f.from)} and exited_at < ${ts(f.to)} ${dims(f)}
    group by stage_key, stage_label, stage_sort
    order by stage_sort`,
  );
}

export interface CycleWeekRow {
  week: string;
  n: number;
  median_active_s: number;
  p75_active_s: number;
}

/** End-to-end intake → G4 approve, by the week of release. */
export function cycleEndToEndWeekly(db: DbOrTx, f: AnalyticsFilters): Promise<CycleWeekRow[]> {
  return rows(
    db,
    sql`
    select to_char(analytics_week(released_at), 'YYYY-MM-DD') as week,
      count(*)::int as n,
      ${median(sql`active_s`)} as median_active_s,
      ${p75(sql`active_s`)} as p75_active_s
    from analytics_quote_cycle
    where released_at >= ${ts(f.from)} and released_at < ${ts(f.to)} ${dims(f)}
    group by 1 order by 1`,
  );
}

export interface CycleTotalRow {
  n: number;
  median_active_s: number | null;
  p75_active_s: number | null;
  median_elapsed_s: number | null;
}

export async function cycleEndToEndTotal(db: DbOrTx, f: AnalyticsFilters): Promise<CycleTotalRow> {
  const [row] = await rows<CycleTotalRow>(
    db,
    sql`
    select count(*)::int as n,
      ${median(sql`active_s`)} as median_active_s,
      ${p75(sql`active_s`)} as p75_active_s,
      ${median(sql`elapsed_s`)} as median_elapsed_s
    from analytics_quote_cycle
    where released_at >= ${ts(f.from)} and released_at < ${ts(f.to)} ${dims(f)}`,
  );
  return row ?? { n: 0, median_active_s: null, p75_active_s: null, median_elapsed_s: null };
}

// ── Flow ───────────────────────────────────────────────────────────────────────────────────────

const weeksCte = (f: AnalyticsFilters) => sql`
  weeks as (
    select generate_series(
      analytics_week(${ts(f.from)}), analytics_week(${ts(f.to)} - interval '1 second'), interval '7 days'
    )::date as week
  )`;

export interface FlowWeekRow {
  week: string;
  created: number;
  closed: number;
}

/** Quotes created vs closed (any outcome) per week. */
export function flowWeekly(db: DbOrTx, f: AnalyticsFilters): Promise<FlowWeekRow[]> {
  return rows(
    db,
    sql`
    with ${weeksCte(f)}
    select to_char(w.week, 'YYYY-MM-DD') as week,
      coalesce(c.n, 0)::int as created, coalesce(x.n, 0)::int as closed
    from weeks w
    left join (
      select analytics_week(created_at) as wk, count(*) as n from analytics_quote
      where created_at >= ${ts(f.from)} and created_at < ${ts(f.to)} ${dims(f)} group by 1
    ) c on c.wk = w.week
    left join (
      select analytics_week(closed_at) as wk, count(*) as n from analytics_quote
      where closed_at >= ${ts(f.from)} and closed_at < ${ts(f.to)} ${dims(f)} group by 1
    ) x on x.wk = w.week
    order by w.week`,
  );
}

export interface WipWeekRow {
  week: string;
  stage_key: string;
  stage_label: string;
  stage_sort: number;
  count: number;
}

/**
 * Work in progress by stage at the end of each week (the end of the current week is `asOf`).
 * A quote on hold is still work in progress; terminal stages are not.
 */
export function wipWeekly(db: DbOrTx, f: AnalyticsFilters, asOf: Date): Promise<WipWeekRow[]> {
  return rows(
    db,
    sql`
    with ${weeksCte(f)},
    bounds as (
      select week,
        least(((week + 7)::timestamp at time zone 'America/Chicago'), ${ts(asOf)}) as at
      from weeks
    )
    select to_char(b.week, 'YYYY-MM-DD') as week, s.stage_key, s.stage_label, s.stage_sort,
      count(*)::int as count
    from bounds b
    join analytics_stage_stay s
      on s.entered_at < b.at and (s.exited_at is null or s.exited_at >= b.at)
    where not s.is_terminal ${dims(f)}
    group by b.week, s.stage_key, s.stage_label, s.stage_sort
    order by b.week, s.stage_sort`,
  );
}

// ── Outcomes ───────────────────────────────────────────────────────────────────────────────────

/** Dimensions the outcome metrics can be split by (a whitelist: the column name is spliced into SQL). */
export const OUTCOME_DIMENSIONS = {
  total: null,
  market: 'market',
  productFamily: 'product_family',
  kam: 'kam_user_id::text',
} as const;
export type OutcomeDimension = keyof typeof OUTCOME_DIMENSIONS;

export interface OutcomeRow {
  key: string | null;
  /** Display name when the key is an id (the KAM split); otherwise null (the API labels value-list codes). */
  label: string | null;
  awarded: number;
  lost: number;
  expired: number;
  /** Open in Customer Decision, validity not yet passed. */
  awaiting: number;
  /** Open in Customer Decision, validity passed, no outcome recorded. */
  gone_dark: number;
  awarded_amount: number;
  lost_amount: number;
}

/**
 * The proposal cohort (proposals issued in the window) by outcome, optionally split by a dimension.
 * `asOf` decides whether an open proposal is awaiting or gone dark (validity vs today, US Central).
 */
export function outcomeCohort(
  db: DbOrTx,
  f: AnalyticsFilters,
  dimension: OutcomeDimension,
  asOf: Date,
): Promise<OutcomeRow[]> {
  const col = OUTCOME_DIMENSIONS[dimension];
  const key = col ? sql.raw(col) : sql`null::text`;
  const label = dimension === 'kam' ? sql`max(kam_name)` : sql`null::text`;
  const today = sql`(${ts(asOf)} at time zone 'America/Chicago')::date`;
  return rows(
    db,
    sql`
    select ${key} as key, ${label} as label,
      count(*) filter (where customer_outcome = 'awarded')::int as awarded,
      count(*) filter (where customer_outcome = 'lost')::int as lost,
      count(*) filter (where customer_outcome = 'expired')::int as expired,
      count(*) filter (where outcome_state = 'open'
        and (validity_until is null or validity_until >= ${today}))::int as awaiting,
      count(*) filter (where outcome_state = 'open' and validity_until < ${today})::int as gone_dark,
      coalesce(sum(sf_amount) filter (where customer_outcome = 'awarded'), 0)::float8 as awarded_amount,
      coalesce(sum(sf_amount) filter (where customer_outcome = 'lost'), 0)::float8 as lost_amount
    from analytics_quote
    where outcome_state is not null
      and outcome_cohort_at >= ${ts(f.from)} and outcome_cohort_at < ${ts(f.to)} ${dims(f)}
    group by 1
    order by 1 nulls first`,
  );
}

export interface LossReasonRow {
  code: string | null;
  label: string;
  count: number;
  amount: number;
}

/** Lost quotes in the proposal cohort by reason, biggest first (the Pareto). */
export function lossReasons(db: DbOrTx, f: AnalyticsFilters): Promise<LossReasonRow[]> {
  return rows(
    db,
    sql`
    select q.outcome_reason_code as code,
      coalesce(rc.label, q.outcome_reason_code, 'No reason recorded') as label,
      count(*)::int as count,
      coalesce(sum(q.sf_amount), 0)::float8 as amount
    from analytics_quote q
    left join reason_code rc on rc.context = 'lost' and rc.code = q.outcome_reason_code
    where q.outcome = 'lost'
      and q.outcome_cohort_at >= ${ts(f.from)} and q.outcome_cohort_at < ${ts(f.to)} ${dims(f)}
    group by q.outcome_reason_code, rc.label
    order by count desc, label`,
  );
}

// ── Quality and governance ─────────────────────────────────────────────────────────────────────

export async function intakeFirstPass(
  db: DbOrTx,
  f: AnalyticsFilters,
): Promise<{ resolved: number; first_pass: number }> {
  const [row] = await rows<{ resolved: number; first_pass: number }>(
    db,
    sql`
    select count(*)::int as resolved, count(*) filter (where first_pass)::int as first_pass
    from analytics_intake_first_pass
    where created_at >= ${ts(f.from)} and created_at < ${ts(f.to)} ${dims(f)}`,
  );
  return row ?? { resolved: 0, first_pass: 0 };
}

export interface ReworkReasonRow {
  gate_key: string;
  code: string | null;
  label: string;
  count: number;
}

/** Why work went back to the KAM (G1 / G2 Rework), most common first. */
export function reworkReasons(
  db: DbOrTx,
  f: AnalyticsFilters,
  gateKeys: readonly string[],
  limit: number,
): Promise<ReworkReasonRow[]> {
  return rows(
    db,
    sql`
    select g.gate_key, g.reason_code as code,
      coalesce(rc.label, g.reason_code, 'No reason recorded') as label,
      count(*)::int as count
    from analytics_gate_decision g
    left join reason_code rc on rc.context = 'rework' and rc.code = g.reason_code
    where g.outcome_key = 'rework' and g.gate_key in (${list(gateKeys)})
      and g.decided_at >= ${ts(f.from)} and g.decided_at < ${ts(f.to)} ${dims(f)}
    group by g.gate_key, g.reason_code, rc.label
    order by count desc, label
    limit ${limit}`,
  );
}

export interface G1YieldRow {
  outcome_key: string;
  label: string;
  count: number;
}

/** G1 decisions by outcome. */
export function g1Yield(db: DbOrTx, f: AnalyticsFilters): Promise<G1YieldRow[]> {
  return rows(
    db,
    sql`
    select g.outcome_key, coalesce(od.label, g.outcome_key) as label, count(*)::int as count
    from analytics_gate_decision g
    left join gate_outcome_definition od on od.gate_key = g.gate_key and od.key = g.outcome_key
    where g.gate_key = 'G1'
      and g.decided_at >= ${ts(f.from)} and g.decided_at < ${ts(f.to)} ${dims(f)}
    group by g.outcome_key, od.label, od.sort
    order by od.sort nulls last, g.outcome_key`,
  );
}

export interface OverrideFrequencyRows {
  quotes_created: number;
  total: number;
  by_field: { field: string; count: number; applied: number }[];
  by_approver: { approver: string; count: number }[];
}

export async function overrideFrequency(
  db: DbOrTx,
  f: AnalyticsFilters,
): Promise<OverrideFrequencyRows> {
  const range = sql`requested_at >= ${ts(f.from)} and requested_at < ${ts(f.to)} ${dims(f)}`;
  const [byField, byApprover, created] = await Promise.all([
    rows<{ field: string; count: number; applied: number }>(
      db,
      sql`select field, count(*)::int as count,
            count(*) filter (where status in ('applied', 'approved'))::int as applied
          from analytics_override where ${range} group by field order by count desc, field`,
    ),
    rows<{ approver: string; count: number }>(
      db,
      sql`select coalesce(decided_by_name, 'Not decided yet') as approver, count(*)::int as count
          from analytics_override where ${range}
          group by 1 order by count desc, approver`,
    ),
    rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from analytics_quote
          where created_at >= ${ts(f.from)} and created_at < ${ts(f.to)} ${dims(f)}`,
    ),
  ]);
  return {
    quotes_created: created[0]?.n ?? 0,
    total: byField.reduce((n, r) => n + r.count, 0),
    by_field: byField,
    by_approver: byApprover,
  };
}

export interface GateComplianceRow {
  proposals: number;
  compliant: number;
  has_g1: number;
  has_g2: number;
  has_g3: number;
  has_g4: number;
}

export async function gateCompliance(db: DbOrTx, f: AnalyticsFilters): Promise<GateComplianceRow> {
  const [row] = await rows<GateComplianceRow>(
    db,
    sql`
    select count(*)::int as proposals,
      count(*) filter (where has_g1 and has_g2 and has_g3 and has_g4)::int as compliant,
      count(*) filter (where has_g1)::int as has_g1,
      count(*) filter (where has_g2)::int as has_g2,
      count(*) filter (where has_g3)::int as has_g3,
      count(*) filter (where has_g4)::int as has_g4
    from analytics_gate_compliance
    where proposal_issued_at >= ${ts(f.from)} and proposal_issued_at < ${ts(f.to)} ${dims(f)}`,
  );
  return row ?? { proposals: 0, compliant: 0, has_g1: 0, has_g2: 0, has_g3: 0, has_g4: 0 };
}

// ── Priority ───────────────────────────────────────────────────────────────────────────────────

export function tierCounts(
  db: DbOrTx,
  f: AnalyticsFilters,
): Promise<{ tier: string | null; count: number }[]> {
  return rows(
    db,
    sql`select priority_tier as tier, count(*)::int as count from analytics_quote
        where created_at >= ${ts(f.from)} and created_at < ${ts(f.to)} ${dims(f)}
        group by priority_tier`,
  );
}

export interface TierAssignRow {
  tier: string | null;
  n: number;
  median_s: number;
  p75_s: number;
}

/** Time from entering the engineering queue to assignment, by priority tier. */
export function tierVsAssign(db: DbOrTx, f: AnalyticsFilters): Promise<TierAssignRow[]> {
  return rows(
    db,
    sql`
    select priority_tier as tier, count(*)::int as n,
      ${median(sql`time_to_assign_s`)} as median_s, ${p75(sql`time_to_assign_s`)} as p75_s
    from analytics_assignment
    where assigned_at >= ${ts(f.from)} and assigned_at < ${ts(f.to)} ${dims(f)}
    group by priority_tier`,
  );
}

// ── Adoption ───────────────────────────────────────────────────────────────────────────────────

export interface AdoptionRows {
  weekly_active: { week: string; role: string; users: number }[];
  intakes: { week: string; count: number }[];
}

export async function adoption(db: DbOrTx, f: AnalyticsFilters): Promise<AdoptionRows> {
  const [weeklyActive, intakes] = await Promise.all([
    rows<{ week: string; role: string; users: number }>(
      db,
      sql`
      with ${weeksCte(f)}
      select to_char(a.week, 'YYYY-MM-DD') as week, a.role, count(distinct a.actor_id)::int as users
      from analytics_user_activity_weekly a join weeks w on w.week = a.week
      group by a.week, a.role order by a.week, a.role`,
    ),
    rows<{ week: string; count: number }>(
      db,
      sql`
      with ${weeksCte(f)}
      select to_char(w.week, 'YYYY-MM-DD') as week, count(i.at)::int as count
      from weeks w left join analytics_intake_created i on i.week = w.week
      group by w.week order by w.week`,
    ),
  ]);
  return { weekly_active: weeklyActive, intakes };
}

/** Non-terminal stages in board order: the series of the WIP chart. */
export function openStages(db: DbOrTx): Promise<{ key: string; label: string; sort: number }[]> {
  return rows(
    db,
    sql`select key, label, sort from stage_definition where not terminal order by sort`,
  );
}

/** Value-list labels for a list key (market, product_family), by code. */
export async function valueLabels(db: DbOrTx, listKey: string): Promise<Record<string, string>> {
  const found = await rows<{ code: string; label: string }>(
    db,
    sql`select code, label from value_list where list_key = ${listKey}`,
  );
  return Object.fromEntries(found.map((r) => [r.code, r.label]));
}

// ── Filter options ─────────────────────────────────────────────────────────────────────────────

/** Distinct values present on quotes, so the filter bar offers what exists. */
export async function filterOptions(db: DbOrTx) {
  const [markets, families, regions, kams] = await Promise.all([
    rows<{ v: string }>(
      db,
      sql`select distinct market as v from analytics_quote where market is not null order by 1`,
    ),
    rows<{ v: string }>(
      db,
      sql`select distinct product_family as v from analytics_quote where product_family is not null order by 1`,
    ),
    rows<{ v: string }>(
      db,
      sql`select distinct region as v from analytics_quote where region is not null order by 1`,
    ),
    rows<{ id: string; name: string }>(
      db,
      sql`select distinct kam_user_id as id, kam_name as name from analytics_quote order by 2`,
    ),
  ]);
  return {
    markets: markets.map((r) => r.v),
    productFamilies: families.map((r) => r.v),
    regions: regions.map((r) => r.v),
    kams,
  };
}
