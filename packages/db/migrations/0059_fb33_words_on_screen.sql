-- FB-33 (N19-20, N19-21, N19-13 example): words on screen. Data only: no schema object is created,
-- changed or dropped, nothing is truncated, no jsonb or array column is added. Synthetic data only.
-- Config follows 0044 / 0046 / 0051: a row the business approved (approved_at set) or an Admin edited (it no
-- longer holds the previous seed text) is left alone. On a fresh database the config tables are empty here:
-- each statement is a no-op and the seed inserts the same words. Every statement is safe to re-run.
--
-- 1. N19-20: the request class "CCQ" spells the name out (Sarah Brennan, Oleg Yarovinski, Darren Miller).
--    The code CCQ, the quote numbers and the group names are not touched.
UPDATE "value_list"
  SET "label" = 'Commercial Capital Quote (CCQ): new business that needs engineering or capital',
      "updated_at" = now(), "version" = "version" + 1
  WHERE "list_key" = 'request_class' AND "code" = 'CCQ' AND "approved_at" IS NULL
    AND "label" = 'CCQ (new business + capital/engineering)';--> statement-breakpoint
--
-- 2. N19-21: Stock and stock-plus are handled in Salesforce. The price inquiry and pack-out half keeps
--    "pricing application" (Darren's note does not cover it; question to Bailey and Darren in the PR).
UPDATE "app_setting"
  SET "value" = to_jsonb('Stock and stock-plus requests are handled in Salesforce. Price inquiries and pack-out evaluations stay in the pricing application for now. Submit each one where it is handled.'::text),
      "version" = "version" + 1, "updated_at" = now()
  WHERE "key" = 'intake_redirect_message' AND "approved_at" IS NULL
    AND "value" = to_jsonb('Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application for now. Submit them there.'::text);--> statement-breakpoint
UPDATE "app_setting"
  SET "value" = jsonb_set("value", '{request_class}', to_jsonb('Commercial Capital Quote (CCQ) is new business that needs engineering or capital. Concept / innovation is CCQ work that starts from a render or a photo instead of a drawing. Stock and stock-plus are handled in Salesforce. Price inquiries and pack-out evaluations stay in the pricing application.'::text)),
      "version" = "version" + 1, "updated_at" = now()
  WHERE "key" = 'intake_field_help' AND "approved_at" IS NULL AND jsonb_typeof("value") = 'object'
    AND "value" ->> 'request_class' = 'CCQ is new business that needs engineering or capital. Concept / innovation is CCQ work that starts from a render or a photo instead of a drawing. Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application.';--> statement-breakpoint
UPDATE "app_setting"
  SET "value" = jsonb_set("value", '{sf_opportunity_id}', to_jsonb('Every Commercial Capital Quote (CCQ) starts from a Salesforce opportunity, so pipeline and outcomes stay linked.'::text)),
      "version" = "version" + 1, "updated_at" = now()
  WHERE "key" = 'intake_field_help' AND "approved_at" IS NULL AND jsonb_typeof("value") = 'object'
    AND "value" ->> 'sf_opportunity_id' = 'Every CCQ quote starts from a Salesforce opportunity, so pipeline and outcomes stay linked.';--> statement-breakpoint
--
-- 3. N19-13 (the example only): the variants help no longer suggests a site scenario. Who proposes site
--    alternatives is not decided (it needs Jim Zweifel); the field, its limit and its owner are unchanged.
UPDATE "app_setting"
  SET "value" = jsonb_set("value", '{quote_variants_note}', to_jsonb('Variants the customer wants priced, e.g. "0, 25 and 50% PCR". Optional.'::text)),
      "version" = "version" + 1, "updated_at" = now()
  WHERE "key" = 'intake_field_help' AND "approved_at" IS NULL AND jsonb_typeof("value") = 'object'
    AND "value" ->> 'quote_variants_note' = 'Variants the customer wants priced, e.g. "0/25/50% PCR; near-site vs ideal-site". Optional.';--> statement-breakpoint
--
-- 4. N19-21: the G1 "not CCQ work" help names Salesforce for stock and stock-plus. This table, not
--    app_setting, holds the outcome help (seeded from workflow/seeds/outcome-help.ts).
UPDATE "gate_outcome_definition"
  SET "help_text" = 'Not CCQ work (stock or stock-plus, which are handled in Salesforce; a price inquiry; capital not tied to a quote). It closes as Redirected so it can take its own path.',
      "updated_at" = now()
  WHERE "gate_key" = 'G1' AND "key" = 'redirect' AND "approved_at" IS NULL
    AND "help_text" = 'Not CCQ work (stock, stock-plus, a price inquiry, capital not tied to a quote). It closes as Redirected so it can take its own path.';
