CREATE TABLE "g4_signoff" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"quote_version" integer NOT NULL,
	"rule_key" text NOT NULL,
	"signoff_key" text NOT NULL,
	"signed_by" uuid NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "terms_exception_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"quote_version" integer NOT NULL,
	"payment_terms_code" text NOT NULL,
	"payment_terms_detail" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"rationale" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "terms_exception_request_status_check" CHECK ("terms_exception_request"."status" in ('pending', 'approved', 'rejected', 'withdrawn', 'superseded')),
	CONSTRAINT "terms_exception_request_decision_check" CHECK (("terms_exception_request"."decided_at" is null) = ("terms_exception_request"."decided_by" is null) and ("terms_exception_request"."decided_at" is null or "terms_exception_request"."rationale" is not null))
);
--> statement-breakpoint
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "value_list" DROP CONSTRAINT "value_list_list_key_check";--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_payment_terms_code" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_tooling_payment" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_milestone_note" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_exception_status" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_mold_ownership" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_amortized" boolean;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_amortization_months" integer;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_min_supply" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_agreement_in_place" boolean;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_agreement_months" integer;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_finalized_by" uuid;--> statement-breakpoint
ALTER TABLE "g4_signoff" ADD CONSTRAINT "g4_signoff_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "g4_signoff" ADD CONSTRAINT "g4_signoff_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "g4_signoff" ADD CONSTRAINT "g4_signoff_signed_by_app_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_exception_request" ADD CONSTRAINT "terms_exception_request_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_exception_request" ADD CONSTRAINT "terms_exception_request_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_exception_request" ADD CONSTRAINT "terms_exception_request_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_exception_request" ADD CONSTRAINT "terms_exception_request_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "g4_signoff_once_uniq" ON "g4_signoff" USING btree ("quote_id","quote_version","rule_key","signoff_key");--> statement-breakpoint
CREATE INDEX "terms_exception_request_quote_idx" ON "terms_exception_request" USING btree ("quote_id","requested_at");--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_terms_finalized_by_app_user_id_fk" FOREIGN KEY ("terms_finalized_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'capitalFlag.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'capitalFlag.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "value_list" ADD CONSTRAINT "value_list_list_key_check" CHECK ("value_list"."list_key" in ('product_family', 'market', 'sub_market', 'resin', 'component', 'process_type', 'machine_type', 'plant', 'request_class', 'drawing_status', 'neck_finish', 'packaging_type', 'tooling_funding_model', 'neck_diameter', 'neck_finish_type', 'neck_special_feature', 'pcr_level', 'color_type', 'additive', 'labels_purchased_by', 'decoration_type', 'requested_payment_terms', 'price_basis', 'freight_type', 'tooling_payment_terms', 'mold_ownership'));--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_terms_exception_status_check" CHECK ("quote"."terms_exception_status" is null or "quote"."terms_exception_status" in ('pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_terms_months_check" CHECK (("quote"."terms_amortization_months" is null or ("quote"."terms_amortized" and "quote"."terms_amortization_months" between 1 and 120)) and ("quote"."terms_agreement_months" is null or ("quote"."terms_agreement_in_place" and "quote"."terms_agreement_months" between 1 and 240)));--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_terms_finalized_consistency_check" CHECK (("quote"."terms_finalized_at" is null) = ("quote"."terms_finalized_by" is null));;--> statement-breakpoint
-- ── FB-08 (hand-written): commercial terms and Final Review ───────────────────────────────────────
-- Tracker: F-021, F-068, F-082 (off), T-007, T-031; decisions D-003, D-029 (provisional defaults),
-- D-002 and A-035 (open: the extra approval is seeded off).
--
-- The config seed refreshes only untouched rows (version = 1) at start-up, so the statements below carry
-- the change to every environment. A row the business approved (approved_at set) is never changed, and a
-- value an admin edited is left alone. On a fresh database the config tables are empty here: each
-- statement is a no-op (or inserts what the seed would) and the seed inserts the same values.
--
-- Row-level security: the two new tables are quote children, visible when the parent quote is (0004).
ALTER TABLE "terms_exception_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "terms_exception_request" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "terms_exception_request_app" ON "terms_exception_request" FOR ALL TO ccq_app
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = "terms_exception_request".quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = "terms_exception_request".quote_id));--> statement-breakpoint
CREATE POLICY "terms_exception_request_migrator" ON "terms_exception_request" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "terms_exception_request_readonly" ON "terms_exception_request" FOR SELECT TO ccq_readonly USING (true);--> statement-breakpoint
ALTER TABLE "g4_signoff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "g4_signoff" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "g4_signoff_app" ON "g4_signoff" FOR ALL TO ccq_app
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = "g4_signoff".quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = "g4_signoff".quote_id));--> statement-breakpoint
CREATE POLICY "g4_signoff_migrator" ON "g4_signoff" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "g4_signoff_readonly" ON "g4_signoff" FOR SELECT TO ccq_readonly USING (true);--> statement-breakpoint

-- D-029 (Gemma Cebolla, Nov 6): the tooling payment options; F-068: mold ownership. Provisional.
INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional")
SELECT
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.list_key, v.code, v.label, v.sort, true, v.meta::jsonb, true
FROM (VALUES
  ('tooling_payment_terms', 'UPFRONT', 'Upfront (100% at the order)', 10, '{"milestones":[{"percent":100,"trigger":"At the order"}]}'),
  ('tooling_payment_terms', 'SPLIT_50_50', '50/50: at the order and at qualification', 20, '{"milestones":[{"percent":50,"trigger":"At the order"},{"percent":50,"trigger":"At qualification"}]}'),
  ('tooling_payment_terms', 'AMORTIZED_PER_PIECE', 'Amortized into the per-piece price', 30, '{"milestones":[]}'),
  ('mold_ownership', 'PRETIUM', 'Pretium', 10, '{}'),
  ('mold_ownership', 'CUSTOMER', 'Customer', 20, '{}'),
  ('mold_ownership', 'SHARED', 'Shared (Pretium and customer)', 30, '{}')
) AS v(list_key, code, label, sort, meta)
WHERE EXISTS (SELECT 1 FROM "value_list")
ON CONFLICT ("list_key", "code") DO NOTHING;--> statement-breakpoint

-- T-007 / T-031: the exception and the approver's capital-terms confirmation block G4 Advance.
-- Added to the setting unless an admin approved it; whatever else it names is kept.
UPDATE "app_setting"
SET "value" = (
    SELECT coalesce(jsonb_agg(DISTINCT c), '[]'::jsonb)
    FROM jsonb_array_elements_text("value" || '["terms_exception","terms_finalized"]'::jsonb) AS c
  ),
  "description" = 'FB-01 (F-069) and FB-08 (D-003 provisional): which checks block G4 Advance (release the offer). terms_checked: the Sales / Pricing terms check. legal_review: the Legal review, when a legal_review_triggers trigger applies. terms_exception: non-standard payment terms need the pricing lead to approve the exception (a pending or rejected one blocks). terms_finalized: the approver confirmed the capital terms. A check not listed shows to the approver as a warning, and the G4 decision records that they saw it. Seed: terms_exception and terms_finalized.',
  "provisional" = true, "updated_at" = now()
WHERE "key" = 'g4_required_checks' AND "approved_at" IS NULL AND jsonb_typeof("value") = 'array';--> statement-breakpoint

-- The G4 Advance rule reads the two new checks. Only the FB-01 rule as seeded is extended.
UPDATE "gate_outcome_definition"
SET "required_fields" = "required_fields" || '[{"anyOf":[{"field":"g4_terms_exception_check_required","op":"equals","value":false},{"field":"terms_exception_open","op":"equals","value":false}]},{"anyOf":[{"field":"g4_terms_finalized_check_required","op":"equals","value":false},{"field":"terms_finalized_at","op":"present"}]}]'::jsonb,
  "updated_at" = now()
WHERE "gate_key" = 'G4' AND "key" = 'approve' AND "approved_at" IS NULL
  AND "required_fields" = '[{"anyOf":[{"field":"g4_terms_check_required","op":"equals","value":false},{"field":"terms_checked_at","op":"present"}]},{"anyOf":[{"field":"legal_review_required","op":"equals","value":false},{"field":"g4_legal_review_check_required","op":"equals","value":false},{"field":"legal_reviewed_on","op":"present"}]}]'::jsonb;--> statement-breakpoint

-- New settings (provisional): what the approver must fill, the extra approval (OFF), the default term.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.key, v.value::jsonb, v.description, true
FROM (VALUES
  ('capital_terms_required', '["funding_model","mold_ownership","amortization","min_supply","agreement"]',
   'FB-08 (F-068, D-003 provisional): the capital terms the approver must fill before confirming them at Final Review: funding_model, mold_ownership, amortization (yes/no, and the months when yes), min_supply (minimum supply / shortfall terms), agreement (in place yes/no, and the duration when yes).'),
  ('g4_additional_approvals', '{"rules":[{"key":"customer_funded_capital","label":"Customer-funded capital: sales leader, then leadership","active":false,"when":{"fundingModels":["CUSTOMER_FUNDED","ZERO_CER"]},"signoffs":[{"key":"sales_leader","label":"Sales leader","roles":["SalesLeader"],"userIds":[]},{"key":"leadership","label":"Leadership","roles":["Leadership"],"userIds":[]}]}]}',
   'FB-08 (F-082, D-002, A-035 open): extra Final Review sign-offs before the approver may release the offer, by funding model, in order. Seeded with the Nov 9 proposal (customer-funded or $0 CER: the sales leader, then leadership) switched OFF (active: false). Set active: true only once Oleg and Sarah confirm it (A-035). Signers need finalReview.signoff (SalesLeader, Leadership).'),
  ('default_payment_terms', '"NET_30"',
   'FB-08 (F-021, D-003 provisional): the payment terms the Commercial panel pre-selects when the customer requested none at intake (a requested_payment_terms code; the customer request wins when there is one). Nothing is saved until someone saves the terms.')
) AS v(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;
