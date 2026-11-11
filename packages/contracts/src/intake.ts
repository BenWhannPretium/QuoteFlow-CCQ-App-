import { z } from 'zod';

/**
 * KAM intake (B-07, F-03). Sales enters only what Sales can know: there is no plant, process type,
 * machine type, net capital, engineer, channel, product class or priority field (REQ-04, X-90).
 *
 * A draft is a work in progress owned by its creator; it becomes a quote (CCQ-YYYY-NNNNN) on submit.
 * Every field is optional in a draft. Which ones block the submit is decided by the domain from the
 * `intake_required_fields` setting, never by these schemas.
 */

const text = (max: number) => z.string().max(max).nullable().optional();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullable()
  .optional();

export const IntakeAddress = z.object({
  line1: text(200),
  city: text(120),
  state: text(80),
  postal: text(20),
  country: text(80),
});
export type IntakeAddress = z.infer<typeof IntakeAddress>;

export const CUSTOMER_STATUSES = ['existing', 'not_yet_established'] as const;

/**
 * FB-02 (F-007, D-011): the customer is always the Salesforce Account on the picked opportunity (new
 * accounts start in Salesforce). Nothing about the customer is typed: `name` is a display copy of the
 * Account name. `status` is the one KAM answer: `not_yet_established` = "Not yet a Pretium customer (no
 * ERP account)" (DEC-27, CLAUDE.md rule 7); it drives the `new_customer` Legal review trigger. The
 * name / location / contact columns of a not-yet-established customer are deprecated (kept, not written).
 */
export const IntakeCustomer = z.object({
  status: z.enum(CUSTOMER_STATUSES),
  sfAccountId: text(18),
  name: text(200),
});
export type IntakeCustomer = z.infer<typeof IntakeCustomer>;

export const IntakeDraftData = z.object({
  // Step 1: opportunity
  sfOpportunityId: z
    .string()
    .regex(/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/, 'Not a Salesforce id')
    .nullable()
    .optional(),
  /** Display copy of the picked opportunity (name, account, amount…) so a resumed draft renders offline. */
  sfOpportunityName: text(300),
  /**
   * FB-02 (F-008): the product facts the opportunity's Salesforce product specification supplied when
   * it was picked. The wizard shows these read-only with a "from Salesforce" tag (no double entry);
   * a null entry means SF had nothing usable and the KAM enters it.
   */
  sfPrefill: z
    .object({
      resin: text(60),
      neckDiameter: text(60),
      neckFinishType: text(60),
      neckFinishTypeCustom: text(120),
      estAnnualVolume: z.number().nullable().optional(),
      containerSize: text(60),
    })
    .nullable()
    .optional(),

  // Step 2: customer and ship / fill destination
  customer: IntakeCustomer.nullable().optional(),
  /** FB-02 (F-017, D-012): the ship / fill destination; city and state are required (config). */
  shipTo: IntakeAddress.nullable().optional(),
  /** The customer default the ship-to was pre-filled from. Kept when the KAM changes the ship-to. */
  shipToDefault: IntakeAddress.nullable().optional(),
  /** Required when shipTo differs from shipToDefault (a governed override once B-09 lands). */
  shipToOverrideReason: text(1000),

  // Step 3: product and volume (value-list codes)
  requestClass: text(60),
  productFamily: text(60),
  components: z.array(z.string().max(60)).max(20).optional(),
  /**
   * FB-02 (F-013): follow-ups of the picked components (`component` value-list meta `followUps`):
   * shown only while the component is picked, required then, cleared when it is not.
   */
  linerSpec: text(120),
  /** labels_purchased_by code (Customer / Pretium). */
  labelsPurchasedBy: text(60),
  /** decoration_type code. */
  decorationType: text(60),
  /** Whole number 1–12 (checked by the domain). */
  decorationPrintColors: z.number().nullable().optional(),
  market: text(60),
  /**
   * FB-12 (F-073): a `sub_market` code that belongs to `market` (the server checks it and clears it when the
   * market changes to one it does not belong to). Optional. It sets the strategic-fit score.
   */
  subMarket: text(60),
  resin: text(60),
  /** FB-02 (F-011): the customer specifies the resin; `resinGrade` (supplier / grade) is then required. */
  resinCustomerSpecified: z.boolean().optional(),
  /** e.g. "LyondellBasell Pro-fax 6331". */
  resinGrade: text(120),
  /** FB-02 (F-055): pcr_level code (0% / Virgin, 25, 30, 50, 100 %, Other; provisional). */
  pcrLevel: text(60),
  /** FB-09 (Danielle Leu): the customer-specified PCR level; required at submit while PCR is Other. */
  pcrLevelOther: text(120),
  /** FB-09: additive code (None / UV / Barrier / Antistat / Impact Modifier / Other; provisional). */
  additive: text(60),
  /**
   * FB-02 (F-010, Jim Zweifel's lists): the neck as three pick-lists. "Custom" (value-list meta
   * `freeText`) needs the matching short description. The old single `neckFinish` list is retired.
   */
  neckDiameter: text(60),
  neckDiameterCustom: text(120),
  neckFinishType: text(60),
  neckFinishTypeCustom: text(120),
  /** Optional. */
  neckSpecialFeature: text(60),
  neckSpecialFeatureCustom: text(120),
  /** FB-02 (F-023): color_type code (Natural / Custom color); Custom needs `colorDescription`. */
  colorType: text(60),
  colorDescription: text(120),
  /** FB-02 (F-023): optional short note on additives. FB-09: required, as the customer-specified additive, while the additive is Other. */
  additives: text(200),
  /**
   * FB-02 (F-075, interim answer to D-017 option B): the variants the customer wants priced, e.g.
   * "0/25/50% PCR; near-site vs ideal-site". The limit is the provisional setting
   * `intake_variants_note_max_length` (300), checked by the domain.
   */
  quoteVariantsNote: text(2000),
  packagingType: text(60),
  packagingNotes: text(2000),
  /**
   * FB-11 (D-032): commercial inputs Pricing needs before costing. All optional at submit (D-006 open):
   * a blank is a warning. `requestedPaymentTerms` is a `requested_payment_terms` code ("Other" needs
   * `requestedPaymentTermsOther`); it is flagged non-standard when it is not in `standard_payment_terms`.
   */
  requestedPaymentTerms: text(60),
  requestedPaymentTermsOther: text(120),
  /**
   * `tooling_funding_model` code: only WHETHER the customer funds any tooling (not how much or how).
   * The wizard preselects the list's default ("Not discussed"); the Commercial panel edits the same field.
   */
  toolingFundingModel: text(40),
  /** Customer wants returnable (multi-trip) dunnage; false = single-trip (F-063, dunnage only). */
  returnableDunnage: z.boolean().optional(),
  /** `price_basis` code (FOB Pretium plant / Delivered). */
  priceBasis: text(60),
  /** `freight_type` code, only while the price basis is delivered (cleared otherwise). */
  freightType: text(60),
  freightSpecialArrangements: text(200),
  /** F-085: an optional bid / program reference (≤ 60). A plain reference: it links nothing. */
  bidReference: text(60),
  /** Units per year. */
  estAnnualVolume: z.number().nullable().optional(),
  /** The KAM confirmed a round/placeholder-looking volume is real. */
  estAnnualVolumeConfirmed: z.boolean().optional(),
  /** USD per year; pre-filled from the SF amount, editable. */
  estAnnualRevenue: z.number().nullable().optional(),
  /** The SF amount it was pre-filled from (kept when edited). */
  estAnnualRevenueSf: z.number().nullable().optional(),
  /**
   * FB-02 (F-009): when the customer needs the quote (YYYY-MM-DD, after today). Feeds the `timing`
   * attribute of the priority score. Replaces the editable expected close date: the SF close date is
   * shown read-only from the latest sync (`IntakeDraft.sfCloseDate`) and not stored on the quote.
   */
  quoteNeededBy: isoDate,
  /** FB-02 (F-009): best estimate of the customer's launch need (YYYY-MM-DD), on or after quoteNeededBy. */
  productNeededBy: isoDate,
  /** Container size as Sales describes it (e.g. "16 oz"). Feeds the standard description. */
  containerSize: text(60),
  /** Standard description (suggested from the template, editable). */
  standardDescription: text(500),
  /** Free text. */
  description: text(4000),

  /**
   * FB-02 (F-016, D-018): product dimensions, mm and grams (2 decimals). Without a bottle or competitor
   * drawing attached, the fields in `intake_min_spec_fields` must all be filled to submit.
   */
  heightMm: z.number().nullable().optional(),
  widthOrDiameterMm: z.number().nullable().optional(),
  depthMm: z.number().nullable().optional(),
  gramWeightG: z.number().nullable().optional(),
  /**
   * FB-02 (F-015): modify an existing mold (in scope when capital or engineering review is needed).
   * When ticked, the existing mold / part number and what changes are required.
   */
  modifyExistingMold: z.boolean().optional(),
  existingMoldRef: text(60),
  moldChangeDescription: text(500),

  // Step 4: drawing and notes
  drawingStatus: text(60),
  /** FB-02 (F-014): optional customer RFP / portal link (https only, ≤ 500; checked by the domain). */
  rfpLink: text(500),
  commentsForEngineering: text(4000),
});
export type IntakeDraftData = z.infer<typeof IntakeDraftData>;

export const IntakeIssue = z.object({
  code: z.string(),
  /** snake_case field the issue is about (dotted for nested values, comma-separated for alternatives). */
  field: z.string(),
  message: z.string(),
  /** FB-02 (F-016): for DRAWING_OR_MIN_SPEC_REQUIRED, the minimum-spec fields still missing. */
  missing: z.array(z.string()).optional(),
});
export type IntakeIssue = z.infer<typeof IntakeIssue>;

export const IntakeEvaluation = z.object({
  /** Stop the submit. */
  blocking: z.array(IntakeIssue),
  /** Amber "Engineering may ask about this": never stop the submit. */
  warnings: z.array(IntakeIssue),
  ready: z.boolean(),
});
export type IntakeEvaluation = z.infer<typeof IntakeEvaluation>;

/** The active CCQ quote on an SF opportunity (one per opportunity), when the caller can see it. */
export const ActiveQuoteRef = z.object({
  quoteNumber: z.string(),
  stageKey: z.string(),
  status: z.string(),
});
export type ActiveQuoteRef = z.infer<typeof ActiveQuoteRef>;

export const INTAKE_STEPS = [1, 2, 3, 4] as const;

export const IntakeDraft = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  step: z.number().int().min(1).max(4),
  data: IntakeDraftData,
  evaluation: IntakeEvaluation,
  /**
   * FB-02 (F-008, T-009): the opportunity's close date from the latest Salesforce sync, shown read-only
   * ("updates with Salesforce"). Never stored on the draft or the quote.
   */
  sfCloseDate: z.string().nullable(),
  /** Set when the draft's opportunity already has an active quote: offer "Open existing". */
  activeQuote: ActiveQuoteRef.nullable(),
  /** Set when the draft reworks a quote returned at a gate (B-08): submit updates that quote. */
  rework: z
    .object({
      quoteNumber: z.string(),
      gateKey: z.string(),
      reasonLabel: z.string().nullable(),
      note: z.string().nullable(),
      decidedAt: z.string(),
      decidedByName: z.string().nullable(),
      /** FB-01 (F-030): the stage it was sent back from (e.g. QUOTING). */
      originStageKey: z.string().nullable(),
      /**
       * FB-01 (F-030): the KAM must answer "Did the scope change?" on submit (`scopeChanged`). No: it
       * goes straight back to `originStageKey`. Yes: it routes as a new submission.
       */
      askScopeChange: z.boolean(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IntakeDraft = z.infer<typeof IntakeDraft>;

// ── API ──────────────────────────────────────────────────────────────────────────────────────────

/** POST /api/v1/quotes/drafts */
export const CreateIntakeDraftBody = z.object({
  data: IntakeDraftData.default({}),
  step: z.number().int().min(1).max(4).default(1),
});
export type CreateIntakeDraftBody = z.input<typeof CreateIntakeDraftBody>;

/** PATCH /api/v1/quotes/drafts/:id (autosave). Top-level keys in `data` replace the stored ones. */
export const PatchIntakeDraftBody = z.object({
  data: IntakeDraftData.optional(),
  step: z.number().int().min(1).max(4).optional(),
});
export type PatchIntakeDraftBody = z.input<typeof PatchIntakeDraftBody>;

export const IntakeDraftParams = z.object({ id: z.uuid() });

export const IntakeDraftListQuery = z.object({
  /** Admin only: `false` lists every user's open drafts. Everyone else always gets their own. */
  mine: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export const IntakeDraftSummary = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  step: z.number().int(),
  sfOpportunityId: z.string().nullable(),
  sfOpportunityName: z.string().nullable(),
  customerName: z.string().nullable(),
  updatedAt: z.string(),
});
export type IntakeDraftSummary = z.infer<typeof IntakeDraftSummary>;

/** A quote returned to its KAM for rework and not resubmitted yet. */
export const ReturnedQuoteSummary = z.object({
  quoteNumber: z.string(),
  opportunityName: z.string().nullable(),
  customerName: z.string().nullable(),
  gateKey: z.string(),
  reasonLabel: z.string().nullable(),
  note: z.string().nullable(),
  returnedAt: z.string(),
  /** The open rework draft, once the KAM has started fixing it. */
  draftId: z.string().nullable(),
  /** FB-01 (F-030): the stage it was sent back from, and whether resubmitting asks about scope. */
  originStageKey: z.string().nullable(),
  askScopeChange: z.boolean(),
});
export type ReturnedQuoteSummary = z.infer<typeof ReturnedQuoteSummary>;

export const IntakeDraftListResponse = z.object({
  items: z.array(IntakeDraftSummary),
  /** The caller's quotes back from a gate for rework (B-08). */
  returned: z.array(ReturnedQuoteSummary).default([]),
});
export type IntakeDraftListResponse = z.infer<typeof IntakeDraftListResponse>;

/** POST /api/v1/quotes/drafts/:id/submit (body optional). */
export const SubmitIntakeBody = z
  .object({
    /**
     * FB-01 (F-030): required when resubmitting a quote Pricing sent back to the KAM (the draft's
     * `rework.askScopeChange`). false: straight back to Quoting with the same pricer. true: a new
     * submission (G1 if enabled, then Engineering). Ignored otherwise.
     */
    scopeChanged: z.boolean().optional(),
  })
  // No body at all is the usual submit (Fastify hands it over as null).
  .nullish();
export type SubmitIntakeBody = z.infer<typeof SubmitIntakeBody>;

export const SubmitIntakeResponse = z.object({
  quoteId: z.string(),
  quoteNumber: z.string(),
  stageKey: z.string(),
  status: z.string(),
  /** `G1`: waiting for the qualify decision. `ENG_REVIEW`: straight into the engineering queue. */
  routedTo: z.string(),
  /** Advisory priority score and tier (B-08); null when no scoring model is in effect. */
  priorityScore: z.number().nullable(),
  priorityTier: z.string().nullable(),
  /** True when the submit resubmitted a quote returned for rework. */
  resubmitted: z.boolean(),
  /** FB-01 (F-030): the KAM's scope answer (null when it was not asked). */
  scopeChanged: z.boolean().nullable(),
  /** FB-01 (F-030): the stage a no-scope-change resubmission resumed at (e.g. QUOTING); else null. */
  resumedAt: z.string().nullable(),
  /** FB-10 (T-011): why volume-band routing chose G1 or Engineering; null when routing is off. */
  routingReason: z.string().nullable(),
  warnings: z.array(IntakeIssue),
  /** B-16: files that came with the draft (now on the quote). */
  attachments: z.number().int(),
});
export type SubmitIntakeResponse = z.infer<typeof SubmitIntakeResponse>;

/** Problem `code`s the intake routes return (problem+json extension member). */
export const INTAKE_PROBLEM_CODES = {
  incomplete: 'intake_incomplete',
  activeQuoteExists: 'active_quote_exists',
  alreadySubmitted: 'draft_already_submitted',
  notFound: 'not_found',
  notOwner: 'not_draft_owner',
  /** The quote is not back with its KAM for rework (or the caller is not its KAM). */
  notReturned: 'quote_not_returned',
  /** FB-02 (F-067): the request class can't be submitted to CCQ (422; `blocking` lists it). */
  requestClassNotAllowed: 'REQUEST_CLASS_NOT_ALLOWED',
  /** FB-02 (F-016): no drawing and an incomplete minimum spec (422; `missing` names the fields). */
  drawingOrMinSpecRequired: 'DRAWING_OR_MIN_SPEC_REQUIRED',
  /** DR-cross-cutting-02: a list-backed field holds a code that is not an active value-list entry (422). */
  invalidListValue: 'invalid_list_value',
} as const;

// ── Draft → domain values ────────────────────────────────────────────────────────────────────────
// One mapping, used by the API (the authority at submit) and the wizard (instant feedback), so both
// feed the domain's `evaluateIntake` the same snake_case values.

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export const intakeAddress = (a: IntakeDraftData['shipTo']) =>
  a
    ? {
        line1: a.line1 ?? null,
        city: a.city ?? null,
        state: a.state ?? null,
        postal: a.postal ?? null,
        country: a.country ?? null,
      }
    : null;

/**
 * The draft's fields in the domain's snake_case shape (`evaluateIntake` input). `hasDrawingAttachment`
 * (FB-02, F-016) says whether a bottle or competitor drawing is attached to the draft (or, for a
 * rework, to the quote); the caller knows its files.
 */
export function intakeValues(data: IntakeDraftData, hasDrawingAttachment?: boolean) {
  const c = data.customer;
  return {
    sf_opportunity_id: data.sfOpportunityId ?? null,
    customer: c
      ? { status: c.status, sf_account_id: c.sfAccountId ?? null, name: c.name ?? null }
      : null,
    ship_to: intakeAddress(data.shipTo),
    ship_to_default: intakeAddress(data.shipToDefault),
    ship_to_override_reason: data.shipToOverrideReason ?? null,
    request_class: data.requestClass ?? null,
    product_family: data.productFamily ?? null,
    components: data.components ?? [],
    market: data.market ?? null,
    sub_market: data.subMarket ?? null,
    resin: data.resin ?? null,
    resin_customer_specified: data.resinCustomerSpecified ?? false,
    resin_grade: blank(data.resinGrade),
    pcr_level: data.pcrLevel ?? null,
    pcr_level_other: blank(data.pcrLevelOther),
    additive: data.additive ?? null,
    neck_diameter: data.neckDiameter ?? null,
    neck_diameter_custom: blank(data.neckDiameterCustom),
    neck_finish_type: data.neckFinishType ?? null,
    neck_finish_type_custom: blank(data.neckFinishTypeCustom),
    neck_special_feature: data.neckSpecialFeature ?? null,
    neck_special_feature_custom: blank(data.neckSpecialFeatureCustom),
    color_type: data.colorType ?? null,
    color_description: blank(data.colorDescription),
    additives: blank(data.additives),
    quote_variants_note: blank(data.quoteVariantsNote),
    liner_spec: blank(data.linerSpec),
    labels_purchased_by: data.labelsPurchasedBy ?? null,
    decoration_type: data.decorationType ?? null,
    decoration_print_colors: data.decorationPrintColors ?? null,
    height_mm: data.heightMm ?? null,
    width_or_diameter_mm: data.widthOrDiameterMm ?? null,
    depth_mm: data.depthMm ?? null,
    gram_weight_g: data.gramWeightG ?? null,
    modify_existing_mold: data.modifyExistingMold ?? false,
    existing_mold_ref: blank(data.existingMoldRef),
    mold_change_description: blank(data.moldChangeDescription),
    rfp_link: blank(data.rfpLink),
    ...(hasDrawingAttachment === undefined ? {} : { has_drawing_attachment: hasDrawingAttachment }),
    requested_payment_terms: data.requestedPaymentTerms ?? null,
    requested_payment_terms_other: blank(data.requestedPaymentTermsOther),
    tooling_funding_model: data.toolingFundingModel ?? null,
    returnable_dunnage: data.returnableDunnage ?? false,
    price_basis: data.priceBasis ?? null,
    freight_type: data.freightType ?? null,
    freight_special_arrangements: blank(data.freightSpecialArrangements),
    bid_reference: blank(data.bidReference),
    packaging_type: data.packagingType ?? null,
    packaging_notes: data.packagingNotes ?? null,
    est_annual_volume: data.estAnnualVolume ?? null,
    est_annual_volume_confirmed: data.estAnnualVolumeConfirmed ?? false,
    est_annual_revenue: data.estAnnualRevenue ?? null,
    quote_needed_by: data.quoteNeededBy ?? null,
    product_needed_by: data.productNeededBy ?? null,
    container_size: data.containerSize ?? null,
    standard_description: data.standardDescription ?? null,
    description: data.description ?? null,
    drawing_status: data.drawingStatus ?? null,
    comments_for_engineering: data.commentsForEngineering ?? null,
  };
}
