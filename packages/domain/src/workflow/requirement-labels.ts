import type { RequiredRule } from '../types/workflow-config';

const fieldsOf = (rule: RequiredRule): string[] =>
  'anyOf' in rule
    ? rule.anyOf.flatMap(fieldsOf)
    : 'allOf' in rule
      ? rule.allOf.flatMap(fieldsOf)
      : [rule.field];

/**
 * DR-engineering-03, DR-kam-sales-leader-03, DR-pricing-finance-02, DR-approver-leadership-admin-03,
 * DR-cross-cutting-07: plain words for every requirement a gate, outcome or intake rule can report, so a
 * user never reads a rule key ("prelim_capital_usd is required", "At least one of: … must equal false").
 *
 * The key is what a failing rule reports as its field (`requirementKey`): a leaf rule's field, or an
 * `anyOf` rule's fields joined by commas. A rule an Admin adds gets plain words by adding its key here;
 * until then the generated text is shown. `seeds.test.ts` fails when a seeded rule has no label.
 * Wording only: which fields are required stays config (`gate_outcome_definition`, `app_setting`).
 */
export const REQUIREMENT_LABELS: Readonly<Record<string, string>> = {
  // Intake (G1 and the intake submit)
  sf_opportunity_id: 'The Salesforce opportunity',
  'customer.name': 'The customer',
  customer_id: 'The customer',
  'ship_to.city': 'The ship-to city',
  'ship_to.state': 'The ship-to state',
  product_family: 'The product family',
  resin: 'The resin',
  est_annual_volume: 'The annual volume',
  'est_annual_volume,est_annual_revenue': 'An annual volume or an annual revenue',
  quote_needed_by: 'The "Quote needed by" date',
  product_needed_by: 'The "Product needed by" date',
  submitted_at: 'The intake, submitted by the KAM',
  // G2 Engineering
  process_type: 'Process type',
  machine_type: 'Machine type',
  plant_code: 'Plant / site',
  cavitation: 'Cavitation',
  cycle_time_s: 'Cycle time',
  capacity_evidence: 'At least one capacity evidence row',
  capacity_signoff_status: 'Capacity sign-off by the capacity owner',
  capacity_utilization_missing:
    'Utilization after calculated on every capacity row (effectiveness above 0%, cycle time and volume)',
  prelim_capital_usd: 'The budgetary capital estimate (Engineering tab)',
  equipment_bom_on_file: 'The equipment BOM uploaded on the Engineering tab',
  // G3 Quoting
  'pricing_record.price_approved_by': 'Price approver',
  'pricing_record.price_approved_at': 'Price approval date',
  'pricing_record.price_approved_by,pricing_record.price_approved_at,pass_through_eligible':
    'The price approval (approver and date), unless the quote is below the pass-through threshold',
  'pricing_record.costing_completed': 'Costing attested as complete (before the price)',
  'cost_model_on_file,pricing_record.cost_model_requirement':
    'The costing model, uploaded by Pricing on the Quoting tab',
  'roi_required,roi_model_on_file': 'The payback model, uploaded by Finance (this quote needs one)',
  'pricing_record.capital_readiness': 'Capital readiness',
  'pricing_record.capital_readiness,pricing_record.capital_pending_justification':
    'Capital readiness confirmed, or a justification for going ahead while it is pending',
  'capital_likely,pricing_record.capital_readiness':
    'Capital is flagged likely: confirm capital readiness (not required or pre-approved)',
  // G4 Final Review
  terms_checked_at: 'The terms check (tooling commitment, MOQ, payment terms)',
  'g4_terms_check_required,terms_checked_at':
    'The terms check by Sales or Pricing (tooling commitment, MOQ, payment terms)',
  'g4_terms_exception_check_required,terms_exception_open':
    "The pricing lead's approval of the payment-terms exception (it is waiting or was rejected: see Commercial terms)",
  'g4_terms_finalized_check_required,terms_finalized_at':
    "The approver's confirmation of the capital terms",
  'legal_review_required,legal_reviewed_on': 'The Legal review (a Legal trigger applies)',
  'legal_review_required,g4_legal_review_check_required,legal_reviewed_on':
    'The Legal review (a Legal trigger applies)',
  // G5 / G6
  accepted_at: 'The date the customer accepted',
  'validity_lapsed,decision_note':
    'A note saying why it is expired now (the proposal is still valid)',
  'handoff_record.cer_status': 'The CER approved, or marked not required',
  'handoff_record.completed_at': 'The receiving team accepted the hand-off',
  // Holds (any gate)
  review_date: 'A review date',
  hold_owner_id: 'A hold owner',
};

/** The key a failing rule reports as its field: the leaf's field, or an `anyOf`'s fields joined. */
export function requirementKey(rule: RequiredRule): string {
  return 'field' in rule ? rule.field : fieldsOf(rule).join(',');
}

/** Every key a rule can report (an `allOf` reports each child). */
export function requirementKeys(rule: RequiredRule): string[] {
  return 'allOf' in rule ? rule.allOf.flatMap(requirementKeys) : [requirementKey(rule)];
}

/** Plain words for a requirement key, or undefined when none is registered. */
export const requirementLabel = (key: string): string | undefined => REQUIREMENT_LABELS[key];
