ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "attachment" ALTER COLUMN "quote_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "draft_id" uuid;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "stored_name" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "storage" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "storage_item_id" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "storage_path" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "removed_by" uuid;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_draft_id_quote_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."quote_draft"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_removed_by_app_user_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_draft_idx" ON "attachment" USING btree ("draft_id");--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'quoting.edit', 'gate.G3.submit', 'finalReview.read', 'gate.G4.decide', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'quoting.edit', 'gate.G3.submit', 'finalReview.read', 'gate.G4.decide', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_storage_check" CHECK ("attachment"."storage" in ('sharepoint', 'blob', 'local'));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_owner_check" CHECK ("attachment"."quote_id" is not null or "attachment"."draft_id" is not null or "attachment"."removed_at" is not null);--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_removed_consistency_check" CHECK (("attachment"."removed_at" is null) = ("attachment"."removed_by" is null));--> statement-breakpoint
-- B-16 hand-written RLS. A quote's files are visible when the quote is (as before). A file still on
-- an intake draft (quote_id null) is visible when the draft is: its owner, plus Admin (quote_draft RLS).
DROP POLICY IF EXISTS attachment_app ON attachment;
--> statement-breakpoint
CREATE POLICY attachment_app ON attachment FOR ALL TO ccq_app
  USING (
    CASE WHEN quote_id IS NOT NULL
      THEN EXISTS (SELECT 1 FROM quote q WHERE q.id = attachment.quote_id)
      ELSE EXISTS (SELECT 1 FROM quote_draft d WHERE d.id = attachment.draft_id)
    END
  )
  WITH CHECK (
    CASE WHEN quote_id IS NOT NULL
      THEN EXISTS (SELECT 1 FROM quote q WHERE q.id = attachment.quote_id)
      ELSE EXISTS (SELECT 1 FROM quote_draft d WHERE d.id = attachment.draft_id)
    END
  );
