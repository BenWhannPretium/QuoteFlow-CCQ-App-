CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"reporter_id" uuid NOT NULL,
	"reporter_roles" text NOT NULL,
	"type" text NOT NULL,
	"severity" integer NOT NULL,
	"description" text NOT NULL,
	"route" text NOT NULL,
	"quote_number" text,
	"app_version" text,
	"user_agent" text,
	"viewport" text,
	"screenshot" "bytea",
	"screenshot_type" text,
	"status" text DEFAULT 'new' NOT NULL,
	"owner_id" uuid,
	"github_issue_url" text,
	"triage_note" text,
	CONSTRAINT "feedback_type_check" CHECK ("feedback"."type" in ('bug', 'confusing', 'missing', 'idea')),
	CONSTRAINT "feedback_status_check" CHECK ("feedback"."status" in ('new', 'triaged', 'fixing', 'fixed', 'wont_fix')),
	CONSTRAINT "feedback_severity_check" CHECK ("feedback"."severity" between 1 and 4),
	CONSTRAINT "feedback_screenshot_type_check" CHECK (("feedback"."screenshot" is null) = ("feedback"."screenshot_type" is null) and ("feedback"."screenshot_type" is null or "feedback"."screenshot_type" in ('image/png', 'image/jpeg', 'image/webp')))
);
--> statement-breakpoint
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_reporter_id_app_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_status_severity_idx" ON "feedback" USING btree ("status","severity","created_at");--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'finalReview.read', 'gate.G4.decide', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'gate.G6.decide', 'terms.edit', 'capitalFlag.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'finalReview.read', 'gate.G4.decide', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'gate.G6.decide', 'terms.edit', 'capitalFlag.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint

-- B-23 feedback RLS. Anyone signed in files a report as themselves; only Admin (feedback.triage) reads
-- or triages: a report can carry a screenshot of commercial figures. No deletes for the app role.
-- Inserts can't use RETURNING (the reporter can't read the row back); the API makes the id.
REVOKE DELETE ON "feedback" FROM ccq_app;
--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "feedback" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY feedback_app_insert ON "feedback" FOR INSERT TO ccq_app
  WITH CHECK (reporter_id = app_user_id());
--> statement-breakpoint
CREATE POLICY feedback_app_select ON "feedback" FOR SELECT TO ccq_app
  USING ('Admin' = ANY (app_roles()));
--> statement-breakpoint
CREATE POLICY feedback_app_update ON "feedback" FOR UPDATE TO ccq_app
  USING ('Admin' = ANY (app_roles())) WITH CHECK ('Admin' = ANY (app_roles()));
--> statement-breakpoint
CREATE POLICY feedback_migrator ON "feedback" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);
