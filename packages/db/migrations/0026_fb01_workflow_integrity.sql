ALTER TABLE "gate_outcome_definition" ADD COLUMN "resume_at" text DEFAULT 'intake' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "rework_origin_stage_key" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "rework_resume_at" text;--> statement-breakpoint
ALTER TABLE "gate_outcome_definition" ADD CONSTRAINT "gate_outcome_definition_resume_at_check" CHECK ("gate_outcome_definition"."resume_at" in ('origin', 'intake'));--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_rework_resume_at_check" CHECK ("quote"."rework_resume_at" is null or "quote"."rework_resume_at" in ('origin', 'intake'));;--> statement-breakpoint
-- ── FB-01 data: the workflow config and settings of existing environments ──────────────────────────
-- The config seed only refreshes rows that are still untouched (version = 1), so these statements carry
-- the change to every environment. A row the business has approved (approved_at set) is never changed.
-- On a fresh database the config tables are empty here: each statement is a no-op and the seed (run
-- right after the migrations) inserts the same values.
--
-- F-029: G3 "Rework (back to KAM)": reason from the rework context, note required, version bump, and
-- (F-030) the KAM's resubmission resumes at its origin (Quoting) unless the scope changed.
INSERT INTO "gate_outcome_definition" (
  "id", "gate_key", "key", "label", "help_text", "requires_note", "requires_reason_code",
  "reason_context", "required_fields", "notify", "sort", "resume_at", "provisional"
)
SELECT
  encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM now()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid,
  'G3', 'rework_kam', 'Rework (back to KAM)',
  'Back to the KAM to fix the commercial input (say exactly what is wrong or missing). When the KAM resubmits without a scope change, it comes straight back to Quoting with the same pricer; a scope change sends it through qualification and Engineering again.',
  true, true, 'rework', '[]'::jsonb,
  '[{"type":"quote.reworked","to":{"stageOwner":true}}]'::jsonb,
  coalesce((SELECT "sort" FROM "gate_outcome_definition" WHERE "gate_key" = 'G3' AND "key" = 'rework'), 0) + 5,
  'origin', true
WHERE EXISTS (SELECT 1 FROM "gate_definition" WHERE "key" = 'G3')
ON CONFLICT ("gate_key", "key") DO NOTHING;--> statement-breakpoint
INSERT INTO "transition_rule" (
  "id", "gate_key", "outcome_key", "target_stage_keys", "next_status", "version_bump", "closure_owner",
  "provisional"
)
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM now()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, 'G3', 'rework_kam', ARRAY['INTAKE'], 'active', true, 'decider', true
WHERE EXISTS (SELECT 1 FROM "gate_outcome_definition" WHERE "gate_key" = 'G3' AND "key" = 'rework_kam')
  AND EXISTS (SELECT 1 FROM "stage_definition" WHERE "key" = 'INTAKE')
ON CONFLICT ("gate_key", "outcome_key") DO NOTHING;--> statement-breakpoint
-- F-027 (D-015): a note on every exception decision (Advance with risk, Capital required, Hold, Rework,
-- Re-quote, Redirect, Stop). The others in that list already required one.
UPDATE "gate_outcome_definition" SET "requires_note" = true, "updated_at" = now()
WHERE "approved_at" IS NULL AND NOT "requires_note"
  AND ("gate_key", "key") IN (('G1', 'hold'), ('G1', 'redirect'), ('G2', 'capital_required'), ('G2', 'hold'), ('G3', 'hold'), ('G3', 'rework'), ('G4', 'hold'), ('G5', 'on_hold'), ('G5', 'requote'), ('G6', 'hold'), ('G6', 'requote'));--> statement-breakpoint
-- F-069: the terms check and the Legal review block G4 Advance only when g4_required_checks names them.
-- Only the B-26 rule as seeded is replaced; an admin's own edit of it is left alone.
UPDATE "gate_outcome_definition"
SET "required_fields" = '[{"anyOf":[{"field":"g4_terms_check_required","op":"equals","value":false},{"field":"terms_checked_at","op":"present"}]},{"anyOf":[{"field":"legal_review_required","op":"equals","value":false},{"field":"g4_legal_review_check_required","op":"equals","value":false},{"field":"legal_reviewed_on","op":"present"}]}]'::jsonb, "updated_at" = now()
WHERE "gate_key" = 'G4' AND "key" = 'approve' AND "approved_at" IS NULL
  AND "required_fields" = '[{"field":"terms_checked_at","op":"present"},{"anyOf":[{"field":"legal_review_required","op":"equals","value":false},{"field":"legal_reviewed_on","op":"present"}]}]'::jsonb;--> statement-breakpoint
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM now()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, 'g4_required_checks', '[]'::jsonb,
  'FB-01 (F-069, D-003 open): which checks block G4 Advance (release the offer): terms_checked (the KAM / Sales / Pricing terms check) and legal_review (the Legal review, when a legal_review_triggers trigger applies). [] = neither blocks; the Final Review screen shows them to the approver as warnings and the G4 decision records that the approver saw them.',
  true
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;
