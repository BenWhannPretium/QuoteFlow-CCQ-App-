# AI dry run: KAM and Sales leader (session 1 of 5)

> Claude Code ran these scripts against a **local copy** of QuoteFlow. It reports what it saw. It does not replace
> business UAT or sign-off.

## Header

| | |
|---|---|
| Date | 2026-11-10 |
| Scope | `docs/uat/scripts/kam.md` (steps 1 to 75), `docs/uat/scripts/sales-leader.md` (steps 1 to 36) |
| Commit tested | `4b018b682f061bf33270c93b0d134b2a58d0a3ec` (`origin/main`, Merge pull request #74) |
| Node | **v24.22.1** (repo wants 22). `pnpm i` worked with `npm_config_engine_strict=false`. Root `pnpm db:migrate` / `db:seed` still failed the engine check, so the same `tsx` commands were run from `packages/db`. |
| Database | Docker `postgres:16` (`ccq-uat-1`, host port 5501), migrated, `db:seed --synthetic` (150 quotes, 14 personas) |
| Mail sink | Docker `axllent/mailpit:v1.27` (`ccq-uat-mail-1`, SMTP 1101, UI 8101). `MAIL_MODE=smtp`. Email was read in Mailpit. |
| Config | `AUTH_MODE=dev`, `SF_MODE=fake`, `FILESTORE_MODE=local`. **API on port 3201, web on 5201** (see Observations: 3101 was held by a service that is not ours). |
| Browser | Playwright 1.64 driving the machine's **Microsoft Edge** (`channel: 'msedge'`). Playwright's own Chromium is **not installed** on this machine and was not installed. Mobile = Edge at 390×844 with touch emulation, not a real phone. |
| Personas used | `kam`, `kam-owner`, `kam-region`, `sales-leader`, `multi-role` (list/search only). `eng-lead`, `pricing-lead`, `pricing`, `engineer`, `approver`, `admin`, `finance` only to move quotes on, to prove denials, or to switch an Admin setting on and off. |
| Method | Wizard, quote page, queue, dialogs and pipeline were driven in the browser. Denied-role checks, caps and validation were also sent straight to the API (`x-dev-user` header). Audit rows were read with read-only `psql`. |
| Quotes made | CCQ-2026-00151 (Part B), 00152 (Part C), 00153 (sales leader's own), 00154 and 00155 (CSV text), 00156 and 00157 (volume routing), 00158 to 00160 (platform minimum), 00161 to 00164 (API validation). Seeded quotes were used for Customer Decision, Quoting and Final Review steps. |
| Admin switches | `g1_volume_routing` and `intake_guardrails` were each switched on for a few seconds and **switched off again** (verified: both `enabled=false` at the end). `g4_additional_approvals` was not touched. |
| Evidence | Screenshots are in the session scratchpad folder, **not committed**: `C:\Users\benwh\AppData\Local\Temp\claude\C--Users-benwh-code-QuoteFlow--claude-worktrees-uat-dry-run-kam-sales-leader-38e5a7\6ac61ff3-fec8-4687-9557-b3e9f6aabf1d\scratchpad\shots\` (file names are cited in section B). |
| **Not covered** | Microsoft sign-in, Azure, Fabric, SharePoint, live Salesforce (link target, real SF data comparison). A real phone and camera. Screen reader. The KAM scope personas (`kam-owner`, `kam-region`) were checked through the API and lists, not by clicking through their UI. `multi-role` one-notice-per-event check. Sales-leader steps 27 and 36. The wizard's platform-minimum warning in the browser (see D). |

## Summary

All of the intake wizard, the G1 qualify decisions, the priority override, the customer outcome and hand-off, the
pipeline, the notifications and the scope rules were run. No step blocked a core flow in a way that could not be
worked round, and no denied role could do something through the API that the UI hides. Ten usability or wrong-wording
defects (Sev-3) and nine cosmetic ones (Sev-4) were found, and eight script steps were wrong and were corrected.
The two that most affect a pilot tester are that a Salesforce reminder is lost when an outcome is recorded from
**My proposals**, and that closing a quote Won (G6) asks for a "Reason" that the script does not mention.

| Severity | Count |
|---|---|
| Sev-1 | 0 |
| Sev-2 | 0 |
| Sev-3 | 10 |
| Sev-4 | 9 |

## A. Coverage

Result key: Pass = seen working in the running app. Fail = the app or the script did not match. Blocked / Not tested
= could not run, reason given.

### KAM script (`kam.md`)

| Step | Role | Result | Note |
|---|---|---|---|
| 1 | KAM | Pass | Home title **My quotes** and subtitle as written. |
| 2 | KAM | Pass | Nav: Home, New intake, My proposals, Pipeline only. |
| 3 | KAM | Pass | Menu shows name, email and "Roles: KAM". Item is **Email preferences**, not "Preferences". |
| 4 | KAM | Pass | All five blocks present. |
| 5 | KAM | Pass | Step 1 of 4 **Opportunity**; search box **Find the Salesforce opportunity**, **Mine** / **All**. |
| 6 | KAM | Pass | Card shows name, account, Amount, Close, SF stage, Owner. Not compared with real Salesforce (fake SF). "Use this opportunity" is a button whose accessible name is "Use <opportunity>" (DR-kam-sales-leader-07). |
| 7 | KAM | Pass (script corrected) | Step name is **Customer & destination**. Read-only customer, no new-customer form, checkbox as written. |
| 8 | KAM | Pass | City and State required (needed list: "Destination city is required"). **Change destination** present. |
| 9 | KAM | Pass (script corrected) | Request class lists four classes, not only CCQ. Help text under each field present. |
| 9a | KAM | Pass | Eight markets, none of the old five. |
| 9b | KAM | Pass | "Choose a market first" while disabled; Food has 7, Beverage 2; help text as written. |
| 9c | KAM | Pass | Changing market clears the sub-market. Sub-market optional. |
| 10 | KAM | Pass | Customer-specified resin box, custom neck lists ("Custom neck diameter / finish / special feature", required), removing the custom value removes the box. |
| 10a | KAM | Pass | Box appears, cap stops at 120, needed list names it, picking a listed resin hides it. |
| 10b | KAM | Pass | List and cap (120) as written; clears when unpicked. |
| 10c | KAM | Pass | List, 200 cap, "Additives is required" in the needed list. |
| 10d | KAM | Pass | Quote's Intake card shows the three typed values. Draft with empty boxes saved. The wizard review shows "Customer-specified resin: No" and not the typed text (DR-kam-sales-leader-19). |
| 10e | KAM | Not tested | A question for a business user. |
| 11 | KAM | Not tested | Custom color and Decoration fields were not exercised. |
| 12 | KAM | Pass | Round volume 1,000,000 asks "Is this the customer's real annual volume?" with a confirm box. |
| 13 | KAM | Pass | SF close date read-only; two needed-by dates; variants note counter. |
| 13a | KAM | Pass | Net 30 no flag; Net 60 "Non-standard: Pricing will review". The **Other** description box was not checked. |
| 13b | KAM | Pass | Starts at Not discussed; customer-funded hint (sales tax) shown. |
| 13c | KAM | Pass | Freight types and the drop trailer / T-bar hint as written. |
| 13d | KAM | Pass | Switching to FOB clears freight; bid reference stops at 60. |
| 13e | KAM | Pass | Label and hint as written; stops at 500. The needed list calls it "Packaging requirements" (DR-kam-sales-leader-11). The over-500 legacy note was not tested. |
| 14 | KAM | Pass | File listed with size, uploader and time. |
| 15 | KAM | Pass | Needed list absent when complete; Edit links on the review. |
| 16 | KAM | Pass | "Quote CCQ-2026-00151 created". Double-click on Submit made one quote. |
| 17 | KAM | Pass | Overview, tier, Why this priority?, Timeline. SF opportunity shows as a plain ID (the Salesforce URL is not set locally). |
| 17a | KAM | Pass | Intake card and **Customer requested:** line as written. |
| 18 | KAM | Pass | "Strategic fit (where to play)" with a provisional chip and "Market: Food › Snacks & Confections". |
| 19 | KAM | Not tested | The Attachments tab was not opened (files seen in the Timeline). |
| 20 | KAM | Pass | |
| 21 | KAM | Pass | "From Salesforce:" shows the default; reason field appears. |
| 22 | KAM | Pass | Needed list names the reason; submit disabled. |
| 23 | KAM | Pass | Existing mold and What changes appear (both required). |
| 24 | KAM | Pass | "Missing: gram weight." |
| 25 | KAM | Pass | **Fix** jumps to step 3 but keyboard focus stays on the page body (DR-kam-sales-leader-18). "Minimum spec complete" then shows. |
| 26 | KAM | Pass | |
| 27 | KAM | Pass | New address on the Intake card; Overrides tab shows the ship-to override with the reason. |
| 28 | KAM | Pass | Resin listed; submit disabled. |
| 29 | KAM | Pass | Message as written. "Price inquiry / RFP check" and "Other capital" are refused with the same message. |
| 30 | KAM | Pass | Draft listed with step and save time. |
| 31 | KAM | Pass | Dialog "Discard this draft?"; toast "Draft discarded". |
| 32 | KAM | Pass | "Has quote CCQ-…", **Open existing**, no use button. |
| 33 | KAM | Pass | "Create the opportunity in Salesforce first". |
| 34 | KAM | Pass | No override button; hint "Need a different priority? Escalate to your sales leader." |
| 35 | KAM | Pass | "CRITICAL (override)", OVERRIDDEN marker, justification under Why this priority?. |
| 36 | KAM | Pass | Override listed with actor and reason. No Revert for the KAM. API revert refused (403). |
| 37 | KAM | Pass | Bell: returned for rework, reason and note in the notice. |
| 38 | KAM | Pass | **Returned to me** lists it. |
| 39 | KAM | Pass | Banner "Returned for rework at G1", "What to fix:", **Fix and resubmit**. |
| 40 | KAM | Pass | "Rework of CCQ-…". Resubmitted with the same number. |
| 41 | KAM | Pass | Notice has reason and the pricing lead's note. The email has the reason only. |
| 42 | KAM | Pass | |
| 43 | KAM | Pass | "If the scope did not change, it goes straight back to Pricing." |
| 44 | KAM | Pass | Submit disabled until answered. |
| 45 | KAM | Pass | "It is now in Quoting"; stage Quoting. Pricing lead told ("is back from the KAM"). That the same pricer stays assigned was not checked. |
| 46 | KAM | Pass | "Yes" resubmits to G1. |
| 47 | KAM | Pass | Counts: open, expiring soon, past validity, on hold. |
| 48 | KAM | Pass | Panel as written. SF link shows as a plain ID (URL not set). |
| 49 | KAM | Pass | "The acceptance date can’t be in the future." |
| 50 | KAM | **Fail** | Stage becomes Commit & Hand Off, quote not closed, but **no Salesforce reminder appears** when the outcome is recorded from **My proposals** (DR-kam-sales-leader-01). |
| 51 | KAM | Blocked | No reminder to click from the My proposals path; the reminder was seen (with dismiss) after Lost on the quote page (step 57). |
| 52 | KAM | Pass | After choosing Advance, the dialog lists the two missing items and refuses. |
| 53 | KAM | Pass | "Hand-off accepted"; card shows CER Approved. |
| 54 | KAM | **Fail as written** (script corrected) | Advance needs **Reason (required)** (acceptance evidence list); without it "Choose a reason." With a reason: Closed – Won, closure owner the KAM (DR-kam-sales-leader-02). |
| 55 | KAM | Pass | "Choose a reason." |
| 56 | KAM | Pass | "Add a note." |
| 57 | KAM | Pass | Closed Lost, competitor, closure owner. Reminder "Update the Salesforce opportunity to match: Closed Lost." |
| 58 | KAM | Pass | Price approval record and capital readiness read-only. |
| 59 | KAM | Pass | Budgetary capital estimate and capacity evidence read-only. |
| 60 | KAM | Pass | Locked after G3 / G2 lines as written. |
| 61 | KAM | Pass | "Locked after G4" line; API write refused (409 SECTION_LOCKED). |
| 62 | KAM | Pass | Both columns offered. |
| 63 | KAM | Pass | CSV has the chosen columns. |
| 64 | KAM | Pass | No price, margin or capital amount in any email seen. |
| 65 | KAM | **Fail as written** (script corrected) | The Final Review page **opens read-only** for a KAM; it is not refused. |
| 66 | KAM | Pass | "You don’t have access to this" for /approvals, /analytics, /admin. |
| 67 | KAM | Pass | No Qualify button; API G1 decision refused (403). |
| 68 | KAM | Pass | Bell notice with link; email has no comment text. |
| 69 | KAM | Pass | One email "N new comments" per person after the 10-minute fold window; the actor is not mailed. |
| 70 | KAM | Pass in part | Moves, returns, holds and closures notified once each. "Once even with two roles" (multi-role) not tested. |
| 71 | KAM | Pass (script corrected) | Item is **Email preferences**; the switch is **Your quote moves or a decision is recorded**. It saves and survives reload; no confirmation toast. |
| 72 | KAM | Pass | Tab bar Home, Intake, Proposals, Pipeline (390 px emulation). |
| 73 | KAM | Pass (script corrected) | "Step 2 of 4 · Customer & destination". No sideways scroll. |
| 74 | KAM | Pass in part | **Add photo** exists with a camera input. The camera was not tested. |
| 75 | KAM | Not tested | No intake was submitted on the emulated phone. |

### Sales-leader script (`sales-leader.md`)

| Step | Role | Result | Note |
|---|---|---|---|
| 1 | Sales leader | Pass | **Sales pipeline** home. |
| 2 | Sales leader | Pass | Nav as written, no Admin. |
| 3 | Sales leader | Pass | All four blocks. |
| 4 | Sales leader | Pass | Pop-up with definition and time window. |
| 5 | Sales leader | Pass | Team pipeline counts equal the open-quote counts on Pipeline (24 / 24 / 16 / 10 / 15 / 3). |
| 6 | Sales leader | Pass | Heading and subtitle as written; **Decide** on each row. Held quotes are listed in the same queue. |
| 7 | Sales leader | Pass | Market › Sub-market, strategic fit with provisional chip, Timing reads Quote needed by. |
| 7a | Sales leader | Pass in part | The typed "Other" values show on the Intake card (seen as KAM, same card; not separately opened as sales leader). |
| 8 | Sales leader | Pass | On a complete quote: "Intake complete for this decision", no note asked, moved to Engineering Review. The seeded G1 quotes are incomplete, so Advance is refused on them. |
| 9 | Sales leader | Pass (script corrected) | The note field is **Note (required)**. Reason and note required; KAM told. |
| 10 | Sales leader | Pass | "Choose a reason." "Choose a review date." "Add a note." |
| 11 | Sales leader | Pass | "On hold until 2026-11-24 · owner Delphia Stoltenberg"; KAM emailed with the review date. |
| 12 | Sales leader | Pass | Redirected, reason Stock item, KAM told. |
| 13 | Sales leader | Pass | "Add a note."; option marked "Closes the quote". |
| 14 | Sales leader | Pass | Declined. |
| 15 | Sales leader | Pass | Dialog opens from the quote page; five info buttons; Cancel changes nothing. |
| 16 | Sales leader | Pass | Resubmitted quotes (CCQ-2026-00105) are back in the list. 00152 not re-checked in the list. |
| 17 | Sales leader | Pass in part | Submitted from the API (not the browser). The sales leader becomes the quote's KAM even though Salesforce lists another owner (E-10). |
| 18 | Sales leader | Pass | No Qualify button on the quote. In the queue the row has **Decide** and the dialog says "You can’t record a Qualify & prioritize decision on this quote right now." The reason (own deal) is not given. |
| 19 | Sales leader | Pass | |
| 20 | Sales leader | Pass | "Explain why in at least 15 characters." |
| 21 | Sales leader | Pass | Applied once even on a double-click; marker "(override)". |
| 22 | Sales leader | Pass (script corrected) | Chip "Tier overridden: <justification>". Only after the quote has left G1. |
| 23 | Sales leader | Pass | |
| 24 | Sales leader | Pass | Revert, then an inline confirm; "Override reverted. The original value is back." |
| 25 | Sales leader | Pass in part | KAM sees the hint. API refuses the tier override for KAM, engineering lead, engineer, pricer and pricing lead (403). Engineer and pricer UI not opened. |
| 26 | Sales leader | **Fail** | No note: "Add a note saying why." With a note: "Could not record the decision / The override was not accepted" because the seeded request is on a closed quote (DR-kam-sales-leader-04). |
| 27 | Sales leader | Not tested | No request raised by the sales leader exists. |
| 28 | Sales leader | Pass | "The proposal is still valid: add a note saying why it is expired now." |
| 29 | Sales leader | Pass | Drag opens the Qualify dialog; cancel leaves the quote at Intake. |
| 30 | Sales leader | Pass | Price record and capital readiness readable; no save buttons. |
| 31 | Sales leader | Pass | |
| 32 | Sales leader | Pass | "Locked after G3 · decided by … reopens if the quote is sent back". |
| 33 | Sales leader | Pass | Analytics loads; 22 info buttons. |
| 34 | Sales leader | Pass in part | Through the API: terms editable for the sales leader; capital terms, engineering terms and exception decisions refused (403). The panel was not inspected in the browser as sales leader. |
| 35 | Sales leader | Pass | Approvals shows override requests only ("To qualify" and "Overrides"). |
| 36 | Sales leader | Not tested | Optional; needs the Admin switch (session 4's area). |

### Features from the session brief that are not numbered script steps

| Feature | Result | Note |
|---|---|---|
| Priority override only by a sales leader, audited | Pass | `override_requested`, `override_applied`, `override_reverted` rows with actor and role. |
| `g1_volume_routing` on, band 1,000,000 or more | Pass in part | 2,000,000/yr went straight to Engineering with the reason "…in the 1,000,000 or more band: straight to Engineering"; 500,000/yr went to the sales leader. "No volume" cannot be submitted (volume is required), so that branch could not be reached. |
| `intake_guardrails` on | Pass in part | Warning "Below the platform minimum for our machine platforms: 400,000 units/yr. You can still submit." is in the submit response and the G1 dialog; never blocks. **Not shown on the quote page** (DR-kam-sales-leader-09). Browser wizard not tested. |
| Scope personas (API) | Pass | `kam-owner` and `kam-region`: other KAMs' quotes give 404 `problem+json` on the quote and on timeline, attachments, review-summary, pricing-context, overrides, stage-times, capacity CSV, comments; search, board and CSV export hold only their own. Other drafts: 404. |
| Denied roles (API) | Pass | 403 `problem+json` for every action tried (list in section B notes). |
| Search, filters, CSV, board | Pass in part | Search by quote number, account, bid reference works; `%` `_` `<script>` are safe. A cell starting `=`, `-` or `@` is prefixed with `'`. Board drag works for the sales leader; a KAM dragging their own G1 card does nothing, with no message. |
| Locks | Pass | G2, G3, G4 lock lines; terms and capital flag refused with 409 `SECTION_LOCKED` after G4. A send-back reopens: seen on the G3 return of CCQ-2026-00120 (back in Quoting). |
| Audit | Pass | create, view, stage_change, override_*, comment create, export, upload, config_change rows have actor, roles and time. A hold is recorded as `gate_decision`, a move as `stage_change`. |
| axe-core | Pass | No serious or critical violation on home, intake steps 1 to 4, proposals, pipeline, board, quote page, queue, approvals, analytics, preferences, dialogs, **except** `label-content-name-mismatch` on the intake opportunity buttons (DR-kam-sales-leader-07). |
| Keyboard | Pass in part | Skip link works; tab order and focus styles are visible. The wizard and G1 dialog were tabbed through, not completed end to end by keyboard. |
| Mobile 390 px | Pass in part | No horizontal scroll on 13 of 14 pages (DR-kam-sales-leader-10); many targets under 44 px (DR-kam-sales-leader-08). |

## B. Defects

| ID | Severity | Where | Steps | Expected | Actual | Evidence | Suspected cause |
|---|---|---|---|---|---|---|---|
| DR-kam-sales-leader-01 | Sev-3 | `/proposals`, KAM | 1 Open **My proposals**. 2 **Record outcome** on a valid proposal. 3 Awarded, PO, today. 4 **Record decision**. 5 Look for the Salesforce reminder. | "Update the Salesforce opportunity to match: <stage>" with the link and a dismiss (kam.md 50 and 51) | Only the toast "Awarded recorded … is now in Commit & Hand Off". The same happens for Expired. The reminder only shows when the outcome is recorded on the quote page, and it is lost on reload. | `kam-awarded.png`, `kam-lost.png` | `SfUpdateReminder` reads a client cache key set by `GateDecisionDialog`; the quote page is not mounted on `/proposals` (`apps/web/src/components/outcome/CustomerDecision.tsx`) |
| DR-kam-sales-leader-02 | Sev-3 | Quote page, KAM, G6 | 1 Awarded quote, fill the hand-off card. 2 **Commit & hand off**. 3 Choose **Advance (close Won)**. 4 **Record decision**. | Closes Won (kam.md 54) | "Choose a reason." The required **Reason** list is the acceptance evidence (Verbal award, PO, LOI, Contract) already recorded at G5. | `kam-g6-advance.png` | G6 Advance configured with a required reason code; API: `REASON_REQUIRED` |
| DR-kam-sales-leader-03 | Sev-3 | G1 dialog, sales leader | 1 Open a seeded G1 quote (CCQ-2026-00145). 2 **Qualify & prioritize**. 3 Read **Missing before it can move on**. | Plain field names | "resin is required", "At least one of: est_annual_volume is required or est_annual_revenue is required". The score table shows "HOME_CARE (not listed, default)". Raw keys also appear in pricing's G3 list. | `sl-g1-dialog.png` | Domain rule messages used verbatim |
| DR-kam-sales-leader-04 | Sev-3 | `/approvals` Overrides, sales leader | 1 **Approvals**. 2 Note typed. 3 **Approve** the seeded request on CCQ-2026-00063. | "Override approved and applied", or a reason | "Could not record the decision / The override was not accepted". The API says "The quote is closed" but the screen hides it. The request stays in the list forever. | `sl-approvals.png` | UI shows `detail`, not `errors[0].message`; seed puts a request on a declined quote |
| DR-kam-sales-leader-05 | Sev-3 | `/intake/new?draft=…`, KAM | 1 Open one draft in two tabs. 2 Edit **Bid / program reference** in tab 1 ("FROM-TAB-1"), then in tab 2. 3 Edit tab 1 again. 4 Wait. 5 Read the stored draft. | A warning that the draft changed elsewhere | No warning. Tab 1 says "Draft saved" while tab 2's older value overwrites it. A draft PATCH has no version check. | `two-tabs-tab1.png` | Draft PATCH has no version |
| DR-kam-sales-leader-06 | Sev-3 | `POST /quotes/drafts` + submit, KAM | 1 Submit a draft with `market: PHARMA_HEALTH`. 2 Read the quote. | Refused like a bad sub-market ("Pick a sub-market from the list") | Accepted (CCQ-2026-00162). The Analytics **Market** filter then lists "Pharma/Health". The browser never offers it. | none (API) | `market` not checked against the active value list at submit |
| DR-kam-sales-leader-07 | Sev-3 | `/intake/new` step 1, KAM | 1 **New intake**. 2 Run axe, or use voice control "click Use this opportunity". | Name contains the visible text | The buttons say "Use this opportunity" but are named "Use <opportunity name>" (axe `label-content-name-mismatch`, serious, WCAG 2.5.3). | none | `aria-label` on the card buttons |
| DR-kam-sales-leader-08 | Sev-3 | All screens at 390 px | 1 Open any page at 390 px. 2 Measure targets. | Controls at least 44 px | ⓘ buttons 32×32, **Why?** 56×32, **Override priority tier** 97×32, preference checkboxes 20×20, many inline quote links 18 to 24 px tall. | `mob-kam_me_preferences.png`, `mob-sales-leader_analytics.png` | Component sizes |
| DR-kam-sales-leader-09 | Sev-3 | Quote page, with `intake_guardrails` on | 1 Admin switches it on. 2 Submit 400,000/yr. 3 Open the quote as KAM and sales leader. | Warning on the quote and at G1 | Warning is in the submit response and the G1 dialog only. The quote page shows nothing and `warnings` is `[]`. (If the quote page is not meant to show it, change the brief.) | `sl-g1-guardrail.png` | Warning built at submit and in the G1 view only |
| DR-kam-sales-leader-10 | Sev-4 | `/quotes/CCQ-2026-00057`, 390 px | 1 Open the closed-won quote at 390 px. | No sideways scroll | Page is 397 px wide (7 px over). | `mob-kam_quotes_CCQ_2026_00057.png` | Header with a long title and the blueprint grid |
| DR-kam-sales-leader-11 | Sev-4 | Intake step 4, KAM | 1 Packaging type **Other**. 2 Leave the note empty. 3 Go to step 4. | Same name as step 3 | Needed list says "Packaging requirements is required"; the field is "Customer-specified packaging (describe)". | `b-step4-review.png` | Two labels for one field |
| DR-kam-sales-leader-12 | Sev-4 | Rework banner and wizard notice; stop notice | 1 Return a quote with a note ending in a full stop. 2 Read the banner. 3 Stop a quote with a note. 4 Read the bell. | One full stop; a stop before "Open the quote" | "…add the PCR level.." (two). "Note: Not a fit for the current strategy Open the quote for the details." | `kam-bell.png` | String templates |
| DR-kam-sales-leader-13 | Sev-4 | Intake card, hold banners, review | 1 Read dates on the Intake card and a hold banner. 2 Set the browser to Tokyo time. | One date style; zone named | "2026-11-30", "On hold until 2026-11-24" next to "Nov 30, 2026". Times follow the browser zone (11/11 7:09 AM in Tokyo) with no zone label; the brief says US Central. | `b-quote-overview.png` | |
| DR-kam-sales-leader-14 | Sev-4 | Record outcome, Awarded | 1 **Record outcome**. 2 **Awarded**. 3 Open **Acceptance evidence**. | Placeholder "Choose evidence…" | "Choose a reason…" | `kam-record-outcome.png` | Shared reason-code select |
| DR-kam-sales-leader-15 | Sev-4 | Labels | 1 Read stage names in the Pipeline filter. 2 Read the header button on a Customer Decision quote. | Consistent names; a verb on a button | "Closed – Won" and "Closed – Commitment not authorized", but "Closed Lost". The button is "Outcome recorded" (past tense) and opens the dialog titled "Outcome recorded". The mismatch banner reads `Salesforce shows "Quoting" (Quoting)`. | `kam-filters.png` | Configured labels |
| DR-kam-sales-leader-16 | Sev-4 | Gate dialog, sales leader | 1 Open Qualify. 2 Choose Hold, Rework or Stop. 3 Read the Note hint. | Hint fits | "Required for exception decisions" under a required note on non-exception outcomes. | `sl-hold-form.png` | |
| DR-kam-sales-leader-17 | Sev-4 | Every email | 1 Open any QuoteFlow email. | Matches rule 2 (no hidden figures) | Footer: "…open the quote to see what you are cleared to see." | Mailpit | `emailContent.ts` |
| DR-kam-sales-leader-18 | Sev-3 | Intake step 4, keyboard | 1 Reach step 4 with a blocked submit. 2 Tab to **Fix**. 3 Press Enter. | Focus on the field to fix | Page moves to step 3; `document.activeElement` is `BODY`. | `c-step4-blocked.png` | |
| DR-kam-sales-leader-19 | Sev-4 | Intake step 4 review | 1 Resin **Other** with the box filled. 2 Read **Review**. | Typed resin shown | "Resin: Other / Customer-specified resin: No". The typed text is shown only on the quote afterwards. | `b-step4-review.png` | Review prints the checkbox |

Notes on severity, as asked ("if unsure pick the higher"): DR-18 was kept at Sev-3 for keyboard users. DR-06 and DR-09 are Sev-3 only because they are wrong-data or missing-warning cases that need an API call or a business answer; ask Ben if either should be Sev-2.

Denied-role checks run through the API, all refused with 403 `problem+json` (none leaked): KAM override of the tier; KAM G1 decision; KAM Final Review decision; KAM approvals, admin, queues, analytics, audit; KAM capital flag, rework, hand-off, ship-to override on another KAM's quote; engineering lead, pricer, engineer and pricing lead tier override; approver G1; sales leader pricing record, capital terms, engineering terms, exception decision, admin settings, approvals list. A KAM naming another closure owner: 403.

## C. Script corrections made

Edited in `docs/uat/scripts/`. Step numbers are unchanged.

| File | Step | Change |
|---|---|---|
| `kam.md` | 7 | "Customer & ship-to" to "Customer & destination" (the app's step 2 name) |
| `kam.md` | 9 | Request class lists CCQ plus three classes that stay in the pricing application; only CCQ can be submitted |
| `kam.md` | 54 | Added the required **Reason** (acceptance evidence) and the refusal without it |
| `kam.md` | 65 | A KAM can open the Final Review page read-only; it is not refused. Added that the API refuses a G4 decision |
| `kam.md` | 71 | Menu item is **Email preferences**; the switch is "Your quote moves or a decision is recorded" |
| `kam.md` | 73 | Stepper reads "Customer & destination" |
| `sales-leader.md` | 9 | The note field is **Note (required)** (the KAM sees it as "What to fix:") |
| `sales-leader.md` | 22 | The quote must have left G1 before the Engineering queue lists it |

**Not changed, needs one decision:** `docs/uat/quickstart/kam.md` line 9, the same line in `quickstart/print.html`, and the published copy `apps/web/public/help/quickstart.html` all say "Customer & ship-to" and "Drawing, notes & review"; the app says "Customer & destination" and "Drawing, files & review". The published copy is under `apps/web/`, and a test fails until it is regenerated (`UPDATE_QUICKSTART=1 pnpm --filter @ccq/web test`), so it was left for Ben to keep this PR to `docs/uat/` and CI green.

## D. Could not test, and why

- Microsoft sign-in, Azure, Fabric, SharePoint, live Salesforce: out of scope for a local copy.
- The Salesforce link target ("Open in Salesforce ↗"): the URL setting is empty locally, so a plain ID shows (kam.md 17, 48, 51).
- A real phone, camera (kam.md 74, 75) and a screen reader.
- kam.md 10e and 11, 13a "Other" description, 19, and the over-500-character legacy packaging note: not run.
- `multi-role` one-notice-per-event (kam.md 70) and sales-leader steps 27 and 36: no suitable data or another session's switch.
- The wizard's platform-minimum warning in the browser: every free opportunity tried supplies a read-only volume from Salesforce, so volume could not be typed. Tested through the API and G1 dialog only.
- `g1_volume_routing` with no volume: the quote cannot be submitted without a volume.
- KAM scope personas through the UI: the API, lists, search, board and CSV were checked instead.
- Keyboard-only completion of the whole wizard and the decision dialog: focus order and focus styles were checked, the flows were driven with the mouse.
- The seeded G1 quotes are incomplete (no resin, no volume), so G1 Advance could only be tested on quotes made during this run.

## E. Observations

1. **Port 3101 was already held** by `node dist/server.js` (not ours, left alone), so the API ran on 3201. `apps/web/vite.config.ts` hard-codes web port 5173 and the proxy default 3000; both were overridden by flags and env vars. `pnpm db:migrate` from the repo root ignores `npm_config_engine_strict`.
2. **Playwright Chromium is not installed** here (00-common says it is). Edge worked. The persona is read from `sessionStorage['ccq.devPersona']`, not `localStorage` as 00-common.md says.
3. **Every "New intake" click makes a new draft.** The same opportunity can have many drafts, and a draft stays after its opportunity gets a quote. "Continue a draft" grew to 12 rows and puts 12 links before the search box for keyboard users.
4. The opportunity search finds a quote by name, not by Salesforce ID, and "moore pacocha" finds nothing where "Moore, Pacocha" does.
5. A returned quote whose **Quote needed by** date has passed cannot be resubmitted until the date is changed, even with "No, same scope". Likely for any send-back older than the date.
6. A seeded quote (CCQ-2026-00122) has an opportunity with no Salesforce account, so after a send-back it cannot be fixed or resubmitted (no way to change the opportunity in rework).
7. The G1 dialog for the sales leader's own deal does not say why it refuses ("You can’t record … right now"); the API says "You cannot qualify an opportunity you own as KAM".
8. A KAM who drags their own G1 card on the board gets no message.
9. The preferences page lists all 22 email types to every role, including ones a KAM can never receive ("Engineers: you have a new engineering review"). Saving a switch gives no confirmation.
10. A sales leader who submits an intake becomes the quote's KAM even when Salesforce lists another owner.
11. The hand-off record can still be edited (API 200) after the quote is Closed – Won.
12. The person a sales leader names as closure owner got no notification of the closure (checked for the named KAM).
13. The score table's strategic-fit row is labelled "Strategic fit (where to play)" for every quote; the brief expects "Strategic fit (sub-market)" when a sub-market is picked.
14. The pipeline "Days in stage" is 0 for closed quotes; the standard description for a resin **Other** quote reads "32oz Bottle, Other with Container".
15. `GET /gates/:gate/queue` returns the Final Review queue to every role, including KAM and Finance (the route inventory lists only `quote.read`). It holds no more than `/quotes` already does, but sales-leader.md step 35 says the queue is for the approver, leadership and Admin.
16. Opening a quote by its internal id (`/quotes/<uuid>`) shows a raw "Validation failed … /quoteNumber: A quote number looks like CCQ-2026-00001" page.
17. Comment mentions only register when the body contains the person's full display name; "@Patience" did not.
18. Uploaded files all default to the kind "Bottle drawing" whatever their type; odd names (`a<b>;c%20.pdf`) are accepted and shown as plain text (no markup), `..\x.pdf` is stored as `x.pdf`.
