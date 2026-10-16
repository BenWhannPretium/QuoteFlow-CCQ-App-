ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "technical_concept_notes" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_accepted_by_app_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'quoting.edit', 'gate.G3.submit', 'gate.G4.decide', 'outcome.record', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'export.csv', 'analytics.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'quoting.edit', 'gate.G3.submit', 'gate.G4.decide', 'outcome.record', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'export.csv', 'analytics.read', 'config.manage'));--> statement-breakpoint
-- ── Hand-written (B-10): quotes assigned before assigned_at existed ──────────────────────────────
-- Best evidence of when the engineer was assigned: the review's acceptance, else the quote's last update.
UPDATE "quote" q SET "assigned_at" = coalesce(
  (SELECT e."accepted_at" FROM "eng_review" e WHERE e."quote_id" = q."id"),
  q."updated_at"
)
WHERE q."assigned_engineer_id" IS NOT NULL AND q."assigned_at" IS NULL;
