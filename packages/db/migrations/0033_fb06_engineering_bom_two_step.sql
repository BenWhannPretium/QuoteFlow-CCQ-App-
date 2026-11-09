ALTER TABLE "attachment" DROP CONSTRAINT "attachment_kind_check";--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_version_check";--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "two_step" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "preform_plant_code" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "blow_plant_code" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "preform_number" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "two_step_freight_note" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "units_per_bag" integer;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "units_per_tray" integer;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "units_per_case" integer;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "units_per_pallet" integer;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_kind_check" CHECK ("attachment"."kind" in ('bottle_drawing', 'spec', 'sample_photo', 'capacity_analysis', 'other', 'bid_file', 'project_brief', 'competitor_drawing', 'cost_model', 'roi_model', 'price_table', 'equipment_bom'));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_version_check" CHECK (("attachment"."version" is null) = ("attachment"."kind" not in ('cost_model', 'roi_model', 'price_table', 'equipment_bom')) and ("attachment"."version" is null or "attachment"."version" >= 1));--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_pack_out_check" CHECK (("eng_review"."units_per_bag" is null or "eng_review"."units_per_bag" between 1 and 9999999) and ("eng_review"."units_per_tray" is null or "eng_review"."units_per_tray" between 1 and 9999999) and ("eng_review"."units_per_case" is null or "eng_review"."units_per_case" between 1 and 9999999) and ("eng_review"."units_per_pallet" is null or "eng_review"."units_per_pallet" between 1 and 9999999));--> statement-breakpoint
-- ── FB-06 (hand-written): engineering roles, equipment BOM, two-step, pack-out ───────────────────────
-- Tracker: F-058, F-062, F-024, F-025; decisions D-033, D-008 (open), D-007 (open), A-006, A-014 (open).
--
-- The config seed refreshes only untouched rows (version = 1) at start-up, so the statements below carry
-- the change to every environment. A row the business approved (approved_at set) is never changed, and a
-- value an admin edited (it no longer equals the seed) is left alone. On a fresh database the config
-- tables are empty here: each statement is a no-op and the seed inserts the same values.
--
-- F-058 (D-033): G2 "Advance – capital required" also needs the equipment BOM on file. Only the rule as
-- seeded is extended; an admin's own edit of it is left alone (add the rule by hand in Admin -> Workflow).
-- Quotes already past G2 are not touched (the rule is read when G2 is decided); a quote still in
-- Engineering Review needs the BOM uploaded before "Capital required".
UPDATE "gate_outcome_definition"
SET "required_fields" = "required_fields" || '[{"field":"equipment_bom_on_file","op":"equals","value":true}]'::jsonb, "updated_at" = now()
WHERE "gate_key" = 'G2' AND "key" = 'capital_required' AND "approved_at" IS NULL
  AND "required_fields" = '[{"field":"prelim_capital_usd","op":"present"},{"field":"capacity_signoff_status","op":"equals","value":"approved"}]'::jsonb;--> statement-breakpoint
UPDATE "gate_outcome_definition"
SET "help_text" = replace("help_text", 'includes contingency); Pricing then', 'includes contingency) and upload the equipment BOM; Pricing then'), "updated_at" = now()
WHERE "gate_key" = 'G2' AND "key" = 'capital_required' AND "approved_at" IS NULL
  AND "help_text" LIKE '%includes contingency); Pricing then%';--> statement-breakpoint
-- F-062 (D-008 open, A-006): routing suggestions for the assign dialog, from Paul Slomkowski's Nov 4
-- email ("Engineering Resources"). Engineers are matched by surname against the directory at read time,
-- so a first-name spelling difference ("Rany" / "Randy") does not matter and a name with no user suggests
-- nobody. Provisional; the lead still assigns.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, 'engineering_assignment_rules',
  '{"rules":[{"processTypes":["ISBM","RHB","IMM"],"resins":[],"engineerName":"Neiberger","engineerUserId":null,"note":"Paul Slomkowski, Nov 4: ISBM, RHB and injection (IMM) go to the PET engineer."},{"processTypes":["EBM","IBM"],"resins":[],"engineerName":"Pasillas","engineerUserId":null,"note":"Paul Slomkowski, Nov 4: EBM and IBM go to the polyolefin engineer."},{"processTypes":[],"resins":["PET","PCR_PET","PETG"],"engineerName":"Neiberger","engineerUserId":null,"note":"Fallback while the process type is not chosen: PET resins go to the PET engineer."},{"processTypes":[],"resins":["HDPE","PCR_HDPE","PP","LDPE"],"engineerName":"Pasillas","engineerUserId":null,"note":"Fallback while the process type is not chosen: polyolefin resins go to the polyolefin engineer."}]}'::jsonb,
  'FB-06 (F-062, D-008 open): routing suggestions for the engineering assignment. A rule lists process types and / or resins (value-list codes; an empty list means any) and the engineer by surname or full name; the first matching rule wins and the assign dialog shows "Suggested: <name>". It never assigns: the lead still does. Seeded from the Nov 4 email from Paul Slomkowski (ISBM, RHB, IMM → Neiberger; EBM, IBM → Pasillas); the resin rules are a fallback while the process type is not yet chosen. Provisional until D-008 is decided.',
  true
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;
