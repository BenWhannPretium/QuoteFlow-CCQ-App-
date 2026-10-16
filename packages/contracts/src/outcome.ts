import { z } from 'zod';

// ── B-13: customer decision, closure, validity, hand-off ─────────────────────────────────────────

export const ValidityState = z.enum(['none', 'valid', 'expiring', 'expired']);
export type ValidityState = z.infer<typeof ValidityState>;

/** The validity countdown: amber at ≤ `warningDays` left, red once expired (US Central calendar). */
export const ValidityStatus = z.object({
  validityUntil: z.string().nullable(),
  /** 0 = last valid day; negative = days since it expired. Null without a validity date. */
  daysLeft: z.number().int().nullable(),
  state: ValidityState,
  /** `validity_warning_days` (provisional 7). */
  warningDays: z.number().int(),
});
export type ValidityStatus = z.infer<typeof ValidityStatus>;

/** The Salesforce stage side by side with the CCQ stage (read only), with a mismatch flag. */
export const SfStageComparison = z.object({
  sfStage: z.string().nullable(),
  ccqStageHint: z.string().nullable(),
  mismatch: z.boolean(),
  reason: z.string().nullable(),
  /** B-06: closed_won | closed_lost | deleted when SF closed or deleted the opportunity. */
  sfStatusFlag: z.string().nullable(),
});
export type SfStageComparison = z.infer<typeof SfStageComparison>;

/** How a closed quote closed (CR-39/40): every field is mandatory to close. */
export const ClosureSummary = z.object({
  outcome: z.string(),
  outcomeLabel: z.string(),
  /** `customer`: decided at Customer Decision (G5). `internal`: a no-go at G1–G4. */
  kind: z.enum(['customer', 'internal']),
  reasonCode: z.string().nullable(),
  reasonLabel: z.string().nullable(),
  closureOwnerId: z.string().nullable(),
  closureOwnerName: z.string().nullable(),
  closedAt: z.string().nullable(),
  /** The closing decision: who recorded it, in which roles, the gate, the note and a named competitor. */
  gateKey: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedByRoles: z.array(z.string()),
  note: z.string().nullable(),
  competitor: z.string().nullable(),
});
export type ClosureSummary = z.infer<typeof ClosureSummary>;

export const AcceptanceEvidence = z.enum(['verbal', 'po', 'loi', 'contract']);
export type AcceptanceEvidence = z.infer<typeof AcceptanceEvidence>;

export const CodeLabel = z.object({ code: z.string(), label: z.string() });
export type CodeLabel = z.infer<typeof CodeLabel>;

/** The minimal Awarded hand-off record (Stage 6). CER / BPR are references only (no integration). */
export const HandoffRecord = z.object({
  acceptanceEvidence: AcceptanceEvidence,
  acceptanceEvidenceLabel: z.string(),
  acceptanceDate: z.string().nullable(),
  acceptanceDocumentUrl: z.string().nullable(),
  cerId: z.string().nullable(),
  bprId: z.string().nullable(),
  receivingRole: z.string().nullable(),
  receivingRoleLabel: z.string().nullable(),
  receivingRoleOther: z.string().nullable(),
  receivingContactName: z.string().nullable(),
  acceptedOn: z.string().nullable(),
  notes: z.string().nullable(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  completedByName: z.string().nullable(),
  updatedAt: z.string(),
  updatedByName: z.string().nullable(),
});
export type HandoffRecord = z.infer<typeof HandoffRecord>;

/** `QuoteDetail.customerDecision`: the Customer Decision header, the closure and the hand-off. */
export const CustomerDecisionDetail = z.object({
  proposalIssuedAt: z.string().nullable(),
  validity: ValidityStatus,
  /** When the daily job flagged the validity as passed (the KAM was told); null otherwise. */
  validityExpiredFlaggedAt: z.string().nullable(),
  sf: SfStageComparison,
  closure: ClosureSummary.nullable(),
  /** Only on AWARDED quotes; null before anyone records it. */
  handoff: HandoffRecord.nullable(),
  /** The quote is AWARDED and the caller holds handoff.edit on it. */
  canEditHandoff: z.boolean(),
  /** The caller may name a closure owner other than the default (outcome.assignOwner). */
  canAssignClosureOwner: z.boolean(),
  receivingRoles: z.array(CodeLabel),
  acceptanceEvidenceOptions: z.array(CodeLabel),
});
export type CustomerDecisionDetail = z.infer<typeof CustomerDecisionDetail>;

const optionalText = (max: number) => z.string().max(max).nullable().optional();
const optionalDate = z.iso.date().nullable().optional();

/** PUT /quotes/:qn/handoff. Only the keys sent change; null clears an optional field. */
export const HandoffBody = z
  .object({
    acceptanceEvidence: AcceptanceEvidence.optional(),
    acceptanceDate: optionalDate,
    acceptanceDocumentUrl: optionalText(2000),
    cerId: optionalText(64),
    bprId: optionalText(64),
    receivingRole: optionalText(80),
    receivingRoleOther: optionalText(200),
    receivingContactName: optionalText(200),
    acceptedOn: optionalDate,
    notes: optionalText(4000),
    /** The "Hand-off complete" checkbox. */
    complete: z.boolean().optional(),
  })
  .strict();
export type HandoffBody = z.infer<typeof HandoffBody>;

export const HandoffResponse = z.object({ customerDecision: CustomerDecisionDetail });
export type HandoffResponse = z.infer<typeof HandoffResponse>;

// ── Outcomes report (admin) ──────────────────────────────────────────────────────────────────────

export const OutcomesReport = z.object({
  generatedAt: z.string(),
  outcomes: z.array(
    z.object({
      outcome: z.string(),
      label: z.string(),
      kind: z.enum(['customer', 'internal']),
      count: z.number().int(),
      reasons: z.array(
        z.object({ code: z.string().nullable(), label: z.string(), count: z.number().int() }),
      ),
    }),
  ),
  customer: z.object({
    awarded: z.number().int(),
    lost: z.number().int(),
    expired: z.number().int(),
    winRate: z.number().nullable(),
  }),
  capture: z.object({
    proposalsIssued: z.number().int(),
    recorded: z.number().int(),
    awaiting: z.number().int(),
    goneDark: z.number().int(),
    rate: z.number().nullable(),
  }),
  incompleteClosures: z.number().int(),
  /** Reason codes are D-15 seeds until approved: true while any closing reason code is provisional. */
  taxonomyProvisional: z.boolean(),
});
export type OutcomesReport = z.infer<typeof OutcomesReport>;

/** Problem `code`s for the B-13 routes. */
export const OUTCOME_PROBLEM_CODES = {
  notFound: 'not_found',
  notPermitted: 'not_permitted',
  rejected: 'handoff_rejected',
} as const;
