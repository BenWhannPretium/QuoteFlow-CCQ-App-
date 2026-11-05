ALTER TABLE "value_list" DROP CONSTRAINT "value_list_list_key_check";--> statement-breakpoint
ALTER TABLE "customer" DROP CONSTRAINT "customer_sf_account_matches_status_check";--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "quote_needed_by" date;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "product_needed_by" date;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "neck_diameter" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "neck_diameter_custom" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "neck_finish_type" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "neck_finish_type_custom" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "neck_special_feature" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "neck_special_feature_custom" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "resin_customer_specified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "resin_grade" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "pcr_level" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "color_type" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "color_description" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "additives" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "liner_spec" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "labels_purchased_by" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "decoration_type" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "decoration_print_colors" integer;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "quote_variants_note" text;--> statement-breakpoint
ALTER TABLE "value_list" ADD CONSTRAINT "value_list_list_key_check" CHECK ("value_list"."list_key" in ('product_family', 'market', 'resin', 'component', 'process_type', 'machine_type', 'plant', 'request_class', 'drawing_status', 'neck_finish', 'packaging_type', 'tooling_funding_model', 'neck_diameter', 'neck_finish_type', 'neck_special_feature', 'pcr_level', 'color_type', 'labels_purchased_by', 'decoration_type'));--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_existing_has_sf_account_check" CHECK ("customer"."status" <> 'existing' or "customer"."sf_account_id" is not null);--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_decoration_print_colors_check" CHECK ("quote"."decoration_print_colors" is null or "quote"."decoration_print_colors" between 1 and 12);--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_need_by_order_check" CHECK ("quote"."product_needed_by" is null or "quote"."quote_needed_by" is null or "quote"."product_needed_by" >= "quote"."quote_needed_by");--> statement-breakpoint
-- ── FB-02 data migration (hand-written) ─────────────────────────────────────────────────────────────
-- Config in existing environments. Rules and keys are added only when missing, so admin edits are
-- kept. The seeds carry the same values for new databases. Every value stays provisional.
--
-- F-017 / F-009: the intake blocks without the ship / fill destination city and state and the two
-- need-by dates. The old "street or city" alternative is dropped.
-- fb02-config:start
UPDATE "app_setting" SET "value" = (
  SELECT coalesce(jsonb_agg(t.e ORDER BY t.i), '[]'::jsonb)
  FROM jsonb_array_elements("app_setting"."value") WITH ORDINALITY AS t(e, i)
  WHERE t.e <> '{"anyOf":[{"field":"ship_to.line1","op":"present"},{"field":"ship_to.city","op":"present"}]}'::jsonb
), "updated_at" = now()
WHERE "key" = 'intake_required_fields' AND jsonb_typeof("value") = 'array';
--> statement-breakpoint
UPDATE "app_setting" SET "value" = "value" || coalesce((
  SELECT jsonb_agg(v.rule ORDER BY v.n)
  FROM (VALUES
    (1, '{"field":"ship_to.city","op":"present"}'::jsonb),
    (2, '{"field":"ship_to.state","op":"present"}'::jsonb),
    (3, '{"field":"quote_needed_by","op":"present"}'::jsonb),
    (4, '{"field":"product_needed_by","op":"present"}'::jsonb)
  ) AS v(n, rule)
  WHERE NOT "app_setting"."value" @> jsonb_build_array(v.rule)
), '[]'::jsonb), "updated_at" = now()
WHERE "key" = 'intake_required_fields' AND jsonb_typeof("value") = 'array';
--> statement-breakpoint
-- F-009: INTAKE_COMPLETE (G1 Advance, and Submit when G1 is off) needs the two need-by dates.
UPDATE "gate_outcome_definition" SET "required_fields" = "required_fields" || coalesce((
  SELECT jsonb_agg(v.rule ORDER BY v.n)
  FROM (VALUES
    (1, '{"field":"quote_needed_by","op":"present"}'::jsonb),
    (2, '{"field":"product_needed_by","op":"present"}'::jsonb)
  ) AS v(n, rule)
  WHERE NOT "gate_outcome_definition"."required_fields" @> jsonb_build_array(v.rule)
), '[]'::jsonb), "updated_at" = now()
WHERE ("gate_key", "key") IN (('G1', 'advance'), ('SUBMIT', 'submit'))
  AND jsonb_typeof("required_fields") = 'array';
--> statement-breakpoint
-- "Why we ask" help for the new and changed intake fields (an admin's own text is kept).
UPDATE "app_setting" SET "value" = jsonb_build_object(
  'quote_needed_by', 'When the customer needs the quote. It sets the timing part of the priority score, so be realistic.',
  'product_needed_by', 'Your best estimate of when the customer needs product (launch). On or after Quote needed by.'
) || "value", "updated_at" = now()
WHERE "key" = 'intake_field_help' AND jsonb_typeof("value") = 'object';
--> statement-breakpoint
UPDATE "app_setting" SET "value" = "value" || jsonb_build_object(
  'customer', 'The customer is the Salesforce Account on the opportunity. Tick "Not yet a Pretium customer" when it has no ERP account yet.'
), "updated_at" = now()
WHERE "key" = 'intake_field_help'
  AND "value"->>'customer' = 'Engineering and Pricing size the work differently for a new versus an established customer.';
--> statement-breakpoint
UPDATE "app_setting" SET "value" = "value" || jsonb_build_object(
  'ship_to', 'Where the product ships or is filled (city and state). Engineering uses it to choose the plant and freight.'
), "updated_at" = now()
WHERE "key" = 'intake_field_help'
  AND "value"->>'ship_to' = 'Freight and the plant that can fill the order both depend on where the product ships.';
--> statement-breakpoint
-- F-009: scoring timing reads "Quote needed by". A new model version (weights and bands unchanged,
-- D-004 open) copied from the model in effect, with its timing input switched. Earlier versions and
-- the scores stamped with them are untouched. Skipped on an empty database (the seed inserts v1 and v2).
INSERT INTO "scoring_model" (
  "id", "created_at", "updated_at", "provisional", "model_version", "attributes", "tier_thresholds",
  "effective_from", "change_reason"
)
SELECT
  encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM now()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid,
  now(),
  now(),
  true,
  (SELECT max("model_version") + 1 FROM "scoring_model"),
  (
    SELECT jsonb_agg(
      CASE WHEN a.e->>'key' = 'timing'
        THEN a.e || '{"label":"Timing (days to quote needed by)","input":"days_to_quote_needed","unknownExplanation":"Quote needed by date not given"}'::jsonb
        ELSE a.e END
      ORDER BY a.i)
    FROM jsonb_array_elements(m."attributes") WITH ORDINALITY AS a(e, i)
  ),
  m."tier_thresholds",
  now(),
  'FB-02 (F-009): timing reads the KAM''s Quote needed by date instead of the Salesforce close date. Weights and bands unchanged (D-004 open).'
FROM "scoring_model" m
WHERE m."effective_from" IS NOT NULL AND m."effective_from" <= now()
  AND m."model_version" = (
    SELECT max("model_version") FROM "scoring_model"
    WHERE "effective_from" IS NOT NULL AND "effective_from" <= now()
  )
  AND m."attributes" @> '[{"key":"timing","input":"days_to_close"}]'::jsonb;
-- fb02-config:end
--> statement-breakpoint
-- F-010: the neck is three pick-lists. Existing values move over by the rule in
-- packages/domain/src/intake/product-facts.ts `migrateLegacyNeckFinish` (the integration test runs the
-- block between the neck-migration markers against it): 28-410, 38-400, 89-400 and 110-400 split into
-- diameter + finish; 120 DC → 120 + Custom "DC"; any other text (the old "Other") → finish Custom with
-- the text kept. neck_finish itself is left as it was (deprecated, kept for history).
-- neck-migration:start
UPDATE "quote" SET
  "neck_diameter" = CASE
    WHEN btrim("neck_finish") IN ('28-410', '38-400', '89-400', '110-400') THEN split_part(btrim("neck_finish"), '-', 1)
    WHEN btrim("neck_finish") IN ('120-DC', '120 DC') THEN '120'
  END,
  "neck_finish_type" = CASE
    WHEN btrim("neck_finish") IN ('28-410', '38-400', '89-400', '110-400') THEN split_part(btrim("neck_finish"), '-', 2)
    ELSE 'CUSTOM'
  END,
  "neck_finish_type_custom" = CASE
    WHEN btrim("neck_finish") IN ('28-410', '38-400', '89-400', '110-400') THEN NULL
    WHEN btrim("neck_finish") IN ('120-DC', '120 DC') THEN 'DC'
    ELSE left(btrim("neck_finish"), 120)
  END
WHERE nullif(btrim("neck_finish"), '') IS NOT NULL
  AND "neck_diameter" IS NULL AND "neck_finish_type" IS NULL;
--> statement-breakpoint
-- Open drafts (a submitted draft is history and stays as it was): neckFinish / neckFinishOther → the
-- three-list keys by the same rule.
UPDATE "quote_draft" AS d SET "data" = (d."data" - 'neckFinish' - 'neckFinishOther') || jsonb_strip_nulls(
  jsonb_build_object(
    'neckDiameter', CASE
      WHEN s.v IN ('28-410', '38-400', '89-400', '110-400') THEN split_part(s.v, '-', 1)
      WHEN s.v IN ('120-DC', '120 DC') THEN '120'
    END,
    'neckFinishType', CASE
      WHEN s.v IN ('28-410', '38-400', '89-400', '110-400') THEN split_part(s.v, '-', 2)
      WHEN s.v IS NOT NULL THEN 'CUSTOM'
    END,
    'neckFinishTypeCustom', CASE
      WHEN s.v IN ('28-410', '38-400', '89-400', '110-400') THEN NULL
      WHEN s.v IN ('120-DC', '120 DC') THEN 'DC'
      ELSE left(s.v, 120)
    END
  ))
FROM (
  SELECT "id", nullif(btrim(CASE WHEN "data"->>'neckFinish' = 'OTHER' THEN "data"->>'neckFinishOther' ELSE "data"->>'neckFinish' END), '') AS v
  FROM "quote_draft"
) AS s
WHERE d."id" = s."id" AND d."submitted_quote_id" IS NULL
  AND (d."data" ? 'neckFinish' OR d."data" ? 'neckFinishOther')
  AND NOT (d."data" ? 'neckDiameter' OR d."data" ? 'neckFinishType');
-- neck-migration:end
--> statement-breakpoint
-- The old single list is retired: kept (older quotes still show their label), not pickable.
UPDATE "value_list" SET "active" = false, "updated_at" = now() WHERE "list_key" = 'neck_finish' AND "active";
--> statement-breakpoint
-- "Why we ask" help for the FB-02 product facts (an admin's own text is kept).
UPDATE "app_setting" SET "value" = jsonb_build_object(
  'neck_diameter', 'Neck diameter in mm. Pick Custom and describe it if it is not on the list. Engineering most often has to chase the neck.',
  'neck_finish_type', 'The finish (thread or closure style). Pick Custom and describe it if needed.',
  'neck_special_feature', 'Optional: continuous thread, multi lead, tamper evident, vented.',
  'resin_customer_specified', 'Pricing needs the exact material when the customer dictates it, not just "polypropylene".',
  'pcr_level', 'Post-consumer recycled content, from the standard levels.',
  'color_type', 'Color and additives drive material cost. Describe a custom color.',
  'additives', 'Anything added to the resin (UV, slip, antistatic…). Optional.',
  'quote_variants_note', 'Variants the customer wants priced, e.g. "0/25/50% PCR; near-site vs ideal-site". Optional.'
) || "value", "updated_at" = now()
WHERE "key" = 'intake_field_help' AND jsonb_typeof("value") = 'object';
--> statement-breakpoint
-- F-013: the component list says which follow-ups a picked component asks for (an admin's own
-- followUps are kept). Decoration itself is a new value: the config seed adds it (provisional).
UPDATE "value_list" SET "meta" = "meta" || jsonb_build_object('followUps', v.follow_ups), "updated_at" = now()
FROM (VALUES
  ('LINER', '["liner_spec"]'::jsonb),
  ('LABEL', '["labels_purchased_by"]'::jsonb),
  ('DECORATION', '["decoration_type","decoration_print_colors"]'::jsonb)
) AS v(code, follow_ups)
WHERE "value_list"."list_key" = 'component' AND "value_list"."code" = v.code
  AND NOT ("value_list"."meta" ? 'followUps');
