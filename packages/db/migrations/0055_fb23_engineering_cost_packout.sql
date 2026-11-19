CREATE TABLE "eng_cost_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"quote_item_id" uuid NOT NULL,
	"line_key" text NOT NULL,
	"amount_usd" numeric(18, 2) NOT NULL,
	"description" text,
	"quantity" smallint,
	"updated_by" uuid,
	CONSTRAINT "eng_cost_line_amount_check" CHECK ("eng_cost_line"."amount_usd" between 0 and 999999999.99),
	CONSTRAINT "eng_cost_line_description_check" CHECK ("eng_cost_line"."description" is null or char_length("eng_cost_line"."description") <= 120),
	CONSTRAINT "eng_cost_line_quantity_check" CHECK ("eng_cost_line"."quantity" is null or "eng_cost_line"."quantity" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "value_list" DROP CONSTRAINT "value_list_list_key_check";--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "mold_lead_time" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "packers_per_line" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "operators_per_line" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "pack_method" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "pack_container_item_no" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "pack_container_description" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "containers_per_layer" integer;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "layers_per_pallet" integer;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "pallet_build_height" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "pallet_type" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "pallets_per_trailer" integer;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "special_packaging_note" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "returnable_dunnage_description" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "returnable_dunnage_cost_usd" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "tooling_markup_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "offer_letter_item" ADD COLUMN "mold_charge_source" text;--> statement-breakpoint
ALTER TABLE "eng_cost_line" ADD CONSTRAINT "eng_cost_line_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_cost_line" ADD CONSTRAINT "eng_cost_line_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_cost_line" ADD CONSTRAINT "eng_cost_line_quote_item_id_quote_item_id_fk" FOREIGN KEY ("quote_item_id") REFERENCES "public"."quote_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_cost_line" ADD CONSTRAINT "eng_cost_line_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eng_cost_line_item_key_uq" ON "eng_cost_line" USING btree ("quote_item_id","line_key");--> statement-breakpoint
CREATE INDEX "eng_cost_line_quote_idx" ON "eng_cost_line" USING btree ("quote_id");--> statement-breakpoint
ALTER TABLE "value_list" ADD CONSTRAINT "value_list_list_key_check" CHECK ("value_list"."list_key" in ('product_family', 'market', 'sub_market', 'resin', 'component', 'process_type', 'machine_type', 'plant', 'request_class', 'drawing_status', 'neck_finish', 'packaging_type', 'tooling_funding_model', 'neck_diameter', 'neck_finish_type', 'neck_special_feature', 'pcr_level', 'color_type', 'additive', 'labels_purchased_by', 'decoration_type', 'requested_payment_terms', 'price_basis', 'freight_type', 'tooling_payment_terms', 'mold_ownership', 'pack_method', 'pallet_type'));--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_cost_estimate_check" CHECK (("eng_review"."mold_lead_time" is null or char_length("eng_review"."mold_lead_time") <= 40) and ("eng_review"."packers_per_line" is null or "eng_review"."packers_per_line" between 0 and 99.99) and ("eng_review"."operators_per_line" is null or "eng_review"."operators_per_line" between 0 and 99.99) and ("eng_review"."tooling_markup_pct" is null or "eng_review"."tooling_markup_pct" between 0 and 100) and ("eng_review"."returnable_dunnage_cost_usd" is null or "eng_review"."returnable_dunnage_cost_usd" between 0 and 999999999.99));--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_pack_out_detail_check" CHECK (("eng_review"."pack_container_item_no" is null or char_length("eng_review"."pack_container_item_no") <= 40) and ("eng_review"."pack_container_description" is null or char_length("eng_review"."pack_container_description") <= 120) and ("eng_review"."containers_per_layer" is null or "eng_review"."containers_per_layer" between 1 and 9999) and ("eng_review"."layers_per_pallet" is null or "eng_review"."layers_per_pallet" between 1 and 999) and ("eng_review"."pallet_build_height" is null or char_length("eng_review"."pallet_build_height") <= 20) and ("eng_review"."pallets_per_trailer" is null or "eng_review"."pallets_per_trailer" between 1 and 999) and ("eng_review"."special_packaging_note" is null or char_length("eng_review"."special_packaging_note") <= 300) and ("eng_review"."returnable_dunnage_description" is null or char_length("eng_review"."returnable_dunnage_description") <= 200));--> statement-breakpoint
ALTER TABLE "offer_letter_item" ADD CONSTRAINT "offer_letter_item_mold_charge_source_check" CHECK ("offer_letter_item"."mold_charge_source" is null or "offer_letter_item"."mold_charge_source" in ('workbook', 'engineering'));--> statement-breakpoint
-- ── FB-23 (hand-written): the engineering cost estimate and pack-out, per item ─────────────────────────
-- Feedback N18-03 to N18-10, N18-14 (Jim Zweifel, Engineering sync of 2026-11-18) and Ben's decisions D4, D5,
-- D6 (2026-11-18). Synthetic data only.
--
-- The statements above add the per-item columns on eng_review (mold lead time, labor, pack-out details,
-- special packaging and returnable dunnage (D4), the noted tooling markup (D5)), the eng_cost_line table,
-- offer_letter_item.mold_charge_source, and widen the value-list keys with pack_method and pallet_type.
-- Fabric (rule 10): text, integer, smallint, uuid, timestamptz and numeric(5,2) / (6,2) / (18,2) only (every
-- numeric has a precision ≤ 38), no json or array column, so nothing needs a companion. The settings are
-- app_setting rows and the list entries value_list rows, whose jsonb already has its companion.
--
-- 1. Row-level security: eng_cost_line is a quote child, visible when the parent quote is (as 0042).
ALTER TABLE "eng_cost_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eng_cost_line" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "eng_cost_line_app" ON "eng_cost_line" FOR ALL TO ccq_app
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = "eng_cost_line".quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = "eng_cost_line".quote_id));--> statement-breakpoint
CREATE POLICY "eng_cost_line_migrator" ON "eng_cost_line" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "eng_cost_line_readonly" ON "eng_cost_line" FOR SELECT TO ccq_readonly USING (true);--> statement-breakpoint
-- The app changes and removes lines (blank = no row), but never truncates (rule 10).
REVOKE TRUNCATE ON "eng_cost_line" FROM ccq_app;--> statement-breakpoint
--
-- 2. The settings (provisional). As 0042 / 0052: on a fresh database the config tables are empty here, so
-- the insert is a no-op and the seed inserts the same rows. ON CONFLICT: an existing row is left alone.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, v.key, v.value::jsonb, v.description, true
FROM (VALUES
  ('engineering_cost_lines', '[{"key":"molds","label":"Molds","group":"tooling","processes":"all","customerFunded":true,"needsDescription":false,"prefill":null},{"key":"unit_mold","label":"Unit mold","group":"tooling","processes":"all","customerFunded":false,"needsDescription":false,"prefill":null},{"key":"perso_parts","label":"Perso parts","group":"tooling","processes":["RHB"],"customerFunded":false,"needsDescription":false,"prefill":null},{"key":"head_tooling","label":"Head tooling","group":"tooling","processes":["EBM"],"customerFunded":false,"needsDescription":false,"prefill":null},{"key":"freight","label":"Freight","group":"tooling","processes":"all","customerFunded":true,"needsDescription":false,"prefill":"freight"},{"key":"start_up","label":"Start-up assistance (3 days)","group":"tooling","processes":"all","customerFunded":true,"needsDescription":false,"prefill":"start_up"},{"key":"tariffs","label":"Tariffs / duties","group":"tooling","processes":"all","customerFunded":true,"needsDescription":false,"prefill":null},{"key":"other","label":"Other","group":"tooling","processes":"all","customerFunded":false,"needsDescription":true,"prefill":null},{"key":"blow_molders","label":"Blow molders","group":"new_line","processes":"all","customerFunded":false,"needsDescription":false,"prefill":null},{"key":"resin_handling","label":"Resin handling equipment","group":"new_line","processes":"all","customerFunded":false,"needsDescription":false,"prefill":null},{"key":"packaging_inspection","label":"Packaging & inspection equipment","group":"new_line","processes":"all","customerFunded":false,"needsDescription":false,"prefill":null},{"key":"support_equipment","label":"Support equipment","group":"new_line","processes":"all","customerFunded":false,"needsDescription":false,"prefill":null},{"key":"misc_equipment","label":"Misc. equipment","group":"new_line","processes":"all","customerFunded":false,"needsDescription":false,"prefill":null}]', 'FB-23 (N18-04, N18-06, N18-07, D4): the engineering cost estimate lines (Jim Zweifel''s ECE Summary), in order. Each: key (stored on eng_cost_line), label, group (tooling: Engineering; new_line: new-line capital equipment, Operations), processes (process-type codes that show the line, or "all"), customerFunded (counted in "customer funded"), needsDescription (Other), prefill (freight or start_up, from engineering_cost_defaults). Seed: Molds, Unit mold, Perso parts (RHB), Head tooling (EBM), Freight, Start-up assistance (3 days), Tariffs / duties (D4), Other; Blow molders, Resin handling, Packaging & inspection, Support, Misc. equipment. Customer funded: Molds, Freight, Start-up (as the sheet) and Tariffs / duties (D4). A line that holds a value always shows. Provisional until Jim confirms the process mapping and Operations the new-line split.'),
  ('engineering_cost_defaults', '{"freightCompleteMoldUsd":1500,"freightLowerBlowMoldUsd":750,"startUpAssistanceUsd":5500}', 'FB-23 (N18-05): the standard figures the cost lines pre-fill (then editable): freightCompleteMoldUsd (1500), freightLowerBlowMoldUsd (750 per lower blow mold), startUpAssistanceUsd (5500 for 3 days). Freight stays editable (air freight from Japan was about $40,000). Provisional.'),
  ('tooling_markup_default_pct', '0', 'FB-23 (N18-14, D5): the markup on customer-funded tooling when none is noted on the item, in %. Customer tooling price = customer funded × (1 + markup / 100). Seed 0: no markup unless one is noted on the quote (Ben, 2026-11-18). Provisional until Bailey Schmitt confirms.'),
  ('offer_mold_charge_source', '"workbook_then_engineering"', 'FB-23 (N18-14, D5): where the offer letter''s Molds row comes from. workbook_then_engineering (seed): the costing workbook''s mold charge for the item when it has one, otherwise the item''s customer tooling price from Engineering''s cost lines, otherwise nothing. workbook_only: the workbook alone (FB-20). The source is recorded on each letter. Provisional until Gemma Cebolla confirms.')
) AS v(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
--
-- 3. The two value lists (provisional), as 0044. countField names the eng_review count a method uses.
INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, v.list_key, v.code, v.label, v.sort, true, v.meta::jsonb, true
FROM (VALUES
  ('pack_method', 'BAGGED', 'Bagged', 10, '{"countField":"unitsPerBag","container":"bag"}'),
  ('pack_method', 'CARTON', 'Carton', 20, '{"countField":"unitsPerCase","container":"carton"}'),
  ('pack_method', 'TRAY', 'Tray', 30, '{"countField":"unitsPerTray","container":"tray"}'),
  ('pack_method', 'BULK', 'Bulk', 40, '{}'),
  ('pack_method', 'OTHER', 'Other', 50, '{}'),
  ('pallet_type', 'PALLET_40X48', '40×48 pallet', 10, '{}'),
  ('pallet_type', 'FLOOR_LOADED', 'Floor loaded (no pallet)', 20, '{"noPallet":true}'),
  ('pallet_type', 'OTHER', 'Other', 30, '{}')
) AS v(list_key, code, label, sort, meta)
WHERE EXISTS (SELECT 1 FROM "value_list")
ON CONFLICT ("list_key", "code") DO NOTHING;--> statement-breakpoint
--
-- 4. The offer letter's "Equipment / tool lead time" Specifications row (N18-03). As 0051: only where the
-- template is still FB-24's seed, unapproved (an Admin's edit or Legal's approval is left alone).
UPDATE "app_setting"
  SET "value" = '{"templateVersion":"fb23-2026-11-19","provisional":true,"legalApproved":false,"eyebrow":"Customer offer","title":"Offer Letter","introduction":"Thank you for the opportunity to quote. We are pleased to offer {{customerName}} the pricing below for quote {{quoteNumber}}.","itemsHeading":"Items quoted","pricingHeading":"Pricing (USD)","rows":{"piecePrice":{"label":"Piece price per 1,000 pcs","required":"always"},"molds":{"label":"Molds","required":"when_customer_funds_tooling"},"changeParts":{"label":"Change parts","required":"never"}},"customerFundedToolingModels":["CUSTOMER_FUNDED","ZERO_CER","SHARED"],"specificationsHeading":"Specifications","specifications":[{"fact":"material","label":"Material (resin type)"},{"fact":"color","label":"Color"},{"fact":"cavities","label":"Number of cavities"},{"fact":"gramWeight","label":"Gram weight"},{"fact":"neckFinish","label":"Neck finish"},{"fact":"decoration","label":"Decoration"},{"fact":"packaging","label":"Packaging"},{"fact":"toolLeadTime","label":"Equipment / tool lead time"}],"assumptionsHeading":"Pricing assumptions","assumptions":[{"text":"This is a concept quote. It assumes: {{conceptAssumptions}}","points":[]},{"text":"Pricing does not include pallet costs.","points":[]},{"text":"Pricing of pallets is subject to change at the time of shipping due to market conditions.","points":[]},{"text":"This offer is valid until {{validUntil}}.","points":[]},{"text":"Price basis: {{priceBasis}}.","points":[]},{"text":"Freight: {{freight}}.","points":[]},{"text":"Payment terms: {{paymentTerms}} from date of invoice.","points":[]},{"text":"Lead time to be confirmed at time of Purchase Order.","points":[]},{"text":"Standard Pretium Quality specifications apply.","points":[]},{"text":"Pretium specified resin applies.","points":[]},{"text":"Tooling funding: {{toolingFunding}}.","points":[]},{"text":"Mold ownership: {{moldOwnership}}.","points":[]},{"text":"Tooling payment terms:","points":["If < $25,000, 50% with order, 50% upon approval of samples.","If > $25,000, 1/3 with order, 1/3 upon completion of molds, 1/3 upon approval of samples."]},{"text":"Final price is subject to change based on final specifications, mold qualification and any resulting change in process conditions.","points":[]},{"text":"All prices will be subject to resin and other raw material escalation and reduction. Pricing is based on the previous month''s CDI resin costs as of the offer date.","points":[]},{"text":"Pretium standard terms & conditions apply.","points":[]}],"showValidity":true,"closing":"We appreciate the opportunity to support your packaging program and look forward to working with you.","signOff":"Yours sincerely,","signerCompany":"Pretium Packaging","footerNote":"Confidential","legalEntity":"","address":""}'::jsonb,
      "version" = "version" + 1, "updated_at" = now()
  WHERE "key" = 'offer_letter_template' AND "approved_at" IS NULL
    AND "value" = '{"templateVersion":"fb24-2026-11-19","provisional":true,"legalApproved":false,"eyebrow":"Customer offer","title":"Offer Letter","introduction":"Thank you for the opportunity to quote. We are pleased to offer {{customerName}} the pricing below for quote {{quoteNumber}}.","itemsHeading":"Items quoted","pricingHeading":"Pricing (USD)","rows":{"piecePrice":{"label":"Piece price per 1,000 pcs","required":"always"},"molds":{"label":"Molds","required":"when_customer_funds_tooling"},"changeParts":{"label":"Change parts","required":"never"}},"customerFundedToolingModels":["CUSTOMER_FUNDED","ZERO_CER","SHARED"],"specificationsHeading":"Specifications","specifications":[{"fact":"material","label":"Material (resin type)"},{"fact":"color","label":"Color"},{"fact":"cavities","label":"Number of cavities"},{"fact":"gramWeight","label":"Gram weight"},{"fact":"neckFinish","label":"Neck finish"},{"fact":"decoration","label":"Decoration"},{"fact":"packaging","label":"Packaging"}],"assumptionsHeading":"Pricing assumptions","assumptions":[{"text":"This is a concept quote. It assumes: {{conceptAssumptions}}","points":[]},{"text":"Pricing does not include pallet costs.","points":[]},{"text":"Pricing of pallets is subject to change at the time of shipping due to market conditions.","points":[]},{"text":"This offer is valid until {{validUntil}}.","points":[]},{"text":"Price basis: {{priceBasis}}.","points":[]},{"text":"Freight: {{freight}}.","points":[]},{"text":"Payment terms: {{paymentTerms}} from date of invoice.","points":[]},{"text":"Lead time to be confirmed at time of Purchase Order.","points":[]},{"text":"Standard Pretium Quality specifications apply.","points":[]},{"text":"Pretium specified resin applies.","points":[]},{"text":"Tooling funding: {{toolingFunding}}.","points":[]},{"text":"Mold ownership: {{moldOwnership}}.","points":[]},{"text":"Tooling payment terms:","points":["If < $25,000, 50% with order, 50% upon approval of samples.","If > $25,000, 1/3 with order, 1/3 upon completion of molds, 1/3 upon approval of samples."]},{"text":"Final price is subject to change based on final specifications, mold qualification and any resulting change in process conditions.","points":[]},{"text":"All prices will be subject to resin and other raw material escalation and reduction. Pricing is based on the previous month''s CDI resin costs as of the offer date.","points":[]},{"text":"Pretium standard terms & conditions apply.","points":[]}],"showValidity":true,"closing":"We appreciate the opportunity to support your packaging program and look forward to working with you.","signOff":"Yours sincerely,","signerCompany":"Pretium Packaging","footerNote":"Confidential","legalEntity":"","address":""}'::jsonb;
