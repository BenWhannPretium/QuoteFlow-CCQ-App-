# UAT script: Pricing and the pricing lead

> Checked against the build on 2026-11-17 (pre-release audit): the queue column is **Engineering decision**, the menu items are **Assign pricer** and **Send back to pricer** (no "…"), **Costing completed** is ticked for you when the costing model is uploaded, and **Submit to pricing lead** appears only when nothing is missing (the tab lists what is). Steps 3, 4, 6, 7, 8a, 9, 12, 14, 15, 17, 18, 20, 20a and 33 are changed.

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
| `<CCQ-QT-4>` | One of them was advanced at G2 with a capital estimate above $0 and the equipment BOM on file, so capital is needed (FB-17; before that it was decided **Advance – capital required**) |
| `<CCQ-GD-2>` | The quote the engineering lead advanced with a $250,000 capital estimate in engineering.md step 94 (Part H here) |
| `<CCQ-QT-NS>` | A quote in Quoting where the KAM asked for **Net 60** at intake (a non-standard request), staged by Ben. Part G steps 35–40 |
| `<CCQ-QT-OTHER>` | A quote in Quoting whose KAM picked **Other** for **Resin**, **PCR** and **Additive** (typed values) and chose a Market and Sub-market, staged by Ben. Part G steps 43–44 |
| `<CUST-1 chosen by Bailey>` | A customer with ERF history in the pricing-history import |

Labels for stages, outcomes and reasons are provisional configuration. Note a wrong meaning, not a different wording.

**Changed 2026-11-15 (FB-17, walkthrough of Nov 13).** The decision dialog offers four choices: **Advance**, **Send back to…**, **Hold** and **Stop**; **Send back to…** asks where the quote goes (Pricing (re-cost), Pricing (another capital model), Engineering or the KAM) and always needs a reason and a note. "Capital required" is now "capital needed", worked out from Engineering's capital estimate. Steps 2, 8b, 11, 20a, 21, 22, 24 and 26 are changed, and **Part H** (steps 46 to 49) is new.

**Changed 2026-11-15 (FB-18, walkthrough of Nov 13).** Home is now the **Command Center**, with two views at the top: **My work** and **Analytics**. **Analytics** is no longer in the menu. Every Save button now says **Progress saved** beside it (the toast in the corner stays). Steps 1, 6, 9 and 10 are changed.

## Part A: The pricing queue and triage

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 1 | Lead | Sign in. | The **Command Center** opens on **Pricing triage** ("Assign Quoting work to the pricers and keep the pricing queue balanced."). The menu reads **Command Center**, **Pricing queue**, **Pipeline**; **Analytics** is the second view at the top of the Command Center. | | |
| 2 | Lead | Click **Pricing queue**. | "Every quote in Quoting, highest priority first, then the longest waiting." Counts: **Awaiting price approval**, **Capital pending**, **Capital needed / with risk** (FB-17: it was "Capital required / with risk"). Two tabs: **All** and **Ready for my review (n)**. | | |
| 3 | Lead | Check the columns. | **Tier**, **Quote**, **Account**, **Product**, **Volume / yr**, **Engineering decision**, **Capital readiness**, **In Quoting**, **KAM**, **Pricer**, **Engineer**. | | |
| 4 | Lead | On `<CCQ-QT-2>` open the row menu (**…**) → **Assign pricer**. Pick an analyst. **Assign**. | Dialog **Assign pricer**. "They have been notified." The **Pricer** column shows the name. | | |
| 5 | Lead | Assign `<CCQ-QT-3>`…`<CCQ-QT-6>`. Then click **Reassign work…** and move one pricer's work to another. | Dialog **Reassign a pricer's work**. The work moves. | | |
| 6 | Analyst | Sign in. Open **Pricing queue**. Filter **Assigned to me**. | The Command Center title is **Pricing desk**. Your quotes only. You do **not** see **Assign pricer** or **Reassign work…**. | | |

## Part B: Pricing context and the price approval record

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 7 | Analyst | On `<CCQ-QT-2>`: **…** → **Record price approval**. | The **Quoting** tab opens. It shows **Engineering summary** with the **Engineering decision**, process, machine, plant, cavitation, cycle time, the **Budgetary capital estimate (USD)** ("preliminary, includes contingency") and the capacity evidence (utilization before and after, assumed effectiveness). | | |
| 7a | Analyst | On the **Quoting** tab read **From intake** (on a quote the KAM submitted after the FB-11 build). | It shows the **Customer bid / RFP reference** (FB-15 wording), **Payment terms requested** (a request other than Net 15 or Net 30 shows **Non-standard: Pricing will review**; it does not change the costing), **Customer funds any tooling**, **Dunnage** (returnable or single-trip) and **Delivered or FOB**, with the freight type and special arrangements when delivered. A value the KAM left blank shows a dash. FB-15: when funding is **Shared** and the KAM gave a share, **Customer share** reads for example "Customer 40%, Pretium 60%" (also beside the funding model on **Commercial terms** and at Final Review). | | |
| 8 | Analyst | Read **Pricing history**. Follow its link. | The card lists the customer's ERFs and SPRs from the import. The link opens **Pricing history** (read-only). Search `<CUST-1 chosen by Bailey>`: the records match the pricing app. | | |
| 8a | Analyst | FB-07 (T-034). On `<CCQ-QT-2>` open **Quoting** → **Costing, payback and price approval**. Tick **Costing completed** first and save. Then in **1. Costing** click **Upload the costing model** and pick a costing workbook (.xlsx). Then **Upload a new version** with a changed workbook. | Ticking first is refused: "Upload the costing model first…". After the first upload **Costing completed (Cost-to-Serve)** is ticked for you (untick it if the costing is not final). After the uploads: **Costing model v2 · current**, "2 versions"; **Earlier versions (1)** lists v1, which still downloads. **Attachments** shows one v2 · current and one v1 · replaced, no duplicate. | | |
| 8b | Analyst | On `<CCQ-QT-4>` (capital needed) look at **2. Payback**. Then on `<CCQ-QT-2>` (no capital). | `<CCQ-QT-4>`: "Needed: Capital is flagged likely" (a quote decided **Advance – capital required** before FB-17 reads "Needed: Engineering’s decision: Advance – capital required"), status **Waiting on an earlier step** until costing is done. `<CCQ-QT-2>`: "Not required: a payback model is needed only when capital is required ($0 CER included)." with the reason. | | |
| 9 | Analyst | In **Price approval record** fill **Legacy ERF #** (optional), check that **Costing completed (Cost-to-Serve)** is ticked (it was ticked for you in step 8a), pick **Approved by** (it starts on you), set **Approved at**, type **Pricing basis** and **Approved negotiation range**. Click **Save price approval**. | "Price approval recorded", and **Progress saved** beside the button until you change a field (FB-18). The top shows "**Price approved ✓** on <date> by <name>". There is no field to type a price. | | |
| 10 | Analyst | In **Capital readiness** pick a **Status**, and add **Capital notes**. **Save capital readiness**. | "Capital readiness saved", and **Progress saved** beside the button (FB-18). The statuses read **Capital not required**, **Capital pending (budgetary)**, **Capital pre-approved (budgetary)** and **Capital not approved (budgetary)**. There is no CER reference box here (a "Legacy CER reference" shows only on old quotes that have one). | | |
| 11 | Analyst | On `<CCQ-QT-4>` (capital needed) open **Capital readiness** → **Status**. | "Not required" cannot be chosen. The note reads "Engineering said capital is needed, so you cannot choose “Not required”." | | |
| 12 | Analyst | On `<CCQ-QT-4>` set **Status** to **Capital pending (budgetary)** with no justification and save. Then read the bottom of the tab (**When you are finished**). | **Submit to pricing lead** is not offered. The list "Fill these in and save. Then you can submit to the pricing lead:" names "Capital readiness confirmed, or a justification for going ahead while it is pending". Fill **Pending-capital justification** and save; the quote still needs capital pre-approved before you can submit (Part H, step 47). | | |

## Part C: Capital flag and commercial terms

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 13 | Analyst | On `<CCQ-QT-3>` → **Overview**. In **Commercial terms** tick **Capital likely**. | "Capital flagged as likely". Capital Management is told (awareness, not approval). | | |
| 14 | Analyst | Record the price approval on `<CCQ-QT-3>` with capital readiness **Capital pending (budgetary)**. Read the bottom of the tab. | **Submit to pricing lead** is not offered. The list names "Capital is flagged likely: confirm capital readiness (not required or pre-approved)". | | |
| 15 | Analyst | Set capital readiness to **Capital pre-approved (budgetary)** (or **Capital not required**) and save. | The line is gone from the list. | | |
| 16 | Analyst | FB-08 changed this step. On `<CCQ-QT-3>` → **Overview** → **Commercial terms** read **Customer requested:**, then in **Terms** read **Payment terms**. Pick **Tooling payment**, answer **Customer tooling commitment**, add a **Milestone note**, tick **Terms checked** and click **Save terms**. Look at **Tooling funding model** and **MOQ**. | **Customer requested:** shows the KAM's intake answer, or "Not given at intake". **Payment terms** starts on the customer's request when there is one, otherwise on **Net 30** (provisional); nothing is saved until you click **Save terms**. Under it: "Standard: Net 15, Net 30. Anything else goes to the pricing lead as an exception." **Tooling payment** offers Upfront (100% at the order), 50/50: at the order and at qualification, and Amortized into the per-piece price; the hint shows the milestones. "Terms checked", "Checked by <you> on <date>." **Tooling funding model** and **MOQ** are read-only for you: Engineering enters them (engineering.md steps 69–71). "Terms checked" needs the payment terms and the tooling-commitment answer. Final Review shows an open warning if it is not ticked, but it does not stop the approver. | | |

## Part D: G3 decisions and send-backs

The pricer submits to the pricing lead. **The pricing lead decides G3, not the pricer.**

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 17 | Analyst | On `<CCQ-QT-5>` record an approval but untick **Costing completed (Cost-to-Serve)** and save. Read the bottom of the tab. | **Submit to pricing lead** is not offered. The list names "Costing attested as complete (before the price)". | | |
| 18 | Analyst | On `<CCQ-QT-2>` (complete, terms checked) click **Submit to pricing lead**. | "Submitted to the pricing lead": "They have been notified. You can edit again if they send it back." The tab is read-only for you. | | |
| 19 | Lead | Open **Pricing queue** → **Ready for my review (n)**. | `<CCQ-QT-2>` is listed. You were notified. | | |
| 20 | Lead | Open `<CCQ-QT-2>`. Click **Send back to pricer** with no note, then with a note. Then, after the pricer resubmits, go on. | A note is required. "Sent back to the pricer": they are told with your note and the tab reopens. After they resubmit, it is in **Ready for my review** again. | | |
| 20a | Lead | FB-07. On `<CCQ-QT-4>` (capital needed) with costing done and capital readiness **Capital pre-approved (budgetary)**, but no payback model yet, read the bottom of the **Quoting** tab. Then ask Finance (finance.md) to upload the payback model (the pricing lead may upload it too, a provisional stop-gap while Finance has no account). Optionally **3. Price approved** → **Upload an updated price table**. | Before the payback model: no **Decide price approval** button; **Still needed before this quote can move forward** names the payback model, and **Send back, hold or stop** is offered. You are notified when Finance uploads it; then the button appears. | | |
| 21 | Lead | On `<CCQ-QT-2>` click **Decide price approval** → **Advance – price approved** → **Record decision**. | "Advance – price approved recorded". The gate reads **G3 Price approved** (not "& capital ready"); capital readiness is still its own panel. Stage **Final Review**. The Approvers and the KAM are notified. The **Quoting** tab shows "Locked after G3 · decided by <you> on <date> · reopens if the quote is sent back". Neither you nor the pricer can edit it. | | |
| 22 | Lead | On `<CCQ-RW-1>` click **Decide price approval** (or **Send back, hold or stop**) → **Send back to…** → **Send to**: **The KAM** (it was "Rework (back to KAM)"). Leave the note empty and record. Then pick a reason, type a note (what should the KAM fix?) and record. Do the same for `<CCQ-RW-2>`. | A reason and a note are required. The quote goes back to **Intake** with the pricer and you still assigned. The KAM is told, with your reason and note (kam.md Part F). | | |
| 23 | Lead | After the KAM answers **No, same scope** on `<CCQ-RW-1>` (kam.md step 45), open it. | The quote is back in **Quoting**: it did not go through G1 or Engineering. You and the pricer are told "… is back from the KAM". A new review round starts, and the price approval is recorded again against the new version with the references carried forward. | | |
| 24 | Lead | On `<CCQ-QT-6>`: **Send back to…** → **Send to**: **Engineering** (it was "Rework (back to Engineering)") with a reason and a note. | The quote goes back to **Engineering & Capacity** as a new version. The engineer and the engineering lead are told. | | |
| 25 | Analyst | When `<CCQ-QT-6>` returns to Quoting, open the **Quoting** tab. | **Earlier versions** shows the first version's record, unchanged. | | |
| 26 | Lead | On `<CCQ-QT-5>`: **Send back to…** → **Send to**: **Pricing (re-cost)** (it was "Rework (re-cost)") with a reason and a note. Then on another quote choose **Hold**: read the **Hold owner** list, set a reason, a review date and a note. | A reason and a note are required each time. Re-cost keeps the quote in **Quoting**, clears **Costing completed**, and tells the pricer. The hold owner starts on **The assigned pricer (<name>)** when the quote has one (FB-17: the person who will clear the hold), otherwise on **Me**. The quote header reads "On hold: <reason>. Owner: <name>. Review by <date>.", and the timeline has the same sentence. | | |
| 27 | Analyst | Look for **Approvals** in the navigation. Type `/quotes/<CCQ-QT-2>/review` after the test URL. | No **Approvals** item. The Final Review page at that address opens **read-only** (every role that can read a quote sees its figures): the three Quoting steps, the capital readiness and the terms, with no decision buttons. Pricing never decides Final Review. | | |

## Part E: What other roles see (sign in as a KAM)

Every role that can read a quote sees its pricing, margin and capital figures. Only Pricing can change them.

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 28 | KAM | Sign out. Sign in as the KAM of `<CCQ-QT-2>`. Open it → **Quoting** tab. | You can read "Price approved ✓ on <date> by <name>", the pricing basis and range, the references and the capital readiness. There is no **Save** button for the KAM. | | |
| 29 | KAM | Open the **Engineering** tab. | The budgetary capital estimate and the capacity evidence are visible, read-only. | | |
| 30 | KAM | **Pipeline** → **Columns**. Choose **Budgetary capital estimate** and **Capital readiness**. Then **Export CSV**. | Both columns are offered, shown and in the file. | | |
| 31 | KAM | Open the emails QuoteFlow sent about this quote. | No price, margin or capital amount in any email. | | |
| 32 | Analyst | Sign back in as yourself. Repeat step 30. | The same columns, on screen and in the CSV. | | |

## Part F: From engineering (FB-06)

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 33 | Analyst | Open `<CCQ-QT-4>` (capital needed: advanced at G2 with a capital estimate above $0) → **Quoting** tab. | A **From engineering** card shows the **Equipment BOM** (file name, version, who uploaded it and when) with a download link, the two-step details if Engineering ticked **Two-step process** (preform plant, blow plant, preform number, freight between plants), and the pack-out (units per bag, tray, case and pallet). "No two-step or pack-out details entered." when there are none. Nothing on the card is editable. | | |
| 34 | Analyst | Download the equipment BOM. Is it the one-page CSR BOM you need for costing, with each line flagged **C** (capital) or **P** (customer paid)? | Write yes, or what is missing, in Notes (A-030: Kal Kaliszewski's minimum fields are still to come). | | |

## Part G: FB-08, FB-09 and FB-12 checks (payment-terms exception, capital terms, Other, Market)

Added 2026-11-10. **FB-08:** payment terms are a list, and a non-standard term goes to the pricing lead as an exception. Sales and Pricing may pre-fill the capital terms; the approver confirms them (approver.md Part C). The standard terms (Net 15 and Net 30, Gemma Cebolla, Nov 9) and the Net 30 default are **provisional**; the exception approver is still to be named (D-003). **FB-09:** an "Other" resin, PCR or additive carries the customer's own value. **FB-12:** the Overview shows the Market and Sub-market. Note a wrong meaning, not a different wording.

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 35 | Analyst | Open `<CCQ-QT-NS>` → **Overview** → **Commercial terms**. Read **Customer requested:** and **Payment terms**. | **Customer requested:** shows "Net 60" with **Non-standard: Pricing will review**. **Payment terms** is already on **Net 60**, with the same badge. | | |
| 36 | Analyst | Fill **Tooling payment** and **Customer tooling commitment**, tick **Terms checked**, and click **Save terms**. | "Terms checked", "Non-standard payment terms: the pricing lead has been asked to decide." A **Payment-terms exception: Net 60** card shows **Waiting for the pricing lead**. **Non-standard terms** is ticked and cannot be unticked ("set by the payment terms"). The pricing lead is notified (bell and email). | | |
| 37 | Lead | Open `<CCQ-QT-NS>` → **Overview** → **Commercial terms**. On the exception card leave **Rationale (required)** empty. | **Approve the exception** and **Reject** stay disabled until there is a rationale. | | |
| 38 | Lead | Type a rationale and click **Reject**. | "Exception rejected" ("Whoever entered the terms and the KAM have been told."). The card shows **Rejected** with your rationale, who decided and when. The analyst and the KAM are notified. | | |
| 39 | Analyst | Change **Payment terms** to **Net 45** (still non-standard) and click **Save terms**. Then ask the lead to open the quote. | A new request waits: **Waiting for the pricing lead**. The lead types a rationale and clicks **Approve the exception**: "Exception approved", status **Approved**, the rationale is shown, and the analyst and KAM are notified. | | |
| 40 | Analyst | Change **Payment terms** to **Net 30** and **Save terms**. | The terms are standard again. Write in Notes what the Commercial panel shows for the earlier exception (the build notes say a request is withdrawn when the terms go back to standard). | | |
| 41 | Analyst | In **Capital terms** (same panel, below the terms) read the note. Fill **Mold ownership**, **Amortized**, **Amortized over (months)** (it appears when **Amortized** is Yes), **Agreement in place**, **Agreement duration (months)** and **Minimum supply / shortfall terms**. Click **Save capital terms**. | The note says "Pre-fill what you know. The approver confirms them at Final Review." **Mold ownership** offers Pretium, Customer and Shared (Pretium and customer). There is **no Funding model** field for you. "Capital terms saved". The panel reads "Not confirmed by the approver yet." | | |
| 42 | Analyst | Try **Amortized over (months)** = 0 or 121, **Agreement duration (months)** = 241, and 301 characters in **Minimum supply / shortfall terms**. | The months are refused with a message under the field (limits 1–120 and 1–240). The text stops at 300 characters. | | |
| 43 | Analyst | Open `<CCQ-QT-OTHER>` → **Overview** → **Intake**. Read **Resin**, **Customer-specified resin**, **PCR %** and **Additives**. | **Resin** reads "Other". **Customer-specified resin** shows the grade the KAM typed. **PCR %** shows the level the KAM typed. **Additives** shows the additive the KAM typed. You can read what the customer specified without asking the KAM. | | |
| 44 | Analyst | On the same **Intake** card read **Market**. | "<Market> › <Sub-market>", for example "Food › Snacks & Confections". On a quote with a market and no sub-market it shows the market alone. | | |
| 45 | Lead | Open **Pricing queue** → **Ready for my review (n)**. Is a pricing lead's exception decision visible without opening the quote? | Write yes or no in Notes. (The exception decision is on the quote's **Commercial terms** panel; the bell and email tell you it is waiting.) | | |

## Part H: FB-17 checks (capital needed, four choices)

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 46 | Analyst | Open **Pricing queue** and find `<CCQ-GD-2>` (advanced by the engineering lead with a $250,000 capital estimate). Use the filter **Engineering decision** → **Capital needed**. | The row's engineering decision reads **Advance · capital needed** with a warning mark, and capital readiness **Capital pending (budgetary)**. The filter lists every quote that needs capital, however G2 was decided, including quotes decided **Advance – capital required** before FB-17. | | |
| 47 | Analyst | Open `<CCQ-GD-2>` → **Quoting** tab. Read **2. Payback** and **Capital readiness**. Save the status **Capital pending (budgetary)** with a justification. | Payback is needed ("Capital is flagged likely"). "Not required" cannot be chosen. With capital pending the warning "Capital is still pending: <your justification>" shows, and **Submit to pricing lead** is not offered: a quote that needs capital must have capital pre-approved before the price is approved. | | |
| 48 | Analyst | Change the status to **Capital pre-approved (budgetary)** and save. Finish the price approval as in Part B. | **Submit to pricing lead** appears once the rest is complete. **Question for Notes (Gemma, Stacy):** should a quote with capital above $0 be able to go to Final Review with capital still pending, as "Advance – capital required" quotes could? | | |
| 49 | Lead | On any quote in Quoting open **Decide price approval** (or **Send back, hold or stop**). Choose **Send back to…** and read **Send to**. Then choose **Stop**. | **Send to** lists **Pricing (re-cost)**, **Engineering**, **The KAM** and **Pricing (another capital model)** (it was "Redirect (alternative capital model)"; it now needs a reason too). **Hold** reads "Pause the quote… To get something fixed, use Send back to… instead." **Stop** asks for a reason and a note and **no closure owner**. Cancel. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Pricing lead | | | |
| | Pricing analyst | | | |
