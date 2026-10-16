import type { OverrideDto, QuoteOverridableField } from '@ccq/contracts';
import { schema, type DbOrTx } from '@ccq/db';
import {
  getSetting,
  listOverridesWithContext,
  type OverrideWithContext,
  type Quote,
} from '@ccq/db/repos';
import {
  asUserId,
  canRequestOverride,
  canSeePriorityScore,
  describeOverrideValue,
  findOverridableField,
  overrideActions,
  parseOverrideSettings,
  type Actor,
  type OverrideApprovalMode,
  type OverrideQuote,
  type OverrideRecord,
  type OverrideSettings,
  type OverrideStatus,
} from '@ccq/domain';
import { eq } from 'drizzle-orm';

const { customer } = schema;

/** Default when `override_justification_min_length` is not configured (B-09 prompt: 15). */
const DEFAULT_JUSTIFICATION_MIN = 15;

/** The override config in effect (`overridable_fields` + `override_justification_min_length`). */
export async function loadOverrideSettings(db: DbOrTx): Promise<OverrideSettings> {
  const [fields, min] = await Promise.all([
    getSetting(db, 'overridable_fields'),
    getSetting(db, 'override_justification_min_length'),
  ]);
  return parseOverrideSettings({
    fields: fields ?? [],
    justificationMinLength: typeof min === 'number' ? min : DEFAULT_JUSTIFICATION_MIN,
  });
}

type QuoteColumns = Pick<
  Quote,
  | 'priorityTier'
  | 'priorityTierOverridden'
  | 'shipTo'
  | 'shipToOverridden'
  | 'shipToOriginal'
  | 'queuePosition'
  | 'queuePositionOverridden'
>;

/**
 * How each overridable field maps onto quote columns: read the current value, and the patch that writes
 * a value with its `*_overridden` flag. A new overridable field needs an entry here and a value kind in
 * the domain (`OVERRIDE_VALUE_KINDS`); who may override it is config.
 */
export const OVERRIDE_FIELD_COLUMNS: Record<
  string,
  {
    read: (q: QuoteColumns) => unknown;
    write: (
      value: unknown,
      overridden: boolean,
      justification: string | null,
      q: QuoteColumns,
    ) => Partial<Quote>;
  }
> = {
  priority_tier: {
    read: (q) => q.priorityTier,
    write: (value, overridden) => ({
      priorityTier: (value as string | null) ?? null,
      priorityTierOverridden: overridden,
    }),
  },
  ship_to: {
    read: (q) => q.shipTo,
    write: (value, overridden, justification, q) => ({
      shipTo: value ?? null,
      shipToOverridden: overridden,
      shipToOverrideReason: overridden ? justification : null,
      // Keep the default the override departed from (B-07 captured it at intake when known).
      ...(overridden && q.shipToOriginal === null ? { shipToOriginal: q.shipTo } : {}),
    }),
  },
  queue_position: {
    read: (q) => q.queuePosition,
    write: (value, overridden) => ({
      queuePosition: (value as number | null) ?? null,
      queuePositionOverridden: overridden,
    }),
  },
};

export const currentFieldValue = (q: QuoteColumns, field: string): unknown =>
  OVERRIDE_FIELD_COLUMNS[field]?.read(q) ?? null;

/** The quote as the override policy sees it. */
export const overrideQuoteOf = (r: {
  kamUserId: string;
  assignedEngineerId: string | null;
  region: string | null;
  accountId: string | null;
  stageKey: string;
  quoteStatus: string;
}): OverrideQuote => ({
  kamUserId: asUserId(r.kamUserId),
  assignedEngineerId: r.assignedEngineerId ? asUserId(r.assignedEngineerId) : null,
  stageKey: r.stageKey,
  status: r.quoteStatus as OverrideQuote['status'],
  ...(r.region ? { region: r.region } : {}),
  ...(r.accountId ? { accountId: r.accountId } : {}),
});

/** The quote as the override policy sees it, from its row (adds the customer's SF account for scope). */
export async function policyQuoteOf(db: DbOrTx, q: Quote): Promise<OverrideQuote> {
  const cust = q.customerId
    ? await db
        .select({ sfAccountId: customer.sfAccountId })
        .from(customer)
        .where(eq(customer.id, q.customerId))
    : [];
  return overrideQuoteOf({ ...q, accountId: cust[0]?.sfAccountId ?? null, quoteStatus: q.status });
}

export const overrideRecordOf = (o: OverrideWithContext['override']): OverrideRecord => ({
  id: o.id,
  field: o.field,
  requestedBy: asUserId(o.requestedBy),
  status: o.status as OverrideStatus,
  approvalMode: o.approvalMode as OverrideApprovalMode,
  originalValue: o.originalValue,
  requestedValue: o.requestedValue,
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export interface OverrideViewContext {
  actor: Actor;
  settings: OverrideSettings;
  kamCanSeePeerScores: boolean;
}

/**
 * Whether the caller may see this override at all: a priority-tier override reveals the tier, so it
 * follows the same rule as the score (`kam_can_see_peer_scores`).
 */
export const overrideVisible = (
  ctx: OverrideViewContext,
  field: string,
  kamUserId: string,
): boolean =>
  field !== 'priority_tier' ||
  canSeePriorityScore(ctx.actor, asUserId(kamUserId), ctx.kamCanSeePeerScores);

export function overrideDto(row: OverrideWithContext, ctx: OverrideViewContext): OverrideDto {
  const o = row.override;
  const config = findOverridableField(ctx.settings, o.field);
  const actions = overrideActions(
    ctx.settings,
    ctx.actor,
    overrideQuoteOf(row),
    overrideRecordOf(o),
  );
  return {
    id: o.id,
    quoteId: o.quoteId,
    quoteNumber: row.quoteNumber,
    customerName: row.customerName ?? null,
    field: o.field,
    fieldLabel: config?.label ?? o.field,
    originalValue: o.originalValue ?? null,
    requestedValue: o.requestedValue ?? null,
    originalDisplay: describeOverrideValue(o.field, o.originalValue),
    requestedDisplay: describeOverrideValue(o.field, o.requestedValue),
    justification: o.justification,
    status: o.status as OverrideStatus,
    approvalMode: o.approvalMode as OverrideApprovalMode,
    requestedBy: o.requestedBy,
    requestedByName: row.requestedByName ?? null,
    requestedAt: o.createdAt.toISOString(),
    decidedBy: o.decidedBy,
    decidedByName: row.decidedByName ?? null,
    decidedAt: iso(o.decidedAt),
    decisionNote: o.decisionNote,
    appliedAt: iso(o.appliedAt),
    revertedBy: o.revertedBy,
    revertedByName: row.revertedByName ?? null,
    revertedAt: iso(o.revertedAt),
    canDecide: actions.canDecide,
    canRevert: actions.canRevert,
  };
}

/**
 * The quote page's override affordances: each configured field with its current value, the pending
 * request (badge), the applied override behind the current value (copper marker) and `canRequest`.
 */
export async function quoteOverridableFields(
  db: DbOrTx,
  ctx: OverrideViewContext,
  q: Quote & { accountId?: string | null },
): Promise<QuoteOverridableField[]> {
  if (ctx.settings.fields.length === 0) return [];
  const rows = await listOverridesWithContext(db, {
    quoteId: q.id,
    statuses: ['requested', 'applied'],
    limit: 50,
  });
  const quote = overrideQuoteOf({ ...q, accountId: q.accountId ?? null, quoteStatus: q.status });
  return ctx.settings.fields
    .filter((f) => overrideVisible(ctx, f.field, q.kamUserId))
    .map((f) => {
      const pending = rows.find(
        (r) => r.override.field === f.field && r.override.status === 'requested',
      );
      // Newest applied first (the list is newest first): the one that set the current value.
      const applied = rows.find(
        (r) => r.override.field === f.field && r.override.status === 'applied',
      );
      return {
        field: f.field,
        label: f.label,
        approval: f.approval,
        canRequest: !pending && canRequestOverride(f, ctx.actor, quote) && q.status !== 'closed',
        currentValue: currentFieldValue(q, f.field),
        pending: pending ? overrideDto(pending, ctx) : null,
        applied: applied ? overrideDto(applied, ctx) : null,
      };
    });
}
