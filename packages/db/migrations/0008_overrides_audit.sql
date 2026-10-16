ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
DROP INDEX "override_status_idx";--> statement-breakpoint
ALTER TABLE "override" ADD COLUMN "approval_mode" text DEFAULT 'approver' NOT NULL;--> statement-breakpoint
ALTER TABLE "override" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "queue_position_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "override_one_open_per_field_uidx" ON "override" USING btree ("quote_id","field") WHERE "override"."status" = 'requested';--> statement-breakpoint
CREATE INDEX "audit_event_at_idx" ON "audit_event" USING btree ("at");--> statement-breakpoint
CREATE INDEX "override_status_idx" ON "override" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'quoting.edit', 'gate.G3.submit', 'gate.G4.decide', 'outcome.record', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'export.csv', 'analytics.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'quoting.edit', 'gate.G3.submit', 'gate.G4.decide', 'outcome.record', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'export.csv', 'analytics.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "override" ADD CONSTRAINT "override_approval_mode_check" CHECK ("override"."approval_mode" in ('approver', 'self'));--> statement-breakpoint
-- ── Hand-written (B-09): existing override rows and the B-07 interim ship-to columns ────────────
-- Ship-to overrides are self-applied ("none (self, logged)"); applied/reverted rows were applied when decided.
UPDATE "override" SET "approval_mode" = 'self' WHERE "field" IN ('ship_to', 'queue_position');
--> statement-breakpoint
UPDATE "override" SET "applied_at" = coalesce("decided_at", "created_at") WHERE "status" IN ('applied', 'reverted');
--> statement-breakpoint
-- B-07 kept a ship-to override on the quote (ship_to_overridden / ship_to_original / ship_to_override_reason).
-- Give each such quote its `override` row, so the override log and the timeline hold every ship-to change.
-- Ids are UUID v7 stamped with the quote's submit time (the app generates ids; a migration has to here).
INSERT INTO "override" (
  "id", "created_at", "updated_at", "created_by", "quote_id", "field", "original_value", "requested_value",
  "justification", "requested_by", "status", "decided_by", "decided_at", "approval_mode", "applied_at"
)
SELECT
  encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM coalesce(q."submitted_at", q."created_at")) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid,
  coalesce(q."submitted_at", q."created_at"),
  coalesce(q."submitted_at", q."created_at"),
  q."kam_user_id",
  q."id",
  'ship_to',
  q."ship_to_original",
  coalesce(q."ship_to", '{}'::jsonb),
  coalesce(nullif(trim(q."ship_to_override_reason"), ''), 'Recorded at intake before B-09 (no reason captured).'),
  q."kam_user_id",
  'applied',
  q."kam_user_id",
  coalesce(q."submitted_at", q."created_at"),
  'self',
  coalesce(q."submitted_at", q."created_at")
FROM "quote" q
WHERE q."ship_to_overridden"
  AND NOT EXISTS (
    SELECT 1 FROM "override" o
    WHERE o."quote_id" = q."id" AND o."field" = 'ship_to' AND o."status" = 'applied'
  );
