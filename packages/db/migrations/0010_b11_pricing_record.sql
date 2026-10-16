ALTER TABLE "pricing_record" DROP CONSTRAINT "pricing_record_quote_id_unique";--> statement-breakpoint
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "segregation_rule" DROP CONSTRAINT "segregation_rule_deny_check";--> statement-breakpoint
-- Hand-written (B-11): existing records (one per quote) belong to the quote's current version.
ALTER TABLE "pricing_record" ADD COLUMN "quote_version" integer;--> statement-breakpoint
UPDATE "pricing_record" p SET "quote_version" = q."version" FROM "quote" q WHERE q."id" = p."quote_id";--> statement-breakpoint
ALTER TABLE "pricing_record" ALTER COLUMN "quote_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "pricing_basis_note" text;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "no_pricing_app_record_note" text;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "costing_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "costing_attested_by" uuid;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "costing_attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "cer_reference" text;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD COLUMN "capital_pending_justification" text;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD CONSTRAINT "pricing_record_costing_attested_by_app_user_id_fk" FOREIGN KEY ("costing_attested_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_record_quote_version_uniq" ON "pricing_record" USING btree ("quote_id","quote_version");--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'quoting.edit', 'gate.G3.submit', 'gate.G4.decide', 'outcome.record', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'export.csv', 'analytics.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'quoting.edit', 'gate.G3.submit', 'gate.G4.decide', 'outcome.record', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'export.csv', 'analytics.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "segregation_rule" ADD CONSTRAINT "segregation_rule_deny_check" CHECK ("segregation_rule"."deny" in ('actor_is_kam', 'actor_is_assigned_engineer', 'actor_is_price_approver'));