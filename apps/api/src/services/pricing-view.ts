import type { PricingRecordView, QuotingDetail } from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import {
  clearLeadReview,
  getSetting,
  listActiveUsersWithRoles,
  listGateDecisionsWithNames,
  listPricingRecords,
  listUsersByIds,
  upsertPricingRecord,
  type Quote,
} from '@ccq/db/repos';
import {
  PRICING_QUEUE_STAGE_KEY,
  PRICING_REF_FORMATS_SEED,
  can,
  canEditQuoting,
  canSeeCommercialFields,
  carryForwardPricingRecord,
  parsePricingRefFormats,
  priceApprovalStatus,
  quotingWarnings,
  redact,
  rolesWithPermission,
  type Actor,
  type CapitalReadiness,
  type PricingRecordValues,
  type PricingRefFormats,
  type QuoteState,
  type WorkflowConfig,
} from '@ccq/domain';

import { leadReviewView } from './lead-review';
import { sectionLockView } from './locks';

type PricingRow = Awaited<ReturnType<typeof listPricingRecords>>[number];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** `pricing_ref_formats`, falling back to the seed. */
export async function loadPricingRefFormats(db: DbOrTx): Promise<PricingRefFormats> {
  return parsePricingRefFormats(
    (await getSetting(db, 'pricing_ref_formats')) ?? PRICING_REF_FORMATS_SEED,
  );
}

const refs = (value: unknown, kind: 'erf'): string[] => {
  const v = (value as Record<string, unknown> | null)?.[kind];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

/** A stored row as the domain's editable values. */
export function recordValues(row: PricingRow | null | undefined): PricingRecordValues | null {
  if (!row) return null;
  return {
    priceApprovedBy: row.priceApprovedBy,
    priceApprovedAt: row.priceApprovedAt,
    pricingBasisNote: row.pricingBasisNote,
    approvedRangeNote: row.approvedRangeNote,
    erfRefs: refs(row.pricingRefs, 'erf'),
    costingCompleted: row.costingCompleted,
    costingAttestedBy: row.costingAttestedBy,
    costingAttestedAt: row.costingAttestedAt,
    capitalReadiness: row.capitalReadiness as CapitalReadiness | null,
    cerReference: row.cerReference,
    capitalNotes: row.capitalNotes,
    capitalPendingJustification: row.capitalPendingJustification,
  };
}

/** Domain values → the row's columns. */
export function recordColumns(v: PricingRecordValues) {
  return {
    priceApprovedBy: v.priceApprovedBy,
    priceApprovedAt: v.priceApprovedAt,
    pricingBasisNote: v.pricingBasisNote,
    approvedRangeNote: v.approvedRangeNote,
    // B-26: no BPR refs; the old `bpr` list and "no record" note columns are left as they are.
    pricingRefs: { erf: v.erfRefs },
    costingCompleted: v.costingCompleted,
    costingAttestedBy: v.costingAttestedBy,
    costingAttestedAt: v.costingAttestedAt,
    capitalReadiness: v.capitalReadiness,
    cerReference: v.cerReference,
    capitalNotes: v.capitalNotes,
    capitalPendingJustification: v.capitalPendingJustification,
  };
}

function recordView(
  row: PricingRow,
  name: (id: string | null) => string | null,
): PricingRecordView {
  const v = recordValues(row)!;
  return {
    quoteVersion: row.quoteVersion,
    priceApprovedBy: v.priceApprovedBy,
    priceApprovedByName: name(v.priceApprovedBy),
    priceApprovedAt: iso(v.priceApprovedAt),
    pricingBasisNote: v.pricingBasisNote,
    approvedRangeNote: v.approvedRangeNote,
    erfRefs: v.erfRefs,
    costingCompleted: v.costingCompleted,
    costingAttestedByName: name(v.costingAttestedBy),
    costingAttestedAt: iso(v.costingAttestedAt),
    capitalReadiness: v.capitalReadiness,
    cerReference: v.cerReference,
    capitalNotes: v.capitalNotes,
    capitalPendingJustification: v.capitalPendingJustification,
    warnings: quotingWarnings(v),
    updatedAt: iso(row.updatedAt),
  };
}

/** The roles whose active users may be named as the price approver (the Pricing team). */
export const pricingRoles = () => rolesWithPermission('quoting.edit');

/**
 * The quote's Quoting tab. Every reader gets the approval status ("Price approved ✓ on <date> by
 * <name>") and the G2 outcome; the record itself, its version history and the capital readiness are
 * commercial and stripped by the domain's `redact` for roles without `quote.read.commercialFields`
 * (KAM, Engineer, SalesLeader), architecture §3.3.
 */
export async function quotingView(
  db: DbOrTx,
  actor: Actor,
  workflow: WorkflowConfig,
  q: Quote,
  state: QuoteState,
): Promise<QuotingDetail> {
  const [rows, decisions, formats] = await Promise.all([
    listPricingRecords(db, q.id),
    listGateDecisionsWithNames(db, q.id),
    loadPricingRefFormats(db),
  ]);
  const current = rows.find((r) => r.quoteVersion === q.version) ?? null;
  const history = rows.filter((r) => r.quoteVersion !== q.version);
  const people = await listUsersByIds(db, [
    ...new Set(
      rows
        .flatMap((r) => [r.priceApprovedBy, r.costingAttestedBy])
        .concat(q.assignedPricerId ? [q.assignedPricerId] : [])
        .filter((id): id is string => !!id),
    ),
  ]);
  const name = (id: string | null) => (id && people.find((p) => p.id === id)?.displayName) || null;

  const g2 = [...decisions].reverse().find((d) => d.decision.gateKey === 'G2');
  const status = priceApprovalStatus(recordValues(current));
  const canEdit = canEditQuoting(actor, state, workflow);
  const inQuoting = q.stageKey === PRICING_QUEUE_STAGE_KEY && q.status !== 'closed';

  const commercial = redact(
    {
      pricingRecord: current ? recordView(current, name) : null,
      pricingRecords: history.map((r) => recordView(r, name)),
    },
    actor,
  );
  return {
    inQuoting,
    approval: {
      approved: status.approved,
      approvedAt: iso(status.approvedAt),
      approvedByName: name(status.approvedById),
      quoteVersion: q.version,
    },
    g2: g2
      ? {
          outcomeKey: g2.decision.outcomeKey,
          outcomeLabel:
            workflow.outcomes.find((o) => o.gateKey === 'G2' && o.key === g2.decision.outcomeKey)
              ?.label ?? g2.decision.outcomeKey,
          decidedAt: g2.decision.decidedAt.toISOString(),
          decidedByName: g2.decidedByName ?? null,
          note: g2.decision.note,
        }
      : null,
    ...commercial,
    commercialRedacted: !canSeeCommercialFields(actor),
    canEdit,
    lock: await sectionLockView(db, workflow, 'pricing', state),
    assignedPricerId: q.assignedPricerId,
    assignedPricerName: name(q.assignedPricerId),
    pricerAssignedAt: iso(q.pricerAssignedAt),
    canAssign: inQuoting && can(actor, 'pricingQueue.assign', state),
    leadReview: await leadReviewView(db, actor, 'pricing', q, state),
    pricingUsers: canEdit ? await listActiveUsersWithRoles(db, pricingRoles()) : [],
    refFormats: formats,
  };
}

/**
 * A quote entering Quoting (G2 Proceed / Capital required, G4 Return, G5 Re-quote, a KAM resubmission
 * with no scope change): its version gets a pricing record carrying forward the pricing-app and CER
 * references of the latest earlier version (the approval is recorded afresh, CR-38), and a new stay
 * starts a new lead-review round. Runs in the transition's transaction. The notifications are FB-05's
 * (`handoff-notifications.ts`): the pricer and the pricing lead, once each.
 */
export async function onPricingArrival(
  tx: DbOrTx,
  quote: { id: string; quoteNumber: string; version: number },
  actorId: string,
): Promise<void> {
  // Lead review: a new stay in Quoting starts a new round (like engineering's acceptance).
  await clearLeadReview(tx, quote.id, 'pricing');
  const rows = await listPricingRecords(tx, quote.id);
  if (!rows.some((r) => r.quoteVersion === quote.version)) {
    const prior = rows.find((r) => r.quoteVersion < quote.version);
    await upsertPricingRecord(tx, {
      quoteId: quote.id,
      quoteVersion: quote.version,
      ...recordColumns(carryForwardPricingRecord(recordValues(prior))),
      createdBy: actorId,
    });
  }
}
