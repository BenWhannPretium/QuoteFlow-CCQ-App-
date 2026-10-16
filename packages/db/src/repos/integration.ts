import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { excludedSet, first } from './_util';
import { uuidv7 } from '../ids';
import {
  appUser,
  customer,
  integrationRun,
  quote,
  sfOpportunitySnapshot,
  userRole,
} from '../schema/index';

export type SfOpportunitySnapshot = typeof sfOpportunitySnapshot.$inferSelect;
export type NewSfOpportunitySnapshot = typeof sfOpportunitySnapshot.$inferInsert;
export type IntegrationRunRow = typeof integrationRun.$inferSelect;

const SNAPSHOT_FIELDS = [
  'name',
  'accountId',
  'accountName',
  'ownerAlias',
  'ownerEmail',
  'ownerName',
  'amount',
  'closeDate',
  'sfStage',
  'isClosed',
  'isWon',
  'erfNumberSf',
  'quoteSourceSf',
  'systemModstamp',
  'deletedInSfAt',
  'dataQuality',
  'raw',
  'syncedAt',
] as const;

export interface UpsertCounts {
  inserted: number;
  updated: number;
  /** Already up to date (same SystemModstamp): left untouched. */
  unchanged: number;
}

/** `xmax = 0` is true for a row the statement inserted, false for one it updated. */
const wasInserted = sql<boolean>`(xmax = 0)`;

/**
 * Insert or refresh snapshots by `sf_opportunity_id`. A row whose SystemModstamp hasn't changed is
 * skipped (so re-running a sync window is idempotent), unless it was marked deleted and SF returned it
 * again (undeleted from the recycle bin).
 */
export async function upsertSfOpportunities(
  db: DbOrTx,
  rows: NewSfOpportunitySnapshot[],
): Promise<UpsertCounts> {
  if (rows.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const s = sfOpportunitySnapshot;
  const written = await db
    .insert(s)
    .values(rows)
    .onConflictDoUpdate({
      target: s.sfOpportunityId,
      set: { ...excludedSet(s, SNAPSHOT_FIELDS), updatedAt: new Date() },
      setWhere: sql`${s.systemModstamp} is distinct from excluded.system_modstamp
        or ${s.deletedInSfAt} is not null`,
    })
    .returning({ inserted: wasInserted });
  const inserted = written.filter((r) => r.inserted).length;
  return { inserted, updated: written.length - inserted, unchanged: rows.length - written.length };
}

export const getSfOpportunity = async (db: DbOrTx, sfOpportunityId: string) =>
  first(
    await db
      .select()
      .from(sfOpportunitySnapshot)
      .where(eq(sfOpportunitySnapshot.sfOpportunityId, sfOpportunityId)),
  );

/** Mark snapshots deleted in SF (never delete them). Returns how many were newly marked. */
export async function markSfOpportunitiesDeleted(
  db: DbOrTx,
  sfOpportunityIds: string[],
  at: Date,
): Promise<number> {
  if (sfOpportunityIds.length === 0) return 0;
  const s = sfOpportunitySnapshot;
  const rows = await db
    .update(s)
    .set({ deletedInSfAt: at, updatedAt: at })
    .where(and(inArray(s.sfOpportunityId, sfOpportunityIds), isNull(s.deletedInSfAt)))
    .returning({ id: s.id });
  return rows.length;
}

export interface SnapshotSearch {
  /** Lower-cased search terms (every term must match the name or the account name). */
  terms: string[];
  /** Owner match for `mine=true`: any of these emails (lower case) or aliases. */
  owner?: { emails: string[]; aliases: string[] } | undefined;
  openOnly: boolean;
  limit: number;
}

/**
 * Fuzzy snapshot search for the intake picker (pg_trgm on name and account name). A term matches
 * on a substring or on trigram word similarity (`<%`, so a typo like "pickel" still finds "Pickle").
 * Ranked by similarity to the whole query, then most recently modified. Deleted snapshots are hidden.
 */
export function searchSfOpportunitySnapshots(db: DbOrTx, p: SnapshotSearch) {
  const s = sfOpportunitySnapshot;
  const where: SQL[] = [isNull(s.deletedInSfAt)];
  for (const term of p.terms) {
    const like = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where.push(
      sql`(${s.name} ilike ${like} or ${s.accountName} ilike ${like}
        or ${term} <% ${s.name} or ${term} <% coalesce(${s.accountName}, ''))`,
    );
  }
  if (p.openOnly) where.push(eq(s.isClosed, false));
  if (p.owner) {
    const emails = p.owner.emails.length ? p.owner.emails : [''];
    const aliases = p.owner.aliases.length ? p.owner.aliases : [''];
    where.push(sql`(lower(${s.ownerEmail}) in ${emails} or lower(${s.ownerAlias}) in ${aliases})`);
  }
  const q = p.terms.join(' ');
  const rank = q
    ? sql`greatest(word_similarity(${q}, ${s.name}), word_similarity(${q}, coalesce(${s.accountName}, ''))) desc,`
    : sql``;
  return db
    .select()
    .from(s)
    .where(and(...where))
    .orderBy(sql`${rank} ${s.systemModstamp} desc nulls last, ${s.name} asc`)
    .limit(p.limit);
}

export const getCustomer = async (db: DbOrTx, id: string) =>
  first(await db.select().from(customer).where(eq(customer.id, id)));

export async function insertCustomer(db: DbOrTx, values: typeof customer.$inferInsert) {
  const [row] = await db.insert(customer).values(values).returning();
  return row!;
}

export interface SfCustomerRow {
  sfAccountId: string;
  name: string;
  defaultShipTo: Record<string, string | null> | null;
}

/**
 * Upsert `existing` customers by SF account id. Name, default ship-to and last_synced_at follow SF;
 * status and source are left alone on existing rows (a synthetic row stays synthetic).
 */
export async function upsertSfCustomers(
  db: DbOrTx,
  rows: SfCustomerRow[],
  at: Date,
): Promise<UpsertCounts> {
  if (rows.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const c = customer;
  const written = await db
    .insert(c)
    .values(
      rows.map((r) => ({
        sfAccountId: r.sfAccountId,
        name: r.name,
        status: 'existing',
        defaultShipTo: r.defaultShipTo,
        source: 'salesforce',
        lastSyncedAt: at,
      })),
    )
    .onConflictDoUpdate({
      target: c.sfAccountId,
      set: {
        name: sql.raw('excluded.name'),
        defaultShipTo: sql.raw('excluded.default_ship_to'),
        lastSyncedAt: sql.raw('excluded.last_synced_at'),
        updatedAt: at,
      },
      setWhere: sql`${c.name} is distinct from excluded.name
        or ${c.defaultShipTo} is distinct from excluded.default_ship_to`,
    })
    .returning({ inserted: wasInserted });
  const inserted = written.filter((r) => r.inserted).length;
  return { inserted, updated: written.length - inserted, unchanged: rows.length - written.length };
}

export interface QuoteSfFlagChange {
  quoteId: string;
  quoteNumber: string;
  sfOpportunityId: string;
  flag: string | null;
}

/**
 * Set `quote.sf_status_flag` from the linked snapshot: deleted → `deleted`, closed → `closed_won` /
 * `closed_lost`, open → null. Only rows whose flag changes are written. Run inside a context that
 * can see every quote (the sync's system context): RLS applies.
 */
export async function refreshQuoteSfStatusFlags(
  db: DbOrTx,
  at: Date,
): Promise<QuoteSfFlagChange[]> {
  const atIso = at.toISOString();
  const result = await db.execute<{
    quote_id: string;
    quote_number: string;
    sf_opportunity_id: string;
    flag: string | null;
  }>(sql`
    with target as (
      select q.id,
        case
          when s.deleted_in_sf_at is not null then 'deleted'
          when s.is_closed and s.is_won then 'closed_won'
          when s.is_closed then 'closed_lost'
        end as flag
      from ${quote} q
      join ${sfOpportunitySnapshot} s on s.sf_opportunity_id = q.sf_opportunity_id
    )
    update ${quote} q
    set sf_status_flag = t.flag,
        sf_status_flagged_at = case when t.flag is null then null else ${atIso}::timestamptz end,
        updated_at = ${atIso}::timestamptz
    from target t
    where q.id = t.id and q.sf_status_flag is distinct from t.flag
    returning q.id as quote_id, q.quote_number, q.sf_opportunity_id, q.sf_status_flag as flag`);
  return [...result].map((r) => ({
    quoteId: r.quote_id,
    quoteNumber: r.quote_number,
    sfOpportunityId: r.sf_opportunity_id,
    flag: r.flag,
  }));
}

// ── integration_run ──────────────────────────────────────────────────────────────────────────────

export async function startIntegrationRun(
  db: DbOrTx,
  source: (typeof integrationRun.$inferInsert)['source'],
  at: Date,
) {
  const [row] = await db.insert(integrationRun).values({ source, startedAt: at }).returning();
  return row!;
}

export const finishIntegrationRun = (
  db: DbOrTx,
  id: string,
  result: {
    status: 'succeeded' | 'failed' | 'partial';
    finishedAt: Date;
    counts?: Record<string, number>;
    error?: string | null;
  },
) =>
  db
    .update(integrationRun)
    .set({ ...result, updatedAt: result.finishedAt })
    .where(eq(integrationRun.id, id));

export const listIntegrationRuns = (
  db: DbOrTx,
  { source, limit = 50 }: { source?: string | undefined; limit?: number } = {},
) =>
  db
    .select()
    .from(integrationRun)
    .where(source ? eq(integrationRun.source, source) : undefined)
    .orderBy(desc(integrationRun.startedAt))
    .limit(limit);

/**
 * B-15: add `counts` to the pricing app's row for the hour starting at `hour` (created on first use),
 * so on-demand reads leave one `integration_run` row per hour, not one per call. Counts are summed
 * key by key. Status follows the hour's totals: no `failed` → succeeded, every call failed → failed,
 * otherwise partial. `error` is a data-free code (the latest one is kept).
 */
export async function addPricingUsage(
  db: DbOrTx,
  hour: Date,
  counts: Record<string, number>,
  at: Date,
  error: string | null,
): Promise<void> {
  const hourIso = hour.toISOString();
  const atIso = at.toISOString();
  const json = JSON.stringify(counts);
  const sum = (key: string) =>
    sql`coalesce((${integrationRun}.counts->>${key})::numeric, 0) + coalesce((excluded.counts->>${key})::numeric, 0)`;
  await db.execute(sql`
    insert into ${integrationRun} (id, source, started_at, finished_at, status, counts, error)
    values (${uuidv7(at.getTime())}::uuid, 'pricing', ${hourIso}::timestamptz, ${atIso}::timestamptz,
      case when coalesce((${json}::jsonb->>'failed')::numeric, 0) = 0 then 'succeeded'
           when (${json}::jsonb->>'failed')::numeric >= coalesce((${json}::jsonb->>'calls')::numeric, 0) then 'failed'
           else 'partial' end,
      ${json}::jsonb, ${error})
    on conflict (source, started_at) where source = 'pricing' do update set
      counts = (
        select coalesce(jsonb_object_agg(k,
          coalesce((${integrationRun}.counts->>k)::numeric, 0) + coalesce((excluded.counts->>k)::numeric, 0)
        ), '{}'::jsonb)
        from (select jsonb_object_keys(${integrationRun}.counts) as k
              union select jsonb_object_keys(excluded.counts)) as keys
      ),
      finished_at = excluded.finished_at,
      status = case when ${sum('failed')} = 0 then 'succeeded'
                    when ${sum('failed')} >= ${sum('calls')} then 'failed'
                    else 'partial' end,
      error = coalesce(excluded.error, ${integrationRun}.error),
      updated_at = excluded.finished_at`);
}

/** Start time of the latest succeeded run for `source`: the delta sync's watermark. */
export async function lastSucceededRunStart(db: DbOrTx, source: string): Promise<Date | null> {
  const row = first(
    await db
      .select({ startedAt: integrationRun.startedAt })
      .from(integrationRun)
      .where(and(eq(integrationRun.source, source), eq(integrationRun.status, 'succeeded')))
      .orderBy(desc(integrationRun.startedAt))
      .limit(1),
  );
  return row?.startedAt ?? null;
}

/** Active users holding `role` (e.g. Admin, for integration failure alerts). */
export const listActiveUserIdsWithRole = async (db: DbOrTx, role: string) =>
  (
    await db
      .selectDistinct({ id: appUser.id })
      .from(appUser)
      .innerJoin(userRole, eq(userRole.userId, appUser.id))
      .where(and(eq(userRole.role, role), eq(appUser.active, true)))
  ).map((r) => r.id);

// ── Reports ──────────────────────────────────────────────────────────────────────────────────────

/** Every visible quote with its SF opportunity's ERF number (RLS applies). */
export const listQuoteErfLinkage = (db: DbOrTx) =>
  db
    .select({
      quoteNumber: quote.quoteNumber,
      stageKey: quote.stageKey,
      sfOpportunityId: quote.sfOpportunityId,
      sfOpportunityName: sfOpportunitySnapshot.name,
      sfStage: sfOpportunitySnapshot.sfStage,
      sfErfNumber: sfOpportunitySnapshot.erfNumberSf,
      ccqErfNumber: quote.erfNumber,
      sfStatusFlag: quote.sfStatusFlag,
    })
    .from(quote)
    .leftJoin(
      sfOpportunitySnapshot,
      eq(sfOpportunitySnapshot.sfOpportunityId, quote.sfOpportunityId),
    )
    .orderBy(desc(quote.quoteNumber));

export const getCustomerBySfAccountId = async (db: DbOrTx, sfAccountId: string) =>
  first(await db.select().from(customer).where(eq(customer.sfAccountId, sfAccountId)));
