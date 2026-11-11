import { z } from 'zod';

import { LeadReviewView } from './lead-review';
import { numberFrom, wholeNumber } from './messages';
import { SectionLockView } from './problem';

// B-10: no imports from quotes.ts here; QuoteDetail embeds EngineeringDetail.

// ── Engineering Review (on quote detail, tab "Engineering") ──────────────────────────────────────

/**
 * F-064: the Engineering capital figure is a BUDGETARY estimate for quoting, not a CER figure. One label,
 * used wherever it is displayed (Engineering, Quoting, Final Review, list columns).
 */
export const BUDGETARY_CAPITAL_LABEL =
  'Budgetary capital estimate (USD): preliminary, includes contingency';
export const BUDGETARY_CAPITAL_HELP =
  'A budgetary figure for quoting. It is refined after award, before any CER.';

const text = (max: number) => z.string().trim().max(max).nullable();
/** A pack-out count: a whole number from 1 to 9,999,999 (the domain's PACK_OUT_MAX). */
const PackOutCount = wholeNumber(1, 9_999_999).nullable();

/**
 * PUT /api/v1/quotes/:quoteNumber/eng-review. Only the keys sent change; null clears a field.
 * `prelimCapitalUsd` is the **budgetary capital estimate** (F-064): preliminary, includes contingency, refined
 * after award and before any CER. The key keeps its name; only the label changed.
 */
export const EngReviewBody = z
  .object({
    processType: z.string().max(40).nullable(),
    machineType: z.string().max(40).nullable(),
    plantCode: z.string().max(40).nullable(),
    /** F-057: a whole number, 1 to 99. */
    cavitation: wholeNumber(1, 99).nullable(),
    cycleTimeS: numberFrom(0, 999_999, 'seconds', true).nullable(),
    toolingNotes: text(4000),
    prelimCapitalUsd: numberFrom(0, 999_999_999_999, 'USD').nullable(),
    technicalConceptNotes: text(4000),
    /** B-26: Supply Chain's network and freight view. */
    supplyChainNotes: text(4000),
    /**
     * FB-06 (F-024, D-007 open, provisional): the two-step (preform) process. The four details apply only
     * while `twoStep` is true; unticking it clears them.
     */
    twoStep: z.boolean(),
    preformPlantCode: z.string().max(40).nullable(),
    blowPlantCode: z.string().max(40).nullable(),
    preformNumber: text(40),
    twoStepFreightNote: text(300),
    /** FB-06 (F-025, A-014 not yet confirmed, provisional): pack-out quantities, whole numbers, optional. */
    unitsPerBag: PackOutCount,
    unitsPerTray: PackOutCount,
    unitsPerCase: PackOutCount,
    unitsPerPallet: PackOutCount,
  })
  .partial()
  .strict();
export type EngReviewBody = z.infer<typeof EngReviewBody>;

/**
 * B-26: PUT /api/v1/quotes/:quoteNumber/capacity-signoff. The capacity owner approves or blocks
 * capacity (G2 Advance needs `approved`); null clears it. Blocking needs a note.
 */
export const CapacitySignoffBody = z
  .object({
    status: z.enum(['approved', 'blocked']).nullable(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type CapacitySignoffBody = z.infer<typeof CapacitySignoffBody>;

export const CapacitySignoff = z.object({
  status: z.enum(['approved', 'blocked']).nullable(),
  byName: z.string().nullable(),
  at: z.string().nullable(),
  note: z.string().nullable(),
});
export type CapacitySignoff = z.infer<typeof CapacitySignoff>;

const pct = numberFrom(0, 100, '%');

export const CapacityEvidenceRowBody = z
  .object({
    id: z.uuid().optional(),
    site: z.string().trim().min(1).max(40),
    lineAsset: z.string().trim().max(120).nullable().optional(),
    /** Required on a new row, never defaulted (DF-22: quotes assumed 85% vs ~70% demonstrated). */
    assumedEffectivenessPct: pct.nullable().optional(),
    cycleTimeS: numberFrom(0, 999_999, 'seconds', true).nullable().optional(),
    /**
     * F-059: the line's current load, entered (replaces the typed "Utilization %"). Utilization AFTER the
     * new business is calculated by the server and is not accepted here. "Buffer %" is gone.
     */
    utilizationBeforePct: pct.nullable().optional(),
    /** Units a year allocated to this line. Blank = the quote's estimated annual volume. */
    allocatedAnnualVolume: z.number().int().min(0).max(999_999_999_999).nullable().optional(),
    /** Scheduled run days a year. Blank = the `capacity_basis` default. */
    scheduledRunDaysPerYear: wholeNumber(1, 366, 'days').nullable().optional(),
    analysisDate: z.iso.date(),
    analystId: z.uuid(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();
export type CapacityEvidenceRowBody = z.infer<typeof CapacityEvidenceRowBody>;

/** PUT /api/v1/quotes/:quoteNumber/capacity-evidence: the full set (rows not sent are removed). */
export const CapacityEvidenceBody = z
  .object({ rows: z.array(CapacityEvidenceRowBody).max(50) })
  .strict();
export type CapacityEvidenceBody = z.infer<typeof CapacityEvidenceBody>;

export const EngReviewFields = z.object({
  processType: z.string().nullable(),
  machineType: z.string().nullable(),
  plantCode: z.string().nullable(),
  cavitation: z.number().nullable(),
  cycleTimeS: z.number().nullable(),
  toolingNotes: z.string().nullable(),
  /**
   * Deprecated (FB-06, F-058): read-only "Legacy notes". The equipment BOM is now an upload; these two
   * free-text fields keep what was written before and accept no new writes.
   */
  downstreamEquipmentNotes: z.string().nullable(),
  /** Absent for roles without commercial access. */
  prelimCapitalUsd: z.number().nullable().optional(),
  technicalConceptNotes: z.string().nullable(),
  /** Deprecated (FB-06): read-only legacy note, see `downstreamEquipmentNotes`. */
  equipmentBomNotes: z.string().nullable(),
  supplyChainNotes: z.string().nullable(),
  /** FB-06 (F-024): the two-step (preform) process; Pricing reads it (T-008). */
  twoStep: z.boolean(),
  preformPlantCode: z.string().nullable(),
  blowPlantCode: z.string().nullable(),
  preformNumber: z.string().nullable(),
  twoStepFreightNote: z.string().nullable(),
  /** FB-06 (F-025): pack-out quantities (whole numbers), entered by Engineering and shown to Pricing. */
  unitsPerBag: z.number().nullable(),
  unitsPerTray: z.number().nullable(),
  unitsPerCase: z.number().nullable(),
  unitsPerPallet: z.number().nullable(),
  updatedAt: z.string().nullable(),
});
export type EngReviewFields = z.infer<typeof EngReviewFields>;

export const CapacityEvidenceRow = z.object({
  id: z.string(),
  site: z.string(),
  lineAsset: z.string().nullable(),
  /** The numbers are absent for roles without commercial access (architecture §3.3); none today (rule 2). */
  assumedEffectivenessPct: z.number().optional(),
  cycleTimeS: z.number().optional(),
  utilizationBeforePct: z.number().optional(),
  allocatedAnnualVolume: z.number().nullable(),
  scheduledRunDaysPerYear: z.number().nullable(),
  /** CALCULATED, read-only (F-059). Null until the review has a cavitation and every input is present. */
  utilizationAfterPct: z.number().nullable().optional(),
  /** `ok` | `warn` (over `capacityBasis.warnAbovePct`) | `over` (over 100: "exceeds line capacity"). */
  utilizationLevel: z.enum(['ok', 'warn', 'over']).nullable(),
  analysisDate: z.string(),
  analystId: z.string(),
  analystName: z.string().nullable(),
  notes: z.string().nullable(),
});
export type CapacityEvidenceRow = z.infer<typeof CapacityEvidenceRow>;

/** `app_setting.capacity_basis` (provisional, D-021). */
export const CapacityBasisDto = z.object({
  scheduledRunDaysPerYear: z.number().int(),
  warnAbovePct: z.number(),
  basisLabel: z.string(),
});
export type CapacityBasisDto = z.infer<typeof CapacityBasisDto>;

/** One fact about the product, from the intake, shown in the Engineering review header (F-023). */
export const ProductFact = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
});
export type ProductFact = z.infer<typeof ProductFact>;

/** One version of the equipment BOM upload (file, version, uploader and date; never a figure). */
export const EquipmentBomFile = z.object({
  id: z.uuid(),
  version: z.number().int(),
  /** The latest version (the one G2 and Pricing read). Earlier versions stay downloadable. */
  current: z.boolean(),
  fileName: z.string(),
  uploadedById: z.string(),
  uploadedByName: z.string().nullable(),
  uploadedAt: z.string(),
  note: z.string().nullable(),
  /** False for metadata-only rows (synthetic data): nothing to download. */
  available: z.boolean(),
});
export type EquipmentBomFile = z.infer<typeof EquipmentBomFile>;

/**
 * FB-06 (F-058, D-033): the equipment BOM is an upload of the Engineering Program Office workbook or its
 * one-page CSR BOM (a generic ballpark at quote time; each line flagged C capital or P customer paid).
 * Required to advance G2 with "capital required" (a G2 rule in config). Nothing is read from the file yet:
 * extraction waits for Kal's blank template (A-030).
 */
export const EquipmentBomView = z.object({
  /** The latest version, or null when none is on file. */
  current: EquipmentBomFile.nullable(),
  /** Every version still on file, newest first (the current one included). */
  versions: z.array(EquipmentBomFile),
  /** The caller may upload or replace it now (the review's editors, while it is open and unlocked). */
  canUpload: z.boolean(),
  /** G2 "Advance – capital required" needs the BOM (the rule is in the gate's config). */
  requiredForCapital: z.boolean(),
});
export type EquipmentBomView = z.infer<typeof EquipmentBomView>;

/** FB-06 (F-062): the engineer the routing rules suggest. A suggestion only: the lead still assigns. */
export const SuggestedEngineer = z.object({
  userId: z.string(),
  name: z.string(),
  /** What the rule matched on, e.g. the process type "ISBM" or the resin "PET" (codes). */
  processType: z.string().nullable(),
  resin: z.string().nullable(),
});
export type SuggestedEngineer = z.infer<typeof SuggestedEngineer>;

/** The Engineering tab of a quote. Included in `QuoteDetail.engineering`. */
export const EngineeringDetail = z.object({
  /** The quote is in Engineering Review now. */
  inQueue: z.boolean(),
  assignedEngineerId: z.string().nullable(),
  assignedEngineerName: z.string().nullable(),
  assignedAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  acceptedByName: z.string().nullable(),
  review: EngReviewFields,
  capacityEvidence: z.array(CapacityEvidenceRow),
  /** The quote's estimated annual volume: the default allocation for a capacity row. */
  quoteAnnualVolume: z.number().nullable(),
  /** F-059: where the run-days default, the amber threshold and the basis label come from. */
  capacityBasis: CapacityBasisDto,
  /** T-030: the rows' allocated volumes do not add up to the quote's volume (a warning, never a block). */
  allocationWarning: z.string().nullable(),
  /**
   * Labels for the codes stored on the review, including entries no longer offered (F-057: the EBM
   * wheel). The pickers show a retired value under this label; nobody can choose it again.
   */
  selectedLabels: z.object({
    processType: z.string().nullable(),
    machineType: z.string().nullable(),
    plantCode: z.string().nullable(),
  }),
  /** F-023: resin, customer-specified grade, PCR %, colour and additives, variants note: what is in the intake. */
  productFacts: z.array(ProductFact),
  /** B-26: the capacity owner's sign-off for this stay in the queue. */
  capacitySignoff: CapacitySignoff,
  /** B-26: the caller may record the sign-off (capacity.signoff, in Engineering Review). */
  canSignOffCapacity: z.boolean(),
  /** Commercial numbers were withheld from this response: inputs for them are write-only. */
  commercialRedacted: z.boolean(),
  canEdit: z.boolean(),
  /** FB-01 (F-001): read-only after G2 is decided, until a send-back reopens it. */
  lock: SectionLockView,
  canAccept: z.boolean(),
  canAssign: z.boolean(),
  /** Lead review: the engineer's submission to the engineering lead. */
  leadReview: LeadReviewView,
  /** FB-06 (F-058): the equipment BOM upload. */
  equipmentBom: EquipmentBomView,
  /** FB-06 (F-062): "Suggested: <name>" in the assign dialog, from `engineering_assignment_rules`. */
  suggestedEngineer: SuggestedEngineer.nullable(),
});
export type EngineeringDetail = z.infer<typeof EngineeringDetail>;

// ── Time in stage (B-10, feeds B-17) ─────────────────────────────────────────────────────────────

export const StageTimeTotal = z.object({
  stageKey: z.string(),
  label: z.string(),
  visits: z.number().int(),
  elapsedMs: z.number(),
  heldMs: z.number(),
  /** Excluding holds (CR-57). */
  activeMs: z.number(),
  current: z.boolean(),
});
export type StageTimeTotal = z.infer<typeof StageTimeTotal>;

export const StageTimesResponse = z.object({
  quoteNumber: z.string(),
  asOf: z.string(),
  stages: z.array(StageTimeTotal),
  visits: z.array(
    z.object({
      stageKey: z.string(),
      enteredAt: z.string(),
      exitedAt: z.string().nullable(),
      elapsedMs: z.number(),
      heldMs: z.number(),
      activeMs: z.number(),
    }),
  ),
});
export type StageTimesResponse = z.infer<typeof StageTimesResponse>;

export const ENGINEERING_PROBLEM_CODES = {
  notFound: 'not_found',
  notPermitted: 'not_permitted',
  rejected: 'engineering_change_rejected',
  conflict: 'engineering_conflict',
} as const;
