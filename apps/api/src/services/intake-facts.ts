import type { QuoteIntakeFacts } from '@ccq/contracts';
import type { Quote, QuoteItem } from '@ccq/db/repos';

/**
 * FB-02: the intake's product and timing facts as every reader of the quote sees them (Engineering and
 * Pricing included; CLAUDE.md rule 2: no role is hidden from data it can enter).
 */
export function intakeFactsDto(q: Quote): QuoteIntakeFacts {
  return {
    quoteNeededBy: q.quoteNeededBy,
    productNeededBy: q.productNeededBy,
    neckDiameter: q.neckDiameter,
    neckDiameterCustom: q.neckDiameterCustom,
    neckFinishType: q.neckFinishType,
    neckFinishTypeCustom: q.neckFinishTypeCustom,
    neckSpecialFeature: q.neckSpecialFeature,
    neckSpecialFeatureCustom: q.neckSpecialFeatureCustom,
    resinCustomerSpecified: q.resinCustomerSpecified,
    resinGrade: q.resinGrade,
    pcrLevel: q.pcrLevel,
    pcrLevelOther: q.pcrLevelOther,
    additive: q.additive,
    colorType: q.colorType,
    colorDescription: q.colorDescription,
    additives: q.additives,
    quoteVariantsNote: q.quoteVariantsNote,
    linerSpec: q.linerSpec,
    labelsPurchasedBy: q.labelsPurchasedBy,
    decorationTypes: q.decorationTypes,
    decorationPrintColors: q.decorationPrintColors,
    heightMm: q.heightMm,
    widthOrDiameterMm: q.widthOrDiameterMm,
    depthMm: q.depthMm,
    gramWeightG: q.gramWeightG,
    modifyExistingMold: q.modifyExistingMold,
    existingMoldRef: q.existingMoldRef,
    moldChangeDescription: q.moldChangeDescription,
    rfpLink: q.rfpLink,
    requestedPaymentTerms: q.requestedPaymentTerms,
    requestedPaymentTermsOther: q.requestedPaymentTermsOther,
    toolingFundingModel: q.toolingFundingModel,
    returnableDunnage: q.returnableDunnage,
    priceBasis: q.priceBasis,
    freightType: q.freightType,
    freightSpecialArrangements: q.freightSpecialArrangements,
    bidReference: q.bidReference,
    customerSharePct: q.customerSharePct,
    // FB-24 (N17-03, N18-02, D4): the concept's assumptions, the KAM's tooling answer, the stocking agreement.
    conceptAssumptions: q.conceptAssumptions,
    toolingCommitment: q.termsToolingCommitment,
    stockHoldRequested: q.stockHoldRequested,
    stockHoldWeeks: q.stockHoldWeeks,
    stockHoldNote: q.stockHoldNote,
    productFamilyOther: q.productFamilyOther,
    componentOther: q.componentOther,
    decorationTypeOther: q.decorationTypeOther,
    guardrailWarning: q.guardrailWarning,
  };
}

/** FB-02 (F-017): the destination's city and state, for queue rows and headers. */
export function shipCityState(shipTo: unknown): {
  shipCity: string | null;
  shipState: string | null;
} {
  const a = (shipTo ?? {}) as { city?: unknown; state?: unknown };
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { shipCity: text(a.city), shipState: text(a.state) };
}

/**
 * A stored quote's intake fields in the domain's snake_case shape (`evaluateIntake` input), the same
 * keys `intakeValues` gives a draft. Used for Engineering's completeness check on submitted quotes.
 */
export function quoteIntakeValues(q: Quote, customerName: string | null | undefined) {
  const structured = (q.structuredDescription ?? {}) as { standard?: string; size?: string };
  return {
    sf_opportunity_id: q.sfOpportunityId,
    customer: { name: customerName ?? null },
    ship_to: q.shipTo,
    ship_to_default: q.shipToOriginal,
    ship_to_override_reason: q.shipToOverrideReason,
    request_class: q.requestClass,
    concept_assumptions: q.conceptAssumptions,
    product_family: q.productFamily,
    product_family_other: q.productFamilyOther,
    components: q.components,
    component_other: q.componentOther,
    market: q.market,
    sub_market: q.subMarket,
    resin: q.resin,
    resin_customer_specified: q.resinCustomerSpecified,
    resin_grade: q.resinGrade,
    pcr_level: q.pcrLevel,
    pcr_level_other: q.pcrLevelOther,
    additive: q.additive,
    neck_diameter: q.neckDiameter,
    neck_diameter_custom: q.neckDiameterCustom,
    neck_finish_type: q.neckFinishType,
    neck_finish_type_custom: q.neckFinishTypeCustom,
    neck_special_feature: q.neckSpecialFeature,
    neck_special_feature_custom: q.neckSpecialFeatureCustom,
    color_type: q.colorType,
    color_description: q.colorDescription,
    additives: q.additives,
    quote_variants_note: q.quoteVariantsNote,
    liner_spec: q.linerSpec,
    labels_purchased_by: q.labelsPurchasedBy,
    decoration_types: q.decorationTypes,
    decoration_type_other: q.decorationTypeOther,
    decoration_print_colors: q.decorationPrintColors,
    height_mm: q.heightMm,
    width_or_diameter_mm: q.widthOrDiameterMm,
    depth_mm: q.depthMm,
    gram_weight_g: q.gramWeightG,
    modify_existing_mold: q.modifyExistingMold,
    existing_mold_ref: q.existingMoldRef,
    mold_change_description: q.moldChangeDescription,
    rfp_link: q.rfpLink,
    requested_payment_terms: q.requestedPaymentTerms,
    requested_payment_terms_other: q.requestedPaymentTermsOther,
    tooling_funding_model: q.toolingFundingModel,
    customer_share_pct: q.customerSharePct,
    returnable_dunnage: q.returnableDunnage,
    price_basis: q.priceBasis,
    freight_type: q.freightType,
    freight_special_arrangements: q.freightSpecialArrangements,
    bid_reference: q.bidReference,
    tooling_commitment: q.termsToolingCommitment,
    stock_hold_requested: q.stockHoldRequested,
    stock_hold_weeks: q.stockHoldWeeks,
    stock_hold_note: q.stockHoldNote,
    packaging_type: q.packagingType,
    packaging_notes: q.packagingNotes,
    est_annual_volume: q.estAnnualVolume,
    est_annual_volume_confirmed: q.estAnnualVolumeConfirmed,
    est_annual_revenue: q.estAnnualRevenue,
    quote_needed_by: q.quoteNeededBy,
    product_needed_by: q.productNeededBy,
    container_size: structured.size ?? null,
    standard_description: structured.standard ?? null,
    description: q.description,
    drawing_status: q.drawingStatus,
    comments_for_engineering: q.commentsForEngineering,
  };
}

/** The product columns a `quote_item` shares with `quote` (FB-19: the quote mirrors item 1's). */
const ITEM_PRODUCT_KEYS = [
  'productFamily',
  'productFamilyOther',
  'components',
  'componentOther',
  'linerSpec',
  'labelsPurchasedBy',
  'decorationTypes',
  'decorationTypeOther',
  'decorationPrintColors',
  'resin',
  'resinCustomerSpecified',
  'resinGrade',
  'pcrLevel',
  'pcrLevelOther',
  'colorType',
  'colorDescription',
  'additive',
  'additives',
  'neckDiameter',
  'neckDiameterCustom',
  'neckFinishType',
  'neckFinishTypeCustom',
  'neckSpecialFeature',
  'neckSpecialFeatureCustom',
  'heightMm',
  'widthOrDiameterMm',
  'depthMm',
  'gramWeightG',
  'modifyExistingMold',
  'existingMoldRef',
  'moldChangeDescription',
  'packagingType',
  'packagingNotes',
  'drawingStatus',
  'estAnnualVolume',
  'estAnnualVolumeConfirmed',
  'productNeededBy',
] as const;

/**
 * FB-19: the quote as one item sees it: the request from the quote, the product facts from the item
 * (and its container size and standard description in `structuredDescription`). For readers written
 * against a quote (the intake facts, the Engineering product facts).
 */
export function quoteWithItem(q: Quote, item: QuoteItem): Quote {
  const product = Object.fromEntries(ITEM_PRODUCT_KEYS.map((k) => [k, item[k]]));
  return {
    ...q,
    ...product,
    structuredDescription: {
      ...((q.structuredDescription ?? {}) as Record<string, unknown>),
      size: item.containerSize,
      standard: item.standardDescription,
    },
  };
}
