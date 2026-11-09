# UAT script: Pricing and the pricing lead

| | |
|---|---|
| Session | **U3**, Wed Nov 11 (2 h). Run by Bailey Schmitt. |
| Tester roles | Pricing analyst (app role `CCQ.Pricing`) and pricing lead (app role `CCQ.PricingLead`) |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft** with your Pretium account. Analysts must be in **`SG-CCQ-Pricing`**. The lead must be in **`SG-CCQ-PricingLead`**. |
| Before you start | Ben has staged the quotes below in **Quoting**. An Admin has imported the pricing-history export (Admin → Integrations). A KAM tester (or a KAM test account) is available for Part E. |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Write the step number in the description. |

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<CCQ-QT-2>` … `<CCQ-QT-6>` | Five quotes in Quoting, unassigned, staged by Ben from `<SF-OPP-18..22 chosen by Bailey>` |
| `<CCQ-RW-1>`, `<CCQ-RW-2>` | Two quotes in Quoting, assigned to a pricer, whose KAM is in the KAM session (staged by Ben; they go back to the KAM in step 22) |
| `<CCQ-QT-4>` | One of them came through G2 as **Advance – capital required** |
| `<CUST-1 chosen by Bailey>` | A customer with ERF history in the pricing-history import |

Labels for stages, outcomes and reasons are provisional configuration. Note a wrong meaning, not a different wording.

## Part A: The pricing queue and triage

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 1 | Lead | Sign in. | Home **Pricing triage** ("Assign Quoting work to the pricers and keep the pricing queue balanced."). | | |
| 2 | Lead | Click **Pricing queue**. | "Every quote in Quoting, highest priority first, then the longest waiting." Counts: **Awaiting price approval**, **Capital pending**, **Capital required / with risk (G2)**. Two tabs: **All** and **Ready for my review (n)**. | | |
| 3 | Lead | Check the columns. | **Tier**, **Quote**, **Account**, **Product**, **Volume / yr**, **G2 outcome**, **Capital readiness**, **In Quoting**, **KAM**, **Pricer**, **Engineer**. | | |
| 4 | Lead | On `<CCQ-QT-2>` open the row menu (**…**) → **Assign pricer…**. Pick an analyst. **Assign**. | Dialog **Assign pricer**. "They have been notified." The **Pricer** column shows the name. | | |
| 5 | Lead | Assign `<CCQ-QT-3>`…`<CCQ-QT-6>`. Then click **Reassign work…** and move one pricer's work to another. | Dialog **Reassign a pricer's work**. The work moves. | | |
| 6 | Analyst | Sign in. Open **Pricing queue**. Filter **Assigned to me**. | Home **Pricing desk**. Your quotes only. You do **not** see **Assign pricer…** or **Reassign work…**. | | |

## Part B: Pricing context and the price approval record

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 7 | Analyst | On `<CCQ-QT-2>`: **…** → **Record price approval**. | The **Quoting** tab opens. It shows **Engineering summary** with the G2 outcome, process, machine, plant, cavitation, cycle time, the **Budgetary capital estimate (USD)** ("preliminary, includes contingency") and the capacity evidence (utilization before and after, assumed effectiveness). | | |
| 8 | Analyst | Read **Pricing history**. Follow its link. | The card lists the customer's ERFs and SPRs from the import. The link opens **Pricing history** (read-only). Search `<CUST-1 chosen by Bailey>`: the records match the pricing app. | | |
| 8a | Analyst | FB-07 (T-034). On `<CCQ-QT-2>` open **Quoting** → **Costing, ROI and price approval**. Tick **Costing completed** first and save. Then in **1. Costing** click **Upload the costing model** and pick a costing workbook (.xlsx). Then **Upload a new version** with a changed workbook. | Ticking first is refused: "Upload the costing model first…". After the uploads: **Costing model v2 · current**, "2 versions"; **Earlier versions (1)** lists v1, which still downloads. **Attachments** shows one v2 · current and one v1 · replaced, no duplicate. | | |
| 8b | Analyst | On `<CCQ-QT-4>` (capital required at G2) look at **2. ROI**. Then on `<CCQ-QT-2>` (no capital). | `<CCQ-QT-4>`: "Needed: Engineering (G2): Advance – capital required", status **Waiting on an earlier step** until costing is done. `<CCQ-QT-2>`: "Not required: …" and why. | | |
| 9 | Analyst | In **Price approval record** fill **Legacy ERF #** (optional), tick **Costing completed (Cost-to-Serve)**, pick **Approved by**, set **Approved at**, type **Pricing basis** and **Approved negotiation range**. Click **Save price approval**. | "Price approval recorded". The top shows "**Price approved ✓** on <date> by <name>". There is no field to type a price. | | |
| 10 | Analyst | In **Capital readiness** pick a **Status**, and add **Capital notes**. **Save capital readiness**. | "Capital readiness saved". The statuses read **Capital not required**, **Capital pending (budgetary)**, **Capital pre-approved (budgetary)** and **Capital not approved (budgetary)**. There is no CER reference box here (a "Legacy CER reference" shows only on old quotes that have one). | | |
| 11 | Analyst | On `<CCQ-QT-4>` (capital required at G2) open **Capital readiness** → **Status**. | "Not required" is not allowed: "Engineering said capital is required (G2), so it cannot be "Not required"." | | |
| 12 | Analyst | On `<CCQ-QT-4>` set **Status** to **Capital pending (budgetary)** with no justification. Then click **Submit to pricing lead**. | Under the missing list: "Capital readiness other than pending, or a pending-capital justification (D-11)". Fill **Pending-capital justification**, save and try again later. | | |

## Part C: Capital flag and commercial terms

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 13 | Analyst | On `<CCQ-QT-3>` → **Overview**. In **Commercial terms** tick **Capital likely**. | "Capital flagged as likely". Capital Management is told (awareness, not approval). | | |
| 14 | Analyst | Record the price approval on `<CCQ-QT-3>` with capital readiness **Capital pending (budgetary)**. Click **Submit to pricing lead**. | Refused: "Capital is flagged likely: confirm capital readiness (not required or pre-approved)". | | |
| 15 | Analyst | Set capital readiness to **Capital pre-approved (budgetary)** (or **Capital not required**). | The block is gone. | | |
| 16 | Analyst | In **Commercial terms** open **Tooling funding model** and the ⓘ "What do the funding options mean?". Fill **Tooling funding model**, **Customer tooling commitment**, **MOQ**, **Payment terms**. Tick **Terms checked**. Click **Save terms**. | The list includes **$0 CER (customer-reimbursed capital)** and **Shared (company and customer)**. The ⓘ explains each: a $0 CER follows the standard quoting path and the customer reimburses the capital; Shared says to record the split in the terms notes. "Terms checked", "Checked by <you> on <date>." Final Review shows an open warning if this is not ticked, but it does not stop the approver. | | |

## Part D: G3 decisions and send-backs

The pricer submits to the pricing lead. **The pricing lead decides G3, not the pricer.**

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 17 | Analyst | On `<CCQ-QT-5>` record an approval but leave **Costing completed (Cost-to-Serve)** unticked. Click **Submit to pricing lead**. | Under the missing list: "Costing attested as complete (before the price)". | | |
| 18 | Analyst | On `<CCQ-QT-2>` (complete, terms checked) click **Submit to pricing lead**. | "Submitted to the pricing lead": "They have been notified. It is locked for you until they send it back." The tab is read-only for you. | | |
| 19 | Lead | Open **Pricing queue** → **Ready for my review (n)**. | `<CCQ-QT-2>` is listed. You were notified. | | |
| 20 | Lead | Open `<CCQ-QT-2>`. Click **Send back to pricer…** with no note, then with a note. Then, after the pricer resubmits, go on. | A note is required. "Sent back to the pricer": they are told with your note and the tab reopens. After they resubmit, it is in **Ready for my review** again. | | |
| 20a | Lead | FB-07. On `<CCQ-QT-4>` (capital required) with costing done but no ROI yet, click **Price approved: advance to Final Review…**. Then ask Finance (finance.md) to upload the ROI. Optionally **3. Price approved** → **Upload an updated price table**. | Before the ROI: the missing list names the ROI model; nothing is recorded. You are notified when Finance uploads it; then nothing is missing. | | |
| 21 | Lead | On `<CCQ-QT-2>` click **Price approved: advance to Final Review…** → **Record decision**. | "Advance – price approved recorded". The gate reads **G3 Price approved** (not "& capital ready"); capital readiness is still its own panel. Stage **Final Review**. The Approvers and the KAM are notified. The **Quoting** tab shows "Locked after G3 · decided by <you> on <date> · reopens if the quote is sent back". Neither you nor the pricer can edit it. | | |
| 22 | Lead | On `<CCQ-RW-1>` click **Return to KAM…**. Choose **Rework (back to KAM)**. Leave the note empty and record. Then pick a reason, type a note ("What should the KAM fix?") and record. Do the same for `<CCQ-RW-2>`. | A note is required. The quote goes back to **Intake** with the pricer and you still assigned. The KAM is told, with your reason and note (kam.md Part F). | | |
| 23 | Lead | After the KAM answers **No, same scope** on `<CCQ-RW-1>` (kam.md step 45), open it. | The quote is back in **Quoting**: it did not go through G1 or Engineering. You and the pricer are told "… is back from the KAM". A new review round starts, and the price approval is recorded again against the new version with the references carried forward. | | |
| 24 | Lead | On `<CCQ-QT-6>` click **Return to Engineering…** → **Rework (back to Engineering)** with a reason and a note. | The quote goes back to **Engineering Review** as a new version. The engineer and the engineering lead are told. | | |
| 25 | Analyst | When `<CCQ-QT-6>` returns to Quoting, open the **Quoting** tab. | **Earlier versions** shows the first version's record, unchanged. | | |
| 26 | Lead | On `<CCQ-QT-5>` click **Hold or stop…** → **Rework (re-cost)** with a reason and a note. Then repeat on another quote with **Hold**: reason, review date, owner and a note. | A note is required each time. Re-cost keeps the quote in **Quoting**, clears **Costing completed**, and tells the pricer. Hold shows "On hold until <date> · owner <name>". | | |
| 27 | Analyst | Look for **Approvals** in the navigation. Type `/quotes/<CCQ-QT-2>/review` after the test URL. | No **Approvals** item. "You don’t have access to this". Pricing never decides Final Review. | | |

## Part E: What other roles see (sign in as a KAM)

Every role that can read a quote sees its pricing, margin and capital figures. Only Pricing can change them.

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 28 | KAM | Sign out. Sign in as the KAM of `<CCQ-QT-2>`. Open it → **Quoting** tab. | You can read "Price approved ✓ on <date> by <name>", the pricing basis and range, the references and the capital readiness. There is no **Save** button for the KAM. | | |
| 29 | KAM | Open the **Engineering** tab. | The budgetary capital estimate and the capacity evidence are visible, read-only. | | |
| 30 | KAM | **Pipeline** → **Columns**. Choose **Budgetary capital estimate** and **Capital readiness**. Then **Export CSV**. | Both columns are offered, shown and in the file. | | |
| 31 | KAM | Open the emails QuoteFlow sent about this quote. | No price, margin or capital amount in any email. | | |
| 32 | Analyst | Sign back in as yourself. Repeat step 30. | The same columns, on screen and in the CSV. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Pricing lead | | | |
| | Pricing analyst | | | |
