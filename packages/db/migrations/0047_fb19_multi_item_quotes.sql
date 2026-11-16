CREATE TABLE IF NOT EXISTS "quote_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"item_no" smallint NOT NULL,
	"label" text,
	"product_family" text,
	"product_family_other" text,
	"components" text[] DEFAULT '{}' NOT NULL,
	"component_other" text,
	"liner_spec" text,
	"labels_purchased_by" text,
	"decoration_type" text,
	"decoration_type_other" text,
	"decoration_print_colors" integer,
	"resin" text,
	"resin_customer_specified" boolean DEFAULT false NOT NULL,
	"resin_grade" text,
	"pcr_level" text,
	"pcr_level_other" text,
	"color_type" text,
	"color_description" text,
	"additive" text,
	"additives" text,
	"neck_diameter" text,
	"neck_diameter_custom" text,
	"neck_finish_type" text,
	"neck_finish_type_custom" text,
	"neck_special_feature" text,
	"neck_special_feature_custom" text,
	"container_size" text,
	"height_mm" numeric(10, 2),
	"width_or_diameter_mm" numeric(10, 2),
	"depth_mm" numeric(10, 2),
	"gram_weight_g" numeric(10, 2),
	"modify_existing_mold" boolean DEFAULT false NOT NULL,
	"existing_mold_ref" text,
	"mold_change_description" text,
	"packaging_type" text,
	"packaging_notes" text,
	"drawing_status" text,
	"est_annual_volume" bigint,
	"est_annual_volume_confirmed" boolean DEFAULT false NOT NULL,
	"product_needed_by" date,
	"standard_description" text,
	"sf_product_spec_id" text,
	CONSTRAINT "quote_item_item_no_check" CHECK ("quote_item"."item_no" >= 1),
	CONSTRAINT "quote_item_label_length_check" CHECK ("quote_item"."label" is null or char_length("quote_item"."label") <= 60),
	CONSTRAINT "quote_item_dimensions_positive_check" CHECK (("quote_item"."height_mm" is null or "quote_item"."height_mm" > 0) and ("quote_item"."width_or_diameter_mm" is null or "quote_item"."width_or_diameter_mm" > 0) and ("quote_item"."depth_mm" is null or "quote_item"."depth_mm" > 0) and ("quote_item"."gram_weight_g" is null or "quote_item"."gram_weight_g" > 0)),
	CONSTRAINT "quote_item_decoration_print_colors_check" CHECK ("quote_item"."decoration_print_colors" is null or "quote_item"."decoration_print_colors" between 1 and 12)
);
--> statement-breakpoint
ALTER TABLE "quote_item" ADD CONSTRAINT "quote_item_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_item" ADD CONSTRAINT "quote_item_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_item_quote_item_no_uidx" ON "quote_item" USING btree ("quote_id","item_no");--> statement-breakpoint
CREATE TABLE "quote_item_drawing" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"quote_id" uuid NOT NULL,
	"quote_item_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_item_drawing" ADD CONSTRAINT "quote_item_drawing_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_item_drawing" ADD CONSTRAINT "quote_item_drawing_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_item_drawing" ADD CONSTRAINT "quote_item_drawing_quote_item_id_quote_item_id_fk" FOREIGN KEY ("quote_item_id") REFERENCES "public"."quote_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_item_drawing" ADD CONSTRAINT "quote_item_drawing_attachment_id_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_item_drawing_item_attachment_uidx" ON "quote_item_drawing" USING btree ("quote_item_id","attachment_id");--> statement-breakpoint
CREATE INDEX "quote_item_drawing_quote_idx" ON "quote_item_drawing" USING btree ("quote_id");--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "quote_item_id" uuid;--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD COLUMN "quote_item_id" uuid;--> statement-breakpoint
ALTER TABLE "eng_review" ADD COLUMN "quote_item_id" uuid;--> statement-breakpoint
-- ── FB-19 (hand-written): multi-item quotes ──────────────────────────────────────────────────────────
-- Tracker: F-084 (multi-item bids as one quote; P1 → MVP, Bailey Schmitt, 2026-11-13), D-005 (open),
-- W13-32 to W13-34. Plan: docs/build-guide/feedback/fb19-plan.md.
--
-- Row-level security: quote_item and quote_item_drawing are quote children, visible when the parent quote
-- is (as 0042).
ALTER TABLE "quote_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote_item" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "quote_item_app" ON "quote_item" FOR ALL TO ccq_app
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = "quote_item".quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = "quote_item".quote_id));--> statement-breakpoint
CREATE POLICY "quote_item_migrator" ON "quote_item" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "quote_item_readonly" ON "quote_item" FOR SELECT TO ccq_readonly USING (true);--> statement-breakpoint
ALTER TABLE "quote_item_drawing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote_item_drawing" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "quote_item_drawing_app" ON "quote_item_drawing" FOR ALL TO ccq_app
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = "quote_item_drawing".quote_id))
  WITH CHECK (EXISTS (SELECT 1 FROM quote q WHERE q.id = "quote_item_drawing".quote_id));--> statement-breakpoint
CREATE POLICY "quote_item_drawing_migrator" ON "quote_item_drawing" FOR ALL TO ccq_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "quote_item_drawing_readonly" ON "quote_item_drawing" FOR SELECT TO ccq_readonly USING (true);--> statement-breakpoint
--
-- Fabric (rule 10): components is an array, so it gets a components_json text companion kept by the
-- zz_fabric_json trigger (0022). Every other column is a mirrored type (numerics are numeric(10, 2));
-- quote_item_drawing has uuid and timestamptz columns only.
ALTER TABLE "quote_item" ADD COLUMN "components_json" text;--> statement-breakpoint
COMMENT ON COLUMN "quote_item"."components_json" IS 'Fabric copy of components as JSON text (B-27, trigger-maintained). Not in the Drizzle schema: do not read or write it in the app.';--> statement-breakpoint
CREATE TRIGGER zz_fabric_json BEFORE INSERT OR UPDATE ON "quote_item"
  FOR EACH ROW EXECUTE FUNCTION fabric_json_companions('components');--> statement-breakpoint
--
-- Existing quotes: item 1 from the quote's own columns (the container size and the standard description
-- live only in structured_description today). The label is the size and the product family's label, as
-- a KAM would name it ("16 oz Bottle"); null when neither is known (shown as "Item 1"). Idempotent: a
-- quote that already has items is left alone.
INSERT INTO "quote_item" (
  "id", "quote_id", "item_no", "label", "product_family", "product_family_other", "components",
  "component_other", "liner_spec", "labels_purchased_by", "decoration_type", "decoration_type_other",
  "decoration_print_colors", "resin", "resin_customer_specified", "resin_grade", "pcr_level",
  "pcr_level_other", "color_type", "color_description", "additive", "additives", "neck_diameter",
  "neck_diameter_custom", "neck_finish_type", "neck_finish_type_custom", "neck_special_feature",
  "neck_special_feature_custom", "container_size", "height_mm", "width_or_diameter_mm", "depth_mm",
  "gram_weight_g", "modify_existing_mold", "existing_mold_ref", "mold_change_description",
  "packaging_type", "packaging_notes", "drawing_status", "est_annual_volume",
  "est_annual_volume_confirmed", "product_needed_by", "standard_description", "created_at",
  "updated_at", "created_by")
SELECT
  encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid,
  q."id", 1,
  left(nullif(btrim(concat_ws(' ',
    nullif(btrim(q."structured_description"->>'size'), ''),
    (SELECT vl."label" FROM "value_list" vl WHERE vl."list_key" = 'product_family' AND vl."code" = q."product_family")
  )), ''), 60),
  q."product_family", q."product_family_other", q."components", q."component_other", q."liner_spec",
  q."labels_purchased_by", q."decoration_type", q."decoration_type_other", q."decoration_print_colors",
  q."resin", q."resin_customer_specified", q."resin_grade", q."pcr_level", q."pcr_level_other",
  q."color_type", q."color_description", q."additive", q."additives", q."neck_diameter",
  q."neck_diameter_custom", q."neck_finish_type", q."neck_finish_type_custom", q."neck_special_feature",
  q."neck_special_feature_custom", nullif(btrim(q."structured_description"->>'size'), ''),
  q."height_mm", q."width_or_diameter_mm", q."depth_mm", q."gram_weight_g", q."modify_existing_mold",
  q."existing_mold_ref", q."mold_change_description", q."packaging_type", q."packaging_notes",
  q."drawing_status", q."est_annual_volume", q."est_annual_volume_confirmed", q."product_needed_by",
  nullif(btrim(q."structured_description"->>'standard'), ''), q."created_at", now(), q."created_by"
FROM "quote" q
WHERE NOT EXISTS (SELECT 1 FROM "quote_item" qi WHERE qi."quote_id" = q."id");--> statement-breakpoint
-- Every engineering review and capacity row belongs to its quote's item 1.
UPDATE "eng_review" er SET "quote_item_id" = qi."id"
FROM "quote_item" qi
WHERE qi."quote_id" = er."quote_id" AND qi."item_no" = 1 AND er."quote_item_id" IS NULL;--> statement-breakpoint
UPDATE "capacity_evidence" ce SET "quote_item_id" = qi."id"
FROM "quote_item" qi
WHERE qi."quote_id" = ce."quote_id" AND qi."item_no" = 1 AND ce."quote_item_id" IS NULL;--> statement-breakpoint
-- The drawings already on a quote (a bottle or competitor drawing, DRAWING_ATTACHMENT_KINDS) are item 1's: the
-- drawing-or-minimum-spec rule is checked per item.
UPDATE "attachment" a SET "quote_item_id" = qi."id"
FROM "quote_item" qi
WHERE qi."quote_id" = a."quote_id" AND qi."item_no" = 1 AND a."quote_item_id" IS NULL
  AND a."kind" IN ('bottle_drawing', 'competitor_drawing');--> statement-breakpoint
-- Intake drafts: the product fields move into data.items[0] (the request fields stay at the top level).
-- The item gets a key (the wizard's handle; the quote item id once the quote exists). A draft that
-- already has items is left alone; the app still reads a draft without items as one item.
UPDATE "quote_draft" d SET "data" = (d."data" - ARRAY[
    'productFamily', 'productFamilyOther', 'components', 'componentOther', 'linerSpec',
    'labelsPurchasedBy', 'decorationType', 'decorationTypeOther', 'decorationPrintColors', 'resin',
    'resinCustomerSpecified', 'resinGrade', 'pcrLevel', 'pcrLevelOther', 'colorType',
    'colorDescription', 'additive', 'additives', 'neckDiameter', 'neckDiameterCustom',
    'neckFinishType', 'neckFinishTypeCustom', 'neckSpecialFeature', 'neckSpecialFeatureCustom',
    'containerSize', 'heightMm', 'widthOrDiameterMm', 'depthMm', 'gramWeightG',
    'modifyExistingMold', 'existingMoldRef', 'moldChangeDescription', 'packagingType',
    'packagingNotes', 'drawingStatus', 'estAnnualVolume', 'estAnnualVolumeConfirmed',
    'productNeededBy', 'standardDescription', 'sfPrefill'])
  || jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('key', gen_random_uuid()::text)
    || COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(d."data") e
        WHERE e.key = ANY (ARRAY[
          'productFamily', 'productFamilyOther', 'components', 'componentOther', 'linerSpec',
          'labelsPurchasedBy', 'decorationType', 'decorationTypeOther', 'decorationPrintColors', 'resin',
          'resinCustomerSpecified', 'resinGrade', 'pcrLevel', 'pcrLevelOther', 'colorType',
          'colorDescription', 'additive', 'additives', 'neckDiameter', 'neckDiameterCustom',
          'neckFinishType', 'neckFinishTypeCustom', 'neckSpecialFeature', 'neckSpecialFeatureCustom',
          'containerSize', 'heightMm', 'widthOrDiameterMm', 'depthMm', 'gramWeightG',
          'modifyExistingMold', 'existingMoldRef', 'moldChangeDescription', 'packagingType',
          'packagingNotes', 'drawingStatus', 'estAnnualVolume', 'estAnnualVolumeConfirmed',
          'productNeededBy', 'standardDescription', 'sfPrefill'])), '{}'::jsonb)))
WHERE jsonb_typeof(d."data") = 'object' AND NOT (d."data" ? 'items');--> statement-breakpoint
--
-- Now that every row has its item: NOT NULL, the foreign keys, one review per item.
ALTER TABLE "eng_review" ALTER COLUMN "quote_item_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "capacity_evidence" ALTER COLUMN "quote_item_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eng_review" DROP CONSTRAINT "eng_review_quote_id_unique";--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_quote_item_id_unique" UNIQUE("quote_item_id");--> statement-breakpoint
ALTER TABLE "capacity_evidence" ADD CONSTRAINT "capacity_evidence_quote_item_id_quote_item_id_fk" FOREIGN KEY ("quote_item_id") REFERENCES "public"."quote_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_review" ADD CONSTRAINT "eng_review_quote_item_id_quote_item_id_fk" FOREIGN KEY ("quote_item_id") REFERENCES "public"."quote_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capacity_evidence_quote_item_idx" ON "capacity_evidence" USING btree ("quote_item_id");--> statement-breakpoint
CREATE INDEX "eng_review_quote_idx" ON "eng_review" USING btree ("quote_id");--> statement-breakpoint
--
-- The settings (provisional, D-005 open). The config seed inserts the same values on a fresh database;
-- here they reach environments that already have config. ON CONFLICT: an existing row is left alone.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, v.key, v.value::jsonb, v.description, true
FROM (VALUES
  ('quote_items_max', '20', 'FB-19 (W13-32, D-005 open): the most items one quote may hold. Checked on every draft save and at submit. Provisional.'),
  ('opportunity_active_quotes', '"warn"', 'FB-19 (W13-33, D-005 open): may an opportunity have more than one active quote? one = no (409, as before FB-19); warn = yes, after the KAM confirms the warning that names the open quote (a KAM may put hot items in a separate quote). Provisional.'),
  ('opportunity_active_quote_message', '"{quoteNumber} is already open for this opportunity (KAM: {kamName}). Add these items to it instead if it is still with you, or continue to start a separate quote."', 'FB-19 (W13-33): the warning a KAM sees when starting an intake on an opportunity that already has an active quote ({quoteNumber} and {kamName} are filled in; several open quotes are listed). Provisional wording.')
) AS v(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
--
-- B-07's unique index was the only cross-KAM control on "one active quote per opportunity". The rule is
-- now the setting above, checked at submit in system context under a transaction advisory lock keyed on
-- the opportunity (apps/api/src/services/intake.ts), so the index goes. No column is dropped.
DROP INDEX IF EXISTS "quote_one_active_per_opportunity_uidx";
