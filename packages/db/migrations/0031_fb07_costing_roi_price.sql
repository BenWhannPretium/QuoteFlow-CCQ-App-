ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_role_check";--> statement-breakpoint
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "user_role" DROP CONSTRAINT "user_role_role_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "stage_definition" DROP CONSTRAINT "stage_definition_owner_role_check";--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_kind_check";--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "version" integer;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "cost_model_requirement" text DEFAULT 'required' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_superseded_by_attachment_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."attachment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_current_version_uidx" ON "attachment" USING btree ("quote_id","kind") WHERE "attachment"."version" is not null and "attachment"."superseded_at" is null and "attachment"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_version_uidx" ON "attachment" USING btree ("quote_id","kind","version") WHERE "attachment"."version" is not null;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_check" CHECK ("role_permission"."role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'PricingLead', 'Finance', 'Approver', 'Leadership', 'Admin', 'PostAward'));--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'finalReview.read', 'gate.G4.decide', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'gate.G6.decide', 'terms.edit', 'capitalFlag.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_check" CHECK ("user_role"."role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'PricingLead', 'Finance', 'Approver', 'Leadership', 'Admin', 'PostAward'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'finalReview.read', 'gate.G4.decide', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'gate.G6.decide', 'terms.edit', 'capitalFlag.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "stage_definition" ADD CONSTRAINT "stage_definition_owner_role_check" CHECK ("stage_definition"."owner_role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'PricingLead', 'Finance', 'Approver', 'Leadership', 'Admin', 'PostAward'));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_version_check" CHECK (("attachment"."version" is null) = ("attachment"."kind" not in ('cost_model', 'roi_model', 'price_table')) and ("attachment"."version" is null or "attachment"."version" >= 1));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_superseded_consistency_check" CHECK ("attachment"."superseded_by" is null or "attachment"."superseded_at" is not null);--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_kind_check" CHECK ("attachment"."kind" in ('bottle_drawing', 'spec', 'sample_photo', 'capacity_analysis', 'other', 'bid_file', 'project_brief', 'competitor_drawing', 'cost_model', 'roi_model', 'price_table'));--> statement-breakpoint
ALTER TABLE "pricing_record" ADD CONSTRAINT "pricing_record_cost_model_requirement_check" CHECK ("pricing_record"."cost_model_requirement" in ('required', 'grandfathered'));--> statement-breakpoint
-- ── FB-07 (hand-written): costing, then ROI, then price confirmation inside Quoting ─────────────────
-- Tracker: F-031, F-032, F-074, F-081, F-083; decisions D-001, D-013, D-031 (Nov 9). Run
-- `pnpm --filter @ccq/db fb07:dry-run` against an environment BEFORE this migration: it lists the open
-- quotes grandfathered below and the config rows that would change or be skipped (admin-changed).
--
-- The config seed refreshes only untouched rows (version = 1) at start-up, so the statements below carry
-- the change to every environment. A row the business approved (approved_at set) is never changed, and a
-- value an admin edited (it no longer equals the seed) is left alone. On a fresh database the config
-- tables are empty here: each statement is a no-op and the seed inserts the same values.
--
-- F-083: the Finance role sees every quote, like Pricing (architecture §3.2: it builds ROIs for any quote
-- that needs one), and reads the pricing-app history like every role that reads commercial fields.
CREATE OR REPLACE FUNCTION app_sees_all_quotes() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_roles() && ARRAY['Admin', 'Leadership', 'EngLead', 'Pricing', 'PricingLead', 'Finance', 'Approver', 'SalesLeader']::text[]
$$;--> statement-breakpoint
DROP POLICY IF EXISTS pricing_history_record_app_select ON pricing_history_record;--> statement-breakpoint
CREATE POLICY pricing_history_record_app_select ON pricing_history_record FOR SELECT TO ccq_app
  USING (app_roles() && ARRAY['KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'PricingLead', 'Finance', 'Approver', 'Leadership', 'Admin', 'PostAward']::text[]);--> statement-breakpoint
-- F-083: the matrix rows (policy/matrix.ts is the control; role_permission mirrors it). Provisional.
INSERT INTO "role_permission" ("id", "role", "permission", "qualifier", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, v.role, v.permission, NULL, true
FROM (VALUES
  ('Finance', 'quote.read'),
  ('Finance', 'quote.read.commercialFields'),
  ('Finance', 'roi.upload'),
  ('PricingLead', 'roi.upload'),
  ('Admin', 'roi.upload')
) AS v(role, permission)
WHERE EXISTS (SELECT 1 FROM "role_permission")
ON CONFLICT ("role", "permission") DO NOTHING;--> statement-breakpoint
-- D-001: when Quoting's ROI step applies (provisional: Finance and Pricing to confirm the list).
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, 'roi_required_when', '{"g2Outcomes":["capital_required"],"capitalLikely":true,"fundingModels":["CUSTOMER_FUNDED","ZERO_CER"]}'::jsonb,
  'FB-07 (D-001): when a quote needs Finance''s ROI model before the pricing lead approves the price (G3). Any of: Engineering''s latest G2 outcome is in g2Outcomes, the quote is flagged capital likely (capitalLikely), or the tooling funding model is in fundingModels. Seed: capital required, $0 CER included. Provisional.',
  true
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- F-081 (D-031): the gate is "Price approved". Capital readiness stays its own field and panel.
UPDATE "gate_definition" SET "label" = 'Price approved', "updated_at" = now()
WHERE "key" = 'G3' AND "approved_at" IS NULL AND "label" = 'Price approved & capital ready';--> statement-breakpoint
UPDATE "gate_outcome_definition" SET "label" = 'Advance – price approved', "updated_at" = now()
WHERE "gate_key" = 'G3' AND "key" = 'submit' AND "approved_at" IS NULL AND "label" = 'Advance to Final Review';--> statement-breakpoint
UPDATE "gate_outcome_definition" SET "help_text" = 'The pricing lead confirms the price. The costing model is on file and costing is attested; when capital is required ($0 CER included) the ROI model is on file too. Optionally upload an updated price table; otherwise the price in the models stands. Capital readiness is recorded separately. The quote goes to Final Review.', "updated_at" = now()
WHERE "gate_key" = 'G3' AND "key" = 'submit' AND "approved_at" IS NULL
  AND "help_text" = 'The cost sheet is done, the price is approved and capital readiness is confirmed. The quote goes to Final Review.';--> statement-breakpoint
-- F-032 (D-001): G3 Advance needs the current costing model (or the grandfather mark) and, when the quote
-- needs an ROI, the current ROI model. Only the B-26 rule as seeded is extended; an admin's own edit of it
-- is left alone (add the two rules by hand in Admin -> Workflow).
UPDATE "gate_outcome_definition"
SET "required_fields" = "required_fields" || '[{"anyOf":[{"field":"cost_model_on_file","op":"equals","value":true},{"field":"pricing_record.cost_model_requirement","op":"equals","value":"grandfathered"}]},{"anyOf":[{"field":"roi_required","op":"equals","value":false},{"field":"roi_model_on_file","op":"equals","value":true}]}]'::jsonb, "updated_at" = now()
WHERE "gate_key" = 'G3' AND "key" = 'submit' AND "approved_at" IS NULL
  AND "required_fields" = '[{"anyOf":[{"allOf":[{"field":"pricing_record.price_approved_by","op":"present"},{"field":"pricing_record.price_approved_at","op":"present"}]},{"field":"pass_through_eligible","op":"equals","value":true}]},{"field":"pricing_record.costing_completed","op":"equals","value":true},{"field":"pricing_record.capital_readiness","op":"present"},{"anyOf":[{"field":"pricing_record.capital_readiness","op":"oneOf","value":["not_required","pre_approved","not_approved"]},{"field":"pricing_record.capital_pending_justification","op":"present"}]},{"anyOf":[{"field":"capital_likely","op":"equals","value":false},{"field":"pricing_record.capital_readiness","op":"oneOf","value":["not_required","pre_approved"]}]}]'::jsonb;--> statement-breakpoint
-- Open quotes: a quote in Quoting (open or on hold) whose current version has costing attested and no
-- costing model on file keeps working. Its requirement is marked grandfathered; the Quoting tab shows
-- "no model on file" instead of blocking. A later version (any send-back) starts required again.
UPDATE "pricing_record" pr SET "cost_model_requirement" = 'grandfathered', "updated_at" = now()
FROM "quote" q
WHERE pr."quote_id" = q."id" AND pr."quote_version" = q."version"
  AND q."stage_key" = 'QUOTING' AND q."status" <> 'closed'
  AND pr."costing_completed"
  AND pr."cost_model_requirement" = 'required'
  AND NOT EXISTS (
    SELECT 1 FROM "attachment" a
    WHERE a."quote_id" = q."id" AND a."kind" = 'cost_model' AND a."removed_at" IS NULL
  );
