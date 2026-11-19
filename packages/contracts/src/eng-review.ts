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
// FB-17 (W13-22): G2 needs the figure, and a figure above $0 means capital is needed, so $0 is an answer.
export const BUDGETARY_CAPITAL_HELP =
  'A rough estimate for quoting. It is firmed up after award. Enter 0 when no capital is needed.';

const text = (max: number) => z.string().trim().max(max).nullable();
/** A pack-out count: a whole number from 1 to 9,999,999 (the domain's PACK_OUT_MAX). */
const PackOutCount = wholeNumber(1, 9_999_999).nullable();

// ── FB-23: the engineering cost estimate (the numbers are the domain's cost-estimate limits) ─────
/** A USD amount from 0 to 999,999,999.99, in cents (COST_AMOUNT_MAX_USD). */
const usdAmount = numberFrom(0, 999_999_999.99, 'USD').multipleOf(0.01, 'Enter the amount in cents');
/** Packers / operators per line: 0 to 99.99, fractional (LABOR_PER_LINE_MAX). */
const perLine = numberFrom(0, 99.99).multipleOf(0.01, 'Use at most two decimals');

/**
 * FB-23 (N18-04 to N18-07, D4): one cost line sent on a save. Lines sent are added or changed; a null
 * amount removes the line (blank = not used); lines not sent are left as they are. `quantity` is the
 * number of lower blow molds the freight was pre-filled for (freight only).
 */
export const CostLineBody = z
  .object({
    lineKey: z.string().trim().min(1).max(40),
    amountUsd: usdAmount.nullable(),
    description: z.string().trim().max(120).nullable().optional(),
    quantity: wholeNumber(1, 99).nullable().optional(),
  })
  .strict();
export type CostLineBody = z.infer<typeof CostLineBody>;

/**
 * PUT /api/v1/quotes/:quoteNumber/eng-review. Only the keys sent change; null clears a field.
 * `prelimCapitalUsd` is the **budgetary capital estimate** (F-064): preliminary, includes contingency, refined
 * after award and before any CER. The key keeps its name; only the label changed.
 *
 * FB-16 (W13-12, W13-13): the form sends the plant and one "Process & machine type" pick (`machineType`).
 * The server derives `processType` from it (`machine_type_process_map`) and refuses a machine type the
 * plant does not run. `processType` is still accepted on its own for an older client; when the machine
 * type changes, the derived value wins.
 */
export const EngReviewBody = z
  .object({
    processType: z.string().max(40).nullable(),
    machineType: z.string().max(40).nullable(),
    plantCode: z.string().max(40).nullable(),
    /** F-057: a whole number, 1 to 99. */
    cavitation: wholeNumber(1, 99).nullable(),
    cycleTimeS: numberFrom(0, 999_999, 'seconds', true).nullable(),
    /** FB-22 (N17-13): the form asks here whether the mold has a hot runner. */
    toolingNotes: text(4000),
    /**
     * FB-22 (N17-13, provisional): the machine platform the item is quoted on (its model or line). Free
     * text, not a list: platforms differ by plant and machines move.
     */
    machinePlatform: text(80),
    prelimCapitalUsd: numberFrom(0, 999_999_999_999, 'USD').nullable(),
    // FB-22 (N17-12): `technicalConceptNotes` and `supplyChainNotes` are no longer accepted (deprecated,
    // read-only "Legacy notes").
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
    // ── FB-23 (N18-03 to N18-10, D4, D5, D6; provisional): Jim's ECE Summary, per item ──
    /** Estimated mold lead time, free text ("16-18 weeks"). */
    moldLeadTime: text(40),
    packersPerLine: perLine.nullable(),
    operatorsPerLine: perLine.nullable(),
    /** A `pack_method` value-list code. With a method, only its count is kept (the others are cleared). */
    packMethod: z.string().max(40).nullable(),
    /** What the parts are packed in or on: item number (free text, D6) and description. */
    packContainerItemNo: text(40),
    packContainerDescription: text(120),
    containersPerLayer: wholeNumber(1, 9_999).nullable(),
    layersPerPallet: wholeNumber(1, 999).nullable(),
    /** With its unit, as typed ("96 in"). */
    palletBuildHeight: text(20),
    /** A `pallet_type` value-list code. */
    palletType: z.string().max(40).nullable(),
    /** Pallets per 53-ft trailer. */
    palletsPerTrailer: wholeNumber(1, 999).nullable(),
    specialPackagingNote: text(300),
    returnableDunnageDescription: text(200),
    returnableDunnageCostUsd: usdAmount.nullable(),
    /** D5: the markup noted on customer-funded tooling, 0 to 100 %; null = none noted (the default, 0). */
    toolingMarkupPct: numberFrom(0, 100, '%')
      .multipleOf(0.01, 'Use at most two decimals')
      .nullable(),
    /** Cost lines to add, change (an amount) or remove (null). */
    costLines: z.array(CostLineBody).max(40),
    /**
     * FB-19 (W13-34): the item this solution is for (a `quote_item` id). Omitted: item 1, as a one-item
     * quote has always written.
     */
    itemId: z.uuid(),
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
    assumedEffectivenessPct: z
      .number()
      // DR-engineering-02: 0% means no capacity at all, so utilization after cannot be calculated.
      .gt(0, 'Enter an assumed effectiveness above 0%, up to 100%')
      .max(100, 'Enter an assumed effectiveness above 0%, up to 100%')
      .nullable()
      .optional(),
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
  .object({
    rows: z.array(CapacityEvidenceRowBody).max(50),
    /** FB-19 (W13-34): the item whose rows these are (a `quote_item` id). Omitted: item 1. */
    itemId: z.uuid().optional(),
  })
  .strict();
export type CapacityEvidenceBody = z.infer<typeof CapacityEvidenceBody>;

/** FB-23: one stored cost line, with its label and group from config. */
export const CostLineView = z.object({
  lineKey: z.string(),
  /** From `engineering_cost_lines`; the key itself when the line is no longer in the config. */
  label: z.string(),
  group: z.enum(['tooling', 'new_line']),
  customerFunded: z.boolean(),
  amountUsd: z.number().optional(),
  description: z.string().nullable(),
  quantity: z.number().nullable(),
});
export type CostLineView = z.infer<typeof CostLineView>;

/** FB-23 (D5): an item's (or the quote's) totals. Markup fields are the item's only. */
export const CostTotalsView = z.object({
  projectTotalUsd: z.number(),
  customerFundedUsd: z.number(),
  netCostUsd: z.number(),
  customerToolingPriceUsd: z.number(),
  /** The markup applied (the noted one, else the default). Absent on the quote's sum. */
  markupPct: z.number().optional(),
  markupNoted: z.boolean().optional(),
});
export type CostTotalsView = z.infer<typeof CostTotalsView>;

/** FB-23 (N18-10): the pack-out calculation. */
export const PackOutFiguresView = z.object({
  piecesPerContainer: z.number().nullable(),
  containersPerPallet: z.number().nullable(),
  piecesPerPallet: z.number().nullable(),
  piecesPerPalletCalculated: z.boolean(),
  piecesPerTrailer: z.number().nullable(),
});
export type PackOutFiguresView = z.infer<typeof PackOutFiguresView>;

export const EngReviewFields = z.object({
  processType: z.string().nullable(),
  machineType: z.string().nullable(),
  plantCode: z.string().nullable(),
  cavitation: z.number().nullable(),
  cycleTimeS: z.number().nullable(),
  toolingNotes: z.string().nullable(),
  /** FB-22 (N17-13): the machine platform (free text, up to 80). */
  machinePlatform: z.string().nullable(),
  /**
   * Deprecated (FB-06, F-058): read-only "Legacy notes". The equipment BOM is now an upload; these two
   * free-text fields keep what was written before and accept no new writes.
   */
  downstreamEquipmentNotes: z.string().nullable(),
  /** Absent for roles without commercial access. */
  prelimCapitalUsd: z.number().nullable().optional(),
  /** Deprecated (FB-22, N17-12): read-only "Legacy notes"; no longer accepted on writes. */
  technicalConceptNotes: z.string().nullable(),
  /** Deprecated (FB-06): read-only legacy note, see `downstreamEquipmentNotes`. */
  equipmentBomNotes: z.string().nullable(),
  /** Deprecated (FB-22, N17-12): read-only "Legacy notes"; no longer accepted on writes. */
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
  // ── FB-23 (N18-03 to N18-10, D4, D5): the cost estimate and pack-out ──
  moldLeadTime: z.string().nullable(),
  packersPerLine: z.number().nullable(),
  operatorsPerLine: z.number().nullable(),
  packMethod: z.string().nullable(),
  packContainerItemNo: z.string().nullable(),
  packContainerDescription: z.string().nullable(),
  containersPerLayer: z.number().nullable(),
  layersPerPallet: z.number().nullable(),
  palletBuildHeight: z.string().nullable(),
  palletType: z.string().nullable(),
  palletsPerTrailer: z.number().nullable(),
  specialPackagingNote: z.string().nullable(),
  returnableDunnageDescription: z.string().nullable(),
  returnableDunnageCostUsd: z.number().nullable().optional(),
  toolingMarkupPct: z.number().nullable().optional(),
  /** The item's cost lines (only lines with a row; blank lines have none), in config order. */
  costLines: z.array(CostLineView).default([]),
  /** Calculated from the lines; null when no line has an amount. */
  costTotals: CostTotalsView.nullable().default(null),
  /** Calculated pack-out figures (blank when an input is missing, never 0). */
  packOut: PackOutFiguresView.nullable().default(null),
  /** Packers + operators per line; null when both are blank. */
  laborTotalPerLine: z.number().nullable().default(null),
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
  /**
   * FB-17 (W13-22): a G2 Advance needs the BOM when capital is needed. True while a G2 outcome that can
   * still be chosen carries the rule in its config (before FB-17: "Advance – capital required").
   */
  requiredForCapital: z.boolean(),
  /** FB-17: "Required to advance when preliminary capital is above $0" (the threshold is a setting). */
  requiredWhenText: z.string(),
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

/**
 * FB-19 (W13-32 to W13-34): one item's Engineering: its own solution, capacity rows and product facts.
 * The lead review, the assignment and the capacity sign-off are the quote's (on `EngineeringDetail`).
 */
export const EngItemView = z.object({
  /** The `quote_item` id (sent as `itemId` when saving this item's solution or capacity rows). */
  id: z.string(),
  itemNo: z.number().int(),
  label: z.string().nullable(),
  /** "Item 2 (24 oz bottle)". */
  name: z.string(),
  containerSize: z.string().nullable(),
  review: EngReviewFields,
  capacityEvidence: z.array(CapacityEvidenceRow),
  /** The item's estimated annual volume: the default allocation for its capacity rows. */
  annualVolume: z.number().nullable(),
  /** T-030: this item's rows do not add up to its volume (a warning, never a block). */
  allocationWarning: z.string().nullable(),
  selectedLabels: z.object({
    processType: z.string().nullable(),
    machineType: z.string().nullable(),
    plantCode: z.string().nullable(),
  }),
  productFacts: z.array(ProductFact),
  processPairLegacy: z.boolean(),
  /** What this item still needs before the engineer can submit it to the lead (the G2 rules per item). */
  toDo: z.array(z.string()),
});
export type EngItemView = z.infer<typeof EngItemView>;

/** The Engineering tab of a quote. Included in `QuoteDetail.engineering`. */
export const EngineeringDetail = z.object({
  /** The quote is in Engineering Review now. */
  inQueue: z.boolean(),
  assignedEngineerId: z.string().nullable(),
  assignedEngineerName: z.string().nullable(),
  assignedAt: z.string().nullable(),
  /**
   * FB-16 (W13-15, D-008 open, provisional): the production scheduler, the second assignee, who works the
   * capacity rows and the capacity sign-off. Null when the lead has not assigned one.
   */
  assignedSchedulerId: z.string().nullable(),
  assignedSchedulerName: z.string().nullable(),
  assignedSchedulerAt: z.string().nullable(),
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
  /**
   * B-26: the caller may record the sign-off (capacity.signoff, in Engineering Review). FB-16: the
   * production scheduler assigned to the quote, or the engineering lead.
   */
  canSignOffCapacity: z.boolean(),
  /**
   * FB-16 (W13-15): the caller may edit the capacity evidence rows (`capacity.edit`: the lead, the
   * assigned engineer, or the production scheduler assigned to the quote). `canEdit` is the solution.
   */
  canEditCapacity: z.boolean(),
  /**
   * FB-16 (W13-12): the stored process type does not fit what the machine type derives (an old quote, or
   * a retired machine type): both are kept and shown read-only until someone picks again.
   */
  processPairLegacy: z.boolean(),
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
  /**
   * FB-19: every item's Engineering, in item order. The top-level `review`, `capacityEvidence`,
   * `quoteAnnualVolume`, `allocationWarning`, `selectedLabels`, `productFacts` and `processPairLegacy` are
   * item 1's (what a one-item quote has always shown).
   */
  items: z.array(EngItemView).default([]),
  /** FB-23: the quote's cost totals, the sum over items (null when no item has a cost line). */
  costTotals: CostTotalsView.nullable().default(null),
  /**
   * FB-23 (D4): the KAM ticked returnable dunnage at intake, so the pack-out asks for the dunnage
   * description and estimated cost.
   */
  returnableDunnage: z.boolean().default(false),
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

// ── FB-16 (W13-20): the numeric rules of the Engineering forms, for validation as the user types ──

/**
 * One rule per numeric Engineering input, taken from the request schemas above so the form and the
 * server can never disagree (the form imports these; it does not copy the numbers). Each is the field's
 * own schema: optional and nullable as the request allows.
 */
export const ENG_INPUT_RULES = {
  cavitation: EngReviewBody.shape.cavitation,
  cycleTimeS: EngReviewBody.shape.cycleTimeS,
  prelimCapitalUsd: EngReviewBody.shape.prelimCapitalUsd,
  unitsPerBag: EngReviewBody.shape.unitsPerBag,
  unitsPerTray: EngReviewBody.shape.unitsPerTray,
  unitsPerCase: EngReviewBody.shape.unitsPerCase,
  unitsPerPallet: EngReviewBody.shape.unitsPerPallet,
  // FB-23
  packersPerLine: EngReviewBody.shape.packersPerLine,
  operatorsPerLine: EngReviewBody.shape.operatorsPerLine,
  containersPerLayer: EngReviewBody.shape.containersPerLayer,
  layersPerPallet: EngReviewBody.shape.layersPerPallet,
  palletsPerTrailer: EngReviewBody.shape.palletsPerTrailer,
  returnableDunnageCostUsd: EngReviewBody.shape.returnableDunnageCostUsd,
  toolingMarkupPct: EngReviewBody.shape.toolingMarkupPct,
  costAmountUsd: CostLineBody.shape.amountUsd,
  assumedEffectivenessPct: CapacityEvidenceRowBody.shape.assumedEffectivenessPct,
  rowCycleTimeS: CapacityEvidenceRowBody.shape.cycleTimeS,
  utilizationBeforePct: CapacityEvidenceRowBody.shape.utilizationBeforePct,
  allocatedAnnualVolume: CapacityEvidenceRowBody.shape.allocatedAnnualVolume,
  scheduledRunDaysPerYear: CapacityEvidenceRowBody.shape.scheduledRunDaysPerYear,
} as const;
export type EngInputField = keyof typeof ENG_INPUT_RULES;

/**
 * What is wrong with the text typed into a numeric Engineering input, in the server's own words, or null
 * when it is fine. Blank is fine here (whether a blank is allowed is the form's or the gate's concern);
 * anything that is not a number is "Enter a number".
 */
export function engInputError(field: EngInputField, text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 'Enter a number';
  const parsed = ENG_INPUT_RULES[field].safeParse(value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'This value is not valid');
}

export const ENGINEERING_PROBLEM_CODES = {
  notFound: 'not_found',
  notPermitted: 'not_permitted',
  rejected: 'engineering_change_rejected',
  conflict: 'engineering_conflict',
} as const;
