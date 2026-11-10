# AI dry-run UAT report: Pricing, Pricing Lead and Finance (session 3 of 5, `pricing-finance`)

**This is a dry run by Claude Code. It does not replace the pilot group's UAT (Nov 13 to 20, 2026) and it is not a sign-off.** It reports what was seen in a local copy of the app.

## Header

| | |
|---|---|
| Date | 2026-11-10 |
| Commit | `4b018b682f061bf33270c93b0d134b2a58d0a3ec` (`origin/main`, branch `claude/uat-dry-run-pricing-finance`) |
| Scripts | `docs/uat/scripts/pricing.md` (Parts A to G, steps 1 to 45 incl. 7a, 8a, 8b, 20a), `docs/uat/scripts/finance.md` (steps 1 to 12), with the pricing and finance quick-starts |
| Node | **v24.22.1** (the repo wants 22). Ran with `NPM_CONFIG_ENGINE_STRICT=false`; `pnpm i`, migrate, seed and the API all worked. |
| Database | Docker `postgres:16` container `ccq-uat-3` on port 5503, user, password and database `ccq`. `pnpm db:migrate && pnpm db:seed --synthetic` (150 synthetic quotes, 14 personas). |
| Mail sink | Docker `axllent/mailpit:v1.27` container `ccq-uat-mail-3` (SMTP 1103, UI 8103). `MAIL_MODE=smtp`. All 104 emails sent during the run were read through the Mailpit API. |
| App | `AUTH_MODE=dev`, `SF_MODE=fake`. API on port 3103 (`pnpm --filter @ccq/api dev`), web on port 5203 (`vite --port 5203 --strictPort` with `VITE_API_PROXY_TARGET=http://localhost:3103`). `.env` is git-ignored; no tracked config was edited. |
| Browser | Playwright driving the installed **Microsoft Edge** (`channel: 'msedge'`), desktop 1280×800 and mobile 390×844, `deviceScaleFactor: 1`. This machine has no Playwright Chromium cache, so the default `chromium.launch()` was not used. Axe-core 4 (WCAG 2.1 A and AA tags). |
| Personas used | `pricing` (Lorenza McGlynn), `pricing-lead` (Brandi Franey), `finance` (Jordy Friesen); `kam` (Patience Runolfsdottir), `sales-leader`, `eng-lead` (Viviane Carroll), `engineer`, `approver`, `leadership`, `admin` to feed quotes and for the denied-role checks. |
| How quotes were made | Quotes were **created and moved to Quoting through the API** (KAM intake, sales-leader G1 "Advance", eng-lead review, capacity evidence and G2), not through the intake and Engineering screens (those belong to sessions 1 and 2). Everything from Quoting onward was done in the UI, with the API used for denied-role, validation and concurrency checks. No database edits. |
| Quotes | `<CCQ-QT-2>` CCQ-2026-00151, `QT-3` 00152 (capital flagged likely, later put on hold), `QT-4` 00153 (G2 "capital required"), `QT-5` 00154, `QT-6` 00155, `RW-1` 00156, `RW-2` 00157, `QT-NS` 00158 (customer asked for Net 60), `QT-OTHER` 00159 (Other resin, PCR and additive, Food › Snacks & Confections). |
| Admin switches | Not touched. `g4_additional_approvals`, `intake_guardrails` and `g1_volume_routing` were still `enabled: false` at the end (read from the database). |
| Not covered | See section D. In short: Microsoft sign-in and anything outside localhost, the Capital Management early notice (no recipients configured locally), the baseline `pnpm e2e` suite (not run), screen readers, a second Pricing analyst, the 24-hour removal limit, and the intake, G1 and Engineering screens. |

## Summary

All 49 Pricing script rows (steps 1 to 45 plus 7a, 8a, 8b and 20a) and all 12 Finance steps were run in the app: 58 matched their expected result in substance, 2 failed and 1 was not tested. Step 8a failed (the refusal of "Costing completed" before a costing model exists is not shown to the user), step 27 had a wrong expected result in the script, which was corrected (the Final Review page opens read-only for Pricing), and step 34 needs a real BOM. Every denied-role check I made against the API (over 100 calls across Pricing, Finance, KAM, Engineer, EngLead, Approver, Leadership, Sales leader and Admin) came back as `application/problem+json` 403, 409 or 422 as designed, and every role I checked (KAM, Engineer, Leadership, Finance) can read pricing, margin and capital figures (CLAUDE.md rule 2). Axe found no violations on any Pricing or Finance screen or decision dialog at 1280 and 390 px. The defects are about messages, duplicates and layout: eleven Sev-3 and five Sev-4, no Sev-1 and no Sev-2. Nothing here says the app is acceptable; gate owners and pilot users decide that.

| Severity | Count |
|---|---|
| Sev-1 | 0 |
| Sev-2 | 0 |
| Sev-3 | 11 |
| Sev-4 | 5 |

## A. Coverage

Result values: Pass, Fail, Blocked, Not tested. "API" means checked directly against the API as that persona.

### `pricing.md`

| Step | Role | Result | Note |
|---|---|---|---|
| 1 | Lead | Pass | Home **Pricing triage** with its sentence. |
| 2 | Lead | Pass | Heading, sentence, three counts, tabs **All** and **Ready for my review (n)** as written. |
| 3 | Lead | Pass | All eleven columns present. |
| 4 | Lead | Pass | Dialog **Assign pricer**, toast "Assigned to Lorenza McGlynn · They have been notified.", Pricer column and email to the pricer. |
| 5 | Lead | Pass | **Reassign work…** moves **all** of one pricer's open quotes (7 moved), not "one" quote. Round trip back worked. |
| 6 | Analyst | Pass | Home **Pricing desk**. No **Assign pricer…** or **Reassign work…** in the UI. API: analyst, KAM, Engineer, Finance, Approver get 403 on `pricing-assignment` and `queue/pricing/reassign`. Admin gets 200 (matches the route inventory). |
| 7 | Analyst | Pass | Row menu **Record price approval** opens Quoting with the Engineering summary, budgetary capital estimate and capacity evidence. |
| 7a | Analyst | Pass | From intake: bid reference, requested terms (Net 60 shows **Non-standard: Pricing will review**), tooling funding, dunnage, delivered or FOB, freight, special arrangements. A blank shows "–". |
| 8 | Analyst | Pass | Pricing history card and link; search by customer returns the same 2 ERFs as the card; read-only (POST, PUT, PATCH, DELETE on `/pricing/history` give 404). |
| 8a | Analyst | **Fail** | Ticking **Costing completed** first and saving is refused by the server (422 `COST_MODEL_REQUIRED`) and nothing is saved, but **the screen shows no message at all** and the box stays ticked (DR-pricing-finance-01). Uploads then worked: v1, v2, "2 versions", **Earlier versions (1)** with v1, Attachments shows v2 current and v1 replaced. |
| 8b | Analyst | Pass | QT-4: "Needed: Engineering (G2): Advance – capital required", status Waiting on an earlier step. QT-2: "Not required: …" with the reason. |
| 9 | Analyst | Pass | "Price approved ✓ on <date> by <name>"; no price field exists (the API refuses `price`, `quotedPrice`, `margin` as unknown keys). See observation E1 on the label. |
| 10 | Analyst | Pass | Four status labels as written, no CER box. |
| 11 | Analyst | Pass | On QT-4 the "Capital not required" option is disabled with "Engineering said capital is required (G2), so it cannot be "Not required"." API returns 422 `INVALID_VALUE` (its wording differs slightly from the UI hint). |
| 12 | Analyst | Pass | The missing list names the capital line, but it also contains raw rule text (DR-pricing-finance-02). |
| 13 | Analyst | Pass | "Capital flagged as likely"; the **Capital Management notice was not testable** (no recipients configured locally, `noticeSentAt` stays null; see D). |
| 14 | Analyst | Pass | Refused: "Capital is flagged likely: confirm capital readiness (not required or pre-approved)" (listed together with the pending-capital line). |
| 15 | Analyst | Pass | Block gone after **Capital pre-approved (budgetary)**. |
| 16 | Analyst | Pass | "Customer requested: Not given at intake"; Payment terms starts on Net 30 and saves only on **Save terms**; the three tooling payment options; "Terms checked" with "Checked by … on …"; funding model and MOQ read-only; the check needs the commitment answer ("The terms check needs to say whether there is a tooling commitment"). |
| 17 | Analyst | Pass | "Costing attested as complete (before the price)" in the missing list, with jargon lines (DR-02). |
| 18 | Analyst | Pass | "Submitted to the pricing lead … It is locked for you until they send it back." No editable control left; API: pricing-record, capital-readiness, resubmit and cost-model upload all give 409. Lead notified in app and by email; the analyst (actor) is not. |
| 19 | Lead | Pass | **Ready for my review (1)** lists it; notified. |
| 20 | Lead | Pass | Empty note refused ("Say what to change."); with a note the analyst is told (app and email) and the tab reopens; after resubmit it is back in the tab. The note is also in the email (DR-05). |
| 20a | Lead | Pass | Missing list names the ROI model, but as raw rule text (DR-02); nothing recorded; API 422. Finance's upload notifies the lead; a second and third upload notify again. Updated price table upload by the lead worked (201); the analyst gets 403. |
| 21 | Lead | Pass | "Advance – price approved recorded", gate **G3 Price approved**, stage Final Review, approver and KAM notified, "Locked after G3 · decided by …". Stale "Submitted…" line still shows (DR-03). Dialog title is "Price approved" (DR-11). |
| 22 | Lead | Pass | Note and reason required; quote goes to Intake with the pricer still assigned; KAM told with the reason (the note is not in the email). |
| 23 | Lead | Pass | The **KAM's answer was submitted through the API** (not the wizard): "No, same scope" puts RW-1 back in Quoting with the same pricer; pricer and lead told "… is back from the KAM". "Yes" (RW-2) went to qualification. Submitting with no answer is refused: "Say whether the scope changed …". |
| 24 | Lead | Pass | New version 2 in Engineering Review; eng lead told. (No engineer was assigned in my fixture, so no engineer was told.) |
| 25 | Analyst | Pass | After G2 is decided again: **Earlier versions: Version 1 · not approved**. |
| 26 | Lead | Pass | Re-cost keeps Quoting, clears Costing completed, pricer told. Hold: reason, review date, owner and note required ("Choose a reason. Choose a review date. Add a note."), "On hold until 2026-11-24 · owner Brandi Franey"; KAM told by app and email (no note in the email). |
| 27 | Analyst | **Fail (script wrong, corrected)** | No **Approvals** item, but `/quotes/<qn>/review` opens a **read-only Final Review page** with no decision buttons, not "You don't have access". Script corrected (section C). Approvals list API is 403. |
| 28 | KAM | Pass | Price approved line, basis, range, references, capital readiness all readable; no controls. |
| 29 | KAM | Pass | Budgetary capital estimate and capacity evidence visible, read-only. |
| 30 | KAM | Pass | Pipeline list → **Columns**: the two columns are offered, shown, and in the CSV (Capital readiness is a raw code there, DR-15). |
| 31 | KAM | Pass | All 104 emails scanned for dollar figures, margin, notes and terms: none (one email carries the lead's send-back note, DR-05). |
| 32 | Analyst | Pass | Same columns on screen and in the CSV. |
| 33 | Analyst | Pass | From engineering card: BOM file, version, uploader and date with a download; with two-step and pack-out set it lists plants, preform number, freight and the four unit counts; "No two-step or pack-out details entered." with none. Nothing editable. |
| 34 | Analyst | Not tested | The BOM downloaded, but it is a synthetic file, so I cannot say whether it is the one-page CSR BOM with C or P flags. |
| 35 | Analyst | Pass | "Net 60" with **Non-standard: Pricing will review**; Payment terms already on Net 60. |
| 36 | Analyst | Pass | Toast "Non-standard payment terms: the pricing lead has been asked to decide."; exception card **Waiting for the pricing lead**; Non-standard terms ticked, disabled, "set by the payment terms"; lead notified in app and by email. |
| 37 | Lead | Pass | **Approve the exception** and **Reject** disabled until a rationale is typed. |
| 38 | Lead | Pass | "Exception rejected"; card shows Rejected, rationale, decider and time; analyst and KAM notified. |
| 39 | Analyst | Pass | Net 45 opens a new request; lead approves with a rationale; both told. Analyst, KAM, Approver cannot decide (403). Empty or blank rationale 422, 1,001 characters 400. |
| 40 | Analyst | Pass | After switching to Net 30 the Commercial panel shows **no exception card at all** (the earlier approved request disappears; the API returns `exception: null`). See E6. |
| 41 | Analyst | Pass | Note, Pretium / Customer / Shared options, months field appears when Amortized is Yes, no Funding model field, "Capital terms saved", "Not confirmed by the approver yet." |
| 42 | Analyst | Pass | Months and duration limits enforced (0, 121, 1.5, -3, 241 refused), the text stops at 300 characters; but the messages are raw ("Too small: expected number to be >=1", DR-06). |
| 43 | Analyst | Pass | Resin Other, customer-specified resin, PCR 37% PCR and additive all readable on Overview → Intake. |
| 44 | Analyst | Pass | "Food › Snacks & Confections". Market with no sub-market not tested. |
| 45 | Lead | Pass | **Answer: no.** The Ready for my review rows show tier, quote, account and price approval status; nothing shows that an exception is waiting. Only the bell and email do. |

### `finance.md`

| Step | Role | Result | Note |
|---|---|---|---|
| 1 | Finance | Pass | Email "[QuoteFlow] CCQ-… is ready for its ROI: Quoting" (the subject has a ": Quoting" suffix) names the uploader and version, no figures, working link. |
| 2 | Finance | Pass | Link opens the Quoting tab: 1. Costing Done, 2. ROI Next, "Needed: Engineering (G2): Advance – capital required". |
| 3 | Finance | Pass | Costing model downloads; the download is in `audit_event` with the actor. |
| 4 | Finance | Pass | "Version 1 uploaded", **v1 · current**, uploader and time; 3. Price approved is Next; pricing lead notified (app and email). |
| 5 | Finance | Pass | v2 current, **Earlier versions (1)**. Pricing lead notified for each version. |
| 6 | Finance | Pass | QT-2: "Not required: …" with the reason, no upload button. API: ROI upload on a quote that needs none gives 409. |
| 7 | Finance | Pass | Menu **Home**, **Pipeline** only. Home **ROI requests** with what to do (text only; it does not list the quotes waiting). |
| 8 | Finance | Pass | No save, upload (other than ROI) or decision control. API: 27 write and read-restricted routes all 403 (pricing-record, capital-readiness, submit, terms, exception decision, G1 to G4, assignment, escalation, override, eng-review, handoff, rework, queues, approvals, analytics, admin, feedback, CSV export). **Exception:** Finance can post a comment (201), see DR-09. |
| 9 | Finance | Pass | After G3: "3. Price approved: Done · Approved by … on …", no upload button; API 409 `SECTION_LOCKED`. |
| 10 | Finance | Pass | Commercial terms readable (funding model, MOQ, capital terms); no save buttons, no enabled control. |
| 11 | Finance | Pass | Tested on QT-6 in Quoting (QT-2 was already past G3, where the step reads "Needed" with no way to upload). After Engineering sets $0 CER: "Needed: Tooling funding: $0 CER (customer-reimbursed capital)"; upload offered once costing exists. |
| 12 | Finance | Pass | Back to Not discussed: "Not required: …" with the reason. |

Other checks that belong to this scope and are not numbered steps:

| Check | Result | Note |
|---|---|---|
| ROI before costing | Pass | 409 `attachment_conflict`: "Costing comes first: Pricing uploads the costing model, then Finance builds the ROI from it". |
| ROI not needed | Pass | 409: "This quote does not need an ROI …". |
| Pricing-lead fallback ROI upload | Pass | 201. Admin also 201. Pricing, KAM, Engineer, EngLead, Approver, Leadership, Sales leader: 403 `roi.upload`. |
| `COST_MODEL_REQUIRED` | Pass | 422 on tick-before-upload (UI shows nothing, DR-01). |
| Version 2 current, earlier versions downloadable, remove restores previous | Pass | Removing the current v3 made v2 current again (confirm dialog, "File removed"). Non-uploader (lead) gets 403. The 24-hour limit itself was not tested. |
| Every upload after G3 | Pass | 409 `SECTION_LOCKED` for cost model, price table and ROI (pricing, lead, Finance, Admin). Pricing record and capital readiness also 409. Terms and the capital flag stay editable after G3 (they lock at G4 by design). |
| Send-back reopens the steps | Pass | Approver "Return to Quoting" on QT-4: lock cleared, analyst and Finance uploads accepted again, new version 2. |
| Costing changed after the ROI | Pass | Finance told again; step 2 shows "The ROI was uploaded before the current costing model: check it still holds." |
| G3 decided by the lead only | Pass | UI: no G3 button for the analyst (row menu lists only **Record price approval**). API: pricing, KAM, Engineer, EngLead, Approver, Leadership, Sales leader, Finance, Admin all 403 `not_permitted`. The lead may decide an unsubmitted quote (lead review "at any time"). |
| Terms exception blocks G4 | Pass | Pending and rejected both block (422 `g4_terms_exception_check_required`); raw rule text again. |
| MOQ and tooling funding are Engineering's | Pass | Pricing PUT `/terms/engineering` is 403; `termsMoq` and `toolingFundingModel` on `/terms` are rejected as unknown keys. |
| Rule 2 (figures visible to every reader) | Pass | KAM, Engineer, Leadership all see price approval, basis, range, references, capital readiness and the budgetary estimate; Finance reads every figure too. |
| Rule 5 (no pricing figure edited in QuoteFlow) | Pass | No price field; unknown keys refused. |
| Audit and timeline | Pass | Actor, time and detail present for uploads, downloads, pricing record, assignment, submit, G3, rework, hold, comments (read with read-only SQL). G3 advance is recorded as `stage_change`, hold and re-cost as `gate_decision`. Timeline shows each of these with actor and time. |
| Accessibility (axe) | Pass | 0 violations on 14 screens at 1280 and 390 px and on the hold, G3, return-to-KAM and return-to-Engineering dialogs and the assign dialog. One transient `aria-hidden-focus` appeared on `#root` only while a row menu was open (Radix menu, not on the screen itself). |
| Keyboard | Pass | Quoting tab: logical order, visible focus except the date-time field (DR-16); the save worked with Tab and Enter; the Hold dialog opens with Enter, keeps focus inside after 25 Tabs and returns focus to its button on Escape. |
| Mobile 390 px | Pass with defects | No horizontal scroll on any screen except Overview when a very long file name is in the timeline (DR-08). Controls under 44 px: DR-12. |
| Double-click, two tabs, reload, Back | Fail / Pass | Double-click submit sends two requests and notifies twice (DR-04). A stale tab that saves after a submit gets the refusal "Submitted to the pricing lead: only the lead edits until it is sent back". Two tabs saving different fields merge (only the changed keys are sent). Reload drops unsaved text; no leave-page warning (E8). Back returns to the quote. |
| Special characters | Pass | `<img src=x onerror=alert(1)>`, quotes, `&`, accents and emoji stored and shown as plain text, no script ran. |

## B. Defects

No Sev-1 or Sev-2 found. Reproduced from a clean state unless marked.

| ID | Severity | Where | Steps | Expected | Actual | Evidence | Suspected cause |
|---|---|---|---|---|---|---|---|
| DR-pricing-finance-01 | Sev-3 | `/quotes/:qn?tab=quoting`, Pricing and PricingLead | 1. Open the Quoting tab of a quote with no costing model. 2. Tick **Costing completed (Cost-to-Serve)**. 3. Click **Save price approval**. | Script 8a: refused with "Upload the costing model first…". | Server returns 422 `COST_MODEL_REQUIRED` and saves nothing, but the screen shows no message, no toast and no field error; the box stays ticked, so the user thinks it saved (a DOM observer saw nothing added for 2.5 s). Other fields in the same save are lost too. | `b8a-tickfirst3.png` | `apps/web/src/components/pricing/QuotingTab.tsx` (~571 to 577): `FormErrors` drops errors whose path is a single segment (`/costingCompleted`), and the checkbox has no `error`. |
| DR-pricing-finance-02 | Sev-3 | Quoting tab "Not ready to submit yet" list (steps 12, 17); **G3 decision dialog** "Missing before it can move on" (step 20a); G4 (API) | 1. As analyst, click **Submit to pricing lead** on a quote with no costing model. 2. As lead, open **Price approved: advance…** on a capital quote with no ROI. | Plain words, for example "The costing model (Pricing)" and "The ROI model (Finance)". | Raw rule text: "At least one of: cost_model_on_file must equal true or pricing_record.cost_model_requirement must equal grandfathered", "At least one of: roi_required must equal false or roi_model_on_file must equal true". The G4 refusal reads "g4_terms_exception_check_required …". | `b12.png`, `d20a.png` | Rule `any_of` text is shown as is; the domain rule messages need friendly labels. |
| DR-pricing-finance-03 | Sev-3 | Quoting tab after G3 (seen as PricingLead; other readers not checked) | 1. Lead decides G3 on a submitted quote. 2. Open its Quoting tab. | Only "Locked after G3 · decided by …". | The tab still says "Submitted to the pricing lead on … Waiting on their review; the pricer cannot edit until it is sent back." directly above the "Locked after G3" line, on a quote that is in Final Review. | `d21-final.png` | The lead-review panel does not check that G3 is decided. |
| DR-pricing-finance-04 | Sev-3 | **Submit to pricing lead** (Pricing) | 1. On a quote that is ready, double-click **Submit to pricing lead**. 2. Check the lead's bell and Mailpit. (Repeated from the returned state: same result.) | One submission, one notice, one email. | Two requests, both 200; two "ready for your review" notifications and two emails to the lead; two success toasts. A later single resubmit gets 409 "Already submitted", so the guard only works for sequential calls. | `rob2` output (no screenshot) | Submit is not idempotent under a race; the button is not disabled while the request is pending. |
| DR-pricing-finance-05 | Sev-3 (triage: Sev-2 if notes count as comment text) | Email "Your lead sent your work back" | 1. Lead clicks **Send back to pricer…** with a note. 2. Read the email to the analyst in Mailpit. | Email never contains comment text; other send-back emails (to the KAM and to Engineering) leave the note out. | The email repeats the lead's note: "Brandi Franey asked for changes. Note: Please add the resin index basis…". A free-text note can carry a price or margin, and the footer says figures are never emailed. | Mailpit message "CCQ-2026-00151 was sent back to you: Lead review" | The lead-review notification template includes the note. |
| DR-pricing-finance-06 | Sev-3 | Overview → Commercial terms → **Capital terms** (Pricing), months fields | 1. Type 0, 121 or 1.5 in **Amortized over (months)**, or 241 in **Agreement duration (months)**. 2. Click **Save capital terms**. | A plain message with the limit: "Enter 1 to 120 months". | "Too small: expected number to be >=1", "Too big: expected number to be <=120", "Invalid input: expected int, received number", shown once under the field and again as a toast. The API says "Too big: expected string to have <=300 characters" for the text fields too. | `g42.png` | Zod default messages are passed through. |
| DR-pricing-finance-07 | Sev-3 | Costing step upload (`POST /quotes/:qn/attachments`, kind `cost_model`) | 1. Upload `costing.pdf` as the costing model. | Only a workbook (.xlsx) is accepted, as the script says; the check that the file is a real workbook exists for .xlsx. | A PDF is accepted (201) and counts as "costing model on file", so costing can be attested and G3 passed with a PDF. (.exe, .csv, .xlsm and a fake .xlsx are refused.) | n/a (API) | The upload accepts the general attachment type list for every kind; the cost, ROI and price table kinds are not limited to .xlsx. |
| DR-pricing-finance-08 | Sev-3 | Attachments tab, remove confirm dialog; Overview timeline at 390 px | 1. Upload a costing model named with 300 characters (accepted). 2. Click **Remove** on it. 3. Open Overview at 390 px. | Long names wrap or truncate. | The confirm dialog text is clipped and its Cancel and Remove buttons sit out of view; the Overview timeline entry "File removed: aaaa…" makes the page scroll sideways by about 2,000 px at 390 px. A file name with a double quote is stored with `%22` in its place. | `att-confirm.png`, `m-overview.png` | No `break-words` on the file name in the dialog and the timeline. |
| DR-pricing-finance-09 | Sev-3 (may be intended) | Finance on any quote (Overview comment box; `POST /quotes/:qn/comments`) | 1. As Finance, open a quote's Overview. 2. Add a comment. | Script, quick-start and home page: Finance "reads quotes and uploads the ROI model, nothing else". | Finance sees the comment box, posts (201), and the analyst gets a "Jordy Friesen commented" notification. | `finance` comment in audit (`create` · `comment`) | `comments` needs only `quote.read`, which Finance has. Decide whether to say so in the Finance quick-start or to restrict it. |
| DR-pricing-finance-10 | Sev-3 | Quoting tab of an **unassigned** quote (Pricing) | 1. As analyst, open a quote nobody has assigned (for example QT-OTHER). | A hint that the lead must assign it, or a disabled **Submit** with a reason. | "Pricer: Unassigned", the forms are editable and saved (API 200), but there is no **Submit to pricing lead** button and no explanation. The API refuses a submit with "Only the assigned pricer submits to the pricing lead". | `probe` of CCQ-2026-00159 | Submit is hidden without a message when the viewer is not the assignee. |
| DR-pricing-finance-11 | Sev-3 | Gate decision dialog opened from **Hold or stop…**, **Return to KAM…**, **Return to Engineering…** (PricingLead) | 1. On a Quoting quote click **Hold or stop…**. | A title that matches the action. | The dialog is titled "Price approved", lists **Advance – price approved** first among the radios, and says "Record the decision for …"; the same dialog is used for every G3 action. The footer buttons are also below the fold at 1280×800 (the dialog scrolls). | `dlg-hold-desktop.png`, `m-return-kam.png` | One dialog titled with the gate label. |
| DR-pricing-finance-12 | Sev-4 | Many screens at 390 px | 1. Open Pricing queue, Pipeline list, Quoting tab, Overview at 390 px. | Controls at least 44 px. | Quote links in lists 21 to 24 px high; the "About …" info buttons on Home 32×32; the Terms checked, Costing completed and similar checkboxes 13 to 16 px; timeline filter chips 36 px high; "Open the Commercial panel" links 18 to 24 px. | `m-lead-queue.png`, `m-finance-pipeline.png` | n/a |
| DR-pricing-finance-13 | Sev-4 | **2. ROI** step before an upload | 1. Open a capital quote's Quoting tab as Finance. | "No ROI model uploaded yet." | "No roi model uploaded yet." (lower case; the code key is lower-cased into the text). | `f4-roi.png` | Kind name lower-cased in the empty text. |
| DR-pricing-finance-14 | Sev-4 | Intake rework banner (KAM, "Fix and resubmit") | 1. Send a quote back to the KAM with a note ending in a full stop. 2. KAM clicks **Fix and resubmit**. | One full stop. | "…the delivery city.. Submitting updates the same quote." | `d23-wizard.png` | The template adds a stop after a note that already has one. |
| DR-pricing-finance-15 | Sev-4 | Pipeline list **Export CSV** | 1. Choose the **Capital readiness** column. 2. Export CSV. | The label shown on screen ("Capital pre-approved (budgetary)"). | The CSV has the raw code `pre_approved`; Tier is "High" in the file and "HIGH" on screen. | `export-pricing.csv` (scratchpad) | CSV uses the stored code. |
| DR-pricing-finance-16 | Sev-4 | Price approval record **Approved at** | 1. Tab into the field. 2. Save a date such as 1990-01-01 (API). | A visible focus ring; a sensible date range. | No focus indicator on the date-time field's parts; a 1990 approval date is accepted and shows as "Dec 31, 1989, 6:00 PM". | `kb1` output | n/a |

## C. Script corrections made

| File | Step | What was wrong | Change |
|---|---|---|---|
| `docs/uat/scripts/pricing.md` | 27 | Expected "You don't have access to this" at `/quotes/<CCQ-QT-2>/review`. The app opens a read-only Final Review page for every role that can read the quote (CLAUDE.md rule 2), with no decision controls. The API `review-summary` is `quote.read`. | Expected result now says there is no **Approvals** item and the page opens read-only with no decision buttons. If the business wants Pricing refused from that page, that is an app change, not a script change. |

No other step was wrong enough to change. `quickstart/pricing.md`, `quickstart/finance.md` and `quickstart/print.html` needed no change.

## D. Could not test, and why

- **Microsoft sign-in, Entra groups and roles, Azure, Fabric, SharePoint, live Salesforce.** Not tested (local, dev sign-in, fake Salesforce only). The `SG-CCQ-Finance` and `CCQ.Finance` setup is untested.
- **Capital Management early notice (pricing step 13).** `app_setting` `capital_notice_recipients` is `{"recipientUserIds": []}`, so nobody is told and `noticeSentAt` stays empty. The flag, toast and G3 block were tested. The test site needs recipients named.
- **KAM wizard for step 23.** The KAM's "Did the scope change?" answer was submitted through the API; the wizard's Next button did not move on in my run (not investigated; it is session 1's screen).
- **Step 34** (is the BOM the one-page CSR BOM with C or P flags): synthetic file only.
- **Baseline `pnpm e2e`.** Not run (needs a production build and its own ports; skipped for time). Nothing here relies on it.
- **A second Pricing analyst.** The synthetic data has one analyst and one lead, so "another analyst edits my quote" and "the lead assigns work to themself and submits" were not tested (the API does list the lead as an assignable pricer).
- **The 24-hour limit on removing a file.** Would need a 24-hour wait or a clock change.
- **Screen readers**, real email clients (HTML source was read in Mailpit only), print layout, the Admin pricing-history import screen (Admin scope), a quote with a market but no sub-market (step 44), and keyboard-only use of every dialog (only Hold was walked).
- **Intake, G1 and Engineering screens** were not used here; quotes reached Quoting through the API (see header).
- **Admin switches** (`g4_additional_approvals`, `intake_guardrails`, `g1_volume_routing`): left off and not tested.

## E. Observations

1. **"Price approved" means two things.** The analyst's price approval record says "Price approved ✓ on <date> by <name>" as soon as it is saved, before the lead decides G3 (also named "Price approved"). The Ready for my review rows, the quote header and the Final Review page all show it. A pilot user may think the lead has already approved.
2. **Pricing lead can be a "pricer".** The lead appears in the Assign pricer list and can hold the pricer role on a quote, which would make them both submitter and decider.
3. **The KAM is told about every lead-review round** ("the pricing work is with the pricing lead", "was sent back to the pricer", …). That is internal pricing traffic; confirm the KAM should see it.
4. **Hold does not tell the assigned pricer** (the KAM is told). Re-cost does tell the pricer.
5. **Reassign work moves all of a pricer's open quotes**, not one; the dialog says so, the script says "one pricer's work", but "move one pricer's work" can read as one quote.
6. **Step 40:** switching back to Net 30 removes the earlier approved exception from the Commercial panel completely (no card, the API returns `exception: null`). The timeline keeps the decision; the panel does not.
7. **Funding model changes after G3.** Engineering can still set the funding model on a quote in Final Review; the ROI step then reads "Needed: …" while the section is locked, so there is nothing Finance can upload. G4 does not look at the ROI.
8. **No "leave page?" warning** when an analyst navigates away with unsaved text; a reload drops it.
9. **Mixed date formats on one page:** Overview shows 2026-12-10 (quote needed by), 11/10/2026, 4:03:36 PM (submitted) and Nov 10, 2026, 4:03 PM (timeline); the hold banner says "On hold until 2026-11-24". Times are correctly US Central.
10. **Email counts:** Finance and the lead get one email per ROI version (three for one quote after a fallback and admin upload). The lead gets a "back from the KAM" email and an "is ready for pricing" email for the same return.
11. **The dialog first focus** lands on the "Priority 60.5 · High (advisory)" disclosure instead of the first field.
12. **Pricing history reader** has an **ERF / BPR / SPR** switch and the sentence "ERFs, BPRs and SPRs from the retired pricing app"; BPR is historical data here, not a CCQ field, so it matches the build rules, but the pilot may ask.
13. **The "Capital readiness" and costing lines in the missing list** appear twice in some cases (a bare "Capital readiness" line next to the long one on a quote with no status chosen).
14. **API leniency:** Amortized "No" with months set is accepted; duplicate legacy ERF numbers are accepted; an empty file gets "Choose a kind and send the file size first".
15. **Environment notes for the team running this:** (a) the repo's web dev server hard-codes port 5173; I used `--port 5203 --strictPort` and `VITE_API_PROXY_TARGET`, no tracked file changed. (b) `.env.example` has no CORS or web-origin setting, only `APP_BASE_URL` (set to port 5203, so emails link correctly). (c) `pnpm --filter @ccq/api dev` uses `node --watch`; on Node 24 on Windows it restarted itself once at start-up before settling. (d) The seeded Salesforce data has only 8 opportunities free of a quote in the default picker; the rest were found by searching customer names. (e) One 404 console message appeared on the first page load in one run and could not be reproduced.
16. **Not a defect, confirmed:** the Radix row-menu `aria-hidden-focus` axe hit only appears while a menu is open.
