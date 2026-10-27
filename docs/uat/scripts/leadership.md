# UAT script: Leadership

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

## Part A: Home and analytics definitions

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Sign in. | Home **Leadership overview** ("Pipeline value, throughput and where work is waiting."): **Open quotes**, **Median intake to G4**, **First-pass intake completeness**, **Win rate pairs with capture**, then **Win rate and outcome capture** and **Pipeline by stage**. | | |
| 2 | Look at the navigation. | **Home**, **Engineering queue**, **Pricing queue**, **Pipeline**, **Approvals**, **Analytics**, **Admin**. | | |
| 3 | Click **Analytics**. | Page **Analytics** with two views: **Leadership report** and **Engineering**. Filters: **From**, **To**, markets, families, KAMs, regions. Section links: **Pipeline**, **Outcomes**, **Cycle time**, **Flow**, **Reasons**, **Quality and governance**, **Priority**, **Adoption**. | | |
| 4 | In **Pipeline**, open the ⓘ on **Open quotes by stage**. | A definition and a **Time window**. The amount is the Salesforce opportunity amount as entered (size of opportunity, not price). | | |
| 5 | In **Outcomes**, open the ⓘ on the win rate and on the capture rate. | The win rate counts decided quotes only and sits next to the outcome capture rate. Awards still in Commit & Hand Off are shown beside it. | | |
| 6 | In **Cycle time**, open the ⓘ on **Days in each stage (holds excluded)** and **Intake to G4 approval, by week**. | Holds are excluded. The definitions say so. | | |
| 7 | For every other chart in the report, open its ⓘ. Write in Notes any definition you disagree with. | Every chart has a definition and a time window. | | |
| 8 | On one chart click **Table**. Then **Chart**. | The same numbers as a table, then back. | | |
| 9 | Click a **Drill down** link in a table. | The **Pipeline** list opens with the matching filter. | | |
| 10 | Set **KAMs** to `<KAM-1 chosen by Bailey>` and **Last 90 days**. | All charts narrow to that KAM. | | |
| 11 | Check whether the page says these numbers are operational and not D&A-certified. | Write what you see in Notes (see README "known gaps"). | | |

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
| 17 | **Pipeline** → **Columns**: add **Prelim capital (USD)** and **Capital readiness**. Click **Export CSV**. | "Export ready". The file has the columns you see, including the two commercial ones. | | |
| 18 | **Admin** → **Audit log**. Click **Export CSV**. | A CSV of the filtered audit log downloads. | | |
| 19 | Filter the audit log by **Action** for exports. | Your two exports from steps 17–18 are listed. | | |

## Part D: Read-only (negative checks)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 20 | Open `<CCQ-ANY-1>` → **Quoting** tab. | You can read the pricing record and capital readiness. There is no **Save price approval** and no **Advance to Final Review…**. | | |
| 21 | Look at the quote header. | No gate decision buttons. | | |
| 22 | **Approvals** → **Final Review** → open a quote. | The bar says "You are reading this review. Final Review decisions are taken by an approver." | | |
| 23 | **Admin** → **App settings**. Then **Reason codes**. | You can read every setting. There are no edit controls. | | |
| 24 | **Engineering queue** and **Pricing queue**. | Both open read-only. No **Assign…**, **Assign pricer…** or **Reassign work…**. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Leadership | | | |
