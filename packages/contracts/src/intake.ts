import { z } from 'zod';

import { SF_PRODUCT_SPECS_STATUSES, SfProductSpec } from './sf-product-spec';

/**
 * KAM intake (B-07, F-03). Sales enters only what Sales can know: there is no plant, process type,
 * machine type, net capital, engineer, channel, product class or priority field (REQ-04, X-90).
 *
 * A draft is a work in progress owned by its creator; it becomes a quote (CCQ-YYYY-NNNNN) on submit.
 * Every field is optional in a draft. Which ones block the submit is decided by the domain from the
 * `intake_required_fields` setting, never by these schemas.
 */

const text = (max: number) => z.string().max(max).nullable().optional();
/**
 * Upper bounds of what the columns hold, so an absurd figure is a 400 here and not a numeric overflow
 * (a 500) at submit: money is numeric(14,2), a dimension or weight numeric(10,2), a volume a bigint read as
 * a JS number.
 */
const MAX_MONEY = 999_999_999_999.99;
const MAX_MEASURE = 99_999_999.99;
const MAX_VOLUME = 1_000_000_000_000;

/**
 * The draft is read two ways. What a request SENDS is checked strictly: a date is a real calendar day (a
 * bare YYYY-MM-DD pattern let 2026-11-31 through to a 500, Postgres 22008) and a figure fits its column.
 * What is already STORED is only described: a draft saved before those checks existed (2026-11-17) can
 * hold such a value, stored drafts are never migrated, and the response schema is enforced on every
 * draft read and save. Reading a stored draft strictly turned "open my draft" into a 500, so the KAM
 * could not reach the field to fix it. The stored reading takes any date string and any number; the
 * value is refused the next time it is sent, where the wizard can mark the field.
 */
const fieldKinds = (stored: boolean) => ({
  isoDate: (stored ? z.string() : z.iso.date('Use YYYY-MM-DD')).nullable().optional(),
  bounded: (max: number) => (stored ? z.number() : z.number().max(max)).nullable().optional(),
});
type FieldKinds = ReturnType<typeof fieldKinds>;
const SENT = fieldKinds(false);
const STORED = fieldKinds(true);

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

/**
 * FB-02 (F-008): the product facts the opportunity's Salesforce product specification supplied when it
 * was picked. The wizard pre-fills these with a "from Salesforce" tag (no double entry) and the KAM may
 * change them; a null entry means SF had nothing usable and the KAM enters it. FB-19: per item (each
 * item added from a Salesforce product carries its own).
 */
const sfPrefillOf = ({ bounded }: FieldKinds) =>
  z.object({
    resin: text(60),
    neckDiameter: text(60),
    neckFinishType: text(60),
    neckFinishTypeCustom: text(120),
    estAnnualVolume: bounded(MAX_VOLUME),
    containerSize: text(60),
  });
export const IntakeSfPrefill = sfPrefillOf(SENT);
export type IntakeSfPrefill = z.infer<typeof IntakeSfPrefill>;

/** FB-19 (W13-32, decision 3): the product fields, entered per item. Value-list codes unless noted. */
const productShapeOf = (kinds: FieldKinds) => ({
  sfPrefill: sfPrefillOf(kinds).nullable().optional(),
  productFamily: text(60),
  /** FB-15 (W13-03): what an "Other" product family is (≤ intake_other_description_max_length). */
  productFamilyOther: text(500),
  components: z.array(z.string().max(60)).max(20).optional(),
  /** FB-15 (W13-03): what the "Other" component is. */
  componentOther: text(500),
  /**
   * FB-02 (F-013): follow-ups of the picked components (`component` value-list meta `followUps`):
   * shown only while the component is picked, required then, cleared when it is not.
   */
  linerSpec: text(120),
  /** labels_purchased_by code (Customer / Pretium). */
  labelsPurchasedBy: text(60),
  /**
   * Deprecated by FB-24 (N17-02): one decoration_type code. Still read (a draft or client from before
   * FB-24) as `decorationTypes: [code]` when `decorationTypes` is absent; never written by the wizard.
   */
  decorationType: text(60),
  /** FB-24 (N17-02): decoration_type codes, several at once (checkboxes). "Other" has one description. */
  decorationTypes: z.array(z.string().max(60)).max(20).optional(),
  /** FB-15 (W13-03): what an "Other" decoration is. */
  decorationTypeOther: text(500),
  /** Whole number 1–12 (checked by the domain). */
  decorationPrintColors: z.number().nullable().optional(),
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
  packagingType: text(60),
  packagingNotes: text(2000),
  /** Units per year. FB-19: per item; the quote's volume is the sum of its items'. */
  estAnnualVolume: kinds.bounded(MAX_VOLUME),
  /** The KAM confirmed a round/placeholder-looking volume is real. */
  estAnnualVolumeConfirmed: z.boolean().optional(),
  /**
   * FB-02 (F-009): best estimate of the customer's launch need (YYYY-MM-DD), on or after quoteNeededBy.
   * FB-19 (Zachary Cairns): per item, since items can be needed at different dates.
   */
  productNeededBy: kinds.isoDate,
  /** Container size as Sales describes it (e.g. "16 oz"). Feeds the standard description. */
  containerSize: text(60),
  /** Standard description (suggested from the template, editable). */
  standardDescription: text(500),
  /**
   * FB-02 (F-016, D-018): product dimensions, mm and grams (2 decimals). Without a bottle or competitor
   * drawing attached, the fields in `intake_min_spec_fields` must all be filled to submit.
   */
  heightMm: kinds.bounded(MAX_MEASURE),
  widthOrDiameterMm: kinds.bounded(MAX_MEASURE),
  depthMm: kinds.bounded(MAX_MEASURE),
  gramWeightG: kinds.bounded(MAX_MEASURE),
  /**
   * FB-02 (F-015): modify an existing mold (in scope when capital or engineering review is needed).
   * When ticked, the existing mold / part number and what changes are required.
   */
  modifyExistingMold: z.boolean().optional(),
  existingMoldRef: text(60),
  moldChangeDescription: text(500),
  drawingStatus: text(60),
});
const productShape = productShapeOf(SENT);

/** The camelCase product fields of an item (the draft keys of `productShape`). */
export const INTAKE_ITEM_FIELDS = Object.keys(productShape) as (keyof typeof productShape)[];

/** FB-24 (N17-05): the longest item name (characters); was 60. As `quote_item_label_length_check`. */
export const ITEM_LABEL_MAX = 120;

/** FB-24 (N17-01): where the intake's ship-to was pre-filled from (`app_setting.ship_to_sources`). */
export const SHIP_TO_SOURCE_VALUES = ['product_spec', 'account'] as const;
export type ShipToSource = (typeof SHIP_TO_SOURCE_VALUES)[number];

const ITEM_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * FB-19 (W13-32 to W13-34): one item of an intake. `key` identifies it while the KAM edits (a uuid the
 * wizard makes); once the quote exists it is the `quote_item` id. A drawing uploaded for the item carries
 * the key (`attachment.quote_item_id`). `linkedDrawingIds`: drawings another item holds that this one
 * uses too (Duplicate copies them as links; at submit each becomes this item's own link to the same file).
 */
const itemDataOf = (kinds: FieldKinds) =>
  z.object({
    key: z.string().regex(ITEM_KEY, 'Not an item key'),
    /** The KAM's short name for the item, e.g. "16 oz bottle" (≤ 120; FB-24, N17-05). */
    label: text(ITEM_LABEL_MAX),
    /** The Salesforce product specification the item was added from. */
    sfProductSpecId: text(40),
    linkedDrawingIds: z.array(z.string().regex(ITEM_KEY)).max(50).optional(),
    /** The key of the item this one was duplicated from (F-084), for the audit; omitted otherwise. */
    duplicatedFrom: z.string().regex(ITEM_KEY).optional(),
    ...productShapeOf(kinds),
  });
export const IntakeItemData = itemDataOf(SENT);
export type IntakeItemData = z.infer<typeof IntakeItemData>;

/** Hard cap on items in a draft (the business limit is the setting `quote_items_max`, checked by the domain). */
export const INTAKE_ITEMS_HARD_MAX = 200;

const draftDataOf = (kinds: FieldKinds) =>
  z.object({
    // Step 1: opportunity
    sfOpportunityId: z
      .string()
      .regex(/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/, 'Not a Salesforce id')
      .nullable()
      .optional(),
    /** Display copy of the picked opportunity (name, account, amount…) so a resumed draft renders offline. */
    sfOpportunityName: text(300),
    /**
     * FB-15 (W13-04): EVERY product specification Salesforce returned when the opportunity was picked.
     * Request-level. FB-19: "Add from Salesforce products" turns each into an item.
     */
    sfProductSpecs: z.array(SfProductSpec).max(50).optional(),
    /**
     * FB-15 (W13-04): what the pick learned about product details: `found`, `none` (Salesforce has no
     * product specification for the opportunity) or `unavailable` (the live read failed). The product
     * step says so, so the KAM knows why nothing was pre-filled.
     */
    sfProductSpecsStatus: z.enum(SF_PRODUCT_SPECS_STATUSES).nullable().optional(),
    /**
     * FB-19 (W13-33): the KAM confirmed the warning that the opportunity already has an active quote and
     * starts a separate one. Needed to submit while `opportunity_active_quotes` is `warn`.
     */
    separateQuoteConfirmed: z.boolean().optional(),

    // Step 2: customer and ship / fill destination
    customer: IntakeCustomer.nullable().optional(),
    /** FB-02 (F-017, D-012): the ship / fill destination; city and state are required (config). */
    shipTo: IntakeAddress.nullable().optional(),
    /** The customer default the ship-to was pre-filled from. Kept when the KAM changes the ship-to. */
    shipToDefault: IntakeAddress.nullable().optional(),
    /** Required when shipTo differs from shipToDefault (a governed override once B-09 lands). */
    shipToOverrideReason: text(1000),
    /**
     * FB-24 (N17-01): where `shipToDefault` came from (`ship_to_sources`): the opportunity's product
     * specification or the Account. Null when nothing had a city and a state (the KAM types it).
     */
    shipToSource: z.enum(SHIP_TO_SOURCE_VALUES).nullable().optional(),
    /**
     * FB-24 (N17-01): the opportunity's free-text "Ship to Locations" (Ship_to_Locations__c), shown
     * read-only above the ship-to so the KAM can copy from it. Never parsed into the address.
     */
    sfShipToLocations: text(1000),

    // Step 3: the request (entered once per quote)
    requestClass: text(60),
    /**
     * FB-24 (N17-03): what a concept / innovation quote assumes (a class in `intake_min_spec_exempt_classes`;
     * required then, ≤ 1,000 checked by the domain). Cleared for any other class at submit.
     */
    conceptAssumptions: text(4000),
    market: text(60),
    /**
     * FB-12 (F-073): a `sub_market` code that belongs to `market` (the server checks it and clears it when the
     * market changes to one it does not belong to). It sets the strategic-fit score.
     */
    subMarket: text(60),
    /**
     * FB-02 (F-075, interim answer to D-017 option B): the variants the customer wants priced, e.g.
     * "0/25/50% PCR; near-site vs ideal-site". The limit is the provisional setting
     * `intake_variants_note_max_length` (300), checked by the domain. FB-19: a variant can also be an item.
     */
    quoteVariantsNote: text(2000),
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
    /**
     * FB-15 (W13-09, provisional): when funding is Shared, the customer's share in percent (0–100, a whole
     * number or one decimal; checked by the domain). Pretium covers the rest. Cleared for any other funding.
     */
    customerSharePct: z.number().nullable().optional(),
    /** Customer wants returnable (multi-trip) dunnage; false = single-trip (F-063, dunnage only). */
    returnableDunnage: z.boolean().optional(),
    /**
     * FB-24 (N18-02): "Will the customer commit to the tooling?" true / false; null = not known yet. The
     * same quote column the Commercial terms panel edits (`terms_tooling_commitment`). Optional.
     */
    toolingCommitment: z.boolean().nullable().optional(),
    /**
     * FB-24 (Ben's decision D4): the customer wants Pretium to hold stock for it. true / false; null = not
     * known yet. Optional. The weeks (a whole number, 1–520) and the note (≤ 300) apply only to a yes.
     */
    stockHoldRequested: z.boolean().nullable().optional(),
    stockHoldWeeks: z.number().nullable().optional(),
    stockHoldNote: text(2000),
    /** `price_basis` code (FOB Pretium plant / Delivered). */
    priceBasis: text(60),
    /** `freight_type` code, only while the price basis is delivered (cleared otherwise). */
    freightType: text(60),
    freightSpecialArrangements: text(200),
    /** F-085: an optional bid / program reference (≤ 60). A plain reference: it links nothing. */
    bidReference: text(60),
    /** USD per year; pre-filled from the SF amount, editable. FB-19: once per quote, never summed from items. */
    estAnnualRevenue: kinds.bounded(MAX_MONEY),
    /** The SF amount it was pre-filled from (kept when edited). */
    estAnnualRevenueSf: kinds.bounded(MAX_MONEY),
    /**
     * FB-02 (F-009): when the customer needs the quote (YYYY-MM-DD, after today). Feeds the `timing`
     * attribute of the priority score. Replaces the editable expected close date: the SF close date is
     * shown read-only from the latest sync (`IntakeDraft.sfCloseDate`) and not stored on the quote.
     */
    quoteNeededBy: kinds.isoDate,
    /** Free text. */
    description: text(4000),

    // Step 3: the items (FB-19). A draft saved before FB-19 has none: its flat product fields are item 1.
    items: z.array(itemDataOf(kinds)).max(INTAKE_ITEMS_HARD_MAX).optional(),
    /**
     * Before FB-19 the product fields sat at the top level. They are still accepted (an older client, a
     * fixture) and read as item 1 when `items` is absent; the server moves them into `items` on save.
     */
    ...productShapeOf(kinds),

    // Step 4: drawing and notes
    /** FB-02 (F-014): optional customer RFP / portal link (https only, ≤ 500; checked by the domain). */
    rfpLink: text(500),
    commentsForEngineering: text(4000),
  });
/** What a request may send (create, autosave): every value checked. */
export const IntakeDraftData = draftDataOf(SENT);
/** What a stored draft may hold: see `fieldKinds`. The shape a draft is returned in. */
export const StoredIntakeDraftData = draftDataOf(STORED);
export type IntakeDraftData = z.infer<typeof IntakeDraftData>;

export const IntakeIssue = z.object({
  code: z.string(),
  /** snake_case field the issue is about (dotted for nested values, comma-separated for alternatives). */
  field: z.string(),
  message: z.string(),
  /** FB-02 (F-016): for DRAWING_OR_MIN_SPEC_REQUIRED, the minimum-spec fields still missing. */
  missing: z.array(z.string()).optional(),
  /** FB-19: the item (1…n) a product-field issue belongs to (its Fix opens that item); absent otherwise. */
  item: z.number().int().positive().optional(),
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

/** An active CCQ quote on an SF opportunity, when the caller can see it. */
export const ActiveQuoteRef = z.object({
  quoteNumber: z.string(),
  stageKey: z.string(),
  status: z.string(),
});
export type ActiveQuoteRef = z.infer<typeof ActiveQuoteRef>;

/**
 * FB-19 (W13-33): an active quote on the draft's opportunity, whoever owns it (read in system context):
 * only its number and its KAM's name, never any other field.
 */
export const OpenQuoteOnOpportunity = z.object({
  quoteNumber: z.string(),
  kamName: z.string().nullable(),
});
export type OpenQuoteOnOpportunity = z.infer<typeof OpenQuoteOnOpportunity>;

/** FB-19 (W13-33): `app_setting.opportunity_active_quotes`. */
export const OPPORTUNITY_ACTIVE_QUOTES_MODES = ['one', 'warn'] as const;

export const INTAKE_STEPS = [1, 2, 3, 4] as const;

export const IntakeDraft = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  step: z.number().int().min(1).max(4),
  // The stored reading: a draft saved before a check was added must still open (see `fieldKinds`).
  data: StoredIntakeDraftData,
  evaluation: IntakeEvaluation,
  /**
   * FB-02 (F-008, T-009): the opportunity's close date from the latest Salesforce sync, shown read-only
   * ("updates with Salesforce"). Never stored on the draft or the quote.
   */
  sfCloseDate: z.string().nullable(),
  /** Set when the draft's opportunity already has an active quote the caller can see: offer "Open existing". */
  activeQuote: ActiveQuoteRef.nullable(),
  /**
   * FB-19 (W13-33): every active quote on the draft's opportunity, whoever owns it (number and KAM only),
   * the configured warning naming them, and whether a separate quote is allowed (`warn`, after the KAM
   * confirms: `separateQuoteConfirmed`) or refused (`one`). Empty / null for a rework.
   */
  openQuotes: z.array(OpenQuoteOnOpportunity).default([]),
  openQuoteWarning: z.string().nullable().default(null),
  openQuotesMode: z.enum(OPPORTUNITY_ACTIVE_QUOTES_MODES).default('warn'),
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
  /**
   * FB-26 (N17-30): set when the draft is a linked re-quote of an expired quote: submit creates a NEW
   * quote linked to it. `banner` is what the wizard shows at the top.
   */
  requote: z
    .object({
      quoteNumber: z.string(),
      /** The old quote's validity date (`YYYY-MM-DD`), when it had one. */
      expiredOn: z.string().nullable(),
      banner: z.string(),
    })
    .nullable()
    .default(null),
  /**
   * FB-15 (W13-01): for a rework, the list codes the quote already holds (snake_case field → codes). A code
   * retired since stays acceptable on resubmit; the wizard passes these to the same check the server runs.
   */
  keptListValues: z.record(z.string(), z.array(z.string())).default({}),
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
  /**
   * Read as stored, not as sent: the wizard sends the whole draft on every save, so a value an older
   * build stored (see `fieldKinds`) would otherwise refuse every save, whatever field was edited. The
   * server checks strictly the values a save changes (`refusedDraftValues`), as it does for list codes.
   */
  data: StoredIntakeDraftData.optional(),
  step: z.number().int().min(1).max(4).optional(),
  /**
   * DR-kam-sales-leader-05: the draft's `updatedAt` this save was made from. When the stored draft has
   * changed since (another tab or window saved it), the save is refused with 409 `draft_changed`
   * instead of silently overwriting the other change. Omitted: no check (older clients).
   */
  expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
});
export type PatchIntakeDraftBody = z.input<typeof PatchIntakeDraftBody>;

/**
 * The values in `data` a request may not send (an impossible day, a figure beyond its column), each with
 * its path inside the draft data. Empty when every value passes the strict reading.
 */
export function refusedDraftValues(
  data: IntakeDraftData,
): { path: (string | number)[]; message: string }[] {
  const parsed = IntakeDraftData.safeParse(data);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    path: issue.path.filter((p): p is string | number => typeof p !== 'symbol'),
    message: issue.message,
  }));
}

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
  /** FB-19: more items than `quote_items_max`, or two items with one key (422). */
  invalidItems: 'invalid_items',
  /** FB-02 (F-016): no drawing and an incomplete minimum spec (422; `missing` names the fields). */
  drawingOrMinSpecRequired: 'DRAWING_OR_MIN_SPEC_REQUIRED',
  /** DR-kam-sales-leader-05: the draft was saved elsewhere (another tab) since this copy was loaded (409). */
  draftChanged: 'draft_changed',
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
 * FB-19: the key a draft saved before FB-19 gives its one item when it is read without being saved
 * (the server gives every item a real key when it saves the draft).
 */
export const LEGACY_ITEM_KEY = '00000000-0000-4000-8000-000000000001';

/** FB-19: the product fields a draft saved before FB-19 holds at its top level, as one item. */
export function itemFromFlat(data: IntakeDraftData, key: string = LEGACY_ITEM_KEY): IntakeItemData {
  const item: Record<string, unknown> = { key };
  for (const f of INTAKE_ITEM_FIELDS) {
    if (data[f] !== undefined) item[f] = data[f];
  }
  return item as IntakeItemData;
}

/**
 * FB-19: the draft's items, in item order: `items` when the draft has them (even none), otherwise one
 * item from the top-level product fields (a draft saved before FB-19, an older client).
 */
export function draftItems(data: IntakeDraftData): IntakeItemData[] {
  return data.items ?? [itemFromFlat(data)];
}

/**
 * FB-19: the draft as it is stored: every product field inside `items` (a draft without `items` gets one
 * item from its top-level product fields, keyed by `newKey`), and no product field at the top level.
 */
export function normalizeDraftData(data: IntakeDraftData, newKey: () => string): IntakeDraftData {
  const items = data.items ?? [itemFromFlat(data, newKey())];
  const out: Record<string, unknown> = { ...data, items };
  for (const f of INTAKE_ITEM_FIELDS) delete out[f];
  return out;
}

/**
 * FB-24 (N17-02): an item's decoration types. `decorationTypes` when the item has it; otherwise the
 * deprecated single `decorationType` as a one-code list (a draft or client from before FB-24).
 */
export function itemDecorationTypes(
  item: Pick<IntakeItemData, 'decorationType' | 'decorationTypes'>,
) {
  if (item.decorationTypes !== undefined) return [...item.decorationTypes];
  return item.decorationType ? [item.decorationType] : [];
}

/** One item's product fields in the domain's snake_case shape (an entry of `intakeValues(...).items`). */
export function intakeItemValues(item: IntakeItemData, hasDrawingAttachment?: boolean) {
  return {
    label: blank(item.label),
    sf_product_spec_id: item.sfProductSpecId ?? null,
    product_family: item.productFamily ?? null,
    product_family_other: blank(item.productFamilyOther),
    components: item.components ?? [],
    component_other: blank(item.componentOther),
    resin: item.resin ?? null,
    resin_customer_specified: item.resinCustomerSpecified ?? false,
    resin_grade: blank(item.resinGrade),
    pcr_level: item.pcrLevel ?? null,
    pcr_level_other: blank(item.pcrLevelOther),
    additive: item.additive ?? null,
    neck_diameter: item.neckDiameter ?? null,
    neck_diameter_custom: blank(item.neckDiameterCustom),
    neck_finish_type: item.neckFinishType ?? null,
    neck_finish_type_custom: blank(item.neckFinishTypeCustom),
    neck_special_feature: item.neckSpecialFeature ?? null,
    neck_special_feature_custom: blank(item.neckSpecialFeatureCustom),
    color_type: item.colorType ?? null,
    color_description: blank(item.colorDescription),
    additives: blank(item.additives),
    liner_spec: blank(item.linerSpec),
    labels_purchased_by: item.labelsPurchasedBy ?? null,
    decoration_types: itemDecorationTypes(item),
    decoration_type_other: blank(item.decorationTypeOther),
    decoration_print_colors: item.decorationPrintColors ?? null,
    height_mm: item.heightMm ?? null,
    width_or_diameter_mm: item.widthOrDiameterMm ?? null,
    depth_mm: item.depthMm ?? null,
    gram_weight_g: item.gramWeightG ?? null,
    modify_existing_mold: item.modifyExistingMold ?? false,
    existing_mold_ref: blank(item.existingMoldRef),
    mold_change_description: blank(item.moldChangeDescription),
    ...(hasDrawingAttachment === undefined ? {} : { has_drawing_attachment: hasDrawingAttachment }),
    packaging_type: item.packagingType ?? null,
    packaging_notes: item.packagingNotes ?? null,
    est_annual_volume: item.estAnnualVolume ?? null,
    est_annual_volume_confirmed: item.estAnnualVolumeConfirmed ?? false,
    product_needed_by: item.productNeededBy ?? null,
    container_size: item.containerSize ?? null,
    standard_description: item.standardDescription ?? null,
    drawing_status: item.drawingStatus ?? null,
  };
}
export type IntakeItemValues = ReturnType<typeof intakeItemValues>;

/**
 * The draft's fields in the domain's snake_case shape (`evaluateIntake` input): the request fields, and
 * FB-19 `items` (one entry per item, `draftItems`). `hasDrawingAttachment` (FB-02, F-016) says whether a
 * bottle or competitor drawing is attached; FB-19: per item (the caller knows its files and which item
 * each belongs to), or one answer for every item. FB-24: `hasRenderAttachment`, a sample photo / render.
 */
export function intakeValues(
  data: IntakeDraftData,
  hasDrawingAttachment?: boolean | ((item: IntakeItemData, index: number) => boolean),
  /** FB-24 (N17-03): a sample photo / render is on file (request level); omitted when not known. */
  hasRenderAttachment?: boolean,
) {
  const c = data.customer;
  return {
    sf_opportunity_id: data.sfOpportunityId ?? null,
    ...(hasRenderAttachment === undefined ? {} : { has_render_attachment: hasRenderAttachment }),
    customer: c
      ? { status: c.status, sf_account_id: c.sfAccountId ?? null, name: c.name ?? null }
      : null,
    ship_to: intakeAddress(data.shipTo),
    ship_to_default: intakeAddress(data.shipToDefault),
    ship_to_override_reason: data.shipToOverrideReason ?? null,
    request_class: data.requestClass ?? null,
    concept_assumptions: blank(data.conceptAssumptions),
    market: data.market ?? null,
    sub_market: data.subMarket ?? null,
    quote_variants_note: blank(data.quoteVariantsNote),
    rfp_link: blank(data.rfpLink),
    requested_payment_terms: data.requestedPaymentTerms ?? null,
    requested_payment_terms_other: blank(data.requestedPaymentTermsOther),
    tooling_funding_model: data.toolingFundingModel ?? null,
    customer_share_pct: data.customerSharePct ?? null,
    returnable_dunnage: data.returnableDunnage ?? false,
    tooling_commitment: data.toolingCommitment ?? null,
    stock_hold_requested: data.stockHoldRequested ?? null,
    stock_hold_weeks: data.stockHoldWeeks ?? null,
    stock_hold_note: blank(data.stockHoldNote),
    price_basis: data.priceBasis ?? null,
    freight_type: data.freightType ?? null,
    freight_special_arrangements: blank(data.freightSpecialArrangements),
    bid_reference: blank(data.bidReference),
    est_annual_revenue: data.estAnnualRevenue ?? null,
    quote_needed_by: data.quoteNeededBy ?? null,
    description: data.description ?? null,
    comments_for_engineering: data.commentsForEngineering ?? null,
    items: draftItems(data).map((item, index) =>
      intakeItemValues(
        item,
        typeof hasDrawingAttachment === 'function'
          ? hasDrawingAttachment(item, index)
          : hasDrawingAttachment,
      ),
    ),
  };
}
export type IntakeValues = ReturnType<typeof intakeValues>;
