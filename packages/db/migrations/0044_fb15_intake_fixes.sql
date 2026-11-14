ALTER TABLE "quote" ADD COLUMN "product_family_other" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "component_other" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "decoration_type_other" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "customer_share_pct" numeric(5, 2);--> statement-breakpoint
-- FB-15 (walkthrough of 2026-11-13, W13-01 to W13-11): intake fixes. Synthetic data only; nothing here reads or
-- writes a customer value.
-- Schema (mirror-safe, rule 10): four nullable columns on "quote": what an "Other" product family, component or
-- decoration is (text), and the customer's share of Shared tooling funding (numeric(5,2), precision <= 38).
-- Data (all provisional, idempotent, safe to re-run):
--   1. intake_required_fields: Market and Sub-market are required (W13-02, D-006 owner Bailey Schmitt). The two
--      rules are APPENDED where missing, as 0028 did: an Admin's other rules are kept.
--   2. "Other" asks what it is (W13-03): value-list meta "freeText" on product_family / component /
--      decoration_type / freight_type OTHER. product_family is an APPROVED list (Danielle Leu, 2026-11-09, 0036):
--      for that one row only the "freeText" behaviour flag is added; its label, values, provisional flag and
--      approved_at are left exactly as they are. Every other row is changed only while unapproved and while the
--      flag is absent (as 0036 and 0043 did for their flags).
--   3. Stock white / Stock black colors for HDPE and PP (W13-07) and the Fluorination additive (W13-08): new
--      provisional rows; existing rows are never touched.
--   4. Shared funding asks for the customer's share (W13-09): meta "customerShare" on SHARED (unapproved, flag
--      absent); its help text changes only while it is still the 0043 wording.
--   5. Help text (W13-06 bid reference, W13-11 Spirits & Mixers, the new fields): a new key is added only where
--      missing; a changed key only while it is still the seeded wording (an Admin's own text wins).
--   6. Settings: intake_other_description_max_length (200) and customer_master_data_notice (W13-10). Inserted
--      only when absent.
UPDATE "app_setting" SET "value" = "value" || coalesce((
  SELECT jsonb_agg(v.rule ORDER BY v.n)
  FROM (VALUES
    (1, '{"field":"market","op":"present"}'::jsonb),
    (2, '{"field":"sub_market","op":"present"}'::jsonb)
  ) AS v(n, rule)
  WHERE NOT "app_setting"."value" @> jsonb_build_array(v.rule)
), '[]'::jsonb), "updated_at" = now()
WHERE "key" = 'intake_required_fields' AND jsonb_typeof("value") = 'array';
--> statement-breakpoint
-- 2. "Other" asks what it is. product_family: the behaviour flag only (approved list; see above).
UPDATE "value_list"
  SET "meta" = "meta" || '{"freeText":true}'::jsonb, "updated_at" = now()
  WHERE "list_key" = 'product_family' AND "code" = 'OTHER' AND NOT ("meta" ? 'freeText');--> statement-breakpoint
UPDATE "value_list"
  SET "meta" = "meta" || '{"freeText":true}'::jsonb, "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" IN ('component', 'decoration_type', 'freight_type') AND "code" = 'OTHER'
    AND "approved_at" IS NULL AND NOT ("meta" ? 'freeText');--> statement-breakpoint
-- 3. New provisional entries (new environments get them from the seed, in the same relative order).
INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional")
SELECT
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.list_key, v.code, v.label, v.sort, true, v.meta::jsonb, true
FROM (VALUES
  ('color_type', 'STOCK_WHITE', 'Stock white', 12, '{"resins":["HDPE","PP"]}'),
  ('color_type', 'STOCK_BLACK', 'Stock black', 14, '{"resins":["HDPE","PP"]}'),
  ('additive', 'FLUORINATION', 'Fluorination', 55, '{}')
) AS v(list_key, code, label, sort, meta)
ON CONFLICT ("list_key", "code") DO NOTHING;--> statement-breakpoint
-- 4. Shared funding asks for the customer's share; Pretium covers the rest.
UPDATE "value_list"
  SET "meta" = "meta" || '{"customerShare":true}'::jsonb, "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'tooling_funding_model' AND "code" = 'SHARED'
    AND "approved_at" IS NULL AND NOT ("meta" ? 'customerShare');--> statement-breakpoint
UPDATE "value_list"
  SET "meta" = "meta" || jsonb_build_object('helpText', 'Pretium and the customer each pay part. Enter the customer''s share; Pretium covers the rest.'),
      "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'tooling_funding_model' AND "code" = 'SHARED'
    AND "meta" ->> 'helpText' = 'Pretium and the customer each pay part. Record the agreed split in the terms notes.';
--> statement-breakpoint
-- 5. Help text. New keys where missing (an existing key, an Admin's included, wins).
UPDATE "app_setting" SET "value" = jsonb_build_object(
  'product_family_other', 'Required when the product family is Other: say what the product is.',
  'component_other', 'Required when a component is Other: say what it is.',
  'decoration_type_other', 'Required when the decoration is Other: say how it is decorated.',
  'customer_share_pct', 'Pretium covers the rest.'
) || "value", "updated_at" = now()
WHERE "key" = 'intake_field_help' AND jsonb_typeof("value") = 'object';
--> statement-breakpoint
UPDATE "app_setting" SET "value" = "value" || jsonb_build_object(
  'bid_reference', 'Most customers don''t send one. Leave it blank if not.'
), "updated_at" = now()
WHERE "key" = 'intake_field_help'
  AND "value"->>'bid_reference' = 'The customer’s bid, RFP or program name or number, if it has one. A plain reference: it does not link quotes.';
--> statement-breakpoint
UPDATE "app_setting" SET "value" = "value" || jsonb_build_object(
  'sub_market', 'Pick the closest sub-market. It sets the strategic-fit score. Beverage › Spirits & Mixers covers alcoholic drinks (Midas calls it Alcoholic).'
), "updated_at" = now()
WHERE "key" = 'intake_field_help'
  AND "value"->>'sub_market' = 'Pick the closest sub-market. It sets the strategic-fit score.';
--> statement-breakpoint
UPDATE "app_setting" SET "value" = "value" || jsonb_build_object(
  'color_type', 'Color and additives drive material cost. Describe a custom color. A stock color is the colorant Pretium uses for its stock items at that plant.'
), "updated_at" = now()
WHERE "key" = 'intake_field_help'
  AND "value"->>'color_type' = 'Color and additives drive material cost. Describe a custom color.';
--> statement-breakpoint
UPDATE "app_setting" SET "value" = "value" || jsonb_build_object(
  'dimensions', 'Height, width or diameter, depth and gram weight. Required (with neck, resin and color) when no drawing is attached; the red asterisks go away once a drawing is attached.'
), "updated_at" = now()
WHERE "key" = 'intake_field_help'
  AND "value"->>'dimensions' = 'Height, width or diameter, depth and gram weight. Required (with neck, resin and color) when no drawing is attached.';
--> statement-breakpoint
UPDATE "app_setting" SET "value" = "value" || jsonb_build_object(
  'freight_special_arrangements', 'Anything unusual about the freight. A drop trailer sits for about two weeks and T-bars are very expensive, so name them here if the customer expects them. Required when the freight type is Other.'
), "updated_at" = now()
WHERE "key" = 'intake_field_help'
  AND "value"->>'freight_special_arrangements' = 'Anything unusual about the freight. A drop trailer sits for about two weeks and T-bars are very expensive, so name them here if the customer expects them.';
--> statement-breakpoint
-- 6. New settings (provisional).
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.key, v.value::jsonb, v.description, true
FROM (VALUES
  ('intake_other_description_max_length', '200',
   'FB-15 (W13-03): the longest description (characters) of an "Other" product family, component or decoration. Provisional.'),
  ('customer_master_data_notice',
   '"This customer has no ERP account yet. Request master-data setup (help-desk ticket) as part of commercial activation."',
   'FB-15 (W13-10, Bailey Schmitt): shown on the Commit & Hand Off view and the closed-won quote when the customer is "not yet a Pretium customer" (no ERP account). Empty = no notice. Provisional wording.')
) AS v(key, value, description)
ON CONFLICT ("key") DO NOTHING;
