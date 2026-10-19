import { sql, type SQL } from 'drizzle-orm';

import type { DbOrTx } from '../client';

/**
 * B-17 role dashboards (F-02): the rows behind each role's landing page. Row-level security applies
 * (the caller's quote scope); the filters here say what the dashboard is *about* (my quotes, the
 * G1 queue, …). Counting, aging and labelling are the API service's job.
 */

export interface DashboardQuoteRow {
  quote_id: string;
  quote_number: string;
  account: string;
  stage_key: string;
  stage_label: string;
  stage_sort: number;
  status: string;
  version: number;
  priority_tier: string | null;
  kam_user_id: string;
  kam_name: string | null;
  assigned_engineer_id: string | null;
  engineer_name: string | null;
  /** YYYY-MM-DD */
  /** Salesforce opportunity amount as entered. */
  sf_amount: number | null;
  validity_until: string | null;
  submitted_at: Date | null;
  /** When the current stage stay began (holds included in the age). */
  stage_entered_at: Date | null;
}

/**
 * Postgres timestamptz text ("2026-10-01 12:00:00.5+00") as a Date. drizzle's raw `execute` hands
 * timestamps back as strings, so the rows below convert the ones typed `Date` here.
 */
function pgDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v !== 'string') return null;
  const text = v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  return new Date(text);
}

async function rows<T extends object>(
  db: DbOrTx,
  query: SQL,
  dateKeys: readonly string[] = [],
): Promise<T[]> {
  const found = [...(await db.execute<Record<string, unknown>>(query))];
  for (const row of found) for (const k of dateKeys) row[k] = pgDate(row[k]);
  return found as T[];
}

const quoteRows = (db: DbOrTx, where: SQL, order: SQL = sql`st.entered_at nulls last`) =>
  rows<DashboardQuoteRow>(
    db,
    sql`
    select q.id as quote_id, q.quote_number,
      coalesce(c.name, 'Unknown customer') as account,
      q.stage_key, coalesce(sd.label, q.stage_key) as stage_label, coalesce(sd.sort, 0) as stage_sort,
      q.status, q.version, q.priority_tier,
      q.kam_user_id, k.display_name as kam_name,
      q.assigned_engineer_id, e.display_name as engineer_name,
      so.amount::float8 as sf_amount,
      to_char(q.validity_until, 'YYYY-MM-DD') as validity_until,
      q.submitted_at, st.entered_at as stage_entered_at
    from quote q
    left join customer c on c.id = q.customer_id
    left join app_user k on k.id = q.kam_user_id
    left join app_user e on e.id = q.assigned_engineer_id
    left join sf_opportunity_snapshot so on so.sf_opportunity_id = q.sf_opportunity_id
    left join stage_definition sd on sd.key = q.stage_key
    left join lateral (
      select sh.entered_at from stage_history sh
      where sh.quote_id = q.id and sh.exited_at is null order by sh.entered_at desc limit 1
    ) st on true
    where ${where}
    order by ${order}`,
    ['submitted_at', 'stage_entered_at'],
  );

const todayChicago = (asOf: Date) =>
  sql`(${asOf.toISOString()}::timestamptz at time zone 'America/Chicago')::date`;

// ── KAM ────────────────────────────────────────────────────────────────────────────────────────

export interface DraftRow {
  draft_id: string;
  step: number;
  updated_at: Date;
  opportunity: string | null;
  rework_of_quote_number: string | null;
}

/** The caller's unsubmitted intake drafts, most recently touched first. */
export function openDrafts(db: DbOrTx, userId: string): Promise<DraftRow[]> {
  return rows(
    db,
    sql`
    select d.id as draft_id, d.step, d.updated_at,
      coalesce(o.name, d.data ->> 'description') as opportunity,
      rq.quote_number as rework_of_quote_number
    from quote_draft d
    left join sf_opportunity_snapshot o on o.sf_opportunity_id = d.sf_opportunity_id
    left join quote rq on rq.id = d.rework_of_quote_id
    where d.owner_user_id = ${userId} and d.submitted_quote_id is null
    order by d.updated_at desc
    limit 20`,
    ['updated_at'],
  );
}

export interface ReturnedRow extends DashboardQuoteRow {
  gate_key: string | null;
  reason_code: string | null;
  reason_label: string | null;
  note: string | null;
  returned_at: Date | null;
  returned_by: string | null;
  draft_id: string | null;
}

/**
 * Quotes sent back to the KAM (a G1 / G2 Rework puts the quote back in Intake with `submitted_at`
 * cleared), each with the latest rework decision's reason and note, and the rework draft if started.
 */
export function returnedToKam(db: DbOrTx, userId: string): Promise<ReturnedRow[]> {
  return rows(
    db,
    sql`
    select q.id as quote_id, q.quote_number,
      coalesce(c.name, 'Unknown customer') as account,
      q.stage_key, coalesce(sd.label, q.stage_key) as stage_label, coalesce(sd.sort, 0) as stage_sort,
      q.status, q.version, q.priority_tier,
      q.kam_user_id, k.display_name as kam_name,
      q.assigned_engineer_id, null::text as engineer_name,
      null::float8 as sf_amount,
      to_char(q.validity_until, 'YYYY-MM-DD') as validity_until,
      q.submitted_at, st.entered_at as stage_entered_at,
      g.gate_key, g.reason_code, rc.label as reason_label, g.note,
      g.decided_at as returned_at, gu.display_name as returned_by,
      d.id as draft_id
    from quote q
    left join customer c on c.id = q.customer_id
    left join app_user k on k.id = q.kam_user_id
    left join stage_definition sd on sd.key = q.stage_key
    left join lateral (
      select sh.entered_at from stage_history sh
      where sh.quote_id = q.id and sh.exited_at is null order by sh.entered_at desc limit 1
    ) st on true
    left join lateral (
      select gd.* from gate_decision gd
      where gd.quote_id = q.id and gd.outcome_key = 'rework' and gd.gate_key in ('G1', 'G2')
      order by gd.decided_at desc limit 1
    ) g on true
    left join reason_code rc on rc.context = 'rework' and rc.code = g.reason_code
    left join app_user gu on gu.id = g.decided_by
    left join quote_draft d on d.rework_of_quote_id = q.id and d.submitted_quote_id is null
    where q.kam_user_id = ${userId} and q.stage_key = 'INTAKE' and q.status = 'active'
      and q.submitted_at is null
    order by g.decided_at desc nulls last`,
    ['submitted_at', 'stage_entered_at', 'returned_at'],
  );
}

/** The caller's open (not closed) quotes. */
export function myOpenQuotes(db: DbOrTx, userId: string) {
  return quoteRows(db, sql`q.kam_user_id = ${userId} and q.status <> 'closed'`);
}

/**
 * Proposals waiting for the customer whose validity ends on or before `today + withinDays`
 * (lapsed ones included: their `validity_until` is in the past). `kamUserId` narrows to one KAM.
 */
export function proposalsEndingBy(db: DbOrTx, asOf: Date, withinDays: number, kamUserId?: string) {
  return quoteRows(
    db,
    sql`q.stage_key = 'CUSTOMER_DECISION' and q.status <> 'closed'
      and q.validity_until is not null
      and q.validity_until <= ${todayChicago(asOf)} + ${withinDays}::int
      ${kamUserId ? sql`and q.kam_user_id = ${kamUserId}` : sql``}`,
    sql`q.validity_until, q.quote_number`,
  );
}

// ── Sales leader ───────────────────────────────────────────────────────────────────────────────

/** Submitted intakes waiting for the G1 decision, oldest first. */
export function awaitingG1(db: DbOrTx) {
  return quoteRows(
    db,
    sql`q.stage_key = 'INTAKE' and q.status = 'active' and q.submitted_at is not null`,
    sql`q.submitted_at, q.quote_number`,
  );
}

export interface PendingOverrideRow {
  override_id: string;
  quote_number: string;
  field: string;
  requested_by: string | null;
  requested_at: Date;
  justification: string;
}

export function pendingOverrides(db: DbOrTx): Promise<PendingOverrideRow[]> {
  return rows(
    db,
    sql`
    select o.id as override_id, q.quote_number, o.field, u.display_name as requested_by,
      o.created_at as requested_at, o.justification
    from override o
    join quote q on q.id = o.quote_id
    left join app_user u on u.id = o.requested_by
    where o.status = 'requested' and o.approval_mode = 'approver'
    order by o.created_at`,
    ['requested_at'],
  );
}

// ── Queues (engineering, pricing, final review) ────────────────────────────────────────────────

/** Open quotes sitting in a stage (active or on hold), oldest stay first. */
export function openInStage(db: DbOrTx, stageKey: string) {
  return quoteRows(db, sql`q.stage_key = ${stageKey} and q.status <> 'closed'`);
}

/** Open Quoting quotes whose current-version pricing record has capital readiness still pending. */
export async function capitalPendingCount(db: DbOrTx): Promise<number> {
  const [row] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n
        from quote q join pricing_record p on p.quote_id = q.id and p.quote_version = q.version
        where q.stage_key = 'QUOTING' and q.status <> 'closed' and p.capital_readiness = 'pending'`,
  );
  return row?.n ?? 0;
}

export interface MedianRow {
  n: number;
  median_s: number | null;
}

/** Median active time (holds excluded) of completed stays in a stage that ended since `since`. */
export async function medianStageTime(
  db: DbOrTx,
  stageKey: string,
  since: Date,
): Promise<MedianRow> {
  const [row] = await rows<MedianRow>(
    db,
    sql`select count(*)::int as n,
          percentile_cont(0.5) within group (order by active_s)::float8 as median_s
        from analytics_stage_stay
        where stage_key = ${stageKey} and not is_open and exited_at >= ${since.toISOString()}::timestamptz`,
  );
  return row ?? { n: 0, median_s: null };
}

/** Median engineering responsiveness since `since`: time to assign (by assignment date) and assign to G2. */
export async function engineeringMedians(
  db: DbOrTx,
  since: Date,
): Promise<{ assign: MedianRow; toG2: MedianRow }> {
  const at = since.toISOString();
  const [assign] = await rows<MedianRow>(
    db,
    sql`select count(*)::int as n,
          percentile_cont(0.5) within group (order by time_to_assign_s)::float8 as median_s
        from analytics_assignment where assigned_at >= ${at}::timestamptz`,
  );
  const [toG2] = await rows<MedianRow>(
    db,
    sql`select count(*)::int as n,
          percentile_cont(0.5) within group (order by assign_to_g2_s)::float8 as median_s
        from analytics_assignment
        where g2_decided_at >= ${at}::timestamptz and assign_to_g2_s is not null`,
  );
  return { assign: assign ?? { n: 0, median_s: null }, toG2: toG2 ?? { n: 0, median_s: null } };
}

export interface DecidedRow {
  quote_number: string;
  outcome_key: string;
  outcome_label: string;
  decided_by_id: string;
  decided_by: string | null;
  decided_at: Date;
}

/** Decisions at a gate since `since`, newest first. */
export function decisionsAtGate(db: DbOrTx, gateKey: string, since: Date): Promise<DecidedRow[]> {
  return rows(
    db,
    sql`
    select q.quote_number, g.outcome_key, coalesce(od.label, g.outcome_key) as outcome_label,
      g.decided_by as decided_by_id, u.display_name as decided_by, g.decided_at
    from gate_decision g
    join quote q on q.id = g.quote_id
    left join gate_outcome_definition od on od.gate_key = g.gate_key and od.key = g.outcome_key
    left join app_user u on u.id = g.decided_by
    where g.gate_key = ${gateKey} and g.decided_at >= ${since.toISOString()}::timestamptz
    order by g.decided_at desc`,
    ['decided_at'],
  );
}
