import type { PricingRecordView, QuotingDetail } from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import {
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
  type PlannedNotification,
  type PricingRecordValues,
  type PricingRefFormats,
  type QuoteState,
  type WorkflowConfig,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { persistNotifications } from './notifications';

type PricingRow = Awaited<ReturnType<typeof listPricingRecords>>[number];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** `pricing_ref_formats`, falling back to the seed. */
export async function loadPricingRefFormats(db: DbOrTx): Promise<PricingRefFormats> {
  return parsePricingRefFormats(
    (await getSetting(db, 'pricing_ref_formats')) ?? PRICING_REF_FORMATS_SEED,
  );
}

const refs = (value: unknown, kind: 'erf' | 'bpr'): string[] => {
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
    bprRefs: refs(row.pricingRefs, 'bpr'),
    noPricingAppRecordNote: row.noPricingAppRecordNote,
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
    pricingRefs: { erf: v.erfRefs, bpr: v.bprRefs },
    noPricingAppRecordNote: v.noPricingAppRecordNote,
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
    bprRefs: v.bprRefs,
    noPricingAppRecordNote: v.noPricingAppRecordNote,
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
        .filter((id): id is string => !!id),
    ),
  ]);
  const name = (id: string | null) => (id && people.find((p) => p.id === id)?.displayName) || null;

  const g2 = [...decisions].reverse().find((d) => d.decision.gateKey === 'G2');
  const status = priceApprovalStatus(recordValues(current));
  const canEdit = canEditQuoting(actor, state);

  const commercial = redact(
    {
      pricingRecord: current ? recordView(current, name) : null,
      pricingRecords: history.map((r) => recordView(r, name)),
    },
    actor,
  );
  return {
    inQuoting: q.stageKey === PRICING_QUEUE_STAGE_KEY && q.status !== 'closed',
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
    pricingUsers: canEdit ? await listActiveUsersWithRoles(db, pricingRoles()) : [],
    refFormats: formats,
  };
}

/**
 * A quote entering Quoting (G2 Proceed / Capital required, G4 Return, G5 Re-quote): its version gets a
 * pricing record carrying forward the pricing-app and CER references of the latest earlier version
 * (the approval is recorded afresh, CR-38), and the Pricing team is told in-app (email is B-18).
 * Runs in the transition's transaction.
 */
export async function onPricingArrival(
  tx: DbOrTx,
  quote: { id: string; quoteNumber: string; version: number },
  actorId: string,
  log?: FastifyBaseLogger,
  /** B-12/B-13: set when Final Review returned the quote here, or the customer asked for a re-quote. */
  returnedFrom?: 'final_review' | 'customer_requote',
): Promise<void> {
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
  const planned: PlannedNotification[] = pricingRoles().map((role) => ({
    type: 'quote.ready_for_quoting',
    recipient: { kind: 'role', role },
  }));
  await persistNotifications(
    tx,
    planned,
    {
      quoteId: quote.id,
      title: returnedFrom
        ? `${quote.quoteNumber} was returned to Quoting`
        : `${quote.quoteNumber} is ready for pricing`,
      body:
        returnedFrom === 'customer_requote'
          ? 'The customer asked for a re-quote. Open the pricing queue to record the price approval again.'
          : returnedFrom
            ? 'Final Review returned it for another look. Open the pricing queue to record the price approval again.'
            : 'Engineering has cleared it. Open the pricing queue to record the price approval.',
      excludeUserId: actorId,
    },
    log,
  );
}

/** G3 Submit: the Approver group is told in-app that a quote waits for Final Review (B-18: email). */
export async function onFinalReviewArrival(
  tx: DbOrTx,
  quote: { id: string; quoteNumber: string },
  actorId: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  const planned: PlannedNotification[] = rolesWithPermission('gate.G4.decide').map((role) => ({
    type: 'quote.ready_for_final_review',
    recipient: { kind: 'role', role },
  }));
  await persistNotifications(
    tx,
    planned,
    {
      quoteId: quote.id,
      title: `${quote.quoteNumber} is ready for Final Review`,
      body: 'Pricing has approved the price. Open Approvals to release or return the proposition.',
      excludeUserId: actorId,
    },
    log,
  );
}
