ALTER TABLE "value_list" DROP CONSTRAINT "value_list_list_key_check";--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "sub_market" text;--> statement-breakpoint
ALTER TABLE "value_list" ADD CONSTRAINT "value_list_list_key_check" CHECK ("value_list"."list_key" in ('product_family', 'market', 'sub_market', 'resin', 'component', 'process_type', 'machine_type', 'plant', 'request_class', 'drawing_status', 'neck_finish', 'packaging_type', 'tooling_funding_model', 'neck_diameter', 'neck_finish_type', 'neck_special_feature', 'pcr_level', 'color_type', 'labels_purchased_by', 'decoration_type', 'requested_payment_terms', 'price_basis', 'freight_type'));--> statement-breakpoint
-- FB-12 (Sub-market at intake, the new market list, and the draft scoring model by sub-market). Tracker: F-020
-- (market list), F-073 (strategic-fit points), T-036; decision D-004 (still OPEN for the weights and tier
-- bands; segment vs market and the points were answered by Melanie Rasche, Director of Market Development,
-- 2026-11-09). Source of every code, label and point: docs/build-guide/feedback/inputs/markets.md.
-- Schema (above): one nullable text column "quote"."sub_market" and the new "sub_market" value list.
-- Data below. Nothing changes how a LIVE quote is scored: the live model is v2 and stays at the neutral 50.
--
-- The config seed refreshes only untouched rows (version = 1) at start-up, so the statements below carry the
-- change to existing environments. On a fresh database the config tables are empty here: each statement is
-- a no-op and the seed inserts the same values. A row the business approved, or one an Admin edited
-- (version > 1), is never changed; the report (pnpm --filter @ccq/db fb12:report) lists what was skipped.
-- No quote is remapped: a quote on a retired market code keeps it and shows "(no longer offered)".
--
-- 1. Markets: the 8 in Melanie Rasche's order, approved by her on 2026-11-09 (approved_by is a user id and
--    she is not an app user, so her name is kept in meta.approvedByName). The five old codes are deactivated.
-- fb12-markets:start
INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional", "approved_at")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'market', v.code, v.label, v.sort, true, '{"approvedByName":"Melanie Rasche"}'::jsonb, false, '2026-11-09T18:00:00Z'::timestamptz
FROM (VALUES
  ('NUTRITION_WELLNESS', 'Nutrition & Wellness', 30),
  ('OTC_HEALTH', 'OTC Health', 40),
  ('CLINICAL', 'Clinical', 50),
  ('HOME_CARE', 'Home Care', 70),
  ('AUTO_COMMERCIAL_CHEMICAL', 'Auto & Commercial Chemical', 80)
) AS v(code, label, sort)
WHERE EXISTS (SELECT 1 FROM "value_list" WHERE "list_key" = 'market')
ON CONFLICT ("list_key", "code") DO NOTHING;
--> statement-breakpoint
UPDATE "value_list" AS l
SET "label" = v.label, "sort" = v.sort, "provisional" = false, "approved_at" = '2026-11-09T18:00:00Z'::timestamptz,
  "meta" = l."meta" || '{"approvedByName":"Melanie Rasche"}'::jsonb, "version" = l."version" + 1, "updated_at" = now()
FROM (VALUES ('FOOD', 'Food', 10), ('BEVERAGE', 'Beverage', 20), ('PERSONAL_CARE', 'Personal Care', 60)) AS v(code, label, sort)
WHERE l."list_key" = 'market' AND l."code" = v.code
  AND l."provisional" AND l."approved_at" IS NULL AND l."version" = 1;
--> statement-breakpoint
UPDATE "value_list"
SET "active" = false, "version" = "version" + 1, "updated_at" = now()
WHERE "list_key" = 'market'
  AND "code" IN ('NUTRITION', 'HOUSEHOLD_CHEMICAL', 'PHARMA_HEALTH', 'INDUSTRIAL_CHEMICAL', 'PET')
  AND "active" AND "provisional" AND "approved_at" IS NULL AND "version" = 1;
-- fb12-markets:end
--> statement-breakpoint
-- 2. Sub-markets: the 30, in her order, each with its parent market in meta.market. PROVISIONAL until she
--    answers the open questions in markets.md (Sun Care, Home Care > Non-Core, Histology, Tubes & Vials).
--    The intake help text is added unless an Admin already wrote one.
-- fb12-sub-markets:start
INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'sub_market', v.code, v.label, v.sort, true, v.meta::jsonb, true
FROM (VALUES
  ('FOOD_CONDIMENTS', 'Condiments, Sauces & Dressings', 10, '{"market":"FOOD"}'),
  ('FOOD_FERMENTED', 'Fermented Foods', 20, '{"market":"FOOD"}'),
  ('FOOD_HONEY_SWEETENERS', 'Honey & Sweeteners', 30, '{"market":"FOOD"}'),
  ('FOOD_SNACKS', 'Snacks & Confections', 40, '{"market":"FOOD"}'),
  ('FOOD_NUT_BUTTERS', 'Nut Butters & Spreads', 50, '{"market":"FOOD"}'),
  ('FOOD_OILS', 'Oils', 60, '{"market":"FOOD"}'),
  ('FOOD_SPICES', 'Spices, Seasonings & Extracts', 70, '{"market":"FOOD"}'),
  ('BEV_NON_ALCOHOLIC', 'Non-Alcoholic', 80, '{"market":"BEVERAGE"}'),
  ('BEV_SPIRITS_MIXERS', 'Spirits & Mixers', 90, '{"market":"BEVERAGE"}'),
  ('NW_LIQUID_SUPPLEMENTS', 'Liquid Supplements', 100, '{"market":"NUTRITION_WELLNESS"}'),
  ('NW_NUTRITIONAL_POWDERS', 'Nutritional Powders', 110, '{"market":"NUTRITION_WELLNESS"}'),
  ('NW_READY_TO_DRINK', 'Ready-to-Drink', 120, '{"market":"NUTRITION_WELLNESS"}'),
  ('NW_VMS', 'VMS', 130, '{"market":"NUTRITION_WELLNESS"}'),
  ('OTC_CONSUMER_HEALTH', 'Consumer Health', 140, '{"market":"OTC_HEALTH"}'),
  ('CLIN_LIFE_SCIENCES', 'Life Sciences', 150, '{"market":"CLINICAL"}'),
  ('CLIN_SPECIMEN_CONTAINERS', 'Specimen Containers', 160, '{"market":"CLINICAL"}'),
  ('CLIN_SWABS', 'Swabs', 170, '{"market":"CLINICAL"}'),
  ('CLIN_HISTOLOGY', 'Histology', 180, '{"market":"CLINICAL"}'),
  ('CLIN_TUBES_VIALS', 'Tubes & Vials', 190, '{"market":"CLINICAL"}'),
  ('PC_BATH_SHOWER', 'Bath & Shower', 200, '{"market":"PERSONAL_CARE"}'),
  ('PC_HAIR', 'Hair Care', 210, '{"market":"PERSONAL_CARE"}'),
  ('PC_SKIN', 'Skin Care', 220, '{"market":"PERSONAL_CARE"}'),
  ('HC_CLEANING', 'Cleaning Supplies', 230, '{"market":"HOME_CARE"}'),
  ('HC_PEST_CONTROL', 'Pest Control', 240, '{"market":"HOME_CARE"}'),
  ('HC_LAWN_GARDEN', 'Lawn & Garden', 250, '{"market":"HOME_CARE"}'),
  ('HC_NON_CORE', 'Non-Core', 260, '{"market":"HOME_CARE"}'),
  ('HC_PET_CARE', 'Pet Care', 270, '{"market":"HOME_CARE"}'),
  ('ACC_AUTO_CARE', 'Auto Care', 280, '{"market":"AUTO_COMMERCIAL_CHEMICAL"}'),
  ('ACC_AG_CROP', 'Ag & Crop Management', 290, '{"market":"AUTO_COMMERCIAL_CHEMICAL"}'),
  ('ACC_COMMERCIAL_CHEMICAL', 'Commercial Chemical', 300, '{"market":"AUTO_COMMERCIAL_CHEMICAL"}')
) AS v(code, label, sort, meta)
WHERE EXISTS (SELECT 1 FROM "value_list" WHERE "list_key" = 'market')
ON CONFLICT ("list_key", "code") DO NOTHING;
--> statement-breakpoint
UPDATE "app_setting"
SET "value" = jsonb_build_object('sub_market', 'Pick the closest sub-market. It sets the strategic-fit score.') || "value",
  "updated_at" = now()
WHERE "key" = 'intake_field_help' AND jsonb_typeof("value") = 'object';
-- fb12-sub-markets:end
--> statement-breakpoint
-- 3. The inactive FB-10 draft scoring model, re-keyed from market to sub-market (80 / 50 / 20), IN PLACE: same
--    model_version, effective_from still null, still provisional. Only when the draft is still exactly what
--    FB-10 seeded: unapproved, never edited (version 1), and its strategic-fit map equal to FB-10's market
--    points. An Admin-edited, discarded or activated draft is left alone (the report says which).
-- fb12-draft:start
UPDATE "scoring_model" AS m
SET "attributes" = (
    SELECT jsonb_agg(
      CASE WHEN a.e->>'key' = 'strategic_fit'
        THEN jsonb_set(a.e, '{map}', jsonb_build_object(
          'by', 'market',
          'values', '{}'::jsonb,
          'default', 50,
          'bySegment', jsonb_build_object('by', 'sub_market', 'values', '{"FOOD_CONDIMENTS":50,"FOOD_FERMENTED":50,"FOOD_HONEY_SWEETENERS":20,"FOOD_SNACKS":80,"FOOD_NUT_BUTTERS":20,"FOOD_OILS":50,"FOOD_SPICES":80,"BEV_NON_ALCOHOLIC":50,"BEV_SPIRITS_MIXERS":20,"NW_LIQUID_SUPPLEMENTS":50,"NW_NUTRITIONAL_POWDERS":80,"NW_READY_TO_DRINK":50,"NW_VMS":80,"OTC_CONSUMER_HEALTH":50,"CLIN_LIFE_SCIENCES":20,"CLIN_SPECIMEN_CONTAINERS":20,"CLIN_SWABS":20,"PC_BATH_SHOWER":80,"PC_HAIR":80,"PC_SKIN":80,"HC_CLEANING":50,"HC_PEST_CONTROL":20,"HC_LAWN_GARDEN":50,"HC_PET_CARE":20,"ACC_AUTO_CARE":50,"ACC_AG_CROP":20,"ACC_COMMERCIAL_CHEMICAL":80}'::jsonb),
          'defaultNote', 'Pick a sub-market to score strategic fit'))
        ELSE a.e END
      ORDER BY a.i)
    FROM jsonb_array_elements(m."attributes") WITH ORDINALITY AS a(e, i)
  ),
  "change_reason" = 'FB-12 (F-073, D-004 open): DRAFT. Weights and tiers equal the active model. Strategic fit scores by sub-market from Melanie Rasche (2026-11-09): Strategic Growth 80, Selectively Participate 50, Rationalization 20 (provisional). A quote with no scored sub-market gets the neutral 50. Not active: compare it in the preview, then activate once D-004 sets the weights and tier bands.',
  "updated_at" = now()
WHERE m."effective_from" IS NULL AND m."provisional" AND m."approved_at" IS NULL AND m."version" = 1
  AND m."change_reason" LIKE 'FB-10%'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(m."attributes") AS a(e)
    WHERE a.e->>'key' = 'strategic_fit'
      AND a.e->'map' = '{"by":"market","values":{"PERSONAL_CARE":90,"NUTRITION":75,"FOOD":75,"PET":75,"BEVERAGE":60,"HOUSEHOLD_CHEMICAL":50,"INDUSTRIAL_CHEMICAL":50,"PHARMA_HEALTH":20},"default":50}'::jsonb
  );
-- fb12-draft:end
