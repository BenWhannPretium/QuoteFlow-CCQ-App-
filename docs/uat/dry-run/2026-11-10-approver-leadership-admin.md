# AI dry-run UAT: approver, leadership and admin (session 4 of 5)

This is what Claude Code saw when it ran the scripts against a local copy. It does not replace business UAT
or sign-off, and nothing here says the build is acceptable.

## Header

| | |
|---|---|
| Date | 2026-11-10 |
| Commit | `4b018b682f061bf33270c93b0d134b2a58d0a3ec` (`origin/main`) |
| Scope | `docs/uat/scripts/approver.md` (all parts, including optional Part G), `leadership.md`, `priority-calibration.md`. Quick-starts `approver.md`, `leadership.md`, `admin.md` |
| Node | **v24.22.1** (the repo wants 22). `pnpm i` ran with `npm_config_engine_strict=false`. The nested `pnpm --filter … db:migrate` calls still refused to run (the repo's `.npmrc` has `engine-strict=true`), so migrate and seed were run directly with `tsx` from `packages/db` (`src/cli/migrate.ts`, `src/cli/seed.ts --synthetic`). The API ran with `tsx src/server.ts`. |
| Database | Docker `postgres:16` container `ccq-uat-4`, port 5504, migrated and seeded with `--synthetic` (150 quotes). |
| Mail | Docker `axllent/mailpit:v1.27` container `ccq-uat-mail-4` (SMTP 1104, UI 8104), `MAIL_MODE=smtp`. Email was read through the Mailpit API. |
| Servers | API on 3104, web on 5204 (`vite --port 5204 --strictPort`). `AUTH_MODE=dev`, `SF_MODE=fake`. |
| Browser | Playwright with the installed Microsoft Edge (`channel: 'msedge'`; there was no pre-installed Chromium on this machine). Desktop 1280×800 and mobile 390×844, `deviceScaleFactor: 1`. axe-core through `@axe-core/playwright`, WCAG 2.0 and 2.1 A and AA tags. |
| Personas | `approver`, `leadership`, `admin`, `sales-leader`, `multi-role`. To stage quotes and hand-offs: `kam`, `eng-lead`, `engineer`, `pricing`, `pricing-lead`, `finance`. |
| Evidence | Screenshots and run logs are in the session scratchpad and are **not committed**: screenshots `m-review-top.png`, `m-decision-bar-clipped.png`, `m-settings.png`, `m-analytics.png`, `l-analytics-fromto.png`, `d-capital.png`, `f-inbox.png`, `f-triage.png`, `a-scoring.png`; exports `pipeline-export.csv`, `audit-export.csv`; the throwaway scripts `tNN.cjs` that drove each check; running notes `notes.md`. |

**Two harness notes you should know about.**

1. `apps/web/vite.config.ts` reads `VITE_API_PROXY_TARGET` from `process.env` only. A line in `.env` does not reach it (`.env.example` suggests it does). On the first run the web proxy fell back to `http://localhost:3000`, which is the user's own service on this machine. Only `GET` requests (sign-in, queue, health) reached it, nothing was written there. It was fixed by starting Vite with the variable set in the shell. (Observation E-1.)
2. Quotes were staged by calling the API as the right personas (intake, G1, Engineering, Pricing, G3, terms), the same sequence `apps/web/e2e/final-review.spec.ts` uses, and only one intake (CCQ-2026-00162) was submitted through the UI wizard. For approver step 19 the script says Ben gives the tester the Pricing role for one step. Here a `Pricing` row was inserted into `user_role` for the approver persona for the time it took to name them price approver on CCQ-2026-00161, then deleted. No quote was moved by editing the database.
3. The synthetic seed leaves only 6 free Salesforce opportunities, so some fixtures are seeded Final Review quotes: Part G's customer-funded and company-funded quotes are CCQ-2026-00083 and CCQ-2026-00094, whose funding model and capital terms were set and confirmed by the approver through the API (the same call the form makes). I also used the seeded quotes CCQ-2026-00020, -00066, -00070, -00074, -00092, -00095, -00104 and -00108 for hold, validation and concurrency checks, so they are in changed states now. The local database was a throwaway and has been removed.

**Not covered** (details in section D): Microsoft sign-in, Azure, Fabric, SharePoint, live Salesforce; the repo's own `pnpm e2e` baseline; activating the draft scoring model (the script says not to); `g4_required_checks` as a blocker; the two-step and pack-out read-outs (step 23); the "no longer offered" market label (step 33); the five golden quotes (step 4b); step 2a as written.

## Summary

The approver's Final Review flow, the capital terms and exception gating, the optional extra customer-funded sign-offs, the Leadership read-only views, the analytics numbers I checked against the database (counts by stage, win rate, capture rate, median intake to G4, time in stage, loss Pareto), the Admin configuration console, the draft scoring-model preview and the two feature switches all behaved as the scripts describe, with the corrections in section C. Every Admin route I probed (20 routes) and the three Final Review write routes refused the wrong roles with a `problem+json` 403, and all three feature switches were put back off. I found **no Sev-1** defect. The one **Sev-2** is a segregation gap: the KAM of a quote, and the person who approved its price, can still edit and confirm the capital terms on the Final Review screen even though the screen and the API refuse their G4 decision. The Sev-3 items are mostly raw rule or validation text in refusals, the Rework/Advance labels cut off on a phone, a hold that accepts a past review date, and the audit "gate decision" filter missing most decisions.

| Severity | Count |
|---|---|
| Sev-1 | 0 |
| Sev-2 | 1 |
| Sev-3 | 11 |
| Sev-4 | 3 |

Coverage: every step of the three scripts has a row in section A. Not tested or only partly tested: approver steps 23 and 32 (and the retired-market part of 33), and priority-calibration steps 2a, 4b and 8 (section D).

## A. Coverage

Result key: **Pass** means I saw it work in the running app. **Pass (script corrected)** means the app behaved sensibly and the script text was wrong, fixed in section C. **Fail** has a defect id.

### approver.md

| Step | Role | Result | Note |
|---|---|---|---|
| 1 | Approver | Pass (script corrected) | Subject is "[QuoteFlow] CCQ-… needs your decision: Final Review", not "needs your review". Names quote, account, product, priority; link `/quotes/<n>/review` works. No amounts (the word "capital" appears only in the footer line "Pricing and capital figures are never sent by email"). Sent once to the approver, once to `multi-role` (also an Approver). |
| 2 | Approver (390 px) | Pass | Home **Approvals**, **Pending final review (G4)**, **Decided recently**, tabs Home, Pipeline, Approvals, Analytics. Home lists 10 of 21 waiting quotes and an **Open final review** button. |
| 3 | Approver (390 px) | Pass | Chips Waiting, Capital required / with risk (G2), Capital pending, You can decide. |
| 4 | Approver (390 px) | Pass | Price approval, Capital readiness, Engineering (G2), KAM, Pricing approver, **Review & decide**. |
| 5 | Approver (390 px) | Pass | All sections present. The decision bar sits above the bottom tabs. |
| 6 | Approver (390 px) | Pass | Capital estimate, capacity before and after (68.42% calculated on a staged quote), pricing basis and range. No horizontal scroll. See DR-02 and DR-12 for the phone layout. |
| 7 | Approver (390 px) | Pass | Dialog text as scripted. Valid until shown as an ISO date (E-3). |
| 8 | Approver | Pass | "The proposal issue date can’t be in the future: enter the date it was actually sent." |
| 9 | Approver | Pass | Stage Customer Decision, not Awarded. KAM and the pricing approver notified (in app and email), the actor not. A double-click on **Record decision** made one decision (4 stage changes, 1 G4 event). |
| 10 | Approver | Pass | "Choose a reason." and "Add a note." |
| 11 | Approver | Pass | Closes as Declined, reason `capacity_unavailable`, closure owner = the approver. KAM and Pricing notified. A note with `<b>"x"</b> & ' é 😀` saved. |
| 12 | Approver | Pass (script corrected) | **Reason is optional** for Rework (it reads "Reason (optional)"). **Send back to (required)** and the note are required. |
| 13 | Approver | Pass | Back in Quoting, version 2. Pricing (both pricers) and the KAM notified. Also tried Engineering Review (API): version 2, KAM, the lead and the engineer notified, Engineering editable again. |
| 14 | Approver | Pass | "Add a note." with reason, date and owner filled. Stays in Final Review, KAM told, owner is the approver (not told). **See DR-04 and DR-05.** |
| 15 | Approver | Pass | Two warnings, each with an **Open the Commercial panel** link. Terms read-only. |
| 16 | Approver | Pass | Released with both warnings. The decision stores `acknowledgedWarnings: [TERMS_NOT_CHECKED, LEGAL_REVIEW_NOT_RECORDED]`. `g4_required_checks` was not changed (D-6). |
| 17 | Approver | Pass | "Locked after G4 · decided by <name> on <date> · reopens if the quote is sent back". Terms, capital terms, pricing record, Engineering, capital readiness all 409 by API for every role. |
| 18 | `multi-role` as KAM | Pass | Bar: "You cannot decide Final Review on a quote where you are the KAM". API `403` problem+json with the same text. **But DR-01** (capital terms still editable). |
| 19 | Approver as price approver | Pass | Bar and API `403` as scripted (fixture: see header note 2). **DR-01** applies here too. |
| 20 | Approver | Pass | `/review` on a closed quote: "This quote is no longer waiting for Final Review: it is in Closed – Won (closed)." and the bar says "No decision is waiting on this quote." |
| 21 | Approver | Pass | No price-approval, terms or other gate buttons. The only editor is **Save capital terms** (Part E). |
| 22 | Approver | Pass | 7 decisions listed, counts by outcome match the ones I made. |
| 23 | Approver | Partly tested | Equipment BOM shows file, version, "current", uploader, date. Two-step and pack-out were **not** shown or checked: no free quote to enter them on, and Engineering is locked after G2 (D-4). |
| 24 | Approver | Pass | Text as scripted, ⓘ present, **Mold ownership** pre-filled by the KAM. |
| 25 | Approver | Pass (see DR-03) | Refused, quote stays in Final Review. Wording is rule text: "At least one of: g4_terms_finalized_check_required must equal false or terms_finalized_at is required". It also shows as "Missing before it can move on:" in the dialog before submit. |
| 26 | Approver | Pass (see DR-10) | "Confirming the capital terms needs the funding model", "Say over how many months it is amortized", "Give the agreement duration in months", "Confirming the capital terms needs the minimum supply / shortfall terms" (spaces only). 0 months: "Too small: expected number to be >=1"; 999: "Too big: expected number to be <=240". Minimum supply is capped at 300. |
| 27 | Approver | Pass | "Capital terms confirmed", "Confirmed by <name> on <date>.", button reads **Confirmed**. |
| 28 | Approver | Pass | "Capital terms saved: The change cleared the approver’s confirmation." and re-confirm works. |
| 29 | Approver | Pass | Card shows **Waiting for the pricing lead**. No Approve/Reject for the approver. `terms/exception/decision` is `403` for approver, KAM, pricing, leadership, admin and eng-lead. Release refused while waiting and while rejected (same raw text, DR-03). |
| 30 | Pricing lead | Pass | Rationale required (empty and spaces: 422; 1001 characters: 400). After approval the card shows **Approved**, rationale, who and when. A rejected one was also tried, then re-requested with Net 45 and approved. |
| 31 | Approver | Pass | Released. Capital and payment terms locked for KAM, Pricing, Engineering and the approver (409). |
| 32 | Approver | Not tested | A business question. Observation E-6 on the list. |
| 33 | Approver | Pass | "Food › Snacks & Confections". The "(no longer offered)" case was not tested (D-5). |
| 34 | Approver | Pass | Resin "Other"; Customer-specified resin, PCR % and Additives show what the KAM typed. |
| 35 | Approver | Pass | With the switch off there is no sign-off section. |
| 36 | Admin | Pass | JSON edit, reason required, "Saved. The change is in the decision log.", version 1 to 2, in the decision log and audit log. |
| 37 | Approver | Pass | Section lists **Sales leader: waiting**, **Leadership: waiting**. Refused: "Final Review also needs: Sales leader, then Leadership". No Sign off button. |
| 38 | Leadership | Pass | Same section, no **Sign off** yet. API wrong order: `422`. |
| 39 | Sales leader | Pass | "Sales leader signed off", "signed by <name>, <time>". Second sign-off: 409 "Sales leader has already signed off". Every other role: 403. The sales leader cannot sign the Leadership slot (403). |
| 40 | Leadership, Approver | Pass | "Leadership signed off". Release works and the stage is Customer Decision. The Company-funded quote shows no section and releases. |
| 41 | Admin | Pass | Set `active: false` with a reason. Section gone on a customer-funded quote, no restart. Final value `active: false` (version 3). |

### leadership.md

| Step | Role | Result | Note |
|---|---|---|---|
| 1 | Leadership | Pass | All five tiles and sections present. |
| 2 | Leadership | Pass | Home, Engineering queue, Pricing queue, Pipeline, Approvals, Analytics, Admin. |
| 3 | Leadership | Pass | Two views, filters, section links. |
| 4 | Leadership | Pass | Definition and window; amount is the Salesforce opportunity amount as entered. |
| 5 | Leadership | Pass | Win rate counts decided only and sits beside capture. "Awards still in Commit & Hand Off" is on the **Awarded, commitment pending** card, not in the win-rate ⓘ. |
| 6 | Leadership | Pass | Holds excluded, stated in both. |
| 7 | Leadership | Pass | All 24 ⓘ buttons open a dialog with **Definition** and **Time window**. I did not form opinions on the definitions. |
| 8 | Leadership | Pass | Table and Chart toggle. |
| 9 | Leadership | Pass (script corrected) | The link is **View quotes** in the **Drill down** column. `/quotes?stage=ENG_REVIEW&status=open` shows 22 quotes, matching the table. |
| 10 | Leadership | Pass | KAM Russ Kuphal: 7 awarded of 9 decided (database agrees). |
| 11 | Leadership | Pass | Footer line on Analytics and on Home. |
| 12 | Leadership | Pass | Override log loads (22 seeded rows). The seed has no queue-position override, so that part of the expected text is untestable here. |
| 13 | Leadership | Pass | Status and Field filters narrow the list. |
| 14 | Leadership | Pass | My view of the quote is in the audit log with my name and US Central time. |
| 15 | Leadership | **Fail (DR-06)** | Action **gate decision** lists only holds. Approve, decline and return are logged as **stage change**. |
| 16 | Leadership | Pass | Usage and Outcomes reports load; "Operational; not D&A-certified." |
| 17 | Leadership | Pass | "Export ready. The download is recorded in the audit log." CSV has the 12 columns shown. The Capital readiness column holds the raw code (DR-15). |
| 18 | Leadership | Pass | `ccq-audit.csv`, 1,102 rows, UTC column `at_utc`. |
| 19 | Leadership | Pass | Both exports listed under **export**. |
| 20 | Leadership | Pass | Pricing record and capital readiness readable; no price-approval buttons or uploads. |
| 21 | Leadership | Pass | No gate buttons in the header. |
| 22 | Leadership | Pass | "You are reading this review. Final Review decisions are taken by an approver." |
| 23 | Leadership | Pass | Settings, reason codes (and value lists, workflow, scoring, users, integrations) are read-only: no Edit, Save, Add buttons. A "Read-only" banner is shown. |
| 24 | Leadership | Pass | No Assign / Reassign buttons. |
| 25 | Leadership | Pass | All fields and statuses readable, no editing controls. |
| 26 | Leadership | Pass | "Food › Snacks & Confections". |
| 27 | Leadership | Pass | `active: false`, no Edit. (Opinion on A-035 not given.) |
| 28 | Leadership | Pass | Done as Part G above. |

### priority-calibration.md

| Step | Role | Result | Note |
|---|---|---|---|
| 1 | Admin | Pass | v2 Active, v3 Draft, Provisional, Not active. |
| 2 | Admin | Pass | The draft's note says weights and tiers equal v2; only Strategic fit has points. I read it but did not diff every weight. |
| 2a | Admin | Not tested | In this seed 79 of 93 open quotes already have a sub-market, so the "No open quote has a sub-market yet" note cannot appear (D-3). |
| 2b | KAM | Pass | CCQ-2026-00162 (Food › Snacks & Confections) submitted through the UI wizard; CCQ-2026-00163 (Home Care › Pet Care) and CCQ-2026-00164 submitted by API. |
| 3 | Admin | Pass | "96 of 96 open quotes … 15 tier changes … average −0.5, biggest rise +4.5, biggest fall −4.5". Table has all columns. Nothing saved. |
| 4 | Admin | Pass | Quote 00162: Strategic fit (sub-market) 50 → 80 (+4.5). Quote 00163: 50 → 20 (−4.5). |
| 4a | Admin | Pass | 27 scored: 80 points ×8, 50 points ×10, 20 points ×9. Histology, Tubes & Vials and Home Care › Non-Core are not listed. Read-only list. |
| 4b | Admin | Not tested | The five golden quotes were not staged. |
| 5 | Admin | Pass | Dialog needs a reason and offers **Rescore the open quotes now** (ticked). Cancel leaves the draft Not active. I did not click Activate. |
| 6 | Leadership | Pass | Same preview. |
| 7 | Leadership | Pass | No Activate, Discard, Save draft, Add band or Add code. |
| 8 | Leadership | Not tested | A request for an opinion. |
| 9 | Admin | Pass | Values match the script: ISBM 1M, RHB 1M, IMM 3M, IBM 3M, EBM 1M. |
| 10 | KAM | Pass (script corrected) | Warning appears under the volume on the Product & volume step. The Review step does not repeat it. Submit is available. |
| 11 | KAM | Pass | Gone at 1,500,000, back at 750,000. |
| 12 | Sales leader | Pass | Dialog shows the warning, **Record decision** enabled, no exception note. |
| 13 | Admin | Pass | Saved as scripted. |
| 14 | KAM | Pass | 2,000,000 goes to Engineering Review (submitted by API). |
| 15 | Sales leader | Pass | The 750,000 quote is in **To qualify**, the 2,000,000 one is not. Arrival notice: "Annual volume 750,000 is outside the 1,000,000 or more band: the sales leader qualifies it." |
| 16 | Admin | Pass (script corrected) | There is no routing action. Filter **update** and **Show**: event `quote.volume_routed` with route and reason. |
| 17 | Admin | Pass | Both set to `false`. A new draft at 750,000 shows no warning. Existing quotes keep their warning text. |
| 18 | Admin | Pass | Live model unchanged, draft Not active. |

### Admin features in the brief (no script)

| Feature | Result | Note |
|---|---|---|
| Reason codes: add, approve, deactivate | Pass | Provisional badge, "Approved · <name>", never deleted, duplicate code refused in plain words, reason required, live in `/config/public` with no restart, audited. |
| Value lists: add, approve, mark provisional, deactivate | Pass | A deactivated value moves to `retiredValues` and quotes keep it. |
| Workflow labels | Pass | Renamed stage Intake and saw it on the leadership home without a restart; restored. Save is disabled with an empty label. |
| Settings and a live change | Pass | `validity_days_default` 30 → 45 showed 45 days in the release dialog at once; restored to 30 (version 3). 0, −5 and 100000 refused. |
| Users and scope | Pass | All → Own quotes only (KAM sees 161 → 53 quotes) → All. A Regions scope cannot be saved without a region. |
| Decision log and audit | Pass | 19 `config_change` audit rows, 19 decision-log rows, all with a reason. |
| Feedback inbox | Pass | A KAM sent two reports (the second with a real PNG); Admin triaged status, owner, GitHub link and a note. The screenshot is `200` for Admin and `403` for leadership, KAM, approver; `PATCH` is `403` for non-admins. |
| Integrations | Pass | Sync now added a run (fetched 0, errors 0). Mail, SharePoint, Pricing and Fabric health read "Unknown" (E-11). |
| Permission probes | Pass | See header and Admin API grid below. |

Admin write routes × roles (leadership, approver, pricing, finance, KAM, engineer, eng-lead, pricing-lead, sales-leader): 20 admin routes (`PATCH` stages, gates and outcomes, reason codes, value lists, settings; scoring draft create, edit, activate, discard; users scope; feedback; Salesforce sync; pricing-history import; `GET` feedback, ERF linkage, pricing history). Every cell was `403` with `application/problem+json`. G4 decision and capital terms: `403` for every non-approver role. UI: KAM, approver, pricing and finance see "You don’t have access to this" on every `/admin/*` page and have no Admin menu item.

## B. Defects

| Id | Severity | Where | Steps | Expected | Actual | Evidence | Suspected cause |
|---|---|---|---|---|---|---|---|
| DR-approver-leadership-admin-01 | **Sev-2** | `PUT /api/v1/quotes/:n/terms/capital` and the Final Review capital form; roles `multi-role` (KAM of the quote) and `approver` (price approver) | 1. Stage a quote in Final Review whose KAM is `multi-role`. 2. As `multi-role` open `/quotes/<n>/review`: the bar says "You cannot decide … where you are the KAM". 3. In the same page edit and **Confirm capital terms** (or `PUT …/terms/capital` with `finalized: true`). 4. Repeat for a quote whose price the approver approved (CCQ-2026-00161). | The person who cannot decide G4 on a quote also cannot edit or confirm its capital terms, which gate the release. | `200`. The capital form is enabled and the confirmation is recorded in the name of the KAM (`finalizedByName` is the `multi-role` user) or of the price approver. Reproduced twice for each. The capital confirmation is the approver's second check on the KAM's own pre-fill, so this removes it. | `t15.cjs`, `t16.cjs` and the final API check in `notes.md` | The segregation rules (`g4-kam-cannot-approve-own`, `g4-price-approver-cannot-release`) are evaluated on the G4 decision only (`packages/domain/src/workflow/evaluate.ts`). `terms.finalize` is not checked against them in `apps/api/src/services/commercial.ts`. |
| DR-approver-leadership-admin-02 | Sev-3 | `/quotes/<n>/review`, Approver, 360, 390 and 414 px | 1. Sign in as `approver`, phone viewport. 2. Open any Final Review quote. 3. Look at the decision bar. | The four button labels fit. | "Rework (back to the affected gate)" and "Advance (release the offer)" are clipped on both sides ("work (back to the affected", "dvance (release the offe"). The primary decision label is unreadable. `scrollWidth` 212 and 186 against `clientWidth` 173 and 175. Reproduced on two quotes and three widths. | `m-review-top.png`, `m-decision-bar-clipped.png` | `apps/web/src/components/final-review/ReviewScreen.tsx` (bar buttons do not wrap). |
| DR-approver-leadership-admin-03 | Sev-3 | G4 release dialog and API; Approver | 1. Open `CCQ-…-FR-CAP` (capital terms not confirmed) or one with a waiting exception. 2. Tap **Advance (release the offer)**. | A plain sentence naming what is missing (the script notes no wording is fixed). | The dialog lists "Missing before it can move on: At least one of: g4_terms_finalized_check_required must equal false or terms_finalized_at is required" (and "…g4_terms_exception_check_required must equal false or terms_exception_open must equal false"). It is the same text after **Record decision**. It does not say whether the exception is waiting or rejected. | `t17.cjs`, `t19.cjs` | Workflow rule engine messages from `packages/domain/src/workflow/evaluate.ts` shown as is. |
| DR-approver-leadership-admin-04 | Sev-3 | **Hold** at G4 (UI and API); Approver | 1. Open a Final Review quote. 2. **Hold**, pick a reason, set **Review date** to a date in the past (UI) or `holdUntil: 2020-01-01` (API), add a note. 3. **Record decision**. | Refused: the review date must be today or later. | Accepted; "On hold until 2020-01-01 · owner <me>" is saved. Reproduced twice (UI, CCQ-2026-00155; API, CCQ-2026-00108). | `t13.cjs` and the API run in `notes.md` | No future-date check on `holdUntil`. |
| DR-approver-leadership-admin-05 | Sev-3 | G4 on a held quote; Approver | 1. Hold a Final Review quote (step 14). 2. Open its `/review`. 3. Tap **Advance (release the offer)**, or `POST …/gates/G4/decisions` `approve`. | The screen says the quote is on hold (with date and owner), and either blocks release or shows how to resume. | `/review` shows no on-hold banner (the hold is shown only on the full quote page). The held quote (CCQ-2026-00155) was released with `201` and went to Customer Decision; there is no Resume. Check whether that is intended. | `t13.cjs`, `t15.cjs` | Review screen reads `stageKey` only. |
| DR-approver-leadership-admin-06 | Sev-3 | **Admin → Audit log**, Action filter; Leadership and Admin | 1. Release, stop and send back some quotes at Final Review. 2. Audit log → **Action = gate decision**. | Every gate decision (script step 15; CLAUDE.md rule 3). | Only holds appear. Approve, decline and return are logged as **stage change** (gate in the detail), so a filter on gate decisions misses most decisions. | scratchpad queries | Audit action is `gate_decision` only when the stage does not change. |
| DR-approver-leadership-admin-07 | Sev-3 | **Analytics**, From and To filters; Leadership | 1. Open Analytics. 2. Set From to 2026-11-10 and To to 2026-10-01. | One short message beside the filter. | 14 stacked red toasts, one per chart, each "Bad Request / `from` is after `to` / Reference: /api/v1/analytics/…". | `l-analytics-fromto.png` | The date inputs have no min/max or form-level check. |
| DR-approver-leadership-admin-08 | Sev-3 | `/admin/settings` at 390 px; Admin and Leadership | 1. Phone viewport. 2. Open **Admin → App settings**. | No sideways scroll. | The page is 823 px wide (433 px of horizontal scroll). The **Other** group overflows. Reproduced for both roles. | `m-settings.png` | Long JSON values in the setting cards do not wrap. |
| DR-approver-leadership-admin-09 | Sev-3 | Capital terms form; Approver | 1. A quote in Final Review where the Sales or Pricing terms check is done. 2. As approver change the **Funding model** and save or confirm. | The terms check stays, or the screen says changing the funding model clears it. | The check is cleared silently (checkedAt null) and the warning "The commercial terms have not been checked by Sales or Pricing" appears. Changing mold ownership or minimum supply does not clear it. In the natural order (check, then approver sets funding) the "terms checked and capital confirmed" state in the script's "Before you start" cannot happen. Only matters as a blocker if `g4_required_checks` includes `terms_checked`. | `t73.cjs`, `t74.cjs` | Funding model is part of the terms the check covers. |
| DR-approver-leadership-admin-10 | Sev-3 | Capital terms months fields; Admin setting save | 1. **Agreement duration (months)** = 0, or 999. 2. Admin setting `validity_days_default` = 0. | Plain wording. | "Too small: expected number to be >=1", "Too big: expected number to be <=240"; setting error starts with the key "validity_days_default must be a whole number of days from 1 to 730". | `t18.cjs`, `t46.cjs` | Raw zod / key text. |
| DR-approver-leadership-admin-11 | Sev-3 | `/admin/reports/usage` at 390 px; Leadership | 1. Phone viewport. 2. Open **Usage report**, run axe. | No serious violations. | axe `scrollable-region-focusable` (serious): the day table's scroll box cannot be reached by keyboard. | `t71.cjs` | `overflow-x-auto` wrapper without `tabindex`. |
| DR-approver-leadership-admin-12 | Sev-3 | Approver home, queue, review; Leadership analytics, mobile | 1. Phone viewport. 2. Measure links and buttons. | 44 px targets. | Quote-number links 20 px high, **Open final review** 36 px, **Open the Commercial panel** 18 px, ⓘ buttons 32×32, **Table** toggles 75×32. On Admin screens, 135 small targets on the Scoring model page and 27 on the Audit log. | `t7.cjs`, `t35.cjs`, `t70.cjs` | Shared button and link sizes. |
| DR-approver-leadership-admin-13 | Sev-4 | Stale second tab at G4 | 1. Open `/review` and the release dialog in two tabs. 2. Record in tab A, then tab B. | Plain: "This quote was already decided." | "Gate G4 applies to stage FINAL_REVIEW, but the quote is in CUSTOMER_DECISION". Only one decision was recorded. | `t67.cjs` | Domain error text. |
| DR-approver-leadership-admin-14 | Sev-4 | **Admin → Scoring model** preview table | 1. Open the preview. | Stage labels. | Raw keys: "ENG_REVIEW · Nutrition & Wellness › Nutritional Powders", "FINAL_REVIEW · …", "CUSTOMER_DECISION · …". | `a-scoring.png` | Stage key not mapped to its label in the preview row. |
| DR-approver-leadership-admin-15 | Sev-4 | **Pipeline → Export CSV**, Leadership | 1. Add **Capital readiness**. 2. Export. | Same wording as the screen ("Capital pre-approved (budgetary)"). | The cell holds `pre_approved`. Stage and tier columns use labels. | `pipeline-export.csv` | Export writes the code. |

## C. Script corrections made

Step numbers are unchanged.

| File | Step | Was | Now | Why |
|---|---|---|---|---|
| `scripts/approver.md` | 1 | "[QuoteFlow] CCQ-… needs your review" … "product and tier" | "… needs your decision: Final Review" … "priority tier" | The G4 email subject and body differ. (The engineering script's "needs your review" is right for its own email and was not changed.) |
| `scripts/approver.md` | 12 | "A reason and a note are required." | "The note is required. The reason is **optional**." | The Rework dialog reads "Reason (optional)" and accepts no reason. |
| `scripts/leadership.md` | 9 | "Click a **Drill down** link" | "Click a **View quotes** link in the **Drill down** column" | That is the link's label. |
| `scripts/priority-calibration.md` | 10 | "Under the volume, and on the review step" | "Under the volume field on the Product & volume step … The Drawing, files & review step does not repeat it." | The warning is not shown on the review step. |
| `scripts/priority-calibration.md` | 16 | "Filter **Action** for routing." | "Filter **Action** = **update**, then **Show** … event `quote.volume_routed`" | There is no routing action in the filter. |

**Not changed on purpose.** `quickstart/approver.md` (and its copy in `quickstart/print.html` and the published `apps/web/public/help/quickstart.html`) says "Rework needs a reason, a note and where it goes back to". The app treats the reason as optional. A quick-start edit has to be republished with `UPDATE_QUICKSTART=1 pnpm --filter @ccq/web test`, which writes an app file and a test fails until then, so I left it for Ben to change together with the app decision (is the reason meant to be optional?). The leadership and admin quick-starts matched what I saw.

## D. Could not test, and why

1. **Microsoft sign-in, Azure, Fabric, SharePoint, live Salesforce.** Not possible locally. Fabric and SharePoint health read "Unknown".
2. **The repo's own Playwright suite (`pnpm e2e`).** Not run: it starts its own servers and the machine was shared with four other sessions.
3. **Priority-calibration 2a.** In the synthetic seed 79 of 93 open quotes already carry a sub-market, so "no open quote has a sub-market" cannot be shown. The wording of that note was not seen.
4. **Approver step 23, two-step and pack-out.** There was no free Salesforce opportunity to stage a quote with them (Engineering is locked after G2). The equipment BOM part was seen.
5. **Approver step 33, "(no longer offered)" market.** No Final Review quote on a retired market was available.
6. **`g4_required_checks` as a blocker.** An attempt to change it through the API failed validation (`400`) and nothing was changed. The blocker behaviour was not tested, so the effect of DR-09 on a blocking setting is unconfirmed.
7. **Priority-calibration 4b (golden quotes)** and **Activate** (the script says not to). The "reason is required" refusal of Activate was not tried, to avoid activating v3 by accident. The effect of **Rescore the open quotes now** was not tested.
8. **Approver step 32 and priority-calibration step 8**: opinions, left to the testers.
9. **Email links beyond the G4 email**, and the comment email text.
10. **Screenshot "Capture screen"** (needs a real browser prompt). **Upload image** worked.
11. **G1 decider as an approver** (segregation "earlier gate"): the seeded rules cover only the KAM and the price approver, so there was nothing else to test.

## E. Observations

1. `vite.config.ts` reads `VITE_API_PROXY_TARGET` only from the shell, but `.env.example` suggests `.env` works. A developer following it silently proxies to port 3000. Also `.npmrc` `engine-strict=true` makes the nested `pnpm --filter` scripts fail on Node 24 even with `npm_config_engine_strict=false`.
2. "Price approved … by Lorenza McGlynn" in the review header and "Approved by Brandi Franey" under **3. Price approved** can name two people (the designated pricer and the pricing lead who decided G3). An approver may not know which one "approved the price".
3. Dates: most screens use "Nov 10, 2026, 4:03 PM" (US Central, good), but "Valid until 2026-12-11", "Quote needed by 2026-12-10" and "On hold until 2026-11-24" are ISO.
4. The dialog title for Stop, Hold and Rework is the gate name, "Release proposition".
5. The Final Review page for a quote that already left Final Review still shows the open-warnings list (for example "Engineering proceeded with risk" on a Closed – Won quote).
6. Step 32 (funding list): **Amortized** is both a funding model in the list and a separate Yes/No field below it, and **Shared** appears in both the funding model and mold ownership. Pilot users may ask which to pick.
7. Outcomes report shows 19 "Closed – Won" while the same page says "22 awarded" (3 are in Commit & Hand Off). It is explained on Analytics, not on this page.
8. **Why quotes are lost** lists the reason "Other (note required)" with the helper text in the label.
9. **Admin → Users and scope** shows a **Scope** button for a Leadership user although other roles see all quotes (the dialog says so). The role-change help names a setting key, `role_change_request_url`.
10. The Admin hub has a **UI kit** link ("Shared components with synthetic data").
11. **Full re-sync** on Integrations gave no visible message in about a second; **Sync Salesforce now** showed a toast. A bad GitHub link in the feedback triage dialog kept the dialog open with no message. A PNG the app could not use was dropped without telling the reporter (the report was still sent).
12. The home screen lists 10 of the waiting quotes and says "Waiting for a decision 21".
13. A "ready for Final Review" notification stays unread for a quote the approver has already decided.
14. The seed has no "queue position" or "approved" overrides, so leadership step 12 and 13 can only be checked partly on the synthetic data.
15. After the platform-minimum switch is turned off, the warning text on quotes submitted while it was on still shows in the sales leader's **Qualify & prioritize** dialog but not on the quote page. That matches "keep their warning text on the quote" only loosely.
