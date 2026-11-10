ALTER TABLE "value_list" DROP CONSTRAINT "value_list_list_key_check";--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "pcr_level_other" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "additive" text;--> statement-breakpoint
ALTER TABLE "value_list" ADD CONSTRAINT "value_list_list_key_check" CHECK ("value_list"."list_key" in ('product_family', 'market', 'resin', 'component', 'process_type', 'machine_type', 'plant', 'request_class', 'drawing_status', 'neck_finish', 'packaging_type', 'tooling_funding_model', 'neck_diameter', 'neck_finish_type', 'neck_special_feature', 'pcr_level', 'color_type', 'additive', 'labels_purchased_by', 'decoration_type', 'requested_payment_terms', 'price_basis', 'freight_type'));--> statement-breakpoint
-- FB-09 (Data standards and value lists). Tracker: F-020, F-057 (plants: no list received), F-012 / F-019 /
-- D-006 (no data change here). Source: Danielle Leu's reply of 2026-11-09
-- (docs/build-guide/feedback/inputs/value-lists-danielle.md). The "market" list is FB-12's and is not touched.
-- Schema: "quote"."pcr_level_other" and "quote"."additive" (single text columns, mirror-safe), and the
-- "additive" value list key. Data:
--   product_family  approved by Danielle Leu 2026-11-09 (values unchanged);
--   resin           her list and order, approved; PCR_HDPE, PCR_PET, PETG, PVC, BIO_RESIN deactivated (never deleted);
--   pcr_level       relabel 0 to "0% / Virgin", add 30 and Other; stays PROVISIONAL (Engineering and Supply Chain confirm);
--   additive        new list, PROVISIONAL (no named owner yet);
--   "Other" carries meta.freeText so the intake asks for the customer-specified detail;
--   engineering_assignment_rules loses the retired resin codes, only while it is still the FB-06 seed;
--   D-016 defaults (provisional): packaging "Other" asks for the packaging note; setting intake_free_text_max_length (500)
--   and an empty plant_packaging_standards (Engineering has not sent it).
-- Idempotent and safe to re-run: existing rows are matched on (list_key, code); an Admin's own edits are kept.

-- "approved_by" is a user id: it is set when Danielle Leu has signed in, otherwise left null; the owner's name is
-- always kept in meta.approvedByName (decision record: value-lists-danielle.md).
-- 1. Product family: sign-off only (the seven values equal Danielle's list).
UPDATE "value_list"
  SET "provisional" = false, "approved_by" = (SELECT "id" FROM "app_user" WHERE "display_name" = 'Danielle Leu' ORDER BY "created_at" LIMIT 1),
      "approved_at" = '2026-11-09T00:00:00Z', "meta" = "meta" || '{"approvedByName":"Danielle Leu"}'::jsonb,
      "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'product_family'
    AND "code" IN ('BOTTLE', 'JAR', 'CLOSURE', 'PREFORM', 'CANISTER_TUB', 'HANDLEWARE', 'OTHER')
    AND "approved_at" IS NULL;--> statement-breakpoint

-- 2. Insert any missing rows of the three lists (new environments get them from the seed).
INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional")
SELECT
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.list_key, v.code, v.label, v.sort, true, v.meta::jsonb, true
FROM (VALUES
  ('resin', 'PET', 'PET', 10, '{}'),
  ('resin', 'HDPE', 'HDPE', 20, '{}'),
  ('resin', 'PP', 'PP', 30, '{}'),
  ('resin', 'LDPE', 'LDPE', 40, '{}'),
  ('resin', 'PS', 'PS', 50, '{}'),
  ('resin', 'OTHER', 'Other', 60, '{"freeText":true}'),
  ('pcr_level', '0', '0% / Virgin', 10, '{}'),
  ('pcr_level', '25', '25%', 20, '{}'),
  ('pcr_level', '30', '30%', 30, '{}'),
  ('pcr_level', '50', '50%', 40, '{}'),
  ('pcr_level', '100', '100%', 50, '{}'),
  ('pcr_level', 'OTHER', 'Other', 60, '{"freeText":true}'),
  ('additive', 'NONE', 'None', 10, '{}'),
  ('additive', 'UV', 'UV', 20, '{}'),
  ('additive', 'BARRIER', 'Barrier', 30, '{}'),
  ('additive', 'ANTISTAT', 'Antistat', 40, '{}'),
  ('additive', 'IMPACT_MODIFIER', 'Impact Modifier', 50, '{}'),
  ('additive', 'OTHER', 'Other', 60, '{"freeText":true}')
) AS v(list_key, code, label, sort, meta)
ON CONFLICT ("list_key", "code") DO NOTHING;--> statement-breakpoint

-- 3. Resin: her order, "Other" asks for the detail, retired codes are deactivated (old quotes keep them).
UPDATE "value_list" AS vl
  SET "sort" = v.sort, "active" = true, "updated_at" = now(), "version" = vl."version" + 1
  FROM (VALUES ('PET', 10), ('HDPE', 20), ('PP', 30), ('LDPE', 40), ('PS', 50), ('OTHER', 60)) AS v(code, sort)
  WHERE vl."list_key" = 'resin' AND vl."code" = v.code AND (vl."sort" <> v.sort OR vl."active" = false);--> statement-breakpoint
UPDATE "value_list"
  SET "active" = false, "sort" = 900 + "sort", "updated_at" = now(), "version" = "version" + 1
  WHERE "list_key" = 'resin' AND "code" IN ('PCR_HDPE', 'PCR_PET', 'PETG', 'PVC', 'BIO_RESIN') AND "active" = true;--> statement-breakpoint
UPDATE "value_list"
  SET "provisional" = false, "approved_by" = (SELECT "id" FROM "app_user" WHERE "display_name" = 'Danielle Leu' ORDER BY "created_at" LIMIT 1),
      "approved_at" = '2026-11-09T00:00:00Z', "meta" = "meta" || '{"approvedByName":"Danielle Leu"}'::jsonb,
      "updated_at" = now()
  WHERE "list_key" = 'resin' AND "code" IN ('PET', 'HDPE', 'PP', 'LDPE', 'PS', 'OTHER') AND "approved_at" IS NULL;--> statement-breakpoint

-- 4. PCR level: relabel 0, order, "Other" asks for the detail. Stays provisional.
UPDATE "value_list" SET "label" = '0% / Virgin', "updated_at" = now(), "version" = "version" + 1
  WHERE "list_key" = 'pcr_level' AND "code" = '0' AND "label" = '0%';--> statement-breakpoint
UPDATE "value_list" AS vl
  SET "sort" = v.sort, "updated_at" = now(), "version" = vl."version" + 1
  FROM (VALUES ('0', 10), ('25', 20), ('30', 30), ('50', 40), ('100', 50), ('OTHER', 60)) AS v(code, sort)
  WHERE vl."list_key" = 'pcr_level' AND vl."code" = v.code AND vl."sort" <> v.sort;--> statement-breakpoint

-- 5. "Other" asks for the customer-specified resin / grade, PCR level or additive.
UPDATE "value_list"
  SET "meta" = "meta" || '{"freeText":true}'::jsonb, "updated_at" = now(), "version" = "version" + 1
  WHERE "list_key" IN ('resin', 'pcr_level', 'additive') AND "code" = 'OTHER' AND NOT ("meta" ? 'freeText');--> statement-breakpoint

-- 6. FB-06 suggestion rules: drop the retired resin codes, only while the setting is still the FB-06 seed
-- (unapproved, never edited in the console: version = 1). An Admin-edited row is left alone.
UPDATE "app_setting"
  SET "value" = jsonb_build_object('rules', (
        SELECT COALESCE(jsonb_agg(
          jsonb_set(r.e, '{resins}', COALESCE((
            SELECT jsonb_agg(x.c) FROM jsonb_array_elements(r.e->'resins') AS x(c)
            WHERE (x.c #>> '{}') NOT IN ('PCR_HDPE', 'PCR_PET', 'PETG', 'PVC', 'BIO_RESIN')
          ), '[]'::jsonb)) ORDER BY r.i), '[]'::jsonb)
        FROM jsonb_array_elements("value"->'rules') WITH ORDINALITY AS r(e, i))),
      "updated_at" = now()
  WHERE "key" = 'engineering_assignment_rules'
    AND "provisional" = true AND "approved_at" IS NULL AND "version" = 1
    AND jsonb_typeof("value"->'rules') = 'array';--> statement-breakpoint

-- 7. "Why we ask" help for the new and reworded fields (an Admin's own wording wins).
UPDATE "app_setting" SET "value" = jsonb_build_object(
  'resin_grade', 'Required when the resin is Other: the customer-specified resin and grade, e.g. "LyondellBasell Pro-fax 6331". Also used when the customer specifies the resin.',
  'pcr_level_other', 'Required when PCR is Other: the PCR level the customer asked for.',
  'additive', 'Anything added to the resin, from the standard list. Pick Other for a specialty additive.'
) || "value", "updated_at" = now()
WHERE "key" = 'intake_field_help' AND jsonb_typeof("value") = 'object';--> statement-breakpoint
UPDATE "app_setting" SET "value" = "value" || jsonb_build_object(
  'additives', 'Optional note on additives. Required, as the customer-specified additive, when the additive is Other.'
), "updated_at" = now()
WHERE "key" = 'intake_field_help' AND "value"->>'additives' = 'Anything added to the resin (UV, slip, antistatic…). Optional.';--> statement-breakpoint
UPDATE "app_setting" SET "value" = "value" || jsonb_build_object(
  'pcr_level', 'Post-consumer recycled content, from the standard levels. Pick Other for a level that is not listed.'
), "updated_at" = now()
WHERE "key" = 'intake_field_help' AND "value"->>'pcr_level' = 'Post-consumer recycled content, from the standard levels.';
--> statement-breakpoint

-- 8. D-016 defaults (F-012, F-019), provisional: packaging "Other" is reserved for customer-dictated packaging and
-- asks for the packaging note; the free-text cap for new edits; the plant standard pack-outs (none published yet).
UPDATE "value_list"
  SET "meta" = "meta" || '{"freeText":true}'::jsonb, "updated_at" = now(), "version" = "version" + 1
  WHERE "list_key" = 'packaging_type' AND "code" = 'OTHER' AND NOT ("meta" ? 'freeText');--> statement-breakpoint
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.key, v.value::jsonb, v.description, true
FROM (VALUES
  ('intake_free_text_max_length', '500',
   'FB-09 (F-019, D-016 default; the tracker recommends A + B, Bailey Schmitt to confirm): the longest packaging note (characters) the intake accepts on a new edit. An older, longer note stays readable and shows a warning. Provisional.'),
  ('plant_packaging_standards', '{}',
   'FB-09 (F-012, D-016 default; A-028 not received): plant code → the standard pack-out configuration Engineering has published for that plant. "Plant specified" packaging is offered only for a plant listed here, and "Pretium / plant preferred" is never offered (Paul Slomkowski). Empty until Engineering sends plant-packaging-standards.csv. Provisional.')
) AS v(key, value, description)
ON CONFLICT ("key") DO NOTHING;
