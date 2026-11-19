# FB-24 plan: intake (concept requests, item fields first, ship-to, decoration multi-select, files, dropdowns)

Prompt: `docs/build-guide/prompts/feedback/FB-24-intake.md`. Branch `claude/fb-24-intake`, migration
`0051_fb24_intake.sql` (renumbered before review if another step lands one first).

## Decisions taken while Ben was away (conservative, all provisional)

| Question | Choice |
|---|---|
| Ship-to fields | Confirmed by a read-only `describe` on 2026-11-19: `Opportunity_Product_Specifications__c.Ship_To_City__c` (text 255), `Ship_To_State__c` (picklist of full names, e.g. "Texas"), `Shipping_Country__c` (picklist); `Opportunity.Ship_to_Locations__c` (textarea 255, "City, State" by convention, "TBD" when unknown). So `ship_to_sources` is seeded `["product_spec", "account"]`. Which wins when they disagree waits on Zachary Cairns. |
| Lists that keep their order (`meta.keepOrder`) | `drawing_status` (best to worst) and `tooling_payment_terms` (upfront, split, amortized). Every other list reads well A to Z with numeric-aware compare (Net 15 … Net 120, 13 mm … 155 mm, 0 % … 100 %). Waits on Bailey. |
| "Other last" | An entry whose code is `OTHER` or whose meta has `freeText` (Other, Custom, Custom color). |
| Concept assumptions limit | 1,000 characters (prompt). Code constant beside the other intake text limits. |
| Stocking agreement weeks | Whole number 1 to 520 (10 years), only with a Yes. |
| Tooling commitment at intake | Writes `quote.terms_tooling_commitment` (null = not known yet). |
| Quote Attachments tab list | The intake list: everything else (capacity analysis, equipment BOM, models, offer letter) is uploaded or generated elsewhere. |

## Request-class readers (B.5): CONCEPT is CCQ everywhere except the minimum spec

| Place | Change |
|---|---|
| `packages/domain/src/intake/intake.ts` (`evaluateIntake`) | min spec not blocking for `intake_min_spec_exempt_classes`; concept needs a drawing or a sample photo / render and its assumptions |
| `packages/domain/src/intake/config-sources.ts`, `config-admin/settings.ts` | new settings read and validated |
| `packages/db/seeds/config/*`, migration 0051 | `CONCEPT` in `request_class` and `intake_allowed_request_classes` |
| `apps/api/src/services/intake.ts` | stores `concept_assumptions` (cleared for other classes) |
| `apps/api/src/services/intake-facts.ts` | `concept_assumptions` in the stored quote's values (Engineering completeness) |
| `apps/api/src/services/quotes.ts`, `packages/contracts/src/quotes.ts` | `conceptAssumptions` on the quote detail |
| `apps/api/src/services/gateService.ts` | reads `requestClass` only for the audit: no change |
| `apps/api/src/routes/v1/intake.ts` | route description mentions the classes: no behaviour change |
| `apps/web/src/intake/Steps.tsx`, `model.ts` | assumptions field, Concept badge, review |
| `apps/web/src/routes/approvals.tsx` (FB-25's file; wording only) | "may be a redirect" only for a class that cannot be submitted, so a concept is not called a redirect |
| `apps/web/src/routes/quotes/$quoteNumber.tsx` (FB-25's file) | shows the class label; no change |
| `packages/db/src/repos/admin-config.ts` | usage count by class: no change |
| `packages/domain/src/engineering/review.ts` | completeness ignores `REQUEST_CLASS_NOT_ALLOWED`: no change |

## Work split

- Intake (contracts, domain, API service, wizard order, concept, decoration, labels, tooling, stocking,
  red / yellow, flag key, returnable): main session.
- Ship-to sources (integrations, domain picker, wizard pre-fill and the "from …" note).
- Files at intake (`attachment_kinds_by_place`, server 422, one "Add file" control).
- Dropdowns A to Z (read order, comparator) and the offer letter's concept sentence.
