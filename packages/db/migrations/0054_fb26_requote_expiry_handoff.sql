ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_kind_check";--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_version_check";--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "requoted_from_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_draft" ADD COLUMN "requote_of_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_requoted_from_quote_id_quote_id_fk" FOREIGN KEY ("requoted_from_quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_draft" ADD CONSTRAINT "quote_draft_requote_of_quote_id_quote_id_fk" FOREIGN KEY ("requote_of_quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_requoted_from_quote_id_uidx" ON "quote" USING btree ("requoted_from_quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_draft_one_open_requote_uidx" ON "quote_draft" USING btree ("requote_of_quote_id") WHERE "quote_draft"."requote_of_quote_id" is not null and "quote_draft"."submitted_quote_id" is null;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'payback.request', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'quote.requote', 'outcome.assignOwner', 'handoff.edit', 'offer.read', 'offer.generate', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'capitalFlag.edit', 'capacity.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'payback.request', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'quote.requote', 'outcome.assignOwner', 'handoff.edit', 'offer.read', 'offer.generate', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'capitalFlag.edit', 'capacity.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_kind_check" CHECK ("attachment"."kind" in ('bottle_drawing', 'spec', 'sample_photo', 'capacity_analysis', 'other', 'bid_file', 'project_brief', 'competitor_drawing', 'cost_model', 'roi_model', 'price_table', 'equipment_bom', 'offer_letter', 'cer_proof'));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_version_check" CHECK (("attachment"."version" is null) = ("attachment"."kind" not in ('cost_model', 'roi_model', 'price_table', 'equipment_bom', 'cer_proof')) and ("attachment"."version" is null or "attachment"."version" >= 1));--> statement-breakpoint
ALTER TABLE "quote_draft" ADD CONSTRAINT "quote_draft_rework_or_requote_check" CHECK ("quote_draft"."rework_of_quote_id" is null or "quote_draft"."requote_of_quote_id" is null);
--> statement-breakpoint
-- FB-26 (N17-30 to N17-32): data. Config follows 0044 / 0049 / 0051: a row the business approved
-- (approved_at set) or an Admin edited (it no longer holds the previous seed) is left alone. On a fresh
-- database the config tables are empty here: each statement is a no-op and the seed inserts the same
-- values. Every statement is safe to re-run. No schema object is dropped; nothing is truncated.
--
-- 1. quote.requote (KAM own, SalesLeader): the matrix rows (policy/matrix.ts is the control). Provisional.
INSERT INTO "role_permission" ("id", "role", "permission", "qualifier", "provisional")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.role, v.permission, v.qualifier::jsonb, true
FROM (VALUES
  ('KAM', 'quote.requote', '{"kind":"own"}'),
  ('SalesLeader', 'quote.requote', NULL)
) AS v(role, permission, qualifier)
WHERE EXISTS (SELECT 1 FROM "role_permission")
ON CONFLICT ("role", "permission") DO NOTHING;--> statement-breakpoint
--
-- 2. Settings (provisional). ON CONFLICT: an existing row is left alone.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, s.key, s.value::jsonb, s.description, true
FROM (VALUES
  ('linked_requote_allowed_from', '["closed_expired","open_lapsed"]',
   'FB-26 (N17-30, Bailey Schmitt, Ben Whann): where a linked re-quote (a new quote linked to the old one, pre-filled from its intake, reviewed again by Engineering, Pricing and Final Review) may start. closed_expired: a quote closed as "No response / Expired". open_lapsed: a quote still open at Customer Decision whose validity date has passed (the same action first records G5 "No response / Expired"). Empty: switched off. The KAM (own quotes) or a SalesLeader starts it (quote.requote). Provisional; whether a Lost quote may also be re-quoted waits on Bailey.'),
  ('validity_notice_recipients', '["kam","g1_decider"]',
   'FB-26 (N17-31, Bailey Schmitt): who the daily job tells that a proposal validity is running out (validity_warning_days) or has passed. kam: the quote''s KAM. g1_decider: the sales leader who qualified it (the latest G1 Advance, by a person; no one when G1 was skipped). Provisional: which sales leader when several exist waits on Bailey.'),
  ('cer_tool_url', '""',
   'FB-26 (N17-32): the CER tool (Apex) link on the hand-off card ("Open the CER tool"). Empty or an https URL. Empty: Admins see "Set the CER links in Admin → Settings", others see nothing. Waits on Oleg Yarovinski.'),
  ('cer_template_url', '""',
   'FB-26 (N17-32): the CER template link on the hand-off card ("CER template"). Empty or an https URL. Waits on Oleg Yarovinski.'),
  ('handoff_cer_proof_required', 'false',
   'FB-26 (N17-32, Bailey Schmitt): when true, a CER marked Approved needs a CER proof file (a screenshot or PDF of the CER tool, uploaded on the hand-off card) before Commit & Hand Off can advance (G6). The CER ID stays required for Approved either way. Seeded false (proof optional). Provisional.')
) AS s(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- The hand-off card's file types: added where the setting still holds 0051's seed. An Admin-edited value
-- without a handoff list reads the seed list for it (parseAttachmentKindsByPlace).
UPDATE "app_setting"
  SET "value" = "value" || '{"handoff":["cer_proof"]}'::jsonb, "updated_at" = now()
  WHERE "key" = 'attachment_kinds_by_place' AND "approved_at" IS NULL
    AND "value" = '{"intake":["bottle_drawing","sample_photo","bid_file","project_brief","competitor_drawing","other"],"quote":["bottle_drawing","sample_photo","bid_file","project_brief","competitor_drawing","other"]}'::jsonb;--> statement-breakpoint
--
-- 3. Workflow config. G6 Advance also reads cer_proof_ok (always true while handoff_cer_proof_required is
-- false, the seed). The G5 Re-quote help points to the linked re-quote once the offer has expired.
UPDATE "gate_outcome_definition"
SET "required_fields" = '[{"field":"handoff_record.cer_status","op":"oneOf","value":["approved","not_required"]},{"field":"handoff_record.completed_at","op":"present"},{"field":"cer_proof_ok","op":"equals","value":true}]'::jsonb, "updated_at" = now()
WHERE "gate_key" = 'G6' AND "key" = 'advance' AND "approved_at" IS NULL
  AND "required_fields" = '[{"field":"handoff_record.cer_status","op":"oneOf","value":["approved","not_required"]},{"field":"handoff_record.completed_at","op":"present"}]'::jsonb;--> statement-breakpoint
UPDATE "gate_outcome_definition"
SET "help_text" = 'Something changed (scope, volume, resin, terms). It goes back to the affected gate as a new version; nothing is edited silently. Use while the offer is still valid. After it has expired, start a linked re-quote from the closed quote.', "updated_at" = now()
WHERE "gate_key" = 'G5' AND "key" = 'requote' AND "approved_at" IS NULL
  AND "help_text" = 'Something changed (scope, volume, resin, terms). It goes back to the affected gate as a new version; nothing is edited silently.';
