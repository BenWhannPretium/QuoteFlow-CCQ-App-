CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"entra_oid" text NOT NULL,
	"upn" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"region" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "app_user_entra_oid_unique" UNIQUE("entra_oid")
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"role" text NOT NULL,
	"permission" text NOT NULL,
	"qualifier" jsonb,
	CONSTRAINT "role_permission_role_permission_uq" UNIQUE("role","permission"),
	CONSTRAINT "role_permission_role_check" CHECK ("role_permission"."role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'Approver', 'Leadership', 'Admin', 'PostAward')),
	CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'quoting.edit', 'gate.G3.submit', 'gate.G4.decide', 'outcome.record', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'attachment.upload', 'export.csv', 'analytics.read', 'config.manage'))
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "user_role_user_role_uq" UNIQUE("user_id","role"),
	CONSTRAINT "user_role_role_check" CHECK ("user_role"."role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'Approver', 'Leadership', 'Admin', 'PostAward'))
);
--> statement-breakpoint
CREATE TABLE "user_scope" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"scope_type" text DEFAULT 'all' NOT NULL,
	"values" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "user_scope_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_scope_scope_type_check" CHECK ("user_scope"."scope_type" in ('all', 'region', 'owner', 'account_list'))
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"key" text NOT NULL,
	"value" jsonb,
	"description" text NOT NULL,
	CONSTRAINT "app_setting_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "gate_definition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"key" text NOT NULL,
	"stage_key" text NOT NULL,
	"label" text NOT NULL,
	"decider_permission" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "gate_definition_key_unique" UNIQUE("key"),
	CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'quoting.edit', 'gate.G3.submit', 'gate.G4.decide', 'outcome.record', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'attachment.upload', 'export.csv', 'analytics.read', 'config.manage'))
);
--> statement-breakpoint
CREATE TABLE "gate_outcome_definition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"gate_key" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"requires_note" boolean DEFAULT false NOT NULL,
	"requires_reason_code" boolean DEFAULT false NOT NULL,
	"reason_context" text,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notify" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "gate_outcome_definition_gate_key_key_uq" UNIQUE("gate_key","key"),
	CONSTRAINT "gate_outcome_definition_reason_context_check" CHECK ("gate_outcome_definition"."reason_context" in ('rework', 'redirect', 'stop', 'decline', 'lost', 'expired', 'hold', 'requote', 'override'))
);
--> statement-breakpoint
CREATE TABLE "reason_code" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"context" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"requires_note" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reason_code_context_code_uq" UNIQUE("context","code"),
	CONSTRAINT "reason_code_context_check" CHECK ("reason_code"."context" in ('rework', 'redirect', 'stop', 'decline', 'lost', 'expired', 'hold', 'requote', 'override'))
);
--> statement-breakpoint
CREATE TABLE "scoring_model" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"model_version" integer NOT NULL,
	"attributes" jsonb NOT NULL,
	"tier_thresholds" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"change_reason" text NOT NULL,
	CONSTRAINT "scoring_model_model_version_unique" UNIQUE("model_version")
);
--> statement-breakpoint
CREATE TABLE "segregation_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rule_key" text NOT NULL,
	"gate_keys" text[] NOT NULL,
	"outcome_keys" text[],
	"deny" text NOT NULL,
	"message" text NOT NULL,
	CONSTRAINT "segregation_rule_rule_key_unique" UNIQUE("rule_key"),
	CONSTRAINT "segregation_rule_deny_check" CHECK ("segregation_rule"."deny" in ('actor_is_kam', 'actor_is_assigned_engineer'))
);
--> statement-breakpoint
CREATE TABLE "sf_stage_map" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sf_stage" text NOT NULL,
	"ccq_stage_hint" text,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sf_stage_map_sf_stage_unique" UNIQUE("sf_stage")
);
--> statement-breakpoint
CREATE TABLE "stage_definition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"owner_role" text,
	"terminal" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stage_definition_key_unique" UNIQUE("key"),
	CONSTRAINT "stage_definition_owner_role_check" CHECK ("stage_definition"."owner_role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'Approver', 'Leadership', 'Admin', 'PostAward'))
);
--> statement-breakpoint
CREATE TABLE "transition_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"gate_key" text NOT NULL,
	"outcome_key" text NOT NULL,
	"target_stage_keys" text[] DEFAULT '{}' NOT NULL,
	"next_status" text NOT NULL,
	"close_as" text,
	"version_bump" boolean DEFAULT false NOT NULL,
	CONSTRAINT "transition_rule_gate_outcome_uq" UNIQUE("gate_key","outcome_key"),
	CONSTRAINT "transition_rule_next_status_check" CHECK ("transition_rule"."next_status" in ('active', 'on_hold', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "value_list" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"list_key" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "value_list_list_key_code_uq" UNIQUE("list_key","code"),
	CONSTRAINT "value_list_list_key_check" CHECK ("value_list"."list_key" in ('product_family', 'market', 'resin', 'component', 'process_type', 'machine_type', 'plant', 'request_class', 'drawing_status', 'neck_finish', 'packaging_type'))
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text NOT NULL,
	"sp_drive_id" text,
	"sp_item_id" text,
	"sp_web_url" text,
	"uploaded_by" uuid NOT NULL,
	CONSTRAINT "attachment_kind_check" CHECK ("attachment"."kind" in ('bottle_drawing', 'spec', 'sample_photo', 'other')),
	CONSTRAINT "attachment_size_check" CHECK ("attachment"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "capacity_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"site" text NOT NULL,
	"line_asset" text,
	"assumed_effectiveness_pct" numeric(5, 2) NOT NULL,
	"cycle_time_s" numeric(8, 2) NOT NULL,
	"utilization_pct" numeric(5, 2) NOT NULL,
	"buffer_pct" numeric(5, 2),
	"analysis_date" date NOT NULL,
	"analyst_id" uuid NOT NULL,
	"notes" text,
	CONSTRAINT "capacity_evidence_pct_check" CHECK ("capacity_evidence"."assumed_effectiveness_pct" between 0 and 100 and "capacity_evidence"."utilization_pct" between 0 and 100 and ("capacity_evidence"."buffer_pct" is null or "capacity_evidence"."buffer_pct" between 0 and 100))
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"sf_account_id" text,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"default_ship_to" jsonb,
	"source" text DEFAULT 'salesforce' NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "customer_sf_account_id_unique" UNIQUE("sf_account_id"),
	CONSTRAINT "customer_status_check" CHECK ("customer"."status" in ('existing', 'not_yet_established')),
	CONSTRAINT "customer_sf_account_matches_status_check" CHECK (("customer"."status" = 'existing') = ("customer"."sf_account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "eng_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"returned_reason" text,
	"process_type" text,
	"machine_type" text,
	"plant_code" text,
	"cavitation" integer,
	"cycle_time_s" numeric(8, 2),
	"tooling_notes" text,
	"prelim_capital_usd" numeric(14, 2),
	"downstream_equipment_notes" text,
	CONSTRAINT "eng_review_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "eng_review_cavitation_check" CHECK ("eng_review"."cavitation" > 0)
);
--> statement-breakpoint
CREATE TABLE "gate_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"gate_key" text NOT NULL,
	"outcome_key" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"note" text,
	"reason_code" text,
	"target_stage_key" text,
	"quote_version" integer NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conditions" text,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "handoff_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"acceptance_evidence" text NOT NULL,
	"receiving_role" text,
	"accepted_by_name" text,
	"cer_id" text,
	"bpr_id" text,
	"notes" text,
	CONSTRAINT "handoff_record_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "handoff_record_acceptance_evidence_check" CHECK ("handoff_record"."acceptance_evidence" in ('verbal', 'po', 'loi', 'contract'))
);
--> statement-breakpoint
CREATE TABLE "override" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"field" text NOT NULL,
	"original_value" jsonb,
	"requested_value" jsonb NOT NULL,
	"justification" text NOT NULL,
	"reason_code" text,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"reverted_by" uuid,
	"reverted_at" timestamp with time zone,
	CONSTRAINT "override_status_check" CHECK ("override"."status" in ('requested', 'approved', 'rejected', 'applied', 'reverted')),
	CONSTRAINT "override_justification_check" CHECK (length(trim("override"."justification")) > 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"price_approved_by" uuid,
	"price_approved_at" timestamp with time zone,
	"pricing_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_range_note" text,
	"capital_readiness" text,
	"capital_notes" text,
	CONSTRAINT "pricing_record_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "pricing_record_capital_readiness_check" CHECK ("pricing_record"."capital_readiness" in ('not_required', 'pending', 'pre_approved', 'not_approved'))
);
--> statement-breakpoint
CREATE TABLE "quote" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_number" text NOT NULL,
	"sf_opportunity_id" text NOT NULL,
	"customer_id" uuid,
	"kam_user_id" uuid NOT NULL,
	"region" text,
	"stage_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"description" text,
	"structured_description" jsonb,
	"product_family" text,
	"market" text,
	"resin" text,
	"components" text[] DEFAULT '{}' NOT NULL,
	"est_annual_volume" bigint,
	"est_annual_revenue" numeric(14, 2),
	"expected_close_date" date,
	"drawing_status" text,
	"neck_finish" text,
	"packaging_type" text,
	"packaging_notes" text,
	"request_class" text,
	"comments_for_engineering" text,
	"ship_to" jsonb,
	"ship_to_overridden" boolean DEFAULT false NOT NULL,
	"priority_score" numeric(5, 2),
	"priority_tier" text,
	"priority_tier_overridden" boolean DEFAULT false NOT NULL,
	"scoring_model_version" integer,
	"queue_position" integer,
	"assigned_engineer_id" uuid,
	"erf_number" text,
	"cer_id" text,
	"bpr_id" text,
	"proposal_issued_at" timestamp with time zone,
	"validity_until" date,
	"review_date" date,
	"outcome" text,
	"outcome_reason_code" text,
	"closure_owner_id" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "quote_quote_number_unique" UNIQUE("quote_number"),
	CONSTRAINT "quote_status_check" CHECK ("quote"."status" in ('active', 'on_hold', 'closed')),
	CONSTRAINT "quote_quote_number_format_check" CHECK ("quote"."quote_number" ~ '^CCQ-[0-9]{4}-[0-9]{5}$'),
	CONSTRAINT "quote_version_check" CHECK ("quote"."version" >= 1),
	CONSTRAINT "quote_priority_score_check" CHECK ("quote"."priority_score" between 0 and 100),
	CONSTRAINT "quote_closed_consistency_check" CHECK (("quote"."status" = 'closed') = ("quote"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "quote_hold" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"reason_code" text,
	CONSTRAINT "quote_hold_end_after_start_check" CHECK ("quote_hold"."ended_at" is null or "quote_hold"."ended_at" >= "quote_hold"."started_at")
);
--> statement-breakpoint
CREATE TABLE "quote_number_counter" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"year" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quote_number_counter_year_unique" UNIQUE("year"),
	CONSTRAINT "quote_number_counter_last_value_check" CHECK ("quote_number_counter"."last_value" between 0 and 99999)
);
--> statement-breakpoint
CREATE TABLE "sf_opportunity_snapshot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"sf_opportunity_id" text NOT NULL,
	"name" text NOT NULL,
	"account_id" text,
	"account_name" text,
	"owner_alias" text,
	"owner_email" text,
	"amount" numeric(14, 2),
	"close_date" date,
	"sf_stage" text,
	"erf_number_sf" text,
	"quote_source_sf" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sf_opportunity_snapshot_sf_opportunity_id_unique" UNIQUE("sf_opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "stage_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"quote_version" integer DEFAULT 1 NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"exited_at" timestamp with time zone,
	"entered_by" uuid,
	"on_hold_ms" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "stage_history_exit_after_enter_check" CHECK ("stage_history"."exited_at" is null or "stage_history"."exited_at" >= "stage_history"."entered_at")
);
--> statement-breakpoint
CREATE TABLE "activity_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_roles" text[] DEFAULT '{}' NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"quote_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	CONSTRAINT "audit_event_action_check" CHECK ("audit_event"."action" in ('view', 'create', 'update', 'stage_change', 'gate_decision', 'override_requested', 'override_approved', 'override_rejected', 'override_applied', 'override_reverted', 'upload', 'download', 'export', 'config_change', 'sign_in'))
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"quote_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "notification_channel_check" CHECK ("notification"."channel" in ('in_app', 'email'))
);
--> statement-breakpoint
CREATE TABLE "integration_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "integration_run_source_check" CHECK ("integration_run"."source" in ('salesforce', 'pricing', 'sharepoint')),
	CONSTRAINT "integration_run_status_check" CHECK ("integration_run"."status" in ('running', 'succeeded', 'failed', 'partial'))
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_scope" ADD CONSTRAINT "user_scope_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_scope" ADD CONSTRAINT "user_scope_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_stage_key_stage_definition_key_fk" FOREIGN KEY ("stage_key") REFERENCES "public"."stage_definition"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "gate_outcome_definition" ADD CONSTRAINT "gate_outcome_definition_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_outcome_definition" ADD CONSTRAINT "gate_outcome_definition_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_outcome_definition" ADD CONSTRAINT "gate_outcome_definition_gate_key_gate_definition_key_fk" FOREIGN KEY ("gate_key") REFERENCES "public"."gate_definition"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reason_code" ADD CONSTRAINT "reason_code_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reason_code" ADD CONSTRAINT "reason_code_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_model" ADD CONSTRAINT "scoring_model_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_model" ADD CONSTRAINT "scoring_model_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segregation_rule" ADD CONSTRAINT "segregation_rule_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segregation_rule" ADD CONSTRAINT "segregation_rule_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf_stage_map" ADD CONSTRAINT "sf_stage_map_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf_stage_map" ADD CONSTRAINT "sf_stage_map_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf_stage_map" ADD CONSTRAINT "sf_stage_map_ccq_stage_hint_stage_definition_key_fk" FOREIGN KEY ("ccq_stage_hint") REFERENCES "public"."stage_definition"("key") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stage_definition" ADD CONSTRAINT "stage_definition_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_definition" ADD CONSTRAINT "stage_definition_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_rule" ADD CONSTRAINT "transition_rule_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_rule" ADD CONSTRAINT "transition_rule_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_rule" ADD CONSTRAINT "transition_rule_outcome_fk" FOREIGN KEY ("gate_key","outcome_key") REFERENCES "public"."gate_outcome_definition"("gate_key","key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "value_list" ADD CONSTRAINT "value_list_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_list" ADD CONSTRAINT "value_list_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD CONSTRAINT "capacity_evidence_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD CONSTRAINT "capacity_evidence_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD CONSTRAINT "capacity_evidence_analyst_id_app_user_id_fk" FOREIGN KEY ("analyst_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decision" ADD CONSTRAINT "gate_decision_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decision" ADD CONSTRAINT "gate_decision_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decision" ADD CONSTRAINT "gate_decision_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD CONSTRAINT "handoff_record_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD CONSTRAINT "handoff_record_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "override" ADD CONSTRAINT "override_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "override" ADD CONSTRAINT "override_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "override" ADD CONSTRAINT "override_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "override" ADD CONSTRAINT "override_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "override" ADD CONSTRAINT "override_reverted_by_app_user_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD CONSTRAINT "pricing_record_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD CONSTRAINT "pricing_record_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_record" ADD CONSTRAINT "pricing_record_price_approved_by_app_user_id_fk" FOREIGN KEY ("price_approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_sf_opportunity_id_sf_opportunity_snapshot_sf_opportunity_id_fk" FOREIGN KEY ("sf_opportunity_id") REFERENCES "public"."sf_opportunity_snapshot"("sf_opportunity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_kam_user_id_app_user_id_fk" FOREIGN KEY ("kam_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_stage_key_stage_definition_key_fk" FOREIGN KEY ("stage_key") REFERENCES "public"."stage_definition"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_assigned_engineer_id_app_user_id_fk" FOREIGN KEY ("assigned_engineer_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_closure_owner_id_app_user_id_fk" FOREIGN KEY ("closure_owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_hold" ADD CONSTRAINT "quote_hold_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_hold" ADD CONSTRAINT "quote_hold_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_number_counter" ADD CONSTRAINT "quote_number_counter_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sf_opportunity_snapshot" ADD CONSTRAINT "sf_opportunity_snapshot_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_entered_by_app_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_run" ADD CONSTRAINT "integration_run_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_user_upn_idx" ON "app_user" USING btree ("upn");--> statement-breakpoint
CREATE INDEX "attachment_quote_idx" ON "attachment" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "capacity_evidence_quote_idx" ON "capacity_evidence" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "comment_quote_idx" ON "comment" USING btree ("quote_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_name_idx" ON "customer" USING btree ("name");--> statement-breakpoint
CREATE INDEX "gate_decision_quote_idx" ON "gate_decision" USING btree ("quote_id","decided_at");--> statement-breakpoint
CREATE INDEX "override_quote_idx" ON "override" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "override_status_idx" ON "override" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quote_stage_priority_idx" ON "quote" USING btree ("stage_key","priority_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "quote_kam_user_id_idx" ON "quote" USING btree ("kam_user_id");--> statement-breakpoint
CREATE INDEX "quote_sf_opportunity_id_idx" ON "quote" USING btree ("sf_opportunity_id");--> statement-breakpoint
CREATE INDEX "quote_assigned_engineer_id_idx" ON "quote" USING btree ("assigned_engineer_id");--> statement-breakpoint
CREATE INDEX "quote_region_idx" ON "quote" USING btree ("region");--> statement-breakpoint
CREATE INDEX "quote_hold_quote_idx" ON "quote_hold" USING btree ("quote_id","started_at");--> statement-breakpoint
CREATE INDEX "sf_opportunity_snapshot_name_trgm_idx" ON "sf_opportunity_snapshot" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "stage_history_quote_entered_idx" ON "stage_history" USING btree ("quote_id","entered_at");--> statement-breakpoint
CREATE INDEX "activity_event_quote_at_idx" ON "activity_event" USING btree ("quote_id","at");--> statement-breakpoint
CREATE INDEX "audit_event_quote_at_idx" ON "audit_event" USING btree ("quote_id","at");--> statement-breakpoint
CREATE INDEX "audit_event_actor_at_idx" ON "audit_event" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "notification_user_unread_idx" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "integration_run_source_started_idx" ON "integration_run" USING btree ("source","started_at");