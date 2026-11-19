ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permission_check";--> statement-breakpoint
ALTER TABLE "gate_definition" DROP CONSTRAINT "gate_definition_decider_permission_check";--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_kind_check";--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_version_check";--> statement-breakpoint
ALTER TABLE "terms_exception_request" ADD COLUMN "approver_permission" text;--> statement-breakpoint
ALTER TABLE "terms_exception_request" ADD COLUMN "document_required" boolean;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_check" CHECK ("role_permission"."permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'payback.request', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'quote.requote', 'outcome.assignOwner', 'handoff.edit', 'offer.read', 'offer.generate', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'terms.exception.decide.senior', 'capitalFlag.edit', 'capacity.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "gate_definition" ADD CONSTRAINT "gate_definition_decider_permission_check" CHECK ("gate_definition"."decider_permission" in ('quote.create', 'quote.read', 'quote.read.commercialFields', 'gate.G1.decide', 'engQueue.read', 'queue.assign', 'engReview.edit', 'gate.G2.decide', 'pricingQueue.read', 'pricingQueue.assign', 'quoting.edit', 'gate.G3.submit', 'roi.upload', 'payback.request', 'finalReview.read', 'gate.G4.decide', 'finalReview.signoff', 'outcome.record', 'quote.requote', 'outcome.assignOwner', 'handoff.edit', 'offer.read', 'offer.generate', 'gate.G6.decide', 'terms.edit', 'terms.engineering.edit', 'terms.finalize', 'terms.exception.decide', 'terms.exception.decide.senior', 'capitalFlag.edit', 'capacity.edit', 'capacity.signoff', 'quote.escalate', 'override.request', 'override.approve', 'override.revert', 'overrideLog.read', 'audit.read', 'attachment.upload', 'attachment.removeAny', 'export.csv', 'analytics.read', 'config.read', 'config.manage', 'feedback.submit', 'feedback.triage'));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_kind_check" CHECK ("attachment"."kind" in ('bottle_drawing', 'spec', 'sample_photo', 'capacity_analysis', 'other', 'bid_file', 'project_brief', 'competitor_drawing', 'cost_model', 'roi_model', 'price_table', 'equipment_bom', 'offer_letter', 'cer_proof', 'payment_terms_approval'));--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_version_check" CHECK (("attachment"."version" is null) = ("attachment"."kind" not in ('cost_model', 'roi_model', 'price_table', 'equipment_bom', 'cer_proof', 'payment_terms_approval')) and ("attachment"."version" is null or "attachment"."version" >= 1));--> statement-breakpoint
ALTER TABLE "terms_exception_request" ADD CONSTRAINT "terms_exception_request_approver_permission_check" CHECK ("terms_exception_request"."approver_permission" is null or "terms_exception_request"."approver_permission" in ('terms.exception.decide', 'terms.exception.decide.senior'));--> statement-breakpoint
-- FB-31 (N19-07, N19-08, N19-10): data. Config follows 0044 / 0049 / 0051 / 0054: a row the business
-- approved (approved_at set) or an Admin edited (it no longer holds the previous seed) is left alone. On a
-- fresh database the config tables are empty here: each statement is a no-op and the seed inserts the
-- same values. Every statement is safe to re-run. No schema object is dropped; nothing is truncated.
--
-- 1. N19-07: terms.exception.decide.senior for Leadership (the CFO stand-in; policy/matrix.ts is the
-- control, role_permission mirrors it). Provisional.
INSERT INTO "role_permission" ("id", "role", "permission", "qualifier", "provisional")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid,
  v.role, v.permission, v.qualifier::jsonb, true
FROM (VALUES
  ('Leadership', 'terms.exception.decide.senior', NULL)
) AS v(role, permission, qualifier)
WHERE EXISTS (SELECT 1 FROM "role_permission")
ON CONFLICT ("role", "permission") DO NOTHING;--> statement-breakpoint
--
-- 2. N19-07: who approves which payment terms. A PROVISIONAL GUESS, NOT POLICY (Sarah Brennan and Oleg
-- Yarovinski have not set thresholds): Net 45 the pricing lead; Net 60, 90, 120 and Other Leadership, with
-- a supporting document. ON CONFLICT: an existing row is left alone.
INSERT INTO "app_setting" ("id", "key", "value", "description", "provisional")
SELECT encode(
    set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
      FROM 1 FOR 6), 52, 1), 53, 1),
    'hex')::uuid, s.key, s.value::jsonb, s.description, true
FROM (VALUES
  ('terms_exception_routes', '[{"codes":["NET_45"],"approverPermission":"terms.exception.decide","approverLabel":"the pricing lead","documentRequired":false},{"codes":["NET_60","NET_90","NET_120","OTHER"],"approverPermission":"terms.exception.decide.senior","approverLabel":"Leadership","documentRequired":true}]',
   'FB-31 (N19-07): who approves non-standard payment terms. An ordered list of tiers: codes (requested_payment_terms codes), approverPermission (terms.exception.decide: the pricing lead; terms.exception.decide.senior: Leadership, standing in for the CFO until a CFO role exists), approverLabel (what the screens call them) and documentRequired (approving also needs a Payment-terms approval document on the quote). A non-standard code no tier lists goes to the first tier. A request keeps the tier it opened with. PROVISIONAL GUESS, NOT POLICY: Sarah Brennan and Oleg Yarovinski have not set the thresholds or approvers yet; this seed (Net 45: the pricing lead; Net 60, Net 90, Net 120 and Other: Leadership with a document) exists so the mechanism can be shown.')
) AS s(key, value, description)
WHERE EXISTS (SELECT 1 FROM "app_setting")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
--
-- 3. N19-07: the exceptions pending now are routed from the then-current terms_exception_routes (the first
-- tier listing the code, else the first tier), as a new request would be. OPEN REQUESTS FOR NET 60 AND
-- ABOVE NOW WAIT FOR LEADERSHIP under the seed. No notification is back-filled. Decided, withdrawn and
-- superseded requests keep null (decided under the pricing lead, before FB-31).
UPDATE "terms_exception_request" AS r
SET ("approver_permission", "document_required") = (
    SELECT t.tier ->> 'approverPermission', COALESCE((t.tier ->> 'documentRequired')::boolean, false)
    FROM "app_setting" s, jsonb_array_elements(s."value") WITH ORDINALITY AS t(tier, n)
    WHERE s."key" = 'terms_exception_routes'
    ORDER BY (t.tier -> 'codes') ? r."payment_terms_code" DESC, t.n
    LIMIT 1),
  "updated_at" = now()
WHERE r."status" = 'pending' AND r."approver_permission" IS NULL
  AND EXISTS (SELECT 1 FROM "app_setting" s WHERE s."key" = 'terms_exception_routes'
    AND jsonb_typeof(s."value") = 'array' AND jsonb_array_length(s."value") > 0);--> statement-breakpoint
--
-- 4. N19-08: four plain funding choices. Relabelled only where the label is still the earlier seed and
-- nobody approved the entry; the help text only where it is still the earlier seed text.
UPDATE "value_list" AS vl
  SET "label" = v.label, "version" = vl."version" + 1, "updated_at" = now()
  FROM (VALUES
    ('CUSTOMER_FUNDED', 'Customer-funded', 'Customer funded (lump sum)'),
    ('AMORTIZED', 'Amortized', 'Customer funded (amortized)'),
    ('COMPANY_FUNDED', 'Company-funded', 'Pretium funded'),
    ('NOT_DISCUSSED', 'Not discussed', 'To be determined')
  ) AS v(code, old_label, label)
  WHERE vl."list_key" = 'tooling_funding_model' AND vl."code" = v.code
    AND vl."approved_at" IS NULL AND vl."label" = v.old_label;--> statement-breakpoint
UPDATE "value_list" AS vl
  SET "meta" = vl."meta" || jsonb_build_object('helpText', v.help), "version" = vl."version" + 1, "updated_at" = now()
  FROM (VALUES
    ('CUSTOMER_FUNDED', 'The customer pays for the tooling up front.', 'The customer pays the tooling cost as a lump sum.'),
    ('AMORTIZED', 'The customer pays for the tooling over time: its cost is spread across an agreed volume and added to the piece price, instead of being paid up front.', 'Pretium pays for the tooling and recovers it in the piece price over time. This is an exception: finance reviews it before the offer goes out.'),
    ('COMPANY_FUNDED', 'Pretium pays for the tooling.', 'Pretium pays for the tooling and carries the cost.'),
    ('NOT_DISCUSSED', 'The customer has not said whether it will pay for any of the tooling or capital. Leave this if it has not come up; you can change it later on the Commercial panel.', 'Not agreed yet. This must be answered before Final Review.')
  ) AS v(code, old_help, help)
  WHERE vl."list_key" = 'tooling_funding_model' AND vl."code" = v.code
    AND vl."approved_at" IS NULL AND vl."meta" ->> 'helpText' = v.old_help;--> statement-breakpoint
-- Amortization is an accommodation that needs finance review (Sarah Brennan): the list flag.
UPDATE "value_list"
  SET "meta" = "meta" || '{"requiresFinanceReview":true}'::jsonb, "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'tooling_funding_model' AND "code" = 'AMORTIZED' AND "approved_at" IS NULL
    AND NOT ("meta" ? 'requiresFinanceReview');--> statement-breakpoint
-- $0 CER and Shared: no longer offered for new choices (a guess from "unnecessarily complicated" and
-- Darren Miller's four-item list; Bailey Schmitt confirms). Kept, so old quotes still read and print; an
-- Admin can reactivate them in the list editor. Only an unapproved entry with its seeded label.
UPDATE "value_list" AS vl
  SET "active" = false, "version" = vl."version" + 1, "updated_at" = now()
  FROM (VALUES
    ('ZERO_CER', '$0 CER (customer-reimbursed capital)'),
    ('SHARED', 'Shared (company and customer)')
  ) AS v(code, label)
  WHERE vl."list_key" = 'tooling_funding_model' AND vl."code" = v.code
    AND vl."approved_at" IS NULL AND vl."active" AND vl."label" = v.label;--> statement-breakpoint
--
-- 5. N19-08: amortized tooling needs a finance-review sign-off at Final Review (Leadership, provisional),
-- switched on. Added only where g4_additional_approvals still holds FB-08's seed (0038).
UPDATE "app_setting"
  SET "value" = jsonb_set("value", '{rules}', ("value" -> 'rules') || '[{"key":"amortized_finance_review","label":"Customer funded (amortized): finance review","active":true,"when":{"fundingModels":["AMORTIZED"]},"signoffs":[{"key":"finance_review","label":"Finance review (Leadership)","roles":["Leadership"],"userIds":[]}]}]'::jsonb),
      "updated_at" = now()
  WHERE "key" = 'g4_additional_approvals' AND "approved_at" IS NULL
    AND "value" = '{"rules":[{"key":"customer_funded_capital","label":"Customer-funded capital: sales leader, then leadership","active":false,"when":{"fundingModels":["CUSTOMER_FUNDED","ZERO_CER"]},"signoffs":[{"key":"sales_leader","label":"Sales leader","roles":["SalesLeader"],"userIds":[]},{"key":"leadership","label":"Leadership","roles":["Leadership"],"userIds":[]}]}]}'::jsonb;--> statement-breakpoint
UPDATE "app_setting"
  SET "description" = 'FB-08 (F-082, D-002, A-035 open): extra Final Review sign-offs before the approver may release the offer, by funding model, in order. Seeded with the Nov 9 proposal (customer-funded or $0 CER: the sales leader, then leadership) switched OFF (active: false); set it active only once Oleg and Sarah confirm it (A-035). FB-31 (N19-08, provisional): amortized tooling ("Customer funded (amortized)") needs a finance review, switched ON: Leadership signs off, standing in until Finance holds an approval permission. Signers need finalReview.signoff (SalesLeader, Leadership).',
      "updated_at" = now()
  WHERE "key" = 'g4_additional_approvals' AND "approved_at" IS NULL
    AND "description" = 'FB-08 (F-082, D-002, A-035 open): extra Final Review sign-offs before the approver may release the offer, by funding model, in order. Seeded with the Nov 9 proposal (customer-funded or $0 CER: the sales leader, then leadership) switched OFF (active: false). Set active: true only once Oleg and Sarah confirm it (A-035). Signers need finalReview.signoff (SalesLeader, Leadership).';--> statement-breakpoint
--
-- 6. N19-07: descriptions that named the pricing lead as the only decider, where unedited.
UPDATE "app_setting"
  SET "description" = replace("description",
      'terms_exception: non-standard payment terms need the pricing lead to approve the exception',
      'terms_exception: non-standard payment terms need the approver their tier of terms_exception_routes names (FB-31) to approve the exception'),
      "updated_at" = now()
  WHERE "key" = 'g4_required_checks' AND "approved_at" IS NULL
    AND "description" = 'FB-01 (F-069) and FB-08 (D-003 provisional): which checks block G4 Advance (release the offer). terms_checked: the Sales / Pricing terms check. legal_review: the Legal review, when a legal_review_triggers trigger applies. terms_exception: non-standard payment terms need the pricing lead to approve the exception (a pending or rejected one blocks). terms_finalized: the approver confirmed the capital terms. tooling_commitment_answered (FB-25, N17-26): the customer tooling commitment is answered yes or no (the KAM may answer it at intake). A check not listed shows to the approver as a warning, and the G4 decision records that they saw it. Seed: terms_exception, terms_finalized and tooling_commitment_answered.';--> statement-breakpoint
UPDATE "app_setting"
  SET "description" = 'FB-11 (F-080, D-032, A-012 decided Nov 9): the requested_payment_terms codes that count as standard. Any other request is flagged non-standard on the intake and the quote, with who must approve it (terms_exception_routes, FB-31). Net 15 and Net 30 are both standard (Gemma Cebolla, Nov 9); still marked provisional until an Admin approves it.',
      "updated_at" = now()
  WHERE "key" = 'standard_payment_terms' AND "approved_at" IS NULL
    AND "description" = 'FB-11 (F-080, D-032, A-012 decided Nov 9): the requested_payment_terms codes that count as standard. Any other request is flagged "Non-standard: Pricing will review" on the intake and the quote. Net 15 and Net 30 are both standard (Gemma Cebolla, Nov 9); still marked provisional until an Admin approves it.';--> statement-breakpoint
--
-- 7. N19-10: the stock help text in the contract's words (inventory and safety stock requirements), only
-- while it is still FB-24's text (0051). The column and key names (stock_hold_*) are unchanged.
UPDATE "app_setting" SET "value" = jsonb_set("value", '{stock_hold_requested}', to_jsonb('Inventory and safety stock requirements in the customer’s contract cost Pretium money to hold, so Pricing needs to know. Say for how long if you know.'::text)),
  "updated_at" = now()
WHERE "key" = 'intake_field_help' AND jsonb_typeof("value") = 'object'
  AND "value" ->> 'stock_hold_requested' = 'Holding bottles for a customer for a long time costs Pretium money, so Pricing needs to know. Say for how long if you know.';
