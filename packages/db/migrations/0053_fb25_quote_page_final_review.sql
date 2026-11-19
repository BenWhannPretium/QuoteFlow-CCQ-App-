-- ── FB-25 (hand-written): Final Review requires the customer tooling commitment; standard terms are never non-standard ─
-- Feedback N17-26 and the Final Review half of N18-02 (Bailey Schmitt, walkthrough of 2026-11-17): the
-- customer tooling commitment is optional for the KAM at intake and required at Final Review. N17-28
-- (Ben Whann, Bailey Schmitt): at a standard payment term (Net 15, Net 30) the "Non-standard terms" box is
-- hidden and the server keeps it false, so a standard code never triggers the non-standard Legal review.
-- Synthetic data only; nothing here reads or writes customer data beyond the open quotes' own flag.
--
-- As 0038 / 0049: a config row the business approved (approved_at set) or an Admin edited (version
-- bumped, or a value away from the seed) is left alone. On a fresh database the config tables are empty
-- here: each config statement is a no-op and the seed inserts the same values.
--
-- 1. g4_required_checks gains tooling_commitment_answered (provisional), only where unedited and unapproved.
UPDATE "app_setting"
SET "value" = (
    SELECT coalesce(jsonb_agg(DISTINCT c ORDER BY c), '[]'::jsonb)
    FROM jsonb_array_elements_text("value" || '["tooling_commitment_answered"]'::jsonb) AS c
  ),
  "description" = 'FB-01 (F-069) and FB-08 (D-003 provisional): which checks block G4 Advance (release the offer). terms_checked: the Sales / Pricing terms check. legal_review: the Legal review, when a legal_review_triggers trigger applies. terms_exception: non-standard payment terms need the pricing lead to approve the exception (a pending or rejected one blocks). terms_finalized: the approver confirmed the capital terms. tooling_commitment_answered (FB-25, N17-26): the customer tooling commitment is answered yes or no (the KAM may answer it at intake). A check not listed shows to the approver as a warning, and the G4 decision records that they saw it. Seed: terms_exception, terms_finalized and tooling_commitment_answered.',
  "provisional" = true, "updated_at" = now()
WHERE "key" = 'g4_required_checks' AND "approved_at" IS NULL AND "version" = 1
  AND jsonb_typeof("value") = 'array';--> statement-breakpoint
--
-- 2. The G4 Advance rule reads the new check. Only the rule as FB-08 (0038) seeded it is extended.
UPDATE "gate_outcome_definition"
SET "required_fields" = "required_fields" || '[{"anyOf":[{"field":"g4_tooling_commitment_check_required","op":"equals","value":false},{"field":"terms_tooling_commitment","op":"present"}]}]'::jsonb,
  "updated_at" = now()
WHERE "gate_key" = 'G4' AND "key" = 'approve' AND "approved_at" IS NULL
  AND "required_fields" = '[{"anyOf":[{"field":"g4_terms_check_required","op":"equals","value":false},{"field":"terms_checked_at","op":"present"}]},{"anyOf":[{"field":"legal_review_required","op":"equals","value":false},{"field":"g4_legal_review_check_required","op":"equals","value":false},{"field":"legal_reviewed_on","op":"present"}]},{"anyOf":[{"field":"g4_terms_exception_check_required","op":"equals","value":false},{"field":"terms_exception_open","op":"equals","value":false}]},{"anyOf":[{"field":"g4_terms_finalized_check_required","op":"equals","value":false},{"field":"terms_finalized_at","op":"present"}]}]'::jsonb;--> statement-breakpoint
--
-- 3. Open quotes whose payment terms are a standard code (app_setting standard_payment_terms) but whose
-- "Non-standard terms" box was ticked by hand: the box is cleared, so the non-standard Legal trigger no
-- longer applies. The terms check and the agreed terms are not touched. Each change gets an audit row by
-- the system (no actor), in the same statement.
WITH standard AS (
  SELECT jsonb_array_elements_text("value") AS code
  FROM "app_setting"
  WHERE "key" = 'standard_payment_terms' AND jsonb_typeof("value") = 'array'
),
updated AS (
  UPDATE "quote" q
  SET "terms_nonstandard" = false, "updated_at" = now()
  WHERE q."status" <> 'closed' AND q."terms_nonstandard" = true
    AND q."terms_payment_terms_code" IN (SELECT code FROM standard)
  RETURNING q."id", q."terms_payment_terms_code", q."version"
)
INSERT INTO "audit_event" (
  "id", "at", "actor_id", "action", "entity", "entity_id", "quote_id", "before", "after",
  "change_reason")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, now(), NULL, 'update', 'quote', u."id"::text, u."id",
  '{"termsNonstandard":true}'::jsonb,
  jsonb_build_object(
    'termsNonstandard', false,
    'termsPaymentTermsCode', u."terms_payment_terms_code",
    'source', 'migration:0053_fb25_quote_page_final_review',
    'quoteVersion', u."version"),
  'FB-25 (N17-28): standard payment terms are never non-standard; the box ticked by hand is cleared'
FROM updated u;
