ALTER TABLE "value_list" DROP CONSTRAINT "value_list_list_key_check";--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "requested_payment_terms" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "requested_payment_terms_other" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "returnable_dunnage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "price_basis" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "freight_type" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "freight_special_arrangements" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "bid_reference" text;--> statement-breakpoint
ALTER TABLE "value_list" ADD CONSTRAINT "value_list_list_key_check" CHECK ("value_list"."list_key" in ('product_family', 'market', 'resin', 'component', 'process_type', 'machine_type', 'plant', 'request_class', 'drawing_status', 'neck_finish', 'packaging_type', 'tooling_funding_model', 'neck_diameter', 'neck_finish_type', 'neck_special_feature', 'pcr_level', 'color_type', 'labels_purchased_by', 'decoration_type', 'requested_payment_terms', 'price_basis', 'freight_type'));--> statement-breakpoint
-- FB-11 (Intake commercial inputs: payment terms, customer funding, dunnage, delivery and freight, bid
-- reference). Tracker: F-080, F-063 (dunnage only), F-085; decision D-032 (Nov 6, Gemma Cebolla and Bailey
-- Schmitt). Schema: seven nullable text / boolean columns on "quote" (the customer-funding answer reuses
-- "tooling_funding_model"). Data: three value lists, one new funding value, the standard payment terms
-- setting and the "why we ask" help text. Everything is provisional (D-006 is open; A-012 was decided Nov 9: Net 15 and Net 30 are standard). Nothing
-- becomes required. An admin's own rows and help text are kept.

INSERT INTO "value_list" ("id", "list_key", "code", "label", "sort", "active", "meta", "provisional")
SELECT
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.list_key, v.code, v.label, v.sort, true, v.meta::jsonb, true
FROM (VALUES
  ('requested_payment_terms', 'NET_15', 'Net 15', 10, '{}'),
  ('requested_payment_terms', 'NET_30', 'Net 30', 20, '{}'),
  ('requested_payment_terms', 'NET_45', 'Net 45', 30, '{}'),
  ('requested_payment_terms', 'NET_60', 'Net 60', 40, '{}'),
  ('requested_payment_terms', 'NET_90', 'Net 90', 50, '{}'),
  ('requested_payment_terms', 'NET_120', 'Net 120', 60, '{}'),
  ('requested_payment_terms', 'OTHER', 'Other', 70, '{"freeText":true}'),
  ('price_basis', 'FOB_PLANT', 'FOB Pretium plant', 10, '{}'),
  ('price_basis', 'DELIVERED', 'Delivered', 20, '{"delivered":true}'),
  ('freight_type', 'FLATBED', 'Flatbed', 10, '{}'),
  ('freight_type', 'VAN', 'Van', 20, '{}'),
  ('freight_type', 'DROP_TRAILER', 'Drop trailer', 30, '{}'),
  ('freight_type', 'T_BAR', 'T-bar', 40, '{}'),
  ('freight_type', 'OTHER', 'Other', 50, '{}'),
  ('tooling_funding_model', 'NOT_DISCUSSED', 'Not discussed', 60, '{"helpText":"The customer has not said whether it will pay for any of the tooling or capital. Leave this if it has not come up; you can change it later on the Commercial panel.","defaultAtIntake":true}')
) AS v(list_key, code, label, sort, meta)
ON CONFLICT ("list_key", "code") DO NOTHING;--> statement-breakpoint

-- The sales-tax hint shows when the customer funds, shares, reimburses ($0 CER) or amortizes the tooling.
UPDATE "value_list"
  SET "meta" = "meta" || '{"taxHint":true}'::jsonb, "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'tooling_funding_model'
    AND "code" IN ('CUSTOMER_FUNDED', 'ZERO_CER', 'AMORTIZED', 'SHARED')
    AND NOT ("meta" ? 'taxHint');--> statement-breakpoint

INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
VALUES (
  encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  'standard_payment_terms',
  '["NET_15","NET_30"]'::jsonb,
  'FB-11 (F-080, D-032, A-012 decided Nov 9): the requested_payment_terms codes that count as standard. Any other request is flagged "Non-standard: Pricing will review" on the intake and the quote. Net 15 and Net 30 are both standard (Gemma Cebolla, Nov 9); still marked provisional until an Admin approves it.',
  true
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

UPDATE "app_setting" SET "value" = jsonb_build_object(
  'requested_payment_terms', 'The payment terms the customer asks for. The standard is Net 15 or Net 30; a longer request is a negotiation point because Pretium carries the cost, so Pricing needs to know. It does not change the costing.',
  'requested_payment_terms_other', 'Describe the terms the customer asked for.',
  'tooling_funding_model', 'Only whether the customer pays for any of the tooling or capital. The amount and how it is paid belong to the terms later.',
  'tooling_funding_tax_hint', 'If the customer owns the tool it is not Pretium capital, and sales tax and contract terms apply. Tax will want to know.',
  'returnable_dunnage', '"Multi-trip" dunnage comes back to Pretium; "single-trip" ships out and the customer is charged for it. Leave unticked for single-trip.',
  'price_basis', 'Delivered or FOB Pretium plant. A delivered price carries freight, which was missed in costing before.',
  'freight_type', 'How it ships when the price is delivered. Drop trailers and T-bars add real cost: say so below.',
  'freight_special_arrangements', 'Anything unusual about the freight. A drop trailer sits for about two weeks and T-bars are very expensive, so name them here if the customer expects them.',
  'bid_reference', 'The customer’s bid, RFP or program name or number, if it has one. A plain reference: it does not link quotes.'
) || "value", "updated_at" = now()
WHERE "key" = 'intake_field_help' AND jsonb_typeof("value") = 'object';
