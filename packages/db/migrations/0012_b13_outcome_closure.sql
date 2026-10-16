ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "gate_outcome_definition" DROP CONSTRAINT "gate_outcome_definition_reason_context_check";--> statement-breakpoint
ALTER TABLE "reason_code" DROP CONSTRAINT "reason_code_context_check";--> statement-breakpoint
ALTER TABLE "transition_rule" ADD COLUMN "closure_owner" text DEFAULT 'decider' NOT NULL;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "acceptance_date" date;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "acceptance_document_url" text;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "receiving_role_other" text;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "receiving_contact_name" text;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "accepted_on" date;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "completed_by" uuid;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "validity_expired_flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD CONSTRAINT "handoff_record_completed_by_app_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD CONSTRAINT "handoff_record_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'quoting.edit', 'gate.G3.submit', 'finalReview.read', 'gate.G4.decide', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'export.csv', 'analytics.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'quoting.edit', 'gate.G3.submit', 'finalReview.read', 'gate.G4.decide', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'export.csv', 'analytics.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "gate_outcome_definition" ADD CONSTRAINT "gate_outcome_definition_reason_context_check" CHECK ("gate_outcome_definition"."reason_context" in ('rework', 'redirect', 'stop', 'decline', 'lost', 'expired', 'hold', 'requote', 'override', 'awarded'));--> statement-breakpoint
ALTER TABLE "reason_code" ADD CONSTRAINT "reason_code_context_check" CHECK ("reason_code"."context" in ('rework', 'redirect', 'stop', 'decline', 'lost', 'expired', 'hold', 'requote', 'override', 'awarded'));--> statement-breakpoint
ALTER TABLE "transition_rule" ADD CONSTRAINT "transition_rule_closure_owner_check" CHECK ("transition_rule"."closure_owner" in ('kam', 'decider'));--> statement-breakpoint
ALTER TABLE "handoff_record" ADD CONSTRAINT "handoff_record_completed_consistency_check" CHECK (("handoff_record"."completed_at" is null) = ("handoff_record"."completed_by" is null));--> statement-breakpoint
-- B-13 hand-written data step (CR-39). G5 customer outcomes default the closure owner to the KAM
-- (the config seed sets the same; this keeps a migrated-but-not-reseeded database consistent).
UPDATE "transition_rule" SET "closure_owner" = 'kam' WHERE "gate_key" = 'G5' AND "next_status" = 'closed';--> statement-breakpoint
-- Closed quotes recorded before the closure rule: take the owner and reason from the closing decision,
-- an award's reason from its hand-off evidence, else the KAM. Anything still without a reason is marked
-- 'unrecorded' (the outcomes report counts these) so the CHECK below can hold for every row.
UPDATE "quote" q SET
  "closure_owner_id" = coalesce(q."closure_owner_id", d."decided_by", q."kam_user_id"),
  "outcome_reason_code" = coalesce(q."outcome_reason_code", d."reason_code", h."acceptance_evidence", 'unrecorded'),
  "outcome" = coalesce(q."outcome", lower(q."stage_key"))
FROM "quote" q2
LEFT JOIN LATERAL (
  SELECT g."decided_by", g."reason_code" FROM "gate_decision" g
  WHERE g."quote_id" = q2."id" AND g."target_stage_key" = q2."stage_key"
  ORDER BY g."decided_at" DESC LIMIT 1
) d ON true
LEFT JOIN "handoff_record" h ON h."quote_id" = q2."id"
WHERE q."id" = q2."id" AND q."status" = 'closed'
  AND (q."closure_owner_id" IS NULL OR q."outcome_reason_code" IS NULL OR q."outcome" IS NULL);--> statement-breakpoint
-- The hand-off receiving role is now a configured code (app_setting handoff_receiving_roles).
UPDATE "handoff_record" SET "receiving_role" = 'other', "receiving_role_other" = "receiving_role"
WHERE "receiving_role" IS NOT NULL AND "receiving_role" NOT IN ('commercial_activation', 'npi_post_award_pm', 'other');--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_closure_complete_check" CHECK ("quote"."status" <> 'closed' or ("quote"."outcome" is not null and "quote"."outcome_reason_code" is not null and "quote"."closure_owner_id" is not null));