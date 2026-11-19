# FB-33 · Words on screen: Commercial Capital Quote spelled out, Stock and Stock-Plus are Salesforce, the credit-check line, the variants example

**Run with:** Claude Code · **Sonnet 5.5** · **high** effort · **Wave 2** (start when FB-28 and FB-31 have merged: you edit `settings.ts` and a value list beside FB-31) · one draft PR · branch `claude/fb-33-words-on-screen`
**Ports:** Postgres `5446` · `E2E_PORT=3160` `E2E_DEV_API_PORT=3161` `E2E_WEB_PORT=4186` · **Migration:** `0059_fb33_words_on_screen.sql`, journal `when` **1795150000006**. If FB-32 added no migration, the orchestrator will tell you to use `0058` and `1795150000005`; in any case recompute from `origin/main` per the ground rules.
**Feedback items:** N19-20, N19-21, N19-22 and the example in N19-13 (`docs/build-guide/feedback/inputs/feedback-2026-11-19.md`) · **Tracker rows it follows:** FB-15 and FB-24 (intake wording), FB-04 (request-class redirects)

---

## Stop check
1. Follow `docs/build-guide/prompts/feedback/FB-28-to-33-ground-rules.md` in full.
2. **The asks (from Darren Miller's demo notes and an AI summary of 2026-11-19; paraphrased):**
   - **N19-20.** Keep the name CCQ, and **spell it out as Commercial Capital Quote** (Sarah Brennan agreed, Oleg Yarovinski: "send it", Darren: "I would recommend spelling it out"). The "Request Class" line of Darren's notes says the same.
   - **N19-21.** Stock and Stock-Plus requests are **not "the pricing app"**: say **Salesforce**.
   - **N19-22.** "Credit check: this is actually a buttoned-up process via new customer creation." Darren's note is about how the demo describes it; **nothing in the code says "credit check"** (verified by search on 2026-11-19; re-verify).
   - **N19-13 (the example only).** Sarah said a KAM should not have to request a "near site vs ideal site" scenario: Engineering and capacity evaluate the production options. The design (who proposes site alternatives, and how they become quote variants) is **not decided** and needs Jim Zweifel; this step only stops the KAM's note suggesting it.
3. **Words are config or code, and the rule is the same as for everything: plain, short, in the words the people used.** Value-list labels, help text and redirect messages are config seeded provisional and changed in existing environments by a **guarded migration** (approved or Admin-edited rows left alone; follow `0044_fb15_intake_fixes.sql` and `0051_fb24_intake.sql`, which changes help text only `WHERE value->>… = <the old seed text>`). Button labels and headings are code.
4. **Do not change what is not asked.** Quote numbers stay `CCQ-YYYY-NNNNN`. The Entra group name `SG-CCQ`, the Admin ERF-linkage report and its "CCQ ERF #" column, the window title "QuoteFlow", and the legacy "ERF" wording (it is correct for the legacy record) stay as they are. "Pricing application" stays where the text really is about pricing history or the retired pricing app (`PricingContextPanel.tsx`, `QuotingTab.tsx` ~671, the pricing-history import): only the Stock and Stock-Plus sentences change.
5. **You own:** the request-class entries in `packages/db/seeds/config/value-lists.ts` (~152-155), the request-class help and redirect texts in `packages/db/seeds/config/settings.ts` (~154 and ~198), `packages/domain/src/workflow/seeds/outcome-help.ts` (~24; seeded into `gate_outcome_definition.help_text`, `hybrid.ts` ~253, so a change reaches existing environments only through a guarded `UPDATE` on that table, `approved_at IS NULL`, as 0046 does, not through `app_setting`), `apps/web/src/routes/intake/new.tsx` (~749 and ~960), `apps/api/src/services/intake.ts` (~661, ~827 and ~1299: "already has an active CCQ quote", probably what `draft.openQuotes.warning` shows), `packages/domain/src/outcome/sf-stage.ts` (~60), the picker help in `settings.ts` (~190), the variants-note help `intake_field_help.quote_variants_note` (`settings.ts` ~241-242, seeded by migration 0028 ~194, which says "near-site vs ideal-site"; a seed change plus a guarded migration) and the comment at `packages/contracts/src/intake.ts` (~269), `apps/web/src/intake/OpportunityPicker.tsx` (the one line ~108), the variants-note placeholder in `apps/web/src/intake/Steps.tsx` (~2106-2123), the new-customer help text, migration 0059, and the UAT scripts, quick-starts and in-app help that carry these words (including the "What changed from the ERF" headings, which are about the ERF and stay). **Running beside you:** FB-29, FB-30 (neither touches these), FB-32 (the prefill part of `intake/model.ts` and `Steps.tsx` ~275-700; the picker component apart from the one line above).

## What the code does today (read 2026-11-19 at `c9ea359`; verify before relying on it)
- **CCQ on screen.** Request-class label "CCQ (new business + capital/engineering)" (`value-lists.ts` ~152); the intake submit button "Submit to CCQ" (`routes/intake/new.tsx` ~960); the active-quote message "…already has an active CCQ quote…" (~749); the picker line "Every CCQ quote starts from a Salesforce opportunity" (`OpportunityPicker.tsx` ~108); "SG-CCQ group" (`auth/pages.tsx` ~132, a group name); "CCQ ERF #" in the Admin ERF-linkage report (`erf-linkage.tsx` ~51); `index.html` title "QuoteFlow". Offer letter and emails: no "CCQ" strings found (re-check). Search the whole of `apps/web/src`, `apps/api/src`, `packages/domain/src`, `packages/contracts/src`, the seeds, migrations (for seeded help text) and `docs/uat` for others.
- **Stock and Stock-Plus.** Request class "Stock / stock-plus" (`value-lists.ts` ~155). Help text (`settings.ts` ~198; set by migration 0051 ~116): "…Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application." Redirect message (`settings.ts` ~154): "…stay in the pricing application for now. Submit them there." `outcome-help.ts` ~24 **never says "pricing application" and names no place**: saying Stock and Stock-Plus are in Salesforce there would be new text, not a correction; add it only if it helps a user at that screen. `INTAKE_ALLOWED_REQUEST_CLASSES` is `['CCQ','CONCEPT']` (`settings.ts` ~110); the other classes are redirected.
- **Credit check.** No "credit check" text in the code, help or emails. The "Not yet a Pretium customer (no ERP account)" tick box triggers the new-customer Legal review (`legal_review_triggers.newCustomer`); it is the only new-customer path on the intake.
- **Variants note.** `quote.quote_variants_note` (KAM-owned, `intake_variants_note_max_length`, default 300); placeholder "e.g. price at 0/25/50% PCR; near-site vs ideal-site" (`Steps.tsx` ~2106-2123). Engineering sets the plant (`plant_code`, DF-10); a KAM cannot request a production site.

## Build

### A. Commercial Capital Quote (N19-20)
Spell it out where the term is introduced or named for a user, and keep the short form where it is a name: the request-class label becomes "Commercial Capital Quote (CCQ): new business that needs engineering or capital" (your wording may be shorter; one line; it is config, so a guarded migration changes it only where unedited); the intake's submit button and active-quote message; the picker line; the first mention on each help, quick-start and UAT page. Do **not** write the long form in every sentence, in quote numbers, in table headings or in a button that already says "Submit". Decide with one rule, apply it everywhere, and write the rule in the PR.

### B. Stock and Stock-Plus are in Salesforce (N19-21)
Change the request-class help, the redirect message and `outcome-help.ts` so that **Stock and Stock-Plus** say they are handled in **Salesforce**. Leave the sentence about price inquiries and pack-out evaluations as it is (Darren's note does not cover them): split the sentence so each part says its own place, and list the unchanged half as a question. The class label "Stock / stock-plus" stays unless Darren's note requires a change (it does not). By guarded migration, only where the text still equals the old seed.

### C. The credit-check line (N19-22)
1. Search once more for any text that says or implies QuoteFlow does a credit check or credit approval (help, notices, the Legal-review reasons, emails, the quick-starts, the walkthrough). If one exists, reword it to say credit is handled in the new-customer set-up process, not in QuoteFlow.
2. If none exists, **add nothing to the screens.** Instead put a one-sentence proposal for the "Not yet a Pretium customer" help text (or for the Admin setting `customer_master_data_notice`, which `CustomerDecision.tsx` ~254 already shows for not-yet-established customers and is a possible home) in the PR ("A credit review happens when the customer is set up, not in QuoteFlow."), marked as unverified wording that Bailey Schmitt and Darren must confirm, and do not ship it.

### D. The variants example (N19-13, example only)
Change the placeholder to an example that is about the product only (for example "e.g. price at 0, 25 and 50% PCR"). Do not remove the field, add a field, or tell the KAM anything about site selection beyond the existing rule. If the field's label or help mentions sites, change only that.

### E. A word-check, once
`grep` the whole repo (app, seeds, docs/uat, the generated help) for each string you changed so none is left behind in a test, a seed, an e2e assertion, a quick-start or the printed help. Change a test only because the words it checks were deliberately changed, and list each.

## Out of scope
The site-alternatives design (needs Jim and a decision); renaming the stage "Engineering & Capacity"; renaming quote numbers or the Entra group; any change to who may submit which request class; the offer letter's wording (Legal owns it); stock pricing as a future use of the app (N19-24).

## Tests
Unit: the migration's guarded updates (a configured, an Admin-edited and an empty database; the upgrade path per the ground rules). Web: a component test or two for the intake button and the active-quote message. Playwright: the changed request-class label on intake, the redirect message for a Stock request, the new placeholder; update only the specs that assert the old words, and list them; 1366 × 768 and 390 px, light and dark, axe (a longer label must still fit at 320 px with no sideways scroll). Regenerate the in-app help (`UPDATE_QUICKSTART=1 pnpm --filter @ccq/web test`).

## Questions to put to Bailey and Darren (draft them; send nothing)
1. Price inquiries and pack-out evaluations: are they also in Salesforce, or in the pricing application?
2. Is the long form wanted in the request-class label, the button and the help only (as built), or everywhere?
3. The credit-check sentence for the new-customer help (C.2): is it right, and who should it name?
4. Site alternatives (Sarah): who proposes them and how do they become quote variants? That needs Jim Zweifel.

## Done when
- [ ] Commercial Capital Quote spelled out under one stated rule, quote numbers and group names untouched
- [ ] Stock and Stock-Plus text says Salesforce; the price-inquiry and pack-out half unchanged and raised as a question
- [ ] no credit-check text added without confirmation; the proposal is in the PR (or the offending text reworded)
- [ ] the variants placeholder no longer suggests site selection
- [ ] guarded migration 0059; the word-check done; help, UAT scripts and quick-starts regenerated; `pnpm verify` passes; close-out file written (ground rules)
