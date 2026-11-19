# UAT script: Leadership

> Checked against the build on 2026-11-17 (pre-release audit): the overview stat reads **Median: intake to Final Review decision**, and the buttons a reader must not see are now named **Decide price approval**, **Assign engineer** and **Assign pricer**. Steps 1, 20 and 24 are changed. Updated 2026-11-17 for the approved UX changes (docs/audit/03-ux-proposals.md).

| | |
|---|---|
| Session | **U3**, Wed Nov 11 (2 h), with Pricing and the approvers. Run by Bailey Schmitt. |
| Tester role | Leadership (app role `CCQ.Leadership`): Sarah Brennan's delegate, ELT, commercial leadership |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft** with your Pretium account. Your account must be in **`SG-CCQ-Leadership`**. |
| Before you start | U1 and U2 have run, so there are decisions, overrides and outcomes to look at. Ben confirms the analytics views are refreshed. |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Write the step number in the description. |

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<CCQ-ANY-1>` | Any open quote in Quoting or later |
| `<KAM-1 chosen by Bailey>` | A KAM with several quotes |

**Changed 2026-11-15 (FB-18, walkthrough of Nov 13).** Home is now the **Command Center**, with two views at the top: **My work** and **Analytics**. **Analytics** is no longer in the menu, and the **Open analytics** button is gone from the overview. Steps 1, 2, 3 and 11 are changed.

## Part A: The Command Center and analytics definitions

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Sign in. | The **Command Center** opens on **Leadership overview** ("Pipeline value, throughput and where work is waiting."): **Open quotes**, **Median: intake to Final Review decision**, **First-pass intake completeness**, **Win rate pairs with capture**, then **Win rate and outcome capture** and **Pipeline by stage**. | | |
| 2 | Look at the navigation. | **Command Center**, **Engineering queue**, **Pricing queue**, **Pipeline**, **Approvals**, **Admin**. There is no **Analytics** item: the Command Center has two views at the top, **My work** and **Analytics**. | | |
| 3 | On the **Command Center** click **Analytics** (at the top, next to **My work**). Later, open an old `/analytics` link or bookmark. | The **Analytics** view, with the line "Command Center · Leadership" above the title and two reports: **Leadership report** and **Engineering**. The old address opens this same view, with any filters the link carried. Filters: **From**, **To**, markets, families, KAMs, regions. Section links: **Pipeline**, **Outcomes**, **Cycle time**, **Flow**, **Reasons**, **Quality and governance**, **Priority**, **Adoption**. | | |
| 4 | In **Pipeline**, open the ⓘ on **Open quotes by stage**. | A definition and a **Time window**. The amount is the Salesforce opportunity amount as entered (size of opportunity, not price). | | |
| 5 | In **Outcomes**, open the ⓘ on the win rate and on the capture rate. | The win rate counts decided quotes only and sits next to the outcome capture rate. Awards still in Commit & Hand Off are shown beside it. | | |
| 6 | In **Cycle time**, open the ⓘ on **Days in each stage (holds excluded)** and **Intake to G4 approval, by week**. | Holds are excluded. The definitions say so. | | |
| 7 | For every other chart in the report, open its ⓘ. Write in Notes any definition you disagree with. | Every chart has a definition and a time window. | | |
| 8 | On one chart click **Table**. Then **Chart**. | The same numbers as a table, then back. | | |
| 9 | Click a **View quotes** link in the **Drill down** column of a table. | The **Pipeline** list opens with the matching filter. | | |
| 10 | Set **KAMs** to `<KAM-1 chosen by Bailey>` and **Last 90 days**. | All charts narrow to that KAM. | | |
| 11 | Scroll to the bottom of **Analytics**. | It says "Operational metrics from QuoteFlow; not yet D&A-certified." The same line sits under the dashboard on **My work**. | | |

## Part B: Override log and audit

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 12 | **Admin** → **Override log**. | "Every override of a governed field, with the original value, the justification and who decided. Leadership and Admin only." The U1 overrides (priority, ship-to, queue pin, the revert) are there. | | |
| 13 | Filter by **Status** and **Field**. | The list narrows. | | |
| 14 | Open `<CCQ-ANY-1>`. Then **Admin** → **Audit log**. Filter **Quote** = its number. | Your view of the quote is listed with your name and time (US Central). | | |
| 15 | Filter **Action** for gate decisions and overrides. | U1–U3 decisions and overrides are listed. | | |
| 16 | **Admin** → **Usage report** and **Outcomes report**. | Both load. The usage report says "Operational; not D&A-certified." | | |

## Part C: Export

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 17 | **Pipeline** → **Columns**: add **Budgetary capital estimate** and **Capital readiness**. Click **Export CSV**. | "Export ready". The file has the columns you see, including the two commercial ones. | | |
| 18 | **Admin** → **Audit log**. Click **Export CSV**. | A CSV of the filtered audit log downloads. | | |
| 19 | Filter the audit log by **Action** for exports. | Your two exports from steps 17–18 are listed. | | |

## Part D: Read-only (negative checks)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 20 | Open `<CCQ-ANY-1>` → **Quoting** tab. | You can read the pricing record and capital readiness. There is no **Save price approval** and no **Decide price approval**. The **Costing, payback and price approval** steps show who did each and when, with no upload buttons. | | |
| 21 | Look at the quote header. | No gate decision buttons. | | |
| 22 | **Approvals** → **Final Review** → open a quote. | The bar says "You are reading this review. Final Review decisions are taken by an approver." | | |
| 23 | **Admin** → **App settings**. Then **Reason codes**. | You can read every setting. There are no edit controls. | | |
| 24 | **Engineering queue** and **Pricing queue**. | Both open read-only. No **Assign engineer**, **Assign pricer** or **Reassign work…**. | | |

## Part E: Final Review terms and Market (FB-08, FB-12)

Added 2026-11-10. Leadership reads the terms and the capital terms; the approver confirms them.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 25 | **Approvals** → **Final Review** → open a quote → **Terms and Legal**. | You can read **Funding model**, **MOQ**, **Payment terms**, **Tooling payment**, the **Payment-terms exception** (with its status) and the **Capital terms** (mold ownership, amortized, minimum supply / shortfall, agreement, and who confirmed them and when). You cannot edit any of it: there is no **Confirm capital terms**, **Save capital terms**, **Approve the exception** or **Reject**. | | |
| 26 | On the same page read **The request** → **Market**. | "<Market> › <Sub-market>", for example "Food › Snacks & Confections". | | |
| 27 | **Admin** → **App settings** → **Final Review**. Read **Extra Final Review sign-offs by funding model (e.g. sales leader, then leadership). Rules with active: false do nothing**. | You can read it. It says `"active": false` (the extra approval is off) and there is no **Edit**. The rule is: when the customer funds the capital, the sales leader signs off, then leadership. Is that the rule you want (A-035 is open)? Write your view in Notes. | | |
| 28 | **Optional.** Only if Bailey runs `approver.md` Part G: sign off as **Leadership**. | See `approver.md` steps 38 and 40. You can sign only after the sales leader has. | | |

## UX changes (2026-11-17)

Added 2026-11-17 for the approved UX changes (`docs/audit/03-ux-proposals.md`).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 29 | Sign in on a browser where you have not opened QuoteFlow before (or in a private window). Read the card at the top of the **Command Center**. Click its link, then **Got it**. Reload the page. | A card **Welcome to QuoteFlow**: "Your main jobs here, and where each one is done." Three jobs: "See where every open quote stands: **Pipeline**.", "Read cycle time, win rate and outcome capture: **Analytics, the second view of this page**." and "Check overrides and the audit trail: **Admin**." The link "Read the one-page quick-start for Leadership" opens the quick-start in a new tab. **Got it** puts the card away for good (for you, in this browser); it does not come back after a reload. | | |
| 30 | On the **Command Center** read **Pipeline by stage**. | A stage total reads "<amount> Salesforce opportunity amount" (it was "SF amount"). | | |
| 31 | Open `<CCQ-ANY-1>`. Read the line under the stage tracker, the priority and the times on the page. | The quote opens on **Overview**. The line says whose move it is (for example "Waiting on: Pricing (<name>). Next: complete the costing and the pricing record, then submit to the pricing lead.") and has no button for you. The priority is labelled, for example "Priority 62 HIGH". Every time on the page is US Central in one format, for example "Nov 17, 2026, 12:18 PM CST". | | |

## FB-27: the analytics tile (2026-11-19)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 32 | **Command Center** → **Analytics** → the outcomes report. | The tile that was "Awarded, commitment pending" reads **Awarded, hand-off not done**: "The customer awarded it; the CER and hand-off are still open. Counted as won." The number is unchanged. Is it clear? (Note your answer.) | | |

## FB-31: payment-terms exceptions and the amortized finance review (2026-11-19)

Added for the Nov 19 feedback (N19-07, N19-08). **Provisional:** Leadership stands in for the CFO (there is no CFO role) and for Finance (which approves nothing today). The thresholds are a guess until Sarah Brennan and Oleg Yarovinski set them.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 33 | After the KAM's step 136, open the bell. Click the notice "<quote>: non-standard payment terms (Net 60)". | It opens the quote's **Commercial terms** tab. The card says **Waiting for Leadership** and shows the supporting document; you can download it. | | |
| 34 | Write a **Rationale** and click **Approve the exception**. | The card says **Approved**, with your name, the time and the rationale. The KAM is told. The timeline reads "Payment-terms exception approved (Net 60) by Leadership". | | |
| 35 | On another Net 60 quote with **no** document, write a rationale. | **Approve the exception** stays off and the card says to attach the supporting document first. **Reject** still works. | | |
| 36 | On a Net 45 quote waiting for the pricing lead, open **Commercial terms**. | You can read the card ("Waiting for the pricing lead") but there is no **Approve** or **Reject** for you. | | |
| 37 | **Approvals** → **Final Review** → a quote whose tooling is **Customer funded (amortized)**. | "Final Review also needs: Finance review (Leadership)" is listed. **Sign off** is yours; the approver cannot release the offer until you do. | | |
| 38 | Should the CFO, not Leadership, approve Net 60 and above? Should Finance give the amortization review? Is a rationale plus an attached document the "formal documentation" Sarah meant? | Write the answers in Notes. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Leadership | | | |
