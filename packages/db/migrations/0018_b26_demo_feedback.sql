ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_role_check";--> statement-breakpoint
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "user_role" DROP CONSTRAINT "user_role_role_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "gate_outcome_definition" DROP CONSTRAINT "gate_outcome_definition_reason_context_check";--> statement-breakpoint
ALTER TABLE "reason_code" DROP CONSTRAINT "reason_code_context_check";--> statement-breakpoint
ALTER TABLE "stage_definition" DROP CONSTRAINT "stage_definition_owner_role_check";--> statement-breakpoint
ALTER TABLE "value_list" DROP CONSTRAINT "value_list_list_key_check";--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "equipment_bom_notes" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "supply_chain_notes" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "capacity_signoff_status" text;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "capacity_signoff_by" uuid;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "capacity_signoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "capacity_signoff_note" text;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "cer_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "handoff_record" ADD COLUMN "cer_approved_on" date;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "assigned_pricer_id" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "pricer_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "capital_likely" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "capital_likely_set_by" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "capital_likely_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "capital_notice_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "market_dev_notice_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "tooling_funding_model" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_tooling_commitment" boolean;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_moq" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_payment_terms" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_nonstandard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_notes" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "terms_checked_by" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "legal_reviewed_on" date;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "legal_reviewer_name" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "legal_review_note" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "legal_recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "hold_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_hold" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_capacity_signoff_by_app_user_id_fk" FOREIGN KEY ("capacity_signoff_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_assigned_pricer_id_app_user_id_fk" FOREIGN KEY ("assigned_pricer_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_capital_likely_set_by_app_user_id_fk" FOREIGN KEY ("capital_likely_set_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_terms_checked_by_app_user_id_fk" FOREIGN KEY ("terms_checked_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_legal_recorded_by_app_user_id_fk" FOREIGN KEY ("legal_recorded_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_hold_owner_id_app_user_id_fk" FOREIGN KEY ("hold_owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_hold" ADD CONSTRAINT "quote_hold_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_check" CHECK ("role_permission"."role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'PricingLead', 'Approver', 'Leadership', 'Admin', 'PostAward'));--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'finalReview.read', 'gate.G4.decide', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'gate.G6.decide', 'terms.edit', 'capitalFlag.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_check" CHECK ("user_role"."role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'PricingLead', 'Approver', 'Leadership', 'Admin', 'PostAward'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'finalReview.read', 'gate.G4.decide', 'outcome.record', 'outcome.assignOwner', 'handoff.edit', 'gate.G6.decide', 'terms.edit', 'capitalFlag.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage'));--> statement-breakpoint
ALTER TABLE "gate_outcome_definition" ADD CONSTRAINT "gate_outcome_definition_reason_context_check" CHECK ("gate_outcome_definition"."reason_context" in ('rework', 'redirect', 'stop', 'decline', 'lost', 'expired', 'hold', 'requote', 'override', 'awarded', 'not_authorized'));--> statement-breakpoint
ALTER TABLE "reason_code" ADD CONSTRAINT "reason_code_context_check" CHECK ("reason_code"."context" in ('rework', 'redirect', 'stop', 'decline', 'lost', 'expired', 'hold', 'requote', 'override', 'awarded', 'not_authorized'));--> statement-breakpoint
ALTER TABLE "stage_definition" ADD CONSTRAINT "stage_definition_owner_role_check" CHECK ("stage_definition"."owner_role" in ('KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'PricingLead', 'Approver', 'Leadership', 'Admin', 'PostAward'));--> statement-breakpoint
ALTER TABLE "value_list" ADD CONSTRAINT "value_list_list_key_check" CHECK ("value_list"."list_key" in ('product_family', 'market', 'resin', 'component', 'process_type', 'machine_type', 'plant', 'request_class', 'drawing_status', 'neck_finish', 'packaging_type', 'tooling_funding_model'));--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_capacity_signoff_status_check" CHECK ("eng_review"."capacity_signoff_status" is null or "eng_review"."capacity_signoff_status" in ('approved', 'blocked'));--> statement-breakpoint
ALTER TABLE "handoff_record" ADD CONSTRAINT "handoff_record_cer_status_check" CHECK ("handoff_record"."cer_status" in ('pending', 'approved', 'not_approved', 'not_required'));--> statement-breakpoint
-- B-26 (hand-written): the pricing lead sees every quote, like Pricing (architecture §3.2).
CREATE OR REPLACE FUNCTION app_sees_all_quotes() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_roles() && ARRAY['Admin', 'Leadership', 'EngLead', 'Pricing', 'PricingLead', 'Approver', 'SalesLeader']::text[]
$$;
