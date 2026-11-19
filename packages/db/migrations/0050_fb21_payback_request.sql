ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "payback_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "payback_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "payback_request_note" text;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "payback_request_withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "payback_request_withdrawn_by" uuid;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "payback_request_withdraw_reason" text;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD CONSTRAINT "pricing_record_payback_requested_by_app_user_id_fk" FOREIGN KEY ("payback_requested_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD CONSTRAINT "pricing_record_payback_request_withdrawn_by_app_user_id_fk" FOREIGN KEY ("payback_request_withdrawn_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'payback.request', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'offer.read', 'offer.generate', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'capitalFlag.edit', 'capacity.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'payback.request', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'offer.read', 'offer.generate', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'capitalFlag.edit', 'capacity.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "pricing_record" ADD CONSTRAINT "pricing_record_payback_request_check" CHECK (("pricing_record"."payback_requested_at" is null) = ("pricing_record"."payback_requested_by" is null)
          and ("pricing_record"."payback_request_withdrawn_at" is null) = ("pricing_record"."payback_request_withdrawn_by" is null)
          and ("pricing_record"."payback_request_withdrawn_at" is null or "pricing_record"."payback_requested_at" is not null)
          and ("pricing_record"."payback_request_note" is null or char_length("pricing_record"."payback_request_note") <= 500)
          and ("pricing_record"."payback_request_withdraw_reason" is null or char_length("pricing_record"."payback_request_withdraw_reason") <= 200));--> statement-breakpoint
-- ── FB-21 Part B (hand-written): a payback model only when someone asks Finance for one ─────────────
-- Feedback N17-21, N17-22 (Bailey Schmitt, Gemma Cebolla); decided by Ben Whann, 2026-11-18. As 0031 and
-- 0049: a config row the business approved or an Admin edited is left alone; on a fresh database every
-- statement is a no-op and the seed inserts the same values.
--
-- 1. Who may ask Finance (or withdraw): the pricing lead on any quote, a pricer on a quote assigned to
-- them (policy/matrix.ts is the control; role_permission mirrors it). Provisional.
INSERT INTO "role_permission" ("id", "role", "permission", "qualifier", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, v.role, v.permission, v.qualifier::jsonb, true
FROM (VALUES
  ('PricingLead', 'payback.request', NULL),
  ('Pricing', 'payback.request', '{"kind":"assignedPricer"}')
) AS v(role, permission, qualifier)
WHERE EXISTS (SELECT 1 FROM "role_permission")
ON CONFLICT ("role", "permission") DO NOTHING;--> statement-breakpoint
--
-- 2. G3 Advance: the payback model only while a request is open, met by one uploaded after it
-- (payback_received, derived by the server). Only the rule as 0049 left it is changed. Open quotes that
-- needed a payback model only because of roi_required_when no longer need one.
UPDATE "gate_outcome_definition"
SET "required_fields" = '[{"anyOf":[{"allOf":[{"field":"pricing_record.price_approved_by","op":"present"},{"field":"pricing_record.price_approved_at","op":"present"}]},{"field":"pass_through_eligible","op":"equals","value":true}]},{"field":"pricing_record.costing_completed","op":"equals","value":true},{"field":"pricing_record.capital_readiness","op":"present"},{"field":"capital_not_approved","op":"equals","value":false},{"anyOf":[{"field":"cost_model_on_file","op":"equals","value":true},{"field":"pricing_record.cost_model_requirement","op":"equals","value":"grandfathered"}]},{"anyOf":[{"field":"roi_required","op":"equals","value":false},{"field":"payback_received","op":"equals","value":true}]}]'::jsonb, "updated_at" = now()
WHERE "gate_key" = 'G3' AND "key" = 'submit' AND "approved_at" IS NULL
  AND "required_fields" = '[{"anyOf":[{"allOf":[{"field":"pricing_record.price_approved_by","op":"present"},{"field":"pricing_record.price_approved_at","op":"present"}]},{"field":"pass_through_eligible","op":"equals","value":true}]},{"field":"pricing_record.costing_completed","op":"equals","value":true},{"field":"pricing_record.capital_readiness","op":"present"},{"field":"capital_not_approved","op":"equals","value":false},{"anyOf":[{"field":"cost_model_on_file","op":"equals","value":true},{"field":"pricing_record.cost_model_requirement","op":"equals","value":"grandfathered"}]},{"anyOf":[{"field":"roi_required","op":"equals","value":false},{"field":"roi_model_on_file","op":"equals","value":true}]}]'::jsonb;--> statement-breakpoint
UPDATE "gate_outcome_definition" SET "help_text" = 'The pricing lead confirms the price. The costing model is on file and costing is attested; when someone asked Finance for a payback model, it is on file too. Optionally upload an updated price table; otherwise the price in the models stands. Capital readiness is recorded separately. The quote goes to Final Review.', "updated_at" = now()
WHERE "gate_key" = 'G3' AND "key" = 'submit' AND "approved_at" IS NULL
  AND "help_text" = 'The pricing lead confirms the price. The costing model is on file and costing is attested; when capital is required ($0 CER included) the payback model is on file too. Optionally upload an updated price table; otherwise the price in the models stands. Capital readiness is recorded separately. The quote goes to Final Review.';--> statement-breakpoint
--
-- 3. roi_required_when only suggests now. The value is unchanged; the description says so.
UPDATE "app_setting" SET "description" = 'FB-21 (N17-21, N17-22): a hint only. A payback model is needed for G3 only while the pricer or the pricing lead has asked Finance for one. When any of these holds, the payback step says "Finance''s payback model may be useful here" beside the request button: Engineering''s latest G2 outcome is in g2Outcomes, the quote is flagged capital likely (capitalLikely), or the tooling funding model is in fundingModels. Seed: capital required, $0 CER included. Provisional.', "updated_at" = now()
WHERE "key" = 'roi_required_when' AND "approved_at" IS NULL AND "version" = 1
  AND "description" = 'FB-07 (D-001): when a quote needs Finance''s payback model (roi_model; "Payback" since FB-14) before the pricing lead approves the price (G3). Any of: Engineering''s latest G2 outcome is in g2Outcomes, the quote is flagged capital likely (capitalLikely), or the tooling funding model is in fundingModels. Seed: capital required, $0 CER included. Provisional.';
