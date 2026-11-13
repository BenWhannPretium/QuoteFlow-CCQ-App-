-- QuoteFlow check-in with Bailey Schmitt (2026-11-12): the "What do the funding options mean?" help listed
-- only $0 CER, Shared and Not discussed. Every option now has a one-line explanation, and the Shared text
-- loses its internal decision code. Data only (value_list.meta.helpText); the lists stay provisional.
-- Safe to re-run: an option that already has help text (an Admin's edit included) is left alone, and the
-- Shared text changes only while it is still the FB-04 seed wording.
UPDATE "value_list"
  SET "meta" = "meta" || jsonb_build_object('helpText', 'Pretium pays for the tooling.'),
      "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'tooling_funding_model' AND "code" = 'COMPANY_FUNDED' AND NOT ("meta" ? 'helpText');--> statement-breakpoint
UPDATE "value_list"
  SET "meta" = "meta" || jsonb_build_object('helpText', 'The customer pays for the tooling up front.'),
      "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'tooling_funding_model' AND "code" = 'CUSTOMER_FUNDED' AND NOT ("meta" ? 'helpText');--> statement-breakpoint
UPDATE "value_list"
  SET "meta" = "meta" || jsonb_build_object('helpText', 'The customer pays for the tooling over time: its cost is spread across an agreed volume and added to the piece price, instead of being paid up front.'),
      "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'tooling_funding_model' AND "code" = 'AMORTIZED' AND NOT ("meta" ? 'helpText');--> statement-breakpoint
UPDATE "value_list"
  SET "meta" = "meta" || jsonb_build_object('helpText', 'Pretium and the customer each pay part. Record the agreed split in the terms notes.'),
      "version" = "version" + 1, "updated_at" = now()
  WHERE "list_key" = 'tooling_funding_model' AND "code" = 'SHARED'
    AND "meta" ->> 'helpText' = 'Split agreed with the customer; record the split in the terms notes until the terms structure is decided (D-003).';
