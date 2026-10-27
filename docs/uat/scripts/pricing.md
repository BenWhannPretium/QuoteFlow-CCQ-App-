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
| `<CCQ-QT-4>` | One of them came through G2 as **Advance – capital required** |
| `<CUST-1 chosen by Bailey>` | A customer with ERF history in the pricing-history import |

Labels for stages, outcomes and reasons are provisional configuration. Note a wrong meaning, not a different wording.

## Part A: The pricing queue and triage

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 1 | Lead | Sign in. | Home **Pricing triage** ("Assign Quoting work to the pricers and keep the pricing queue balanced."). | | |
| 2 | Lead | Click **Pricing queue**. | "Every quote in Quoting, highest priority first, then the longest waiting." Counts: **Awaiting price approval**, **Capital pending**, **Capital required / with risk (G2)**. | | |
| 3 | Lead | Check the columns. | **Tier**, **Quote**, **Account**, **Product**, **Volume / yr**, **G2 outcome**, **Capital readiness**, **In Quoting**, **KAM**, **Pricer**, **Engineer**. | | |
| 4 | Lead | On `<CCQ-QT-2>` open the row menu (**…**) → **Assign pricer…**. Pick an analyst. **Assign**. | Dialog **Assign pricer**. "They have been notified." The **Pricer** column shows the name. | | |
| 5 | Lead | Assign `<CCQ-QT-3>`…`<CCQ-QT-6>`. Then click **Reassign work…** and move one pricer's work to another. | Dialog **Reassign a pricer's work**. The work moves. | | |
| 6 | Analyst | Sign in. Open **Pricing queue**. Filter **Assigned to me**. | Home **Pricing desk**. Your quotes only. You do **not** see **Assign pricer…** or **Reassign work…**. | | |

## Part B: Pricing context and the price approval record

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 7 | Analyst | On `<CCQ-QT-2>`: **…** → **Record price approval**. | The **Quoting** tab opens. It shows **Engineering summary** with the G2 outcome, process, machine, plant, cavitation, cycle time, **Preliminary capital** and the capacity evidence numbers. | | |
| 8 | Analyst | Read **Pricing history**. Follow its link. | The card lists the customer's ERFs and SPRs from the import. The link opens **Pricing history** (read-only). Search `<CUST-1 chosen by Bailey>`: the records match the pricing app. | | |
| 9 | Analyst | In **Price approval record** fill **Legacy ERF #** (optional), tick **Costing completed (Cost-to-Serve)**, pick **Approved by**, set **Approved at**, type **Pricing basis** and **Approved negotiation range**. Click **Save price approval**. | "Price approval recorded". The top shows "**Price approved ✓** on <date> by <name>". There is no field to type a price. | | |
| 10 | Analyst | In **Capital readiness** pick a **Status**, add a **CER reference** (optional) and **Capital notes**. **Save capital readiness**. | "Capital readiness saved". | | |
| 11 | Analyst | On `<CCQ-QT-4>` (capital required at G2) open **Capital readiness** → **Status**. | "Not required" is not allowed: "Engineering said capital is required (G2), so it cannot be "Not required"." | | |
| 12 | Analyst | On `<CCQ-QT-4>` set **Status** to **Pending** with no justification. Then try **Advance to Final Review…**. | Under **Missing before it can move on:** "Capital readiness other than pending, or a pending-capital justification (D-11)". Close the dialog, fill **Pending-capital justification** and save. |  | |

## Part C: Capital flag and commercial terms

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 13 | Analyst | On `<CCQ-QT-3>` → **Overview**. In **Commercial terms** tick **Capital likely**. | "Capital flagged as likely". Capital Management is told (awareness, not approval). | | |
| 14 | Analyst | Record the price approval on `<CCQ-QT-3>` with capital readiness **Pending**. Try **Advance to Final Review…**. | Refused: "Capital is flagged likely: confirm capital readiness (not required or pre-approved)". | | |
| 15 | Analyst | Set capital readiness to **Pre-approved** (or **Not required**). | The block is gone. | | |
| 16 | Analyst | In **Commercial terms** fill **Tooling funding model**, **Customer tooling commitment**, **MOQ**, **Payment terms**. Tick **Terms checked**. Click **Save terms**. | "Terms checked". "Checked by <you> on <date>." Final Review needs this to release the offer. | | |

## Part D: G3 decisions

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 17 | Analyst | On `<CCQ-QT-5>` record an approval but leave **Costing completed (Cost-to-Serve)** unticked. Click **Advance to Final Review…**. | Under **Missing before it can move on:** "Costing attested as complete (before the price)". | | |
| 18 | Analyst | On `<CCQ-QT-2>` (complete, terms checked) click **Advance to Final Review…** → **Record decision**. | "Advance to Final Review recorded". Stage **Final Review**. Approvers are notified. | | |
| 19 | Analyst | On `<CCQ-QT-5>` click **Hold or stop…** → **Rework (re-cost)** with a reason and note. | The quote stays in **Quoting**. **Costing completed** is cleared. | | |
| 20 | Analyst | On `<CCQ-QT-6>` click **Return to Engineering…** → **Rework (back to Engineering)** with a reason. | The quote goes back to **Engineering Review** as a new version. The engineer is told. | | |
| 21 | Analyst | When `<CCQ-QT-6>` returns to Quoting, open the **Quoting** tab. | **Earlier versions** shows the first version's record, unchanged. | | |
| 22 | Analyst | On `<CCQ-QT-5>` click **Hold or stop…** → **Hold** with reason, review date and owner. | "On hold until <date> · owner <name>". | | |
| 23 | Analyst | Look for **Approvals** in the navigation. Type `/quotes/<CCQ-QT-2>/review` after the test URL. | No **Approvals** item. "You don’t have access to this". Pricing never decides Final Review. | | |

## Part E: Redaction check (sign in as a KAM)

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 24 | KAM | Sign out. Sign in as the KAM of `<CCQ-QT-2>`. Open it → **Quoting** tab. | Only "Price approved ✓ on <date> by <name>" and "Pricing details, references and capital readiness are commercial…". No basis, range, ERF number, capital readiness or figures. | | |
| 25 | KAM | Open the **Engineering** tab. | No preliminary capital. No capacity numbers. | | |
| 26 | KAM | **Pipeline** → **Columns**. Then **Export CSV**. | No **Prelim capital (USD)** or **Capital readiness** column, on screen or in the file. | | |
| 27 | KAM | Open the emails QuoteFlow sent about this quote. | No price, margin or capital amount in any email. | | |
| 28 | Analyst | Sign back in as yourself. Repeat step 26. | You can choose **Prelim capital (USD)** and **Capital readiness**, and they are in the CSV. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Pricing lead | | | |
| | Pricing analyst | | | |
