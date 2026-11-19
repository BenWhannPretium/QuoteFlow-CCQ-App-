ALTER TABLE "quote_item" DROP CONSTRAINT "quote_item_label_length_check";--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "decoration_types" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "concept_assumptions" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "stock_hold_requested" boolean;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "stock_hold_weeks" integer;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "stock_hold_note" text;--> statement-breakpoint
ALTER TABLE "quote_item" ADD COLUMN "decoration_types" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_stock_hold_weeks_check" CHECK ("quote"."stock_hold_weeks" is null or ("quote"."stock_hold_weeks" between 1 and 520 and "quote"."stock_hold_requested" is true));--> statement-breakpoint
ALTER TABLE "quote_item" ADD CONSTRAINT "quote_item_label_length_check" CHECK ("quote_item"."label" is null or char_length("quote_item"."label") <= 120);--> statement-breakpoint
-- ── FB-24 (hand-written): intake feedback of 2026-11-17/18 ────────────────────────────────────────────
-- N17-01 (ship-to sources), N17-02 (decoration types, several at once), N17-03 (concept / innovation
-- requests), N17-04 (Soldier pack), N17-05 (item name 120), N17-06/07 (file types per place), N17-08
-- (dropdowns A to Z: keepOrder), N18-02 (tooling commitment at intake), D4 (stocking agreement).
-- Synthetic data only. As 0044 / 0049: a config row the business approved (approved_at set) or an Admin
-- edited away from the seed is left alone. On a fresh database the config tables are empty here: each
-- config statement is a no-op and the seed inserts the same values.
--
-- 1. Fabric (rule 10): decoration_types is an array, so it gets a decoration_types_json text companion on
-- quote and quote_item, kept by the zz_fabric_json trigger (0022), which is re-created with the new column.
ALTER TABLE "quote" ADD COLUMN "decoration_types_json" text;--> statement-breakpoint
COMMENT ON COLUMN "quote"."decoration_types_json" IS 'Fabric copy of decoration_types as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';--> statement-breakpoint
ALTER TABLE "quote_item" ADD COLUMN "decoration_types_json" text;--> statement-breakpoint
COMMENT ON COLUMN "quote_item"."decoration_types_json" IS 'Fabric copy of decoration_types as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';--> statement-breakpoint
DROP TRIGGER zz_fabric_json ON "quote";--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "quote"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('components', 'decoration_types', 'priority_breakdown', 'ship_to', 'ship_to_original', 'structured_description');--> statement-breakpoint
DROP TRIGGER zz_fabric_json ON "quote_item";--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "quote_item"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('components', 'decoration_types');--> statement-breakpoint
--
-- 2. N17-02: decoration_types back-filled from the deprecated single decoration_type (kept, no longer
-- written). The UPDATE fires the trigger, which fills the companions; the rest get theirs below.
UPDATE "quote" SET "decoration_types" = ARRAY["decoration_type"]
  WHERE "decoration_type" IS NOT NULL AND btrim("decoration_type") <> '' AND "decoration_types" = '{}';--> statement-breakpoint
UPDATE "quote_item" SET "decoration_types" = ARRAY["decoration_type"]
  WHERE "decoration_type" IS NOT NULL AND btrim("decoration_type") <> '' AND "decoration_types" = '{}';--> statement-breakpoint
UPDATE "quote" SET "decoration_types_json" = to_jsonb("decoration_types")::text
  WHERE "decoration_types_json" IS NULL;--> statement-breakpoint
UPDATE "quote_item" SET "decoration_types_json" = to_jsonb("decoration_types")::text
  WHERE "decoration_types_json" IS NULL;--> statement-breakpoint
-- Open drafts: each item's decorationType becomes decorationTypes [code] (the app still reads an old
-- draft's single code the same way). An item that already has decorationTypes is left alone.
UPDATE "quote_draft" d SET "data" = jsonb_set(d."data", '{items}', (
    SELECT jsonb_agg(
      CASE
        WHEN jsonb_typeof(i.item) = 'object' AND NOT (i.item ? 'decorationTypes')
          AND jsonb_typeof(i.item -> 'decorationType') = 'string' AND btrim(i.item ->> 'decorationType') <> ''
        THEN (i.item - 'decorationType') || jsonb_build_object('decorationTypes', jsonb_build_array(i.item ->> 'decorationType'))
        ELSE i.item
      END ORDER BY i.n)
    FROM jsonb_array_elements(d."data" -> 'items') WITH ORDINALITY AS i(item, n)))
  WHERE jsonb_typeof(d."data" -> 'items') = 'array' AND jsonb_array_length(d."data" -> 'items') > 0
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(d."data" -> 'items') x
      WHERE jsonb_typeof(x) = 'object' AND x ? 'decorationType' AND NOT (x ? 'decorationTypes'));--> statement-breakpoint
-- The Decoration component asks for decoration_types (it asked for decoration_type). Only the follow-up
-- list as seeded is changed; the app also reads a remaining decoration_type follow-up as decoration_types.
UPDATE "value_list"
  SET "meta" = jsonb_set("meta", '{followUps}', '["decoration_types","decoration_print_colors"]'::jsonb),
      "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'component' AND "code" = 'DECORATION' AND "approved_at" IS NULL
    AND "meta" -> 'followUps' = '["decoration_type","decoration_print_colors"]'::jsonb;--> statement-breakpoint
--
-- 3. New provisional list entries: N17-03 Concept / innovation, N17-04 Soldier pack (before Other).
INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional")
SELECT
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.list_key, v.code, v.label, v.sort, true, v.meta::jsonb, true
FROM (VALUES
  ('request_class', 'CONCEPT', 'Concept / innovation', 15, '{}'),
  ('packaging_type', 'SOLDIER_PACK', 'Soldier pack', 45, '{}')
) AS v(list_key, code, label, sort, meta)
WHERE EXISTS (SELECT 1 FROM "value_list" vl WHERE vl."list_key" = v.list_key)
ON CONFLICT ("list_key", "code") DO NOTHING;--> statement-breakpoint
--
-- 4. N17-08: lists are shown A to Z (Other last) unless an entry's meta says keepOrder. Seeded on the two
-- lists whose stored order means something: drawing_status (best to worst) and tooling_payment_terms
-- (upfront, split, amortized). Provisional (Bailey Schmitt confirms which lists keep their order).
UPDATE "value_list"
  SET "meta" = "meta" || '{"keepOrder":true}'::jsonb, "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" IN ('drawing_status', 'tooling_payment_terms') AND "approved_at" IS NULL
    AND NOT ("meta" ? 'keepOrder');--> statement-breakpoint
--
-- 5. Settings (provisional). CONCEPT can be submitted; the minimum spec does not block it; the ship-to
-- sources; the file types each place offers. ON CONFLICT: an existing row is left alone.
UPDATE "app_setting"
  SET "value" = '["CCQ","CONCEPT"]'::jsonb,
      "description" = 'FB-02 (F-067): the request_class codes that can be submitted to CCQ. Any other class shows intake_redirect_message and Submit is disabled; the API answers 422 REQUEST_CLASS_NOT_ALLOWED. FB-24 (N17-03): CONCEPT added. Provisional (Matthew Graden, Tania Nazario).',
      "updated_at" = now()
  WHERE "key" = 'intake_allowed_request_classes' AND "approved_at" IS NULL
    AND "value" = '["CCQ"]'::jsonb;--> statement-breakpoint
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, s.key, s.value::jsonb, s.description, true
FROM (VALUES
  ('intake_min_spec_exempt_classes', '["CONCEPT"]',
   'FB-24 (N17-03, Bailey Schmitt): request_class codes for which the no-drawing minimum spec (intake_min_spec_fields) does not block; the fields stay on screen, optional. Such a request needs a drawing or a sample photo / render on file and "Assumptions for this concept", which the offer letter states. Seed: CONCEPT. Provisional.'),
  ('ship_to_sources', '["product_spec","account"]',
   'FB-24 (N17-01, D-18): where the intake pre-fills the ship-to from, in order; the first source with a city and a state wins and the screen says which. product_spec: the opportunity''s first product specification (Ship_To_City__c, Ship_To_State__c, Shipping_Country__c); account: the Account''s shipping address. The opportunity''s free-text Ship_to_Locations__c is shown to the KAM, never parsed. Provisional until Zachary Cairns confirms which wins.'),
  ('attachment_kinds_by_place', '{"intake":["bottle_drawing","sample_photo","bid_file","project_brief","competitor_drawing","other"],"quote":["bottle_drawing","sample_photo","bid_file","project_brief","competitor_drawing","other"]}',
   'FB-24 (N17-06, N17-07, Bailey Schmitt): the file types each place offers, in order. intake: the intake''s files (the server refuses any other type on a draft, 422). quote: the quote''s Attachments tab. Capacity analysis is uploaded on Engineering''s capacity rows, the equipment BOM in Engineering, the models in Quoting; the offer letter is generated. Specification is offered nowhere until Bailey says where it belongs (old files keep their label). Provisional.')
) AS s(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Help text: new keys where missing (an existing key, an Admin's included, wins); the request class help
-- gains the concept sentence only where it is still the seeded text.
UPDATE "app_setting" SET "value" = jsonb_build_object(
  'concept_assumptions', 'What the quote assumes about a product that is not designed yet (size, weight, resin, decoration). Engineering, Pricing and Final Review see it, and the offer letter states it.',
  'decoration_types', 'Tick every decoration the item has. Other asks what it is.',
  'tooling_commitment', 'Whether the customer will commit to paying for the tooling. Final Review sees your answer. Yes asks for a Legal review before the offer goes out.',
  'stock_hold_requested', 'Holding bottles for a customer for a long time costs Pretium money, so Pricing needs to know. Say for how long if you know.'
) || "value", "updated_at" = now()
WHERE "key" = 'intake_field_help' AND jsonb_typeof("value") = 'object';--> statement-breakpoint
UPDATE "app_setting" SET "value" = jsonb_set("value", '{request_class}', to_jsonb('CCQ is new business that needs engineering or capital. Concept / innovation is CCQ work that starts from a render or a photo instead of a drawing. Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application.'::text)),
  "updated_at" = now()
WHERE "key" = 'intake_field_help' AND jsonb_typeof("value") = 'object'
  AND "value" ->> 'request_class' = 'CCQ is new business that needs engineering or capital. Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application.';--> statement-breakpoint
--
-- 6. N17-03 (FB-20's letter): a concept quote states its assumptions. The template gains the whitelisted
-- token {{conceptAssumptions}} in one provisional sentence ("This is a concept quote. It assumes: …"),
-- which drops itself on any other quote (blank token, FB-20's rule); templateVersion fb24-2026-11-19. Only
-- the template exactly as 0048 seeded it is replaced: an Admin's edit or an approved template is left
-- alone (the Admin can add the sentence in the console). The description names the new token where it
-- is still FB-20's text.
UPDATE "app_setting"
  SET "value" = '{"templateVersion":"fb24-2026-11-19","provisional":true,"legalApproved":false,"eyebrow":"Customer offer","title":"Offer Letter","introduction":"Thank you for the opportunity to quote. We are pleased to offer {{customerName}} the pricing below for quote {{quoteNumber}}.","itemsHeading":"Items quoted","pricingHeading":"Pricing (USD)","rows":{"piecePrice":{"label":"Piece price per 1,000 pcs","required":"always"},"molds":{"label":"Molds","required":"when_customer_funds_tooling"},"changeParts":{"label":"Change parts","required":"never"}},"customerFundedToolingModels":["CUSTOMER_FUNDED","ZERO_CER","SHARED"],"specificationsHeading":"Specifications","specifications":[{"fact":"material","label":"Material (resin type)"},{"fact":"color","label":"Color"},{"fact":"cavities","label":"Number of cavities"},{"fact":"gramWeight","label":"Gram weight"},{"fact":"neckFinish","label":"Neck finish"},{"fact":"decoration","label":"Decoration"},{"fact":"packaging","label":"Packaging"}],"assumptionsHeading":"Pricing assumptions","assumptions":[{"text":"This is a concept quote. It assumes: {{conceptAssumptions}}","points":[]},{"text":"Pricing does not include pallet costs.","points":[]},{"text":"Pricing of pallets is subject to change at the time of shipping due to market conditions.","points":[]},{"text":"This offer is valid until {{validUntil}}.","points":[]},{"text":"Price basis: {{priceBasis}}.","points":[]},{"text":"Freight: {{freight}}.","points":[]},{"text":"Payment terms: {{paymentTerms}} from date of invoice.","points":[]},{"text":"Lead time to be confirmed at time of Purchase Order.","points":[]},{"text":"Standard Pretium Quality specifications apply.","points":[]},{"text":"Pretium specified resin applies.","points":[]},{"text":"Tooling funding: {{toolingFunding}}.","points":[]},{"text":"Mold ownership: {{moldOwnership}}.","points":[]},{"text":"Tooling payment terms:","points":["If < $25,000, 50% with order, 50% upon approval of samples.","If > $25,000, 1/3 with order, 1/3 upon completion of molds, 1/3 upon approval of samples."]},{"text":"Final price is subject to change based on final specifications, mold qualification and any resulting change in process conditions.","points":[]},{"text":"All prices will be subject to resin and other raw material escalation and reduction. Pricing is based on the previous month''s CDI resin costs as of the offer date.","points":[]},{"text":"Pretium standard terms & conditions apply.","points":[]}],"showValidity":true,"closing":"We appreciate the opportunity to support your packaging program and look forward to working with you.","signOff":"Yours sincerely,","signerCompany":"Pretium Packaging","footerNote":"Confidential","legalEntity":"","address":""}'::jsonb,
      "version" = "version" + 1, "updated_at" = now()
  WHERE "key" = 'offer_letter_template' AND "approved_at" IS NULL
    AND "value" = '{"templateVersion":"fb20-2026-11-16","provisional":true,"legalApproved":false,"eyebrow":"Customer offer","title":"Offer Letter","introduction":"Thank you for the opportunity to quote. We are pleased to offer {{customerName}} the pricing below for quote {{quoteNumber}}.","itemsHeading":"Items quoted","pricingHeading":"Pricing (USD)","rows":{"piecePrice":{"label":"Piece price per 1,000 pcs","required":"always"},"molds":{"label":"Molds","required":"when_customer_funds_tooling"},"changeParts":{"label":"Change parts","required":"never"}},"customerFundedToolingModels":["CUSTOMER_FUNDED","ZERO_CER","SHARED"],"specificationsHeading":"Specifications","specifications":[{"fact":"material","label":"Material (resin type)"},{"fact":"color","label":"Color"},{"fact":"cavities","label":"Number of cavities"},{"fact":"gramWeight","label":"Gram weight"},{"fact":"neckFinish","label":"Neck finish"},{"fact":"decoration","label":"Decoration"},{"fact":"packaging","label":"Packaging"}],"assumptionsHeading":"Pricing assumptions","assumptions":[{"text":"Pricing does not include pallet costs.","points":[]},{"text":"Pricing of pallets is subject to change at the time of shipping due to market conditions.","points":[]},{"text":"This offer is valid until {{validUntil}}.","points":[]},{"text":"Price basis: {{priceBasis}}.","points":[]},{"text":"Freight: {{freight}}.","points":[]},{"text":"Payment terms: {{paymentTerms}} from date of invoice.","points":[]},{"text":"Lead time to be confirmed at time of Purchase Order.","points":[]},{"text":"Standard Pretium Quality specifications apply.","points":[]},{"text":"Pretium specified resin applies.","points":[]},{"text":"Tooling funding: {{toolingFunding}}.","points":[]},{"text":"Mold ownership: {{moldOwnership}}.","points":[]},{"text":"Tooling payment terms:","points":["If < $25,000, 50% with order, 50% upon approval of samples.","If > $25,000, 1/3 with order, 1/3 upon completion of molds, 1/3 upon approval of samples."]},{"text":"Final price is subject to change based on final specifications, mold qualification and any resulting change in process conditions.","points":[]},{"text":"All prices will be subject to resin and other raw material escalation and reduction. Pricing is based on the previous month''s CDI resin costs as of the offer date.","points":[]},{"text":"Pretium standard terms & conditions apply.","points":[]}],"showValidity":true,"closing":"We appreciate the opportunity to support your packaging program and look forward to working with you.","signOff":"Yours sincerely,","signerCompany":"Pretium Packaging","footerNote":"Confidential","legalEntity":"","address":""}'::jsonb;--> statement-breakpoint
UPDATE "app_setting"
  SET "description" = 'FB-20 (F-070): the offer letter''s wording and layout. Every business sentence on the letter (title, introduction, pricing assumptions, closing, sign-off, footer), the price row labels and when each is required (piece price always; molds when the quote''s tooling funding is one of customerFundedToolingModels; change parts never), and the Specifications rows. Tokens: {{quoteNumber}}, {{customerName}}, {{validUntil}}, {{paymentTerms}}, {{priceBasis}}, {{freight}}, {{toolingFunding}}, {{moldOwnership}}, {{conceptAssumptions}} (FB-24: a concept quote''s assumptions, blank on any other quote); a sentence whose token has no value on the quote is left out. Seeded from the old Standard Quote Template (feedback/inputs/offer-letter-template-structure.md). Provisional, not approved by Legal; legalEntity and address are blank until Legal gives them.', "updated_at" = now()
  WHERE "key" = 'offer_letter_template'
    AND "description" = 'FB-20 (F-070): the offer letter''s wording and layout. Every business sentence on the letter (title, introduction, pricing assumptions, closing, sign-off, footer), the price row labels and when each is required (piece price always; molds when the quote''s tooling funding is one of customerFundedToolingModels; change parts never), and the Specifications rows. Tokens: {{quoteNumber}}, {{customerName}}, {{validUntil}}, {{paymentTerms}}, {{priceBasis}}, {{freight}}, {{toolingFunding}}, {{moldOwnership}}; a sentence whose token has no value on the quote is left out. Seeded from the old Standard Quote Template (feedback/inputs/offer-letter-template-structure.md). Provisional, not approved by Legal; legalEntity and address are blank until Legal gives them.';
