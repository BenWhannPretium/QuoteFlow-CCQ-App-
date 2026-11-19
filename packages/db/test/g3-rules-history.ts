import type { RequiredRule } from '@ccq/domain';

/**
 * The G3 Advance ("submit") rule as each migration left it, so a migration test can start from the
 * state an environment had before it, whatever the seed says today.
 *
 * - 0031 (FB-07): price approval, costing attested, capital readiness with the two "pending" rules, the
 *   costing model and, when needed, the payback model.
 * - 0049 (FB-21 Part A) replaced the two "pending" rules with "not approved refuses Advance".
 * - 0050 (FB-21 Part B): the payback model only while a request is open (`payback_received`).
 */
export const G3_RULES_0031: RequiredRule[] = JSON.parse(
  '[{"anyOf":[{"allOf":[{"field":"pricing_record.price_approved_by","op":"present"},{"field":"pricing_record.price_approved_at","op":"present"}]},{"field":"pass_through_eligible","op":"equals","value":true}]},{"field":"pricing_record.costing_completed","op":"equals","value":true},{"field":"pricing_record.capital_readiness","op":"present"},{"anyOf":[{"field":"pricing_record.capital_readiness","op":"oneOf","value":["not_required","pre_approved","not_approved"]},{"field":"pricing_record.capital_pending_justification","op":"present"}]},{"anyOf":[{"field":"capital_likely","op":"equals","value":false},{"field":"pricing_record.capital_readiness","op":"oneOf","value":["not_required","pre_approved"]}]},{"anyOf":[{"field":"cost_model_on_file","op":"equals","value":true},{"field":"pricing_record.cost_model_requirement","op":"equals","value":"grandfathered"}]},{"anyOf":[{"field":"roi_required","op":"equals","value":false},{"field":"roi_model_on_file","op":"equals","value":true}]}]',
) as RequiredRule[];

export const G3_RULES_0049: RequiredRule[] = JSON.parse(
  '[{"anyOf":[{"allOf":[{"field":"pricing_record.price_approved_by","op":"present"},{"field":"pricing_record.price_approved_at","op":"present"}]},{"field":"pass_through_eligible","op":"equals","value":true}]},{"field":"pricing_record.costing_completed","op":"equals","value":true},{"field":"pricing_record.capital_readiness","op":"present"},{"field":"capital_not_approved","op":"equals","value":false},{"anyOf":[{"field":"cost_model_on_file","op":"equals","value":true},{"field":"pricing_record.cost_model_requirement","op":"equals","value":"grandfathered"}]},{"anyOf":[{"field":"roi_required","op":"equals","value":false},{"field":"roi_model_on_file","op":"equals","value":true}]}]',
) as RequiredRule[];

export const G3_RULES_0050: RequiredRule[] = JSON.parse(
  '[{"anyOf":[{"allOf":[{"field":"pricing_record.price_approved_by","op":"present"},{"field":"pricing_record.price_approved_at","op":"present"}]},{"field":"pass_through_eligible","op":"equals","value":true}]},{"field":"pricing_record.costing_completed","op":"equals","value":true},{"field":"pricing_record.capital_readiness","op":"present"},{"field":"capital_not_approved","op":"equals","value":false},{"anyOf":[{"field":"cost_model_on_file","op":"equals","value":true},{"field":"pricing_record.cost_model_requirement","op":"equals","value":"grandfathered"}]},{"anyOf":[{"field":"roi_required","op":"equals","value":false},{"field":"payback_received","op":"equals","value":true}]}]',
) as RequiredRule[];

/** The G3 Advance help text before and after 0050 (0042 wrote the "payback" wording). */
export const G3_HELP_0042 =
  'The pricing lead confirms the price. The costing model is on file and costing is attested; when capital is required ($0 CER included) the payback model is on file too. Optionally upload an updated price table; otherwise the price in the models stands. Capital readiness is recorded separately. The quote goes to Final Review.';
export const G3_HELP_0050 =
  'The pricing lead confirms the price. The costing model is on file and costing is attested; when someone asked Finance for a payback model, it is on file too. Optionally upload an updated price table; otherwise the price in the models stands. Capital readiness is recorded separately. The quote goes to Final Review.';
