-- DR-engineering-02 (AI dry-run UAT, Sev-2): an Assumed effectiveness of 0% saved, utilization after could not
-- be calculated, and G2 Advance was still recorded. The API now refuses 0%, and every G2 Advance outcome also
-- is refused while a capacity row has no utilization after (server-derived `capacity_utilization_missing`;
-- "Capital required" still needs no capacity row).
-- Data only: no schema change. Only the rules as seeded are extended (approved_at IS NULL and the value equal to
-- the previous seed); an Admin's own edit is left alone (add the rule by hand in Admin -> Workflow). On a fresh
-- database the table is empty here and the seed inserts the new rule. Quotes already past G2 are not touched.
-- Idempotent and safe to re-run.
UPDATE "gate_outcome_definition"
SET "required_fields" = "required_fields" || '[{"field":"capacity_utilization_missing","op":"equals","value":false}]'::jsonb, "updated_at" = now()
WHERE "gate_key" = 'G2' AND "key" IN ('proceed', 'proceed_with_risk') AND "approved_at" IS NULL
  AND "required_fields" = '[{"op":"present","field":"process_type"},{"op":"present","field":"machine_type"},{"op":"present","field":"plant_code"},{"op":"present","field":"cavitation"},{"op":"present","field":"cycle_time_s"},{"op":"minItems","field":"capacity_evidence","value":1},{"op":"equals","field":"capacity_signoff_status","value":"approved"}]'::jsonb;--> statement-breakpoint
UPDATE "gate_outcome_definition"
SET "required_fields" = "required_fields" || '[{"field":"capacity_utilization_missing","op":"equals","value":false}]'::jsonb, "updated_at" = now()
WHERE "gate_key" = 'G2' AND "key" = 'capital_required' AND "approved_at" IS NULL
  AND "required_fields" = '[{"op":"present","field":"prelim_capital_usd"},{"op":"equals","field":"capacity_signoff_status","value":"approved"},{"op":"equals","field":"equipment_bom_on_file","value":true}]'::jsonb;
