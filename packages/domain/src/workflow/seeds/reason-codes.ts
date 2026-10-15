import type { ReasonCodeDefinition } from '../../types/workflow-config';

/**
 * Placeholder taxonomy so the engine has valid codes to test against. The real list is open decision D-15
 * (outcome taxonomy, reason codes, closure owner), so every entry is provisional.
 */
const CODES: Record<string, [code: string, label: string][]> = {
  rework: [
    ['missing_information', 'Missing information'],
    ['scope_unclear', 'Scope unclear'],
    ['wrong_specification', 'Wrong specification'],
    ['other', 'Other'],
  ],
  redirect: [
    ['stock_item', 'Stock item'],
    ['price_inquiry', 'Price inquiry'],
    ['other_capital_route', 'Other capital route'],
    ['other', 'Other'],
  ],
  stop: [
    ['below_minimum_threshold', 'Below minimum value/volume'],
    ['not_strategic', 'Not strategic'],
    ['duplicate', 'Duplicate request'],
    ['customer_withdrew', 'Customer withdrew'],
    ['other', 'Other'],
  ],
  decline: [
    ['margin_below_floor', 'Margin below floor'],
    ['capacity_unavailable', 'Capacity unavailable'],
    ['capital_not_approved', 'Capital not approved'],
    ['strategic_misfit', 'Strategic misfit'],
    ['other', 'Other'],
  ],
  lost: [
    ['price', 'Price'],
    ['lead_time', 'Lead time'],
    ['technical_capability', 'Technical capability'],
    ['incumbent_supplier', 'Incumbent supplier retained'],
    ['customer_cancelled', 'Customer cancelled'],
    ['other', 'Other'],
  ],
  expired: [
    ['no_response', 'No customer response'],
    ['validity_lapsed', 'Proposal validity lapsed'],
  ],
  hold: [
    ['awaiting_customer_info', 'Awaiting customer information'],
    ['awaiting_capital_decision', 'Awaiting capital decision'],
    ['awaiting_internal_input', 'Awaiting internal input'],
    ['customer_requested_delay', 'Customer requested delay'],
  ],
  requote: [
    ['scope_change', 'Scope change'],
    ['price_change', 'Price change'],
    ['volume_change', 'Volume change'],
    ['validity_lapsed', 'Proposal validity lapsed'],
  ],
  override: [
    ['priority_correction', 'Priority correction'],
    ['strategic_account', 'Strategic account'],
  ],
};

export const SEED_REASON_CODES: ReasonCodeDefinition[] = Object.entries(CODES).flatMap(
  ([context, codes]) =>
    codes.map(([code, label]) => ({ context, code, label, active: true, provisional: true })),
);
