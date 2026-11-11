# AI dry-run defects: fix log

The fixes for the 74 defects in the five AI dry-run reports of 2026-11-10 (`2026-11-10-*.md` in this folder),
made on 2026-11-11. The fixes are in draft PRs, and none is merged. The reports themselves are unchanged.

The column "How retested" names the check that now passes.

- **Running app:** the step was run against the app started from the fixed branch:
  - the dev API with synthetic data (local Postgres);
  - or the production build served by `vite preview` with a config-only database, which is how the Playwright suite runs.
- **Reproduced first:** a check that was also run on unfixed `main` and failed there, then passed on the branch.
- **Test only:** shown by a new integration or unit test, not by clicking through the app.

Nothing here is "UAT passed". The pilot group's UAT decides.

## Pull requests

| PR | Workstream | DR ids |
|---|---|---|
| [#80](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/80) | 1. Sev-2 | DR-cross-cutting-01, DR-cross-cutting-02, DR-approver-leadership-admin-01, DR-engineering-02, plus DR-kam-sales-leader-06, DR-approver-leadership-admin-13 and DR-cross-cutting-04 (second hold) |
| [#81](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/81) | 2. Plain-language messages | DR-engineering-01, DR-engineering-03, DR-kam-sales-leader-03, DR-pricing-finance-02, DR-pricing-finance-06, DR-approver-leadership-admin-03, DR-approver-leadership-admin-10, DR-cross-cutting-07 |
| [#82](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/82) | 3. Dates and validation | DR-engineering-04, DR-approver-leadership-admin-04, DR-approver-leadership-admin-07, DR-cross-cutting-04 (past date), DR-pricing-finance-16, DR-kam-sales-leader-13 |
| [#84](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/84) | 4. Double submits, uploads, hostile input | DR-engineering-06, DR-engineering-09 (article), DR-pricing-finance-04, DR-pricing-finance-07, DR-pricing-finance-08, DR-cross-cutting-03, DR-cross-cutting-05, DR-cross-cutting-08 |
| [#83](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/83) | 5. Accessibility and mobile | DR-engineering-07, DR-engineering-08, DR-kam-sales-leader-07, DR-kam-sales-leader-08, DR-kam-sales-leader-18, DR-pricing-finance-12, DR-approver-leadership-admin-02, DR-approver-leadership-admin-08, DR-approver-leadership-admin-11, DR-approver-leadership-admin-12, DR-cross-cutting-06, DR-cross-cutting-10, DR-cross-cutting-11 |
| [#86](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/86) | 6. Feedback in the screens | DR-pricing-finance-01, DR-pricing-finance-03, DR-pricing-finance-10, DR-pricing-finance-11, DR-kam-sales-leader-01, DR-kam-sales-leader-02, DR-kam-sales-leader-04, DR-kam-sales-leader-05, DR-approver-leadership-admin-06, DR-approver-leadership-admin-09, DR-approver-leadership-admin-14, DR-engineering-05, DR-cross-cutting-12 |
| [#85](https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/pull/85) | 7. Wording and exports | DR-engineering-09 (dialog), DR-engineering-10, DR-engineering-11, DR-kam-sales-leader-11, DR-kam-sales-leader-12, DR-kam-sales-leader-14, DR-kam-sales-leader-15 (part), DR-kam-sales-leader-16, DR-kam-sales-leader-17, DR-kam-sales-leader-19, DR-pricing-finance-13, DR-pricing-finance-14, DR-pricing-finance-15, DR-approver-leadership-admin-15 |

The PRs are independent of each other, and each is branched from `main`.

**Merge order and conflicts:**
- #80 and #86 both add a migration: `0040` in #80, `0041` in #86. Merge #80 first, or renumber, because both append to `migrations/meta/_journal.json`.
- #85 and #86 both edit `apps/web/e2e/workflow-integrity.spec.ts` (different lines).
- #81, #82, #85 and #86 all edit `GateDecisionDialog.tsx` (different parts). Expect small rebases.

## Status by defect

### Engineering (`2026-11-10-engineering.md`)

| DR id | Status | PR | How retested |
|---|---|---|---|
| DR-engineering-01 | fixed | #81 | Test only: `contracts/messages.test.ts` (cavitation, pack-out, percent and months messages name the limits; no zod wording). Playwright suite (running app) green. |
| DR-engineering-02 | fixed | #80 | Reproduced first: `engineering.int.test.ts` (0% refused, Advance blocked while utilization after is blank). Running app: `engineering.spec.ts` types 0% and sees the refusal on the field. |
| DR-engineering-03 | fixed | #81 | Running app: `engineering.spec.ts` "the G2 dialog names what is missing in words…" (plain list, Record decision disabled with the reason). |
| DR-engineering-04 | fixed | #82 | Test only: `gates.int.test.ts` (past review date gives 422 `/review_date`) and `evaluate.test.ts` (G1, G4 and G5 holds). |
| DR-engineering-05 | fixed | #86 | Test only: `fb06.test.ts` (IMM_PREFORM goes to the PET engineer). Migration `0041` dry-run on the seeded database: 1 row updated, then rolled back. |
| DR-engineering-06 | fixed | #84 | Test only: `timeline.int.test.ts` (concurrent double comment gives one row). Running app: `overrides.spec.ts` double-clicks Comment and sees one comment, also after a reload. |
| DR-engineering-07 | fixed | #83 | Running app: `engineering.spec.ts` (Escape from Assign returns focus to the row's Actions button). |
| DR-engineering-08 | fixed | #83 | Running app: tap targets measured at 390×844 on the engineering queue, the quote and the Engineering tab; `mobile.spec.ts` new checks. |
| DR-engineering-09 | fixed | #84, #85 | Test only: the upload content message ("an Excel workbook"). Dialog placeholder ("Choose an engineer…") by reading the code; no test. |
| DR-engineering-10 | fixed | #85 | Running app: `workflow-integrity.spec.ts` and `g1.spec.ts` see the outcome's own note helper. |
| DR-engineering-11 | fixed | #85 | Test only: `engineering.int.test.ts` (the capacity CSV has "Aurora", not "AURORA"). |
| DR-engineering-12 | needs decision | | The comment sanitiser strips tags silently. Product call: see below. |

### KAM and sales leader (`2026-11-10-kam-sales-leader.md`)

| DR id | Status | PR | How retested |
|---|---|---|---|
| DR-kam-sales-leader-01 | fixed | #86 | Not retested in the app (no spec records an outcome from My proposals). The reminder is kept per quote in the browser until dismissed, and the toast names the Salesforce stage. |
| DR-kam-sales-leader-02 | fixed | #86 | Running app: `outcome.spec.ts` (the G6 reason is pre-filled). Script `kam.md` step 54 updated. |
| DR-kam-sales-leader-03 | fixed | #81 | Test only: `rules.test.ts`, `requirement-labels.test.ts` (labels), `value-label.test.ts` (score explanations show labels). |
| DR-kam-sales-leader-04 | fixed | #86 | Test only: `overrides.test.ts` (a request on a closed quote is not decidable, so it leaves the inbox). The toast shows the API's reason; no test for the toast. |
| DR-kam-sales-leader-05 | fixed | #86 | Test only: `fb12-sub-market.int.test.ts` (a save from an older copy gets 409 `draft_changed`; nothing is overwritten). The wizard's message was not clicked through. |
| DR-kam-sales-leader-06 | fixed | #80 | Reproduced first: `fb12-sub-market.int.test.ts` (retired market `PHARMA_HEALTH` refused). |
| DR-kam-sales-leader-07 | fixed | #83 | Running app: `intake.spec.ts` still finds the buttons by `/^Use /`. Axe on intake step 1 is part of the existing intake spec. |
| DR-kam-sales-leader-08 | fixed | #83 | Running app: tap targets measured at 390×844 (home, quotes, quote page, preferences); `mobile.spec.ts`. |
| DR-kam-sales-leader-09 | needs decision | | Guardrail warning not on the quote page. Product call: see below. |
| DR-kam-sales-leader-10 | not reproducible | | Running app: CCQ-2026-00057 at 390×844 measured 390 px wide, with no element past the viewport. The synthetic data here differs from the dry run's database. |
| DR-kam-sales-leader-11 | fixed | #85 | By reading the code (the field label map). The intake e2e passed; it does not reach this message. |
| DR-kam-sales-leader-12 | fixed | #85 | Integration: the notification suites passed. No test asserts the single full stop. |
| DR-kam-sales-leader-13 | fixed | #82 | Test only: `time.test.ts` (Central with the zone named; CDT, then CST after Nov 1; calendar dates). Running app: `final-review.spec.ts` sees "Valid until Dec 11, 2026". |
| DR-kam-sales-leader-14 | fixed | #85 | By reading the code; the outcome e2e passed. |
| DR-kam-sales-leader-15 | fixed in part | #85 | The Salesforce banner no longer repeats the stage. **"Closed Lost" and "Outcome recorded" are provisional config labels.** Rename them in Admin → Workflow labels (no code change) if the pilot wants "Closed – Lost" and "Record outcome". |
| DR-kam-sales-leader-16 | fixed | #85 | Running app: `g1.spec.ts` (Redirect shows "Say where the work goes instead, and why."). |
| DR-kam-sales-leader-17 | fixed | #85 | Test only: `render.test.ts` (footer text). |
| DR-kam-sales-leader-18 | fixed | #83 | Running app: `intake.spec.ts` ("Fix" focuses the gram-weight field). |
| DR-kam-sales-leader-19 | fixed | #85 | By reading the code; no test opens the review step with a typed resin. |

### Pricing and Finance (`2026-11-10-pricing-finance.md`)

| DR id | Status | PR | How retested |
|---|---|---|---|
| DR-pricing-finance-01 | fixed | #86 | By reading the code. The error is shown under the box and the box is unticked. `pricing.spec.ts` cannot run locally (see below). |
| DR-pricing-finance-02 | fixed | #81 | Test only: `rules.test.ts` (the ROI any-of reads "The ROI model, uploaded by Finance…"); `requirement-labels.test.ts`. |
| DR-pricing-finance-03 | fixed | #86 | Test only: `pricing.int.test.ts` (lead-review status `none` after G3). |
| DR-pricing-finance-04 | fixed | #84 | Test only: `pricing.int.test.ts` (three concurrent submits give 200, 409, 409 and one notice to the lead). |
| DR-pricing-finance-05 | needs decision | | Send-back email repeats the lead's note. See below. |
| DR-pricing-finance-06 | fixed | #81 | Test only: `messages.test.ts` ("Enter 1 to 120 months", "Enter 1 to 240 months", the text-field limit with its name). |
| DR-pricing-finance-07 | fixed | #84 | Test only: `attachments.int.test.ts` (a PDF is refused as the costing model, ROI model or price table). |
| DR-pricing-finance-08 | fixed | #84 | Test only: `attachments.int.test.ts` (`%22` kept as `"`). The wrapping is CSS; the Playwright suite passed. |
| DR-pricing-finance-09 | needs decision | | Finance can comment on any quote. See below. |
| DR-pricing-finance-10 | fixed | #86 | Test only: `pricing.int.test.ts` (the unassigned quote's `submitBlockedReason`). |
| DR-pricing-finance-11 | fixed | #86 | Running app: `quoting-steps.spec.ts` ("Hold or stop…" opens "Hold or stop" without Advance) and `workflow-integrity.spec.ts` ("Return to KAM…"). |
| DR-pricing-finance-12 | fixed | #83 | Running app: tap targets measured at 390×844 (pricing queue, quote page); `mobile.spec.ts`. |
| DR-pricing-finance-13 | fixed | #85 | By reading the code; the quoting-steps e2e passed. |
| DR-pricing-finance-14 | fixed | #85 | By reading the code (the rework banner). |
| DR-pricing-finance-15 | fixed | #85 | Test only: `pipeline.int.test.ts` (labels, no stored codes). The tier was already a label in the CSV; the screen's upper case is CSS. |
| DR-pricing-finance-16 | fixed | #82 | Test only: `pricing.test.ts` (approval before the quote existed is refused). The focus ring is CSS on `:focus`; not measured. |

### Approver, Leadership and Admin (`2026-11-10-approver-leadership-admin.md`)

| DR id | Status | PR | How retested |
|---|---|---|---|
| DR-approver-leadership-admin-01 | fixed | #80 | Reproduced first: `terms-fb08.int.test.ts` (multi-role as KAM, and the approver as price approver: 403; another approver: 200). Running app: `fb08.spec.ts` (multi-role sees the reason, no Confirm, API 403). |
| DR-approver-leadership-admin-02 | fixed | #83 | Running app: `final-review.spec.ts` at 390 px (no decision label clipped). |
| DR-approver-leadership-admin-03 | fixed | #81 | Test only: `requirement-labels.test.ts` and `rules.test.ts` (G4 terms keys have plain labels). |
| DR-approver-leadership-admin-04 | fixed | #82 | Test only: `evaluate.test.ts` (G4 hold with a past date is refused). |
| DR-approver-leadership-admin-05 | needs decision | | Held quote released from `/review`, no Resume. See below. |
| DR-approver-leadership-admin-06 | fixed | #86 | Test only: `audit.int.test.ts` (the "gate decision" filter finds stage-change rows with a gateKey). |
| DR-approver-leadership-admin-07 | fixed | #82 | Running app: `dashboards.spec.ts` (one inline message, no chart request, no toast). |
| DR-approver-leadership-admin-08 | fixed | #83 | Running app: `/admin/settings` measured at 390 px (823 px before, 390 after); `mobile.spec.ts`. |
| DR-approver-leadership-admin-09 | fixed | #86 | By reading the code (the field hint, and the toast saying what a change cleared). |
| DR-approver-leadership-admin-10 | fixed | #81 | Test only: `config-admin.test.ts` (the setting's label, not its key); `messages.test.ts` (months). |
| DR-approver-leadership-admin-11 | fixed | #83 | Running app: `mobile.spec.ts` (usage report region has `tabindex=0`; axe has no serious violation). |
| DR-approver-leadership-admin-12 | fixed | #83 | Running app: tap targets measured at 390×844 (approvals, review, analytics, scoring model). |
| DR-approver-leadership-admin-13 | fixed | #80 | Reproduced first: `outcome.int.test.ts` (stale tab gets 409 "This quote was already decided"). Running app: the API returned the same for a stale-tab approve. |
| DR-approver-leadership-admin-14 | fixed | #86 | By reading the code (`stageLabel` in the preview row). |
| DR-approver-leadership-admin-15 | fixed | #85 | Test only: `pipeline.int.test.ts`. |

### Cross-cutting (`2026-11-10-cross-cutting.md`)

| DR id | Status | PR | How retested |
|---|---|---|---|
| DR-cross-cutting-01 | fixed | #80 | Reproduced first: `outcome.int.test.ts` races at G1–G6. Running app, API on the dev server:<br>• G4, 3 approves + 1 decline at once: one 201 and three 409 "This quote was already decided"; 1 decision, 1 open stage row, one notice per recipient.<br>• G1, 2 holds: 201 + 409.<br>• G1, 3 stops: 201 + 409 + 409. |
| DR-cross-cutting-02 | fixed | #80 | Reproduced first: `fb12-sub-market.int.test.ts` (unknown and retired codes in 7 fields refused at create, save and submit; a rework keeps its retired value). |
| DR-cross-cutting-03 | fixed | #84 | Test only: `dr-input.int.test.ts` (NUL in 8 routes gives 400 `invalid_character`). |
| DR-cross-cutting-04 | fixed | #80, #82 | Running app: a second G1 hold gives 409 "already on hold" (#80). Test only: past review date refused (#82). |
| DR-cross-cutting-05 | fixed | #84 | Test only: `attachments.int.test.ts` (empty file). |
| DR-cross-cutting-06 | fixed | #83 | Running app: `fb08.spec.ts` axe after the exception shows "Approved". |
| DR-cross-cutting-07 | fixed | #81 | Running app: `engineering.spec.ts` (Record decision is disabled with the reason when the outcome would be refused); the G4 labels by unit test. |
| DR-cross-cutting-08 | fixed | #84 | Test only: `dr-input.int.test.ts` (5,000-character path gives a 414 problem without the echo). |
| DR-cross-cutting-09 | needs decision | | Refused (403) calls are not audited. See below. |
| DR-cross-cutting-10 | fixed | #83 | Running app: tap targets measured at 390×844; `mobile.spec.ts`. |
| DR-cross-cutting-11 | fixed | #83 | Running app: `mobile.spec.ts` (usage report). |
| DR-cross-cutting-12 | fixed | #86 | By reading the code (the Solution card adds "(no longer offered)"); retiring a plant in e2e was not staged. |

**Totals:** 74 defects.
- 67 fixed (one of them in part, DR-kam-sales-leader-15).
- 1 not reproducible (DR-kam-sales-leader-10).
- 6 need a decision.

Of the fixed ones, 4 were Sev-2, all in #80.

## Needs a decision (Ben)

These were not changed, as the brief asked.

1. **DR-pricing-finance-05: the lead's send-back email repeats the lead's free-text note.** A note can carry a price, and the rule is that email never contains comment text.
   - Lean: leave the note out of the email, as the KAM and Engineering send-back emails already do.
2. **DR-pricing-finance-09: Finance can comment on any quote.** The script says Finance only reads and uploads the ROI model.
   - Either restrict comments for Finance (a permission change),
   - or correct the Finance quick-start to say Finance may comment.
3. **DR-cross-cutting-09: refused (403) calls are not audited.** Security-access step 33 says they are.
   - Either add an audit action for refused calls (a CHECK-constraint migration, Fabric-safe),
   - or drop "the refused calls" from step 33.
4. **DR-approver-leadership-admin-05: a quote on hold at Final Review can still be released from `/review`, and there is no Resume.** Decide the intended behaviour: block the release while on hold, or show how to resume.
   - At minimum, `/review` should show the hold banner (date and owner).
5. **DR-kam-sales-leader-09 and DR-engineering-12:** product calls.
   - DR-kam-sales-leader-09: the guardrail warning is shown at submit and in the G1 dialog, not on the quote page. Should the quote page show it?
   - DR-engineering-12: the comment sanitiser silently strips tags, so `<script>x</script>` becomes "x". Should it keep the text as typed (rendered as text), or warn?

## What could not be retested here

- **Node 24.** Everything ran on Node 24 (the repo wants 22) with `npm_config_engine_strict=false`. Three checks fail locally on unchanged `main` too, because of the xlsx writer under Node 24:
  - `pricing-history.int.test.ts` "refuses a file that is not the export";
  - the `integrations` exportReader unit test;
  - the Playwright `admin-integrations` and `pricing` specs, whose pricing-history import fails at their first step.

  So **`pricing.spec.ts` did not run locally**, and DR-pricing-finance-01 has no Playwright check. CI on Node 22 is the reference.
- **Playwright browser.** Local runs used the system Chrome. The bundled Chromium is not installed, and `playwright install` was not run.
- **No live services.** Microsoft sign-in, Azure, Salesforce, SharePoint and Fabric were not touched.
- **Fabric mirror.** The migrations are data-only (no new columns), so the Fabric guard tests are unaffected. A live mirror was not checked.
