# AI dry run: Engineering lead and engineer (session 2 of 5)

This is what Claude Code saw running the Engineering UAT script against a local copy. It is not a sign-off
and does not replace the pilot group's UAT.

## Header

| | |
|---|---|
| Date | 2026-11-10 (US Central) |
| Commit | `4b018b682f061bf33270c93b0d134b2a58d0a3ec` (`origin/main`; branch `claude/uat-dry-run-engineering`) |
| Node | v24.22.1 (the repo wants 22). Used `npm_config_engine_strict=false`. The root `pnpm db:*` wrappers still stopped on the engine check, so the `@ccq/db` scripts were run as `pnpm --config.engine-strict=false --filter @ccq/db …` |
| Database | Docker `postgres:16`, container `ccq-uat-2`, host port 5502 (`docker compose` was not used, so as not to collide with the other sessions). Migrated, then `pnpm db:seed --synthetic` |
| Mail sink | Docker `axllent/mailpit:v1.27`, `ccq-uat-mail-2`, SMTP 1102, UI 8102. `MAIL_MODE=smtp`. Email was read in Mailpit |
| App | `AUTH_MODE=dev`, `SF_MODE=fake`. API on 3102 (run with `node --import tsx` because `pnpm dev`'s watch mode kept restarting the API on this machine), web on 5202 (`vite --port 5202 --strictPort`, `VITE_API_PROXY_TARGET=http://localhost:3102`). `APP_BASE_URL=http://localhost:5202`. No tracked config was edited |
| Browser | Playwright driving the installed Microsoft Edge (`channel: 'msedge'`); no bundled Chromium was available. Desktop 1280x800, mobile 390x844 |
| Personas | `eng-lead`, `engineer`, `engineer-owner`; `kam`, `sales-leader`, `pricing`, `pricing-lead` to feed and move quotes; all 13 personas for the API permission matrix |
| Evidence | Screenshots, the CSV and the throwaway Playwright scripts are in `C:\Users\benwh\AppData\Local\Temp\claude\C--Users-benwh-code-QuoteFlow--claude-worktrees-uat-dry-run-engineering-0bf558\ffa84bbd-0608-48d3-9f2b-976e7afb301d\scratchpad\` (not committed). File names below are relative to it |
| Not covered | See D |

How the data was staged, so a reader can judge what was real:

- `<CCQ-ENG-1>` to `<CCQ-ENG-8>` = CCQ-2026-00151 to 00158, `<CCQ-ENG-OTHER>` = 00159, `<CCQ-ENG-GRADE>` = 00160. They were **created through the API as `kam` and qualified through the API as `sales-leader`** (the intake and G1 screens belong to session 1). The Engineering Review work on them was done in the UI. ENG-OTHER used the longest entries the intake allows (resin grade 120, PCR level 120, additive note 200).
- Pricing's "Rework (back to Engineering)" (step 42) was posted through the API as `pricing-lead`.
- **The dev users are not named Neiberger or Pasillas**, so the assign dialog correctly suggested nobody until I renamed two local users in `app_user` (Emil Funk to Alan Neiberger = `engineer`, Richard Turner to Carlos Pasillas = `engineer-owner`). That is the "engineer has signed in" condition in step 48.
- **Legacy states were staged with SQL on the throwaway database** (steps 15c, 61, 67): a placeholder plant and machine type plus legacy BOM text on ENG-8; resin `PCR_HDPE` and market `PHARMA_HEALTH` on seeded quote 00150. A fresh seed has no inactive `PCR_HDPE` entry in `value_list` (the real migration deactivates one), so I inserted one. Without it the retired resin shows as the raw code (E-9). No quote was moved between stages by SQL.
- Seeded quotes supplied the rest of the queue (28 to 32 open quotes).

## Summary

76 script steps (including 15a to 15c) were run. 72 did what the script says (7 of them with a defect logged beside them) and 4 were not tested because they ask for a business opinion or for Jim Zweifel's spreadsheet (47, 49, 57, 65). Queue and assignment, the Engineering tab, the equipment BOM, capacity evidence, lead review, every G2 outcome, the lock after G2, funding and MOQ and the plant and machine lists worked as the script describes. Every denied role was refused with a `problem+json` 403 on the engineering routes tried. The main problems: a G2 Advance is accepted with a capacity row whose assumed effectiveness is 0 (utilization is then "not calculated"), raw validation text reaches users, a double-click posts a comment twice, and the injection-preform process type gets no engineer suggestion. This report says what was seen; it is not a statement that anything is ready.

| Severity | Count |
|---|---|
| Sev-1 | 0 |
| Sev-2 | 1 |
| Sev-3 | 7 |
| Sev-4 | 4 |

## A. Coverage

Result key: Pass, Fail, Blocked, Not tested. "Pass (DR-…)" means the step did what the script says and a separate defect is logged.

### Part A: Lead, the queue

| Step | Role | Result | Note |
|---|---|---|---|
| 1 | Lead | Pass | Home shows the four panels. The bell had 10 "is in the engineering queue" alerts; the email "[QuoteFlow] CCQ-2026-… needs your review: Engineering queue" arrived. |
| 2 | Lead | Pass | Two tabs; aging chips; "Buckets, not an SLA (D-20)." |
| 3 | Lead | Pass | Columns and order match, plus an extra **SF close** column and a menu column (script corrected). The chip with a sales leader's reason was not exercised; a seeded quote shows "(override)". |
| 4 | Lead | Pass | Tier, Engineer (including Unassigned) and Product family filters narrow the list (28, then 8, then 3, then 0); Clear all restores 28. |
| 5 | Lead | Pass | Dialog lists engineers with open counts and "Suggested: Alan Neiberger (PET) · Use it"; nothing preselected; an empty submit says "Choose an engineer."; then "Assigned to … They have been notified." |
| 6 | Lead | Pass | Reassign works; the new engineer gets in-app and email. The engineer it is taken from is not told (E-1). |
| 7 | Lead | Pass | Bulk assign of two quotes; one notification each. |
| 8 | Lead | Pass | "Reassign an engineer's work": 5 quotes moved to the other engineer, who was notified. The "To" list omits the "From" engineer. Moved back through the API afterwards. |
| 9 | Lead | Pass | Position 1 needs a justification of 15 characters or more; the quote moved to the top; Timeline → Overrides shows "Engineering queue position overridden: — → #1" with Revert. |
| 10 | Lead | Pass | Opens the G2 dialog with Rework preselected; an empty note is refused ("Add a note."); the KAM got in-app and email with reason and note. |

### Part B: Engineer

| Step | Role | Result | Note |
|---|---|---|---|
| 11 | Engineer | Pass | Home "My assignments"; navigation Home, My assignments, Pipeline only. |
| 12 | Engineer | Pass | Own quotes on top, the queue below. |
| 13 | Engineer | Pass | "Review accepted"; Accepted shows time and name. |
| 14 | Engineer | Pass | From the intake shows resin, market › sub-market, neck, PCR, color; blank facts are not listed. |
| 15 | Engineer | Pass (DR-01) | Saves; capital label and help as written; the machine list has the 14 types. Out-of-range cavitation shows raw text. |
| 15a | Engineer | Pass | v1, then v2 with "Earlier versions (1)". A non-workbook and a `.exe` are refused. |
| 15b | Engineer | Pass | The four details appear only while ticked and are gone after untick, save and reload; pack-out takes whole numbers. |
| 15c | Engineer | Pass | Read-only "Legacy notes" card (staged by SQL). |
| 16 | Engineer | Pass | Capital reads back. |
| 17 | Engineer | Pass (DR-02, DR-11) | A missing effectiveness is refused "Row 1: state the assumed effectiveness % (there is no default)"; utilization after is read-only; no buffer field; "101.8% · exceeds line capacity"; basis line as written. |
| 18 | Engineer | Pass | Cavitation 12 to 6 changed utilization after from 65.8% to 69.5% (hand check: 62 + 750,000 / 12 × 14.5 s ÷ (350 × 24 × 0.80 h) = 65.75%). |
| 19 | Engineer | Pass | Warning "allocate 200,000 … 550,000 fewer … you can still save"; Remove row 2 keeps one row. |
| 20 | Engineer | Pass (DR-11) | CSV `CCQ-2026-00151-capacity-evidence.csv`; "Attach analysis" lists the file as a capacity analysis. The export is audited. |
| 21 | Engineer | Pass | CAD and PDF listed with kind, size, name, time; note kept; Timeline → Files shows both. |
| 22 | Engineer | Pass | `.zip` and `.exe` refused with the allowed list. |
| 23 | Engineer | Pass | No Decide G2… or Assign…. API: assignment, bulk reassign and G2 decision are 403 for `engineer`. |
| 24 | Engineer | Pass | Read-only on another engineer's quote (but see E-4). |
| 25 | Engineer | Pass | The missing list names six items; then "Submitted to the engineering lead … locked for you". |

### Part C: Lead, review, capacity and G2

| Step | Role | Result | Note |
|---|---|---|---|
| 26 | Lead | Pass | "Ready for my review (1)" lists it. |
| 27 | Lead | Pass | An empty note is refused ("Say what to change."); the send-back notifies the engineer (in-app and email, note included); the tab reopens; the count drops to 0. The field is labelled "What should change?". |
| 28 | Engineer | Pass | Re-submit notifies the lead again. |
| 29 | Lead | Pass | Capital and utilization readable. |
| 30 | Lead | Pass | Missing list: "Capacity sign-off by the capacity owner". Record decision stays enabled; the server refuses. |
| 31 | Lead | Pass | Block is disabled until there is a note. |
| 32 | Lead | Pass | "Capacity approved". |
| 33 | Lead | Pass | "Advance recorded … now in Quoting"; both pricing users and the KAM notified. |
| 34 | Lead, Engineer | Pass | Lock line as written; no editable inputs for either; API writes are 409 "Section locked". |
| 35 | Lead | Pass | "Add a note." first, then Quoting. |
| 36 | Lead | Pass (DR-03) | Refused until the capital figure and the BOM are on file; then Quoting with "Capital pending (budgetary)". |
| 37 | Lead | Pass (DR-04) | Reason, review date, owner and note are required; header "On hold until … · owner …"; KAM told. |
| 38 | Lead | Pass | Stays in Engineering Review; decision and note on the timeline; KAM told. |
| 39 | Lead | Pass | Reason and note required; closes as Declined; KAM told. |
| 40 | Lead | Pass | Header "Feasible solution?" opens the G2 dialog; seven ⓘ buttons "What “…” means". |
| 41 | Engineer | Pass | Quoting tab read-only. |
| 42 | Lead | Pass | Posted by `pricing-lead` through the API ("Rework (back to Engineering)"). Lead, engineer and KAM told; the tab is reopened for the engineer, lock line gone. Pricing's own screen was not driven. |
| 43 | Lead | Pass | Analytics → Engineering; each chart has an "About …" button. |
| 44 | Lead | Pass | The mention picker works; the KAM got the mention, the lead got the KAM's comment, nobody was told of their own. The staged quote had no assigned engineer, so that recipient was not exercised. The email carries no comment text. |

### Part D: Faron (capacity analyst)

| Step | Role | Result | Note |
|---|---|---|---|
| 45 | Engineer | Pass | Done as the assigned engineer (same screen as step 17). |
| 46 | Engineer | Pass | The hand calculation matches (step 18); effectiveness is applied once. |
| 47 | Engineer | Not tested | Asks Faron for an opinion. |

### Part E: FB-06

| Step | Role | Result | Note |
|---|---|---|---|
| 48 | Lead | Pass | PET to Neiberger, HDPE and PP to Pasillas, nothing preselected. With the seeded names (no match) there is no suggestion, as the script says. |
| 49 | Lead | Not tested | Business judgement. |
| 50 | Engineer | Pass | Remove is on the **Attachments** tab (confirm dialog); the previous version becomes current; Timeline → Files "File removed". The 24-hour limit could not be aged. |
| 51 | Engineer | Pass | No upload button; the file downloads. API: only the EngLead and the assigned engineer may upload; every other role is 403. |
| 52 | Lead | Pass | No upload, two-step or pack-out inputs after G2; API upload is 409 "Section locked". |
| 53 | Engineer | Pass | Number inputs refuse letters; 1.5, 0 and -3 are refused (raw text, DR-01); the preform number stops at 40, the freight note at 300. |
| 54 | Engineer | Pass | The "From engineering" card shows BOM file, version, uploader, date, two-step and pack-out. |

### Part F: FB-13

| Step | Role | Result | Note |
|---|---|---|---|
| 55 | Engineer | Pass | 22 plants in the listed order; no placeholder. |
| 56 | Engineer | Pass | 14 machine types in order; no "Provisional list" note. |
| 57 | Lead | Not tested | Needs Jim's spreadsheet. |
| 58 | Engineer | Pass | Persisted after reload. |
| 59 | Engineer | Pass | The same 22 in the preform, blow and capacity site lists. |
| 60 | Lead | Pass | Same suggestions as step 48. |
| 61 | Lead | Pass | "Placeholder plant 01 (no longer offered)" and "EBM shuttle (no longer offered)"; other edits save; the API refuses a new write of a retired or unknown plant or machine value (422). Staged by SQL. |

### Part G: FB-09, FB-12, FB-08

| Step | Role | Result | Note |
|---|---|---|---|
| 62 | Engineer | Pass | Resin, PCR and additive show the typed values, not "Other". |
| 63 | Engineer | Pass | "HDPE · LyondellBasell Pro-fax 6331". |
| 64 | Engineer | Pass | The longest entries show in full at 1280 px. |
| 65 | Engineer | Not tested | Business judgement. |
| 66 | Engineer | Pass | "Food › Snacks & Confections"; a market alone shows "Food". A quote with neither was not checked. |
| 67 | Engineer | Pass | "PCR-HDPE (no longer offered)" and "Pharma/Health (no longer offered)" once the inactive resin entry existed (E-9). |
| 68 | Lead | Pass (DR-05) | PS, Other and the retired resin: no suggestion before a process type. After saving ISBM, RHB or IMM the PET engineer is suggested, after EBM or IBM the other; **IMM Preform and Assembly: none**. |
| 69 | Engineer | Pass | Saved and persisted; the ⓘ explains three options. There is an extra "Not set" choice and MOQ is free text (script corrected). |
| 70 | Engineer | Pass | Read-only on another engineer's quote. |
| 71 | Lead | Pass | The lead can edit. |
| 72 | Engineer | Pass | Payment terms and the terms check are read-only; no Save terms. |
| 73 | Engineer | Pass | Same field as the intake answer; Pricing's Quoting tab shows "Customer-funded" after Engineering saved it. |

### API checks (13 personas)

A denied call returned `403` with `application/problem+json` for: assign, bulk reassign, PUT eng-review, accept, send-back, capacity evidence, capacity sign-off, `terms/engineering` and G2 decision, for every persona outside the allowed set (EngLead or Admin for assign and reassign; EngLead or the assigned engineer for the Engineering writes; EngLead for send-back, sign-off and G2). `GET /queue/engineering` and `/analytics/engineering` were 403 for KAM, Sales leader, Pricing, Pricing lead, Approver, Finance and multi-role, and 200 for EngLead, Engineers, Leadership and Admin. `engineer-owner` gets 404 (not 403) for quotes it is not assigned, in the UI ("Not found"), in the queue (5 items, none unassigned or owned by others) and in the API; an owner-scoped KAM gets 404 on these quotes. For allowed roles the mutating routes were skipped (their success was covered in the UI).

### Other checks

| Check | Result |
|---|---|
| Notifications and email, once each, actor not told | Pass for assign, reassign, submit, send-back, G2 outcomes, return to KAM, hold, stop and comment. Links point at the local site. Emails carry decision and send-back notes but no comment text. |
| Audit | Read for CCQ-2026-00151: create, stage changes, every `eng_review` and `capacity_evidence` update, uploads and the capacity export, each with actor and time. Views are logged but not on every page load (E-8). |
| axe (WCAG 2.1 A/AA) | No violations on home, queue, My assignments, the Engineering tab (several states), Attachments, the assign, pin, G2 and reassign dialogs, Analytics → Engineering. |
| Keyboard | Skip link first; focus ring visible; row menu and assign dialog work and trap focus. After Escape, focus goes to the top of the page (DR-07). The first row menu is 37 Tab presses away. |
| Mobile 390 px | No horizontal scroll on the queue, My assignments, home, Overview and both Engineering tabs. Small tap targets (DR-08). |
| Robustness | Two tabs on one quote: each save sent only its own field and neither overwrote the other. Double-click on Assign: one notification. Double-click on Comment: two comments (DR-06). Reload keeps saved data. Quotes, ampersands, accents, emoji and `<b>` are kept in Engineering fields. |
| Long text via the API | 4,001 characters refused (tooling, concept, G2 note, capacity note), 4,000 accepted; MOQ of 201, preform number of 41 and line of 121 refused. The messages are generic ("Request body is invalid"). |

## B. Defects

| ID | Severity | Where | Steps | Expected | Actual | Evidence | Suspected cause |
|---|---|---|---|---|---|---|---|
| DR-engineering-01 | Sev-3 | Engineering tab, engineer or lead (cavitation, budgetary capital, pack-out, capacity percentages, run days, cycle time) | 1. Open Solution. 2. Type 0 in Cavitation. 3. Save solution. (Same with 1.5 in a pack-out box, or 150 in Utilization before.) | A plain sentence that names the field and the limit | Raw validation text: "Too small: expected number to be >=1", "Invalid input: expected int, received number", "Too big: expected number to be <=100". Some forms show it twice; the text is not tied to the field with `aria-describedby`. | `b-cav-error.png` | zod default messages passed through in `apps/web/src/components/engineering/` |
| DR-engineering-02 | Sev-2 | Capacity evidence and G2 Advance, UI and API, engineer or lead | 1. Add a capacity row with **Assumed effectiveness % = 0**. 2. Save capacity evidence. 3. Approve capacity. 4. Decide G2, Advance. | 0% refused (an assumption of 0 means nothing), or Advance blocked while utilization after cannot be calculated | The row saves and **Utilization after is not calculated** ("Calculated once … are in"; the CSV says "not calculated" with a blank capacity). G2 Advance is recorded (201). | `files\dl-CCQ-2026-00151-capacity-evidence.csv` (the CSV with the 0 row). Advance repeated through the API on CCQ-2026-00155 | `pct` in `packages/contracts/src/eng-review.ts` allows 0; the G2 requirement only needs a row and a sign-off |
| DR-engineering-03 | Sev-3 | Decide G2…, lead | 1. On a quote with no capital figure and no BOM choose "Advance – capital required". | A readable missing list: "Budgetary capital estimate", "Equipment BOM" | The list says "prelim_capital_usd is required" and Record decision alerts "equipment_bom_on_file must equal true". (The BOM line is readable: "The equipment BOM uploaded on the Engineering tab".) | `c-capital-refused.png` | gate requirement keys shown as is |
| DR-engineering-04 | Sev-3 | Decide G2…, Hold, lead | 1. Choose Hold. 2. Reason, owner, note. 3. Review date 2026-11-01 (nine days ago). 4. Record decision. | A past review date refused, or a warning | Accepted: "On hold until 2026-11-01 · owner …"; the KAM is told "Review date: 2026-11-01". The date box has no minimum. | `c-hold.png` | no `min` on the date field and no check in the hold rule |
| DR-engineering-05 | Sev-3 | Assign dialog suggestion, lead | 1. Save Process type **IMM Preform** (or Assembly) on an unassigned quote. 2. Open Assign…. | Injection (the script and the rule text say "injection") goes to the PET engineer | No "Suggested:" line. ISBM, RHB and IMM do suggest the PET engineer. | none (absence of a line); `a-assign-suggest.png` shows the dialog for ISBM | `ASSIGNMENT_RULES_SEED` in `packages/domain/src/engineering/assignment-rules.ts` lists `IMM` but not `IMM_PREFORM`, which is in the process list |
| DR-engineering-06 | Sev-3 | Timeline comment box, any role | 1. Open a quote. 2. Type a comment. 3. Double-click **Comment**. | One comment | Two identical comments (repeated once from a clean quote with the same result), and a notification for each | none (database count: 2 rows) | the button is not disabled while the request runs |
| DR-engineering-07 | Sev-3 | Queue row menu and dialogs, keyboard users | 1. Tab to a row's **Actions for CCQ-…** button. 2. Enter, then Assign…. 3. Escape. | Focus returns to the row's Actions button | Focus goes back to the top of the page; the row menu is then 37 Tab presses away again. | none | menu to dialog hand-off without a focus return target |
| DR-engineering-08 | Sev-3 | 390 px, lead and engineer | 1. Open the queue, My assignments, home or an Engineering tab at 390 px. | Controls of at least 44 px | Under 44 px: quote links in the queue (126x24) and on My assignments (111x20); "Why this priority?" (56x32); **Override** (97x32); the ⓘ "About" buttons (32x32); the queue age chips (36 px high); the Overview timeline tabs (36 px high); "What do the funding options mean?" (32 px); checkboxes (16 to 20 px) | `mob-queue.png`, `mob-my-assignments.png`, `mob-home.png`, `mob-overview.png`, `mob-eng-tab-lead.png` | n/a |
| DR-engineering-09 | Sev-4 | Equipment BOM upload and the Reassign work dialog | Upload a non-workbook as the BOM; open Reassign work. | "not an Excel workbook"; "Choose an engineer…" | "The file's content is not a Excel workbook"; "Choose a engineer…" | none | string literals |
| DR-engineering-10 | Sev-4 | Decide G2…, Rework, Hold and Stop | Select Rework. | A Note helper that says what to write | The helper reads "Required for exception decisions", which does not fit these outcomes | `c-hold.png` | shared helper text |
| DR-engineering-11 | Sev-4 | Capacity CSV | Download CSV on a quote with a site. | The site as its label ("St. Charles") | The site column holds the code `ST_CHARLES` | `files\dl-CCQ-2026-00151-capacity-evidence.csv` | the export writes the stored code |
| DR-engineering-12 | Sev-4 | Timeline comments | Post a comment containing `<script>x</script>`. | The text kept as typed (Engineering notes keep `<b>B</b>`) | The tags are silently removed and the comment reads "x" | none (database text) | comment sanitiser |

## C. Script corrections made

In `docs/uat/scripts/engineering.md` (step numbers unchanged; the quick-starts needed no change, so `print.html` was not touched):

- Step 3: the column list includes **SF close** (and a menu column).
- Step 50: says where the removal is (Attachments tab, **Remove**, confirm).
- Step 69: the funding list also has **Not set**, and **MOQ** is free text of up to 200 characters, not a number.

## D. Could not test, and why

- Steps 47, 49, 57 and 65: they ask for a business opinion or need Jim Zweifel's spreadsheet.
- The 24-hour removal window of step 50 expiring: the data cannot be aged without editing the database.
- The `pnpm e2e` baseline: not run (the machine was short of memory with five sessions running).
- Pricing's own G3 screen (step 42 was done through the API) and the intake and G1 screens (the quotes were created through the API).
- Microsoft sign-in, Azure, Fabric, SharePoint and live Salesforce: not available locally.
- A quote with neither market nor sub-market (the last sentence of step 66).
- Double-click on "Submit to engineering lead" and on "Record decision"; browser Back mid-dialog; the `kam-region` persona; dark mode.
- The chip showing a sales leader's priority reason (step 3).

## E. Observations (not defects, may confuse a pilot user)

1. When a quote is reassigned, the engineer it is taken from is not told (they only ever got "assigned to you"). The Reassign work toast does not say anyone was notified.
2. Saving a budgetary capital estimate rescores the quote (ENG-1 went from 62 High to 56 Standard), and the Quoting tab then says "Engineering did not say capital is required" when the lead chose a plain Advance with $2.5M entered. Correct by the rules, but a pilot user may ask why.
3. The lead can accept a review on the engineer's behalf (row menu "Accept (start review)").
4. Any engineer sees **Attach analysis** on a quote that is not theirs; the API allows `attachment.upload` for every engineer, and attachments are not locked after G2 (a capacity analysis was accepted on a quote already in Quoting).
5. The assign dialog lists the lead too ("Viviane Carroll (0 open, lead)"), and with a mixed selection (PP and HDPE) the "Suggested" line follows the first quote only.
6. Timeline "File uploaded: bom2.xlsx" does not say it is the equipment BOM or which version; "File removed" does not say which version.
7. API validation messages are generic ("Request body is invalid", "The change was not accepted", "The decision was not accepted"). A client that re-sends an unchanged retired plant is refused; the web form only sends changed fields, so users do not meet this.
8. Quote views are audited, but not on every page load (a user's repeated views within a few minutes gave one row).
9. On a database seeded from scratch there are no inactive resin entries, so a quote on a retired resin shows the raw code (`PCR_HDPE`). On the test site the migration should have kept them; Ben can confirm by opening `<CCQ-ENG-RETIRED>`.
10. A capacity row accepts an analysis date in the future (2030-01-01).
11. The Engineering tab is one long page for the lead (about 6,000 px at 390 px); a pilot user on a phone will scroll a lot.
