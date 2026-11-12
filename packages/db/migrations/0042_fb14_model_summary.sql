CREATE TABLE "model_summary" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"attachment_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"template_id" text,
	"map_provisional" boolean,
	"field_count" integer NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL,
	"duration_ms" integer,
	CONSTRAINT "model_summary_attachment_id_unique" UNIQUE("attachment_id"),
	CONSTRAINT "model_summary_kind_check" CHECK ("model_summary"."kind" in ('cost_model', 'roi_model', 'price_table')),
	CONSTRAINT "model_summary_status_check" CHECK ("model_summary"."status" in ('complete', 'partial', 'unavailable', 'not_configured')),
	CONSTRAINT "model_summary_reason_check" CHECK ("model_summary"."reason" in ('not_xlsx', 'too_large', 'unreadable', 'timed_out', 'not_recognised', 'not_calculated', 'fields_not_found')),
	CONSTRAINT "model_summary_field_count_check" CHECK ("model_summary"."field_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "model_summary_field" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"summary_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"unit" text NOT NULL,
	"value_type" text NOT NULL,
	"sheet" text NOT NULL,
	"cell_ref" text NOT NULL,
	"defined_name" text,
	"state" text NOT NULL,
	"value_number" numeric(18, 4),
	"value_text" text,
	"value_date" timestamp with time zone,
	"headline" boolean DEFAULT false NOT NULL,
	"proposed" boolean DEFAULT true NOT NULL,
	CONSTRAINT "model_summary_field_state_check" CHECK ("model_summary_field"."state" in ('ok', 'blank', 'error', 'not_calculated', 'not_found', 'wrong_type', 'out_of_range')),
	CONSTRAINT "model_summary_field_type_check" CHECK ("model_summary_field"."value_type" in ('number', 'text', 'date')),
	CONSTRAINT "model_summary_field_unit_check" CHECK ("model_summary_field"."unit" in ('usd', 'units', 'years', 'percent', 'count', 'text'))
);
--> statement-breakpoint
ALTER TABLE "model_summary" ADD CONSTRAINT "model_summary_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_summary" ADD CONSTRAINT "model_summary_attachment_id_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_summary" ADD CONSTRAINT "model_summary_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_summary_field" ADD CONSTRAINT "model_summary_field_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_summary_field" ADD CONSTRAINT "model_summary_field_summary_id_model_summary_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."model_summary"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_summary_field" ADD CONSTRAINT "model_summary_field_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_summary_quote_idx" ON "model_summary" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "model_summary_field_summary_idx" ON "model_summary_field" USING btree ("summary_id","sort");--> statement-breakpoint
-- ── FB-14 (hand-written): model summaries and the "Payback" wording ──────────────────────────────────
-- Tracker: F-031 (summary half), A-031 (partly received), D-013, T-017 (summary half). No tracker ID yet
-- for the "Payback" wording (Stacy Slocum, 2026-11-11).
--
-- Fabric (rule 10): the two new tables use text, uuid, integer, boolean, timestamptz and numeric(18, 4)
-- only, so they mirror as they are (no companions). The new settings are app_setting rows, whose value
-- already has its value_json companion.
--
-- Row-level security: both tables are quote children, visible when the parent quote is (0004).
ALTER TABLE "model_summary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "model_summary" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "model_summary_app" ON "model_summary" FOR ALL TO ccq_app
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = "model_summary".quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = "model_summary".quote_id));--> statement-breakpoint
CREATE POLICY "model_summary_migrator" ON "model_summary" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "model_summary_readonly" ON "model_summary" FOR SELECT TO ccq_readonly USING (true);--> statement-breakpoint
ALTER TABLE "model_summary_field" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "model_summary_field" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "model_summary_field_app" ON "model_summary_field" FOR ALL TO ccq_app
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = "model_summary_field".quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = "model_summary_field".quote_id));--> statement-breakpoint
CREATE POLICY "model_summary_field_migrator" ON "model_summary_field" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "model_summary_field_readonly" ON "model_summary_field" FOR SELECT TO ccq_readonly USING (true);--> statement-breakpoint
-- A summary is what the workbook said when it was uploaded: written once, never changed by the app.
REVOKE UPDATE, DELETE, TRUNCATE ON "model_summary", "model_summary_field" FROM ccq_app;--> statement-breakpoint
--
-- The settings (provisional). The config seed inserts the same values on a fresh database; here they
-- reach environments that already have config. ON CONFLICT: an existing row is left alone.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, v.key, v.value::jsonb, v.description, true
FROM (VALUES
  ('model_summary_templates', '[{"templateId":"payback_calculator","label":"Pretium savings and payback calculator (capital and CI projects), draft #3","kind":"roi_model","active":true,"provisional":true,"note":"FB-14: cells proposed from the draft received 2026-11-11; Finance to confirm the headline cells and add the QF_ defined names. The layout is still moving (draft).","recognise":{"sheet":"0. Financial Summary","labels":[{"ref":"A3","contains":"FINANCIAL SUMMARY"},{"ref":"A9","contains":"INCREMENTAL ANNUAL UNITS"},{"ref":"K15","contains":"PAYBACK"}]},"fields":[{"key":"incremental_annual_units","label":"Incremental annual units","unit":"units","type":"number","sheet":"0. Financial Summary","ref":"QF_IncrementalUnits","fallbackRef":"A10","headline":true,"proposed":true},{"key":"incremental_net_sales","label":"Incremental net sales","unit":"usd","type":"number","sheet":"0. Financial Summary","ref":"QF_IncrementalNetSales","fallbackRef":"F10","headline":true,"proposed":true},{"key":"incremental_material_margin","label":"Incremental material margin","unit":"usd","type":"number","sheet":"0. Financial Summary","ref":"QF_IncrementalMaterialMargin","fallbackRef":"K10","headline":true,"proposed":true},{"key":"annual_pl_savings","label":"Annual P&L savings","unit":"usd","type":"number","sheet":"0. Financial Summary","ref":"QF_AnnualPLSavings","fallbackRef":"A16","headline":true,"proposed":true},{"key":"capital_request","label":"Capital request","unit":"usd","type":"number","sheet":"0. Financial Summary","ref":"QF_CapitalRequest","fallbackRef":"F16","headline":true,"proposed":true},{"key":"payback_years","label":"Payback (taxes, WACC, terminal value)","unit":"years","type":"number","sheet":"0. Financial Summary","ref":"QF_Payback","fallbackRef":"K16","headline":true,"proposed":true},{"key":"simple_payback_years","label":"Simple payback","unit":"years","type":"number","sheet":"0. Financial Summary","ref":"QF_SimplePayback","fallbackRef":"K49","headline":true,"proposed":true},{"key":"project_life_years","label":"Evaluation period (project life)","unit":"years","type":"number","sheet":"1. Overarching Asssumptions","ref":"QF_ProjectLife","fallbackRef":"D11","headline":false,"proposed":true},{"key":"discount_rate","label":"Discount rate (WACC)","unit":"percent","type":"number","sheet":"1. Overarching Asssumptions","ref":"QF_DiscountRate","fallbackRef":"D12","headline":false,"proposed":true},{"key":"hurdle_payback_years","label":"Hurdle: maximum simple payback","unit":"years","type":"number","sheet":"1. Overarching Asssumptions","ref":"QF_HurdlePayback","fallbackRef":"D17","headline":false,"proposed":true},{"key":"one_time_expense","label":"One-time expense","unit":"usd","type":"number","sheet":"4. Investment","ref":"QF_OneTimeExpense","fallbackRef":"D12","headline":false,"proposed":true},{"key":"working_capital","label":"Working capital","unit":"usd","type":"number","sheet":"4. Investment","ref":"QF_WorkingCapital","fallbackRef":"D13","headline":false,"proposed":true},{"key":"npv","label":"NPV","unit":"usd","type":"number","sheet":"5. Business Case","ref":"QF_NPV","fallbackRef":"E41","headline":false,"proposed":true},{"key":"irr","label":"IRR","unit":"percent","type":"number","sheet":"5. Business Case","ref":"QF_IRR","fallbackRef":"E43","headline":false,"proposed":true}],"warnings":{"nonPositive":["payback_years","simple_payback_years"],"hurdle":{"field":"simple_payback_years","limitField":"hurdle_payback_years"}}},{"templateId":"erf_costing_pre_makeover","label":"ERF costing workbook, pre-makeover layout (inactive)","kind":"cost_model","active":false,"provisional":true,"note":"FB-14: for the ERF costing layout in use before the costing-template makeover. Inactive: not the costing template going forward. Reads the first variant column of the Summary sheet only.","recognise":{"sheet":"Summary","labels":[{"ref":"A13","contains":"Total"},{"ref":"A15","contains":"Revenue"},{"ref":"A18","contains":"CM%"},{"sheet":"ECE SUMMARY","ref":"C2","contains":"ECE SUMMARY"}]},"fields":[{"key":"unit_cost","label":"Total cost (first variant)","unit":"usd","type":"number","sheet":"Summary","ref":"B13","headline":true,"proposed":true},{"key":"target_price","label":"Target price (first variant)","unit":"usd","type":"number","sheet":"Summary","ref":"B16","headline":true,"proposed":true},{"key":"revenue","label":"Revenue (first variant)","unit":"usd","type":"number","sheet":"Summary","ref":"B15","headline":false,"proposed":true},{"key":"contribution_margin_pct","label":"Contribution margin % (first variant)","unit":"percent","type":"number","sheet":"Summary","ref":"B18","headline":true,"proposed":true},{"key":"contribution_margin_usd","label":"Contribution margin $ on volume (first variant)","unit":"usd","type":"number","sheet":"Summary","ref":"B27","headline":false,"proposed":true},{"key":"annual_volume","label":"Annual volume (first variant)","unit":"units","type":"number","sheet":"Summary","ref":"B22","headline":true,"proposed":true},{"key":"capital_project_total","label":"Capital project total (first size)","unit":"usd","type":"number","sheet":"Summary","ref":"V22","headline":false,"proposed":true},{"key":"capital_net_cost","label":"Net capital cost to Pretium (first size)","unit":"usd","type":"number","sheet":"Summary","ref":"V24","headline":false,"proposed":true}],"warnings":{"nonPositive":[],"hurdle":null}}]', 'FB-14 (F-031 summary half, D-013, A-031 partly received): the one-page summary maps. One entry per template: the attachment kind, how to recognise it (a sheet plus label cells) and the fields to read (a defined name when the workbook has one, else an A1 address; fallbackRef is used until the name exists). Inactive maps are not used. Seeded: the payback calculator (Finance, draft #3: cells proposed, Finance to confirm and add the QF_ names) and the pre-makeover ERF costing layout (inactive). Provisional.'),
  ('model_summary_visible', 'true', 'FB-14 (04 §2a, open): may QuoteFlow show the figures read from uploaded models (costing, payback) to the roles that read the quote? Seeded on (CLAUDE.md rule 2: every role that reads a quote sees its commercial figures). Off hides the figures everywhere; the files and their versions still show. Provisional until Gemma Cebolla decides.'),
  ('model_summary_limits', '{"maxBytes":15728640,"timeoutMs":5000,"maxCells":200000}', 'FB-14: the work cap for reading a model summary at upload: maxBytes (a larger file is stored and shows "too large"), timeoutMs (well inside the upload request), maxCells. Provisional.')
) AS v(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
--
-- "Payback" (Stacy Slocum, 2026-11-11: "let's not call it an ROI"; provisional, D-001 is not rewritten).
-- Only user-facing text changes; every identifier (roi_model, roi.upload, roi_required_when, ...) stays.
-- As 0031: a row the business approved, or an admin edited away from the old seed text, is left alone.
UPDATE "gate_outcome_definition" SET "help_text" = replace("help_text", 'the ROI model is on file too.', 'the payback model is on file too.'), "updated_at" = now()
WHERE "gate_key" = 'G3' AND "key" = 'submit' AND "approved_at" IS NULL
  AND "help_text" = 'The pricing lead confirms the price. The costing model is on file and costing is attested; when capital is required ($0 CER included) the ROI model is on file too. Optionally upload an updated price table; otherwise the price in the models stands. Capital readiness is recorded separately. The quote goes to Final Review.';--> statement-breakpoint
UPDATE "app_setting" SET "description" = replace("description", 'needs Finance''s ROI model before', 'needs Finance''s payback model (roi_model; "Payback" since FB-14) before'), "updated_at" = now()
WHERE "key" = 'roi_required_when' AND "approved_at" IS NULL AND "version" = 1
  AND "description" LIKE 'FB-07 (D-001): when a quote needs Finance''s ROI model before%';
