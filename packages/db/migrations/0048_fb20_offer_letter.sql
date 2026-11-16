CREATE TABLE "offer_letter" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"quote_version" integer NOT NULL,
	"letter_no" smallint NOT NULL,
	"attachment_id" uuid NOT NULL,
	"template_version" text NOT NULL,
	"wording_approved" boolean NOT NULL,
	"letter_date" date NOT NULL,
	"attention" text,
	"valid_until" date NOT NULL,
	"cost_model_attachment_id" uuid NOT NULL,
	"cost_model_version" integer NOT NULL,
	"generated_by" uuid NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "offer_letter_attachment_id_unique" UNIQUE("attachment_id"),
	CONSTRAINT "offer_letter_letter_no_check" CHECK ("offer_letter"."letter_no" >= 1),
	CONSTRAINT "offer_letter_attention_check" CHECK ("offer_letter"."attention" is null or char_length("offer_letter"."attention") <= 120)
);
--> statement-breakpoint
CREATE TABLE "offer_letter_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"offer_letter_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"quote_item_id" uuid,
	"item_no" smallint NOT NULL,
	"part_description" text NOT NULL,
	"part_number" text,
	"place_of_manufacture" text NOT NULL,
	"annual_volume" integer,
	"piece_price_per_1000" numeric(18, 4),
	"mold_charge" numeric(18, 4),
	"change_parts_charge" numeric(18, 4),
	CONSTRAINT "offer_letter_item_item_no_check" CHECK ("offer_letter_item"."item_no" >= 1),
	CONSTRAINT "offer_letter_item_part_number_check" CHECK ("offer_letter_item"."part_number" is null or char_length("offer_letter_item"."part_number") <= 60)
);
--> statement-breakpoint
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_kind_check";--> statement-breakpoint
ALTER TABLE "model_summary_field" DROP CONSTRAINT "model_summary_field_unit_check";--> statement-breakpoint
ALTER TABLE "model_summary_field" ALTER COLUMN "value_number" SET DATA TYPE numeric(24, 10);--> statement-breakpoint
ALTER TABLE "model_summary_field" ADD COLUMN "item_no" smallint;--> statement-breakpoint
ALTER TABLE "offer_letter" ADD CONSTRAINT "offer_letter_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letter" ADD CONSTRAINT "offer_letter_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letter" ADD CONSTRAINT "offer_letter_attachment_id_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letter" ADD CONSTRAINT "offer_letter_cost_model_attachment_id_attachment_id_fk" FOREIGN KEY ("cost_model_attachment_id") REFERENCES "public"."attachment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letter" ADD CONSTRAINT "offer_letter_generated_by_app_user_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letter_item" ADD CONSTRAINT "offer_letter_item_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letter_item" ADD CONSTRAINT "offer_letter_item_offer_letter_id_offer_letter_id_fk" FOREIGN KEY ("offer_letter_id") REFERENCES "public"."offer_letter"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letter_item" ADD CONSTRAINT "offer_letter_item_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letter_item" ADD CONSTRAINT "offer_letter_item_quote_item_id_quote_item_id_fk" FOREIGN KEY ("quote_item_id") REFERENCES "public"."quote_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_letter_quote_letter_no_uidx" ON "offer_letter" USING btree ("quote_id","letter_no");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_letter_item_letter_item_no_uidx" ON "offer_letter_item" USING btree ("offer_letter_id","item_no");--> statement-breakpoint
CREATE INDEX "offer_letter_item_quote_idx" ON "offer_letter_item" USING btree ("quote_id");--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'offer.read', 'offer.generate', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'capitalFlag.edit', 'capacity.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'offer.read', 'offer.generate', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'capitalFlag.edit', 'capacity.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_kind_check" CHECK ("attachment"."kind" in ('bottle_drawing', 'spec', 'sample_photo', 'capacity_analysis', 'other', 'bid_file', 'project_brief', 'competitor_drawing', 'cost_model', 'roi_model', 'price_table', 'equipment_bom', 'offer_letter'));--> statement-breakpoint
ALTER TABLE "model_summary_field" ADD CONSTRAINT "model_summary_field_item_no_check" CHECK ("model_summary_field"."item_no" is null or "model_summary_field"."item_no" >= 1);--> statement-breakpoint
ALTER TABLE "model_summary_field" ADD CONSTRAINT "model_summary_field_unit_check" CHECK ("model_summary_field"."unit" in ('usd', 'units', 'years', 'percent', 'count', 'text', 'usd_per_unit', 'usd_per_1000'));--
-- ── FB-20 (hand-written): the offer letter ─────────────────────────────────────────────────────────
-- Tracker: F-070 (customer quote document from a template; P1, pulled forward). Asked by Bailey Schmitt
-- (product owner), 2026-11-16. Ben's decisions: the price comes from the costing workbook summary (FB-14),
-- the letter is made only after Final Review, one letter per quote with a row per item, and the wording is
-- provisional until Legal approves it.
--
-- The statements above add offer_letter and offer_letter_item, the offer_letter attachment kind, the
-- offer.read / offer.generate permissions, and on model_summary_field the item_no column, the two price
-- units and a wider value_number (numeric(24,10): a per-piece price keeps its decimals).
--
-- Fabric (rule 10): uuid, text, smallint, integer, boolean, date, timestamptz and numeric(18,4) /
-- numeric(24,10) only, so the tables mirror as they are (no companions, no view, no T-SQL twin). The new
-- settings are app_setting rows, whose value already has its value_json companion.
--
-- Row-level security: both tables are quote children, visible when the parent quote is (as 0042).
ALTER TABLE "offer_letter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offer_letter" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "offer_letter_app" ON "offer_letter" FOR ALL TO ccq_app
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = "offer_letter".quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = "offer_letter".quote_id));--> statement-breakpoint
CREATE POLICY "offer_letter_migrator" ON "offer_letter" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "offer_letter_readonly" ON "offer_letter" FOR SELECT TO ccq_readonly USING (true);--> statement-breakpoint
ALTER TABLE "offer_letter_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offer_letter_item" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "offer_letter_item_app" ON "offer_letter_item" FOR ALL TO ccq_app
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = "offer_letter_item".quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = "offer_letter_item".quote_id));--> statement-breakpoint
CREATE POLICY "offer_letter_item_migrator" ON "offer_letter_item" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "offer_letter_item_readonly" ON "offer_letter_item" FOR SELECT TO ccq_readonly USING (true);--> statement-breakpoint
-- A letter is what was sent: written once, never changed or removed by the app.
REVOKE UPDATE, DELETE, TRUNCATE ON "offer_letter", "offer_letter_item" FROM ccq_app;--> statement-breakpoint
--
-- The matrix rows (policy/matrix.ts is the control; role_permission mirrors it). Provisional: Bailey
-- Schmitt to confirm who may generate a letter.
INSERT INTO "role_permission" ("id", "role", "permission", "qualifier", "provisional")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.role, v.permission, v.qualifier::jsonb, true
FROM (VALUES
  ('KAM', 'offer.read', NULL),
  ('SalesLeader', 'offer.read', NULL),
  ('EngLead', 'offer.read', NULL),
  ('Engineer', 'offer.read', NULL),
  ('Pricing', 'offer.read', NULL),
  ('PricingLead', 'offer.read', NULL),
  ('Approver', 'offer.read', NULL),
  ('Leadership', 'offer.read', NULL),
  ('Admin', 'offer.read', NULL),
  ('Finance', 'offer.read', NULL),
  ('ProductionScheduler', 'offer.read', NULL),
  ('PostAward', 'offer.read', '{"kind":"stages","stageKeys":["AWARDED"]}'),
  ('KAM', 'offer.generate', '{"kind":"own"}'),
  ('SalesLeader', 'offer.generate', NULL),
  ('Pricing', 'offer.generate', NULL),
  ('PricingLead', 'offer.generate', NULL),
  ('Admin', 'offer.generate', NULL)
) AS v(role, permission, qualifier)
WHERE EXISTS (SELECT 1 FROM "role_permission")
ON CONFLICT ("role", "permission") DO NOTHING;--> statement-breakpoint
--
-- The settings (provisional). The config seed inserts the same values on a fresh database; here they
-- reach environments that already have config. ON CONFLICT: an existing row is left alone.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.key, v.value::jsonb, v.description, true
FROM (VALUES
  ('offer_letter_template', '{"templateVersion":"fb20-2026-11-16","provisional":true,"legalApproved":false,"eyebrow":"Customer offer","title":"Offer Letter","introduction":"Thank you for the opportunity to quote. We are pleased to offer {{customerName}} the pricing below for quote {{quoteNumber}}.","itemsHeading":"Items quoted","pricingHeading":"Pricing (USD)","rows":{"piecePrice":{"label":"Piece price per 1,000 pcs","required":"always"},"molds":{"label":"Molds","required":"when_customer_funds_tooling"},"changeParts":{"label":"Change parts","required":"never"}},"customerFundedToolingModels":["CUSTOMER_FUNDED","ZERO_CER","SHARED"],"specificationsHeading":"Specifications","specifications":[{"fact":"material","label":"Material (resin type)"},{"fact":"color","label":"Color"},{"fact":"cavities","label":"Number of cavities"},{"fact":"gramWeight","label":"Gram weight"},{"fact":"neckFinish","label":"Neck finish"},{"fact":"decoration","label":"Decoration"},{"fact":"packaging","label":"Packaging"}],"assumptionsHeading":"Pricing assumptions","assumptions":[{"text":"Pricing does not include pallet costs.","points":[]},{"text":"Pricing of pallets is subject to change at the time of shipping due to market conditions.","points":[]},{"text":"This offer is valid until {{validUntil}}.","points":[]},{"text":"Pricing is {{priceBasis}}.","points":[]},{"text":"Freight: {{freight}}.","points":[]},{"text":"Payment terms: {{paymentTerms}} from date of invoice.","points":[]},{"text":"Lead time to be confirmed at time of Purchase Order.","points":[]},{"text":"Standard Pretium Quality specifications apply.","points":[]},{"text":"Pretium specified resin applies.","points":[]},{"text":"Tooling funding: {{toolingFunding}}.","points":[]},{"text":"Mold ownership: {{moldOwnership}}.","points":[]},{"text":"Tooling payment terms:","points":["If < $25,000, 50% with order, 50% upon approval of samples.","If > $25,000, 1/3 with order, 1/3 upon completion of molds, 1/3 upon approval of samples."]},{"text":"Final price is subject to change based on final specifications, mold qualification and any resulting change in process conditions.","points":[]},{"text":"All prices will be subject to resin and other raw material escalation and reduction. Pricing is based on the previous month''s CDI resin costs as of the offer date.","points":[]},{"text":"Pretium standard terms & conditions apply.","points":[]}],"showValidity":true,"closing":"We appreciate the opportunity to support your packaging program and look forward to working with you.","signOff":"Yours sincerely,","signerCompany":"Pretium Packaging","footerNote":"Confidential","legalEntity":"","address":""}',
   'FB-20 (F-070): the offer letter''s wording and layout. Every business sentence on the letter (title, introduction, pricing assumptions, closing, sign-off, footer), the price row labels and when each is required (piece price always; molds when the quote''s tooling funding is one of customerFundedToolingModels; change parts never), and the Specifications rows. Tokens: {{quoteNumber}}, {{customerName}}, {{validUntil}}, {{paymentTerms}}, {{priceBasis}}, {{freight}}, {{toolingFunding}}, {{moldOwnership}}; a sentence whose token has no value on the quote is left out. Seeded from the old Standard Quote Template (feedback/inputs/offer-letter-template-structure.md). Provisional, not approved by Legal; legalEntity and address are blank until Legal gives them.'),
  ('offer_letter_wording_approved', 'false',
   'FB-20: Legal has approved the offer letter wording. While false, every generated letter carries "DRAFT: wording not yet approved by Legal" in its header and the generate screen warns. Each letter records the value it was made with. Seeded false (Ben, 2026-11-16: no approved wording known).'),
  ('offer_letter_block_if_costing_changed', 'true',
   'FB-20: refuse an offer letter when the costing workbook was uploaded after Final Review approved the quote (the price may have changed since G4). Seeded on. Provisional.')
) AS v(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
--
-- The inactive pre-makeover costing map gains the offer piece price (item 1, Summary!B16, per piece,
-- proposed: Gemma Cebolla to confirm the unit). As 0026 / 0036: a setting the business approved
-- (approved_at set) or an Admin edited (version > 1) is left alone, and so is a map that already has it.
UPDATE "app_setting" s SET "value" = (
    SELECT jsonb_agg(
      CASE WHEN e->>'templateId' = 'erf_costing_pre_makeover'
             AND NOT (e->'fields' @> '[{"key":"offer_piece_price"}]'::jsonb)
        THEN jsonb_set(
          jsonb_set(e, '{fields}', (e->'fields') || jsonb_build_array('{"key":"offer_piece_price","label":"Offer: piece price (item 1, first variant)","unit":"usd_per_unit","type":"number","sheet":"Summary","ref":"B16","itemNo":1,"headline":false,"proposed":true}'::jsonb)),
          '{note}', '"FB-14: for the ERF costing layout in use before the costing-template makeover. Inactive: not the costing template going forward. Reads the first variant column of the Summary sheet only. FB-20: offer_piece_price (item 1) is the target price, unit per piece proposed (Gemma Cebolla to confirm)."'::jsonb)
        ELSE e END
      ORDER BY t.ord)
    FROM jsonb_array_elements(s."value") WITH ORDINALITY AS t(e, ord)
  ), "updated_at" = now()
WHERE s."key" = 'model_summary_templates' AND s."approved_at" IS NULL AND s."version" = 1
  AND jsonb_typeof(s."value") = 'array'
  AND s."value" @> '[{"templateId":"erf_costing_pre_makeover"}]'::jsonb;
