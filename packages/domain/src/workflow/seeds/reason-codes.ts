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
  // Lost taxonomy from the B-03 brief (still provisional under D-15). "Other" needs a note.
  lost: [
    ['price', 'Price'],
    ['lead_time', 'Lead time'],
    ['capability', 'Capability'],
    ['capacity', 'Capacity'],
    ['customer_cancelled', 'Customer cancelled'],
    ['competitor_relationship', 'Competitor relationship'],
    ['other', 'Other (note required)'],
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

/** Codes that need a note when chosen, as `context:code`. */
const NOTE_REQUIRED = new Set(['lost:other']);

export const SEED_REASON_CODES: ReasonCodeDefinition[] = Object.entries(CODES).flatMap(
  ([context, codes]) =>
    codes.map(([code, label]) => ({
      context,
      code,
      label,
      active: true,
      requiresNote: NOTE_REQUIRED.has(`${context}:${code}`),
      provisional: true,
    })),
);
