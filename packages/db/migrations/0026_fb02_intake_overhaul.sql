ALTER TABLE "customer" DROP CONSTRAINT "customer_sf_account_matches_status_check";--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "quote_needed_by" date;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "product_needed_by" date;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_existing_has_sf_account_check" CHECK ("customer"."status" <> 'existing' or "customer"."sf_account_id" is not null);--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_need_by_order_check" CHECK ("quote"."product_needed_by" is null or "quote"."quote_needed_by" is null or "quote"."product_needed_by" >= "quote"."quote_needed_by");--> statement-breakpoint
-- ── FB-02 data migration (hand-written) ─────────────────────────────────────────────────────────────
-- Config in existing environments. Rules and keys are added only when missing, so admin edits are
-- kept. The seeds carry the same values for new databases. Every value stays provisional.
--
-- F-017 / F-009: the intake blocks without the ship / fill destination city and state and the two
-- need-by dates. The old "street or city" alternative is dropped.
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
