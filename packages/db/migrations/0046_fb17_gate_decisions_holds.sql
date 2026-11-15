ALTER TABLE "gate_outcome_definition" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "gate_outcome_definition" ADD COLUMN "outcome_group" text;--> statement-breakpoint
ALTER TABLE "gate_outcome_definition" ADD CONSTRAINT "gate_outcome_definition_outcome_group_check" CHECK ("gate_outcome_definition"."outcome_group" in ('advance', 'send_back', 'hold', 'stop', 'customer_outcome'));--> statement-breakpoint
-- ── FB-17 (hand-written): gate decisions and holds ───────────────────────────────────────────────────
-- Walkthrough 2026-11-13 (W13-22 to W13-25, W13-27, the timeline half of W13-26): outcomes can be
-- switched off, "Advance – capital required" is switched off (capital needed follows from the preliminary
-- capital), the decision dialog offers Advance / Send back to… / Hold / Stop, every send-back carries a
-- reason code, and the hold owner defaults to the person working the stage. Tracker rows it follows:
-- F-027, F-029 / F-030, F-058 / D-033, D-001.
--
-- The statements above add gate_outcome_definition.active (boolean, default true) and outcome_group
-- (text, with a CHECK list). Nothing for the Fabric companions (rule 10): no jsonb, no array, no view.
--
-- Config follows the rule of 0026 and 0036: a row the business approved (approved_at set) is never
-- changed, and a value an Admin edited (it no longer equals the previous seed) is left alone. On a fresh
-- database the config tables are empty here: each statement is a no-op and the seed inserts the same
-- values. Every statement is safe to re-run. No outcome key and no transition changes: analytics and the
-- SQL views read them.
--
-- W13-22, W13-25: the two new settings (provisional).
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.key, v.value::jsonb, v.description, true
FROM (VALUES
  ('capital_needed_above_usd', '0',
   'FB-17 (W13-22): capital is needed when the preliminary capital on the engineering review is above this amount (USD). Seed 0: any amount above $0 needs capital, and the engineer enters $0 to say none is needed. When capital is needed a G2 Advance needs the equipment BOM, sets "capital likely" on the quote and starts capital readiness on pending. It replaces the G2 outcome "Advance – capital required", which is switched off. Provisional.'),
  ('hold_owner_default', '"stage_assignee"',
   'FB-17 (W13-25): who the hold-owner picker in the decision dialog starts on. stage_assignee: the person working the stage (the assigned engineer or production scheduler in Engineering, the assigned pricer in Quoting) when there is exactly one, otherwise the decider. decider: always the decider ("Me"), as before FB-17. The picker offers the same people either way, and the owner is told unless they are the decider. Provisional.')
) AS v(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- W13-23: the choice the decision dialog shows each outcome under. A new column, so there is no earlier
-- value to protect: every seeded outcome that has no group yet gets its group, approved or not. G5 is the
-- customer's answer (customer_outcome) and keeps its flat list; its "On hold" is a hold.
UPDATE "gate_outcome_definition" AS o SET "outcome_group" = v.outcome_group, "updated_at" = now()
FROM (VALUES
  ('G1', 'advance', 'advance'),
  ('G1', 'hold', 'hold'),
  ('G1', 'rework', 'send_back'),
  ('G1', 'redirect', 'stop'),
  ('G1', 'stop', 'stop'),
  ('SUBMIT', 'submit', 'advance'),
  ('G2', 'proceed', 'advance'),
  ('G2', 'proceed_with_risk', 'advance'),
  ('G2', 'capital_required', 'advance'),
  ('G2', 'hold', 'hold'),
  ('G2', 'rework', 'send_back'),
  ('G2', 'redirect', 'send_back'),
  ('G2', 'stop', 'stop'),
  ('G3', 'submit', 'advance'),
  ('G3', 'hold', 'hold'),
  ('G3', 'recost', 'send_back'),
  ('G3', 'rework', 'send_back'),
  ('G3', 'rework_kam', 'send_back'),
  ('G3', 'redirect', 'send_back'),
  ('G3', 'stop', 'stop'),
  ('G4', 'approve', 'advance'),
  ('G4', 'hold', 'hold'),
  ('G4', 'return', 'send_back'),
  ('G4', 'decline', 'stop'),
  ('G5', 'awarded', 'customer_outcome'),
  ('G5', 'negotiating', 'customer_outcome'),
  ('G5', 'lost', 'customer_outcome'),
  ('G5', 'expired', 'customer_outcome'),
  ('G5', 'on_hold', 'hold'),
  ('G5', 'requote', 'customer_outcome'),
  ('G6', 'advance', 'advance'),
  ('G6', 'hold', 'hold'),
  ('G6', 'requote', 'send_back'),
  ('G6', 'stop', 'stop')
) AS v(gate_key, key, outcome_group)
WHERE o."gate_key" = v.gate_key AND o."key" = v.key AND o."outcome_group" IS NULL;--> statement-breakpoint
-- W13-22: "Advance – capital required" is switched off (only while unapproved). The row stays: quotes
-- already decided with it keep their label and their capital behaviour.
UPDATE "gate_outcome_definition" SET "active" = false, "updated_at" = now()
WHERE "gate_key" = 'G2' AND "key" = 'capital_required' AND "approved_at" IS NULL AND "active" = true;--> statement-breakpoint
-- W13-23: labels say where the quote goes ("Send back to …"), and G1's "not CCQ work" reads as a Stop.
-- Only while the label is still the previous seed wording and unapproved.
UPDATE "gate_outcome_definition" AS o SET "label" = v.new_label, "updated_at" = now()
FROM (VALUES
  ('G1', 'rework', 'Rework (back to KAM)', 'Send back to the KAM (fix the intake)'),
  ('G1', 'redirect', 'Redirect (not CCQ work)', 'Stop: not CCQ work (send elsewhere)'),
  ('G2', 'rework', 'Rework (back to KAM)', 'Send back to the KAM (fix the intake)'),
  ('G2', 'redirect', 'Redirect (alternative platform / site)', 'Send back to Engineering (try another platform or site)'),
  ('G3', 'recost', 'Rework (re-cost)', 'Send back to Pricing (re-cost)'),
  ('G3', 'rework', 'Rework (back to Engineering)', 'Send back to Engineering'),
  ('G3', 'rework_kam', 'Rework (back to KAM)', 'Send back to the KAM'),
  ('G3', 'redirect', 'Redirect (alternative capital model)', 'Send back to Pricing (another capital model)'),
  ('G4', 'return', 'Rework (back to the affected gate)', 'Send back to Quoting or Engineering'),
  ('G6', 'requote', 'Rework (re-quote)', 'Send back to Quoting or Engineering (re-quote)')
) AS v(gate_key, key, old_label, new_label)
WHERE o."gate_key" = v.gate_key AND o."key" = v.key AND o."approved_at" IS NULL AND o."label" = v.old_label;--> statement-breakpoint
-- W13-23: every send-back needs a reason code. G4 "return" already has the rework context; G2 and G3
-- "redirect" had none (the redirect context holds G1's not-CCQ codes, which are wrong here), so they take
-- the rework codes. Only while each row is untouched and unapproved.
UPDATE "gate_outcome_definition" SET "requires_reason_code" = true, "updated_at" = now()
WHERE "gate_key" = 'G4' AND "key" = 'return' AND "approved_at" IS NULL
  AND "requires_reason_code" = false AND "reason_context" = 'rework';--> statement-breakpoint
UPDATE "gate_outcome_definition" SET "reason_context" = 'rework', "requires_reason_code" = true, "updated_at" = now()
WHERE "gate_key" IN ('G2', 'G3') AND "key" = 'redirect' AND "approved_at" IS NULL
  AND "requires_reason_code" = false AND "reason_context" IS NULL;--> statement-breakpoint
-- W13-24 (every hold says what a hold is for) and W13-22 (G2 Advance names the capital figure). As 0031,
-- 0042 and 0045: only while the text is still the previous seed wording and unapproved.
UPDATE "gate_outcome_definition" AS o SET "help_text" = v.new_help, "updated_at" = now()
FROM (VALUES
  ('G1', 'hold', 'Pause it in Intake (for example, waiting on the customer). The clock stops. Needs a reason, an owner and a review date.', 'Pause the quote, for example when the customer asks to revisit it in 6 months. To get something fixed, use Send back to… instead.'),
  ('G2', 'proceed', 'The solution is feasible: the quote goes to Quoting. Needs the solution fields, capacity evidence and the capacity sign-off.', 'The solution is feasible: the quote goes to Quoting. Needs the solution fields, capacity evidence, the capacity sign-off and the preliminary capital figure (enter $0 when no capital is needed). When capital is needed, upload the equipment BOM first; Pricing then confirms capital readiness.'),
  ('G2', 'hold', 'Pause it at this stage. The clock stops. Needs a reason, an owner and a review date.', 'Pause the quote, for example when the customer asks to revisit it in 6 months. To get something fixed, use Send back to… instead.'),
  ('G3', 'hold', 'Pause it in Quoting (for example, capital pre-approval pending). The clock stops. Needs a reason, an owner and a review date.', 'Pause the quote, for example when the customer asks to revisit it in 6 months. To get something fixed, use Send back to… instead.'),
  ('G4', 'hold', 'Pause the release. The clock stops. Needs a reason, an owner and a review date.', 'Pause the quote, for example when the customer asks to revisit it in 6 months. To get something fixed, use Send back to… instead.'),
  ('G5', 'on_hold', 'The customer put it on hold. The Pretium clock stops. Needs a reason, an owner and a review date.', 'Pause the quote, for example when the customer asks to revisit it in 6 months. To get something fixed, use Send back to… instead.'),
  ('G6', 'hold', 'Commitment pending (for example, the CER is still with the approvers). Needs a reason, an owner and a review date.', 'Pause the quote, for example when the customer asks to revisit it in 6 months. To get something fixed, use Send back to… instead.')
) AS v(gate_key, key, old_help, new_help)
WHERE o."gate_key" = v.gate_key AND o."key" = v.key AND o."approved_at" IS NULL AND o."help_text" = v.old_help;--> statement-breakpoint
-- W13-22: every G2 Advance needs the preliminary capital figure (enter $0 when no capital is needed), and
-- the equipment BOM exactly when capital is needed (server-derived `eng_capital_needed`: the figure is
-- above app_setting capital_needed_above_usd; a blank figure counts as needed). Only the rules as seeded
-- are extended (0040 was the last change); an Admin's own edit is left alone (add the two rules by hand in
-- Admin -> Workflow). Quotes already past G2 are not touched: the rule is read when G2 is decided.
UPDATE "gate_outcome_definition"
SET "required_fields" = "required_fields" || '[{"field":"prelim_capital_usd","op":"present"},{"anyOf":[{"field":"eng_capital_needed","op":"equals","value":false},{"field":"equipment_bom_on_file","op":"equals","value":true}]}]'::jsonb, "updated_at" = now()
WHERE "gate_key" = 'G2' AND "key" IN ('proceed', 'proceed_with_risk') AND "approved_at" IS NULL
  AND "required_fields" = '[{"field":"process_type","op":"present"},{"field":"machine_type","op":"present"},{"field":"plant_code","op":"present"},{"field":"cavitation","op":"present"},{"field":"cycle_time_s","op":"present"},{"field":"capacity_evidence","op":"minItems","value":1},{"field":"capacity_signoff_status","op":"equals","value":"approved"},{"field":"capacity_utilization_missing","op":"equals","value":false}]'::jsonb;
