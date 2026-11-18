-- ── FB-21 Part A (hand-written): capital readiness "pending" is the normal state and never blocks ─────
-- Feedback N17-19, N17-20 (Bailey Schmitt, walkthrough and sync of 2026-11-17/18); decided by Ben Whann,
-- 2026-11-18: no CER exists before award, so "pending" needs no reasoning and never stops a quote; "not
-- approved" is a recommendation to stop and refuses G3 Advance. Synthetic data only; nothing here reads or
-- writes customer data beyond the open quotes' own capital readiness.
--
-- As 0031 / 0046: a config row the business approved (approved_at set) or an Admin edited away from the
-- seed is left alone. On a fresh database the config tables are empty here: each config statement is a
-- no-op and the seed inserts the same values.
--
-- 1. The readiness a quote starts on when it enters Quoting with none (provisional).
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, 'capital_readiness_default', '{"whenNeeded":"pending","whenNotNeeded":"not_required"}'::jsonb,
  'FB-21 (N17-19): the capital readiness a quote starts on when it enters Quoting with none. whenNeeded: Engineering says capital is needed (a preliminary capital figure is above capital_needed_above_usd or blank). whenNotNeeded: every figure is entered and none is above it. whenNeeded cannot be not_required. The pricer can change it. Seed: pending / not_required. Provisional.',
  true
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
--
-- 2. G3 Advance: drop "pending needs a justification" and "capital likely needs pre-approved or not
-- required"; add "not approved refuses Advance" (capital_not_approved, derived by the server). Only the
-- rule as seeded (0031) is changed; an Admin's own edit is left alone (change it in Admin -> Workflow).
UPDATE "gate_outcome_definition"
SET "required_fields" = '[{"anyOf":[{"allOf":[{"field":"pricing_record.price_approved_by","op":"present"},{"field":"pricing_record.price_approved_at","op":"present"}]},{"field":"pass_through_eligible","op":"equals","value":true}]},{"field":"pricing_record.costing_completed","op":"equals","value":true},{"field":"pricing_record.capital_readiness","op":"present"},{"field":"capital_not_approved","op":"equals","value":false},{"anyOf":[{"field":"cost_model_on_file","op":"equals","value":true},{"field":"pricing_record.cost_model_requirement","op":"equals","value":"grandfathered"}]},{"anyOf":[{"field":"roi_required","op":"equals","value":false},{"field":"roi_model_on_file","op":"equals","value":true}]}]'::jsonb,
  "updated_at" = now()
WHERE "gate_key" = 'G3' AND "key" = 'submit' AND "approved_at" IS NULL
  AND "required_fields" = '[{"anyOf":[{"allOf":[{"field":"pricing_record.price_approved_by","op":"present"},{"field":"pricing_record.price_approved_at","op":"present"}]},{"field":"pass_through_eligible","op":"equals","value":true}]},{"field":"pricing_record.costing_completed","op":"equals","value":true},{"field":"pricing_record.capital_readiness","op":"present"},{"anyOf":[{"field":"pricing_record.capital_readiness","op":"oneOf","value":["not_required","pre_approved","not_approved"]},{"field":"pricing_record.capital_pending_justification","op":"present"}]},{"anyOf":[{"field":"capital_likely","op":"equals","value":false},{"field":"pricing_record.capital_readiness","op":"oneOf","value":["not_required","pre_approved"]}]},{"anyOf":[{"field":"cost_model_on_file","op":"equals","value":true},{"field":"pricing_record.cost_model_requirement","op":"equals","value":"grandfathered"}]},{"anyOf":[{"field":"roi_required","op":"equals","value":false},{"field":"roi_model_on_file","op":"equals","value":true}]}]'::jsonb;--> statement-breakpoint
--
-- 3. Open quotes already in Quoting (open or on hold) whose current version has no capital readiness
-- start on the same default the app now sets on entry (capitalNeededForReadiness): "whenNeeded" when the
-- latest G2 outcome is the retired "capital_required", the quote has no item, or any item's preliminary
-- capital is blank or above capital_needed_above_usd; else "whenNotNeeded". A readiness someone chose is
-- never touched. Each change gets an audit row by the system (no actor), in the same statement.
WITH cfg AS (
  SELECT
    COALESCE(
      (SELECT "value"->>'whenNeeded' FROM "app_setting" WHERE "key" = 'capital_readiness_default'
         AND "value"->>'whenNeeded' IN ('pending', 'pre_approved', 'not_approved')),
      'pending') AS when_needed,
    COALESCE(
      (SELECT "value"->>'whenNotNeeded' FROM "app_setting" WHERE "key" = 'capital_readiness_default'
         AND "value"->>'whenNotNeeded' IN ('not_required', 'pending', 'pre_approved', 'not_approved')),
      'not_required') AS when_not_needed,
    COALESCE(
      (SELECT ("value"#>>'{}')::numeric FROM "app_setting" WHERE "key" = 'capital_needed_above_usd'
         AND jsonb_typeof("value") = 'number'),
      0) AS above_usd
),
targets AS (
  SELECT pr."id", pr."quote_id", pr."quote_version",
    (
      (SELECT gd."outcome_key" FROM "gate_decision" gd
        WHERE gd."quote_id" = q."id" AND gd."gate_key" = 'G2'
        ORDER BY gd."decided_at" DESC, gd."created_at" DESC, gd."id" DESC LIMIT 1) = 'capital_required'
      OR NOT EXISTS (SELECT 1 FROM "quote_item" qi WHERE qi."quote_id" = q."id")
      OR EXISTS (
        SELECT 1 FROM "quote_item" qi
        LEFT JOIN "eng_review" er ON er."quote_item_id" = qi."id"
        WHERE qi."quote_id" = q."id"
          AND (er."prelim_capital_usd" IS NULL OR er."prelim_capital_usd" > cfg.above_usd))
    ) IS TRUE AS needed
  FROM "pricing_record" pr
  JOIN "quote" q ON q."id" = pr."quote_id" AND q."version" = pr."quote_version"
  CROSS JOIN cfg
  WHERE q."stage_key" = 'QUOTING' AND q."status" <> 'closed' AND pr."capital_readiness" IS NULL
),
updated AS (
  UPDATE "pricing_record" pr
  SET "capital_readiness" = CASE WHEN t.needed THEN cfg.when_needed ELSE cfg.when_not_needed END,
    "updated_at" = now()
  FROM targets t CROSS JOIN cfg
  WHERE pr."id" = t."id"
  RETURNING pr."id", pr."quote_id", pr."quote_version", pr."capital_readiness", t.needed
)
INSERT INTO "audit_event" (
  "id", "at", "actor_id", "action", "entity", "entity_id", "quote_id", "before", "after",
  "change_reason")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, now(), NULL, 'update', 'pricing_record', u."id"::text, u."quote_id",
  '{"capitalReadiness":null}'::jsonb,
  jsonb_build_object(
    'capitalReadiness', u."capital_readiness",
    'source', 'migration:0049_fb21_capital_readiness',
    'capitalNeeded', u.needed,
    'quoteVersion', u."quote_version"),
  'FB-21 (N17-19): an open quote in Quoting with no capital readiness starts on capital_readiness_default'
FROM updated u;
