CREATE TABLE "user_preference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_preference_user_key_idx" ON "user_preference" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "notification_user_created_idx" ON "notification" USING btree ("user_id","channel","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_idx" ON "notification" USING btree ("user_id","channel","dedupe_key") WHERE "notification"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notification_email_due_idx" ON "notification" USING btree ("next_attempt_at") WHERE "notification"."channel" = 'email' and "notification"."sent_at" is null and "notification"."failed_at" is null;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_delivery_state_check" CHECK (not ("notification"."sent_at" is not null and "notification"."failed_at" is not null));--> statement-breakpoint
-- ── B-18: user_preference row-level security ────────────────────────────────────────────────────
-- Any request context may READ preferences: whoever causes an event (a KAM, an engineer, a job) must
-- know whether the recipient opted out of its email. The flags are not sensitive. Only the user
-- themself (or Admin, the system job context) may write them.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_preference TO ccq_app;
--> statement-breakpoint
GRANT SELECT ON user_preference TO ccq_readonly;
--> statement-breakpoint
GRANT ALL ON user_preference TO ccq_migrator;
--> statement-breakpoint
ALTER TABLE user_preference ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_preference FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_preference_app_select ON user_preference FOR SELECT TO ccq_app USING (true);
--> statement-breakpoint
CREATE POLICY user_preference_app_insert ON user_preference FOR INSERT TO ccq_app
  WITH CHECK (user_id = app_user_id() OR 'Admin' = ANY (app_roles()));
--> statement-breakpoint
CREATE POLICY user_preference_app_update ON user_preference FOR UPDATE TO ccq_app
  USING (user_id = app_user_id() OR 'Admin' = ANY (app_roles()))
  WITH CHECK (user_id = app_user_id() OR 'Admin' = ANY (app_roles()));
--> statement-breakpoint
CREATE POLICY user_preference_app_delete ON user_preference FOR DELETE TO ccq_app
  USING (user_id = app_user_id() OR 'Admin' = ANY (app_roles()));
--> statement-breakpoint
CREATE POLICY user_preference_migrator ON user_preference FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY user_preference_readonly ON user_preference FOR SELECT TO ccq_readonly USING (true);
