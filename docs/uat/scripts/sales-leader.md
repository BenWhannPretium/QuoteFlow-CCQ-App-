# UAT script: Sales leader

| | |
|---|---|
| Session | **U1**, Mon Nov 9 (2 h), alongside the KAMs. Run by Bailey Schmitt. |
| Tester role | Sales leader, the G1 qualifier (app role `CCQ.SalesLeader`) |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft** and use your Pretium account. Your account must be in **`SG-CCQ-SalesLeader`**. |
| Before you start | The KAMs have submitted their Part B and Part C quotes (kam.md). Ben has staged the quotes below. The KAM testers have submitted their Part B quote (you override its tier in Part D). |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Write the step number in the description. |

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<CCQ-G1-A>` … `<CCQ-G1-E>` | Five submitted intakes waiting at G1, staged by Ben from `<SF-OPP-5..9 chosen by Bailey>` |
| KAM Part C quote | The quote the KAM tester submitted in kam.md Part C (you return it at step 9) |
| `<SF-OPP-OWN chosen by Bailey>` | A Salesforce opportunity **you** own, used to submit your own intake |
| `<CCQ-CD-3 staged by Ben>` | A quote in Customer Decision, still inside its validity date |
| `<CCQ-OVR-OLD staged by Ben>` | Optional: a priority override requested **before** the November change (a KAM raised it under the old rule). Skip step 26 if Ben has none |

**Retest and record (added 2026-11-10).** Session U1 ran on Mon Nov 9, before FB-09 (the "Other" rule), FB-12 (sub-market and the new market list) and FB-08 (commercial terms). Steps 7 and 7a are changed. Part F is new. Retest them on the test site. They stay here for the record.

Labels for stages, outcomes and reasons are provisional configuration. Note a wrong meaning, not a different wording.

## Part A: Home and the team dashboard

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Sign in. | Home **Sales pipeline** ("Qualification decisions and the health of your team’s pipeline."). | | |
| 2 | Look at the navigation. | **Home**, **New intake**, **My proposals**, **To qualify**, **Pipeline**, **Approvals**, **Analytics**. No Admin. | | |
| 3 | Read the home blocks. | **To qualify (G1)**, **Pending override requests** (empty is normal: new overrides apply at once), **Team pipeline by stage**, **Proposals with no outcome past validity**. | | |
| 4 | Click the ⓘ next to **Team pipeline by stage**. | A pop-up gives the definition and the time window. | | |
| 5 | Compare the **Team pipeline by stage** counts with **Pipeline** (filter by your team's KAMs). | The counts match. | | |

## Part B: G1 Qualify & prioritize, every outcome

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 6 | Click **To qualify**. | Tab **To qualify**: "Submitted intakes, highest priority first. The score is advisory: it orders the list; you decide." Each row has **Decide**. | | |
| 7 | Open `<CCQ-G1-A>`. Read the product facts, then **Why this priority?** | The Overview shows what the KAM entered (**Market** as "Market › Sub-market", resin, PCR %, dimensions, the two needed-by dates, any variants note). **Why this priority?** shows each attribute with its points. Strategic fit shows **Market: <Market › Sub-market>** (for example "Market: Food › Snacks & Confections") with a **provisional** chip. The live model scores strategic fit at a neutral 50; the sub-market points are only in the draft (priority-calibration.md). "Timing" reads the **Quote needed by** date. | | |
| 7a | Open a quote where the KAM picked **Other** for resin, PCR or additive (for example the quote from kam.md steps 10a–10d). Read **Resin**, **Customer-specified resin**, **PCR %** and **Additives**. | **Resin** reads "Other". The next three show what the KAM typed, so you can qualify without asking. Write in Notes if the customer's value would change your decision. | | |
| 8 | Click **Decide** on `<CCQ-G1-A>`. Choose **Advance**. Click **Record decision**. | The dialog shows the priority (advisory) and "Intake complete for this decision." No note is asked for a plain Advance. Then "Advance recorded". The quote leaves the list. Its stage is **Engineering Review**. | | |
| 9 | **Decide** on the KAM's Part C quote. Choose **Rework (back to KAM)**. Pick reason **Missing information**. Type a note in "What should the KAM fix?" **Record decision**. | A note is required. The quote goes back to **Intake**. The KAM is notified and sees the banner (kam.md steps 37–40). | | |
| 10 | **Decide** on `<CCQ-G1-B>`. Choose **Hold**. Click **Record decision** with no review date and no note. | Refused: it asks for a review date and a note. | | |
| 11 | Set **Review date (required)**, keep the hold owner as yourself, pick a reason, add a note, **Record decision**. | The quote shows "On hold until <date> · owner <you>". The KAM is told it is on hold, with the review date. | | |
| 12 | **Decide** on `<CCQ-G1-C>`. Choose **Redirect (not CCQ work)**. Pick **Stock item**. Add a note. **Record decision**. | The quote closes as **Redirected**. The closure card shows the reason and you as closure owner. The KAM is told it closed. | | |
| 13 | **Decide** on `<CCQ-G1-D>`. Choose **Stop**. Pick **Not strategic**. Leave the note empty. **Record decision**. | "Add a note." The option is marked "Closes the quote". | | |
| 14 | Add a note. **Record decision**. | The quote closes as **Declined**. | | |
| 15 | Open `<CCQ-G1-E>`. Click the header button **Qualify & prioritize**. Hover each ⓘ next to the options. | The same dialog opens from the quote page. Each outcome has a definition. Cancel without deciding. | | |
| 16 | After the KAM resubmits the Part C quote, check **To qualify**. | It is back in the list with the same quote number. | | |

## Part C: You cannot qualify your own deal (negative check)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 17 | Click **New intake**. Submit an intake from `<SF-OPP-OWN chosen by Bailey>` (you are the KAM). | The quote is created and waits at G1. | | |
| 18 | Find it in **To qualify**, or open it. | You cannot decide it: no **Decide** button, or the dialog says you can't record a decision. The rule is "You cannot qualify an opportunity you own as KAM". Another sales leader must decide it. | | |

## Part D: Priority override (sales leaders only)

You are the only role that can change a priority tier. It applies at once, with your reason. KAMs, Engineering and Pricing ask you instead (kam.md step 34).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 19 | Open the KAM's Part B quote. Next to the priority, click **Override priority tier**. | A dialog **Override priority tier** that says "Applies now and is logged with your reason". There is no request-and-wait step. | | |
| 20 | Pick **New tier** = **Critical** (or another). Type **Justification (required)** "Too short". Click **Apply override**. | Refused: the justification needs at least 15 characters. | | |
| 21 | Type a justification of 15 or more characters (for example "Strategic launch, customer line trial"). Click **Apply override**. | The dialog closes. The priority shows the new tier with a marker (original tier and why). The justification shows under **Why this priority?** | | |
| 22 | Sign in as the engineering lead (or ask the tester). Open **Engineering queue** and find the quote. | The row shows a chip with your justification, so Engineering knows why it moved. | | |
| 23 | In **Timeline**, click **Overrides**. | "Priority tier overridden: <old> → <new>", with your name and reason. | | |
| 24 | Click **Revert** on the override. Confirm **Revert**. | "Override reverted. The original value is back." The marker goes. The timeline shows the revert. | | |
| 25 | Ask a KAM tester, an engineer and a pricer to open a quote and look for an override button on the priority. | None of them has one. The KAM sees "Need a different priority? Escalate to your sales leader." | | |
| 26 | Only if Ben staged `<CCQ-OVR-OLD>`: **Approvals** → **Overrides**. Click **Approve** without a note, then with a note. | A request raised before the change stays open and you can decide it. A note is required. "Override approved and applied". | | |
| 27 | Try to approve a request you raised yourself (if one exists). | You cannot decide your own request. | | |

## Part E: Outcomes, board and what you can see

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 28 | Open `<CCQ-CD-3 staged by Ben>`. Click **Outcome recorded** (header). Choose **No response / Expired**. Pick a reason. Leave the note empty. **Record decision**. | Refused: "The proposal is still valid: add a note saying why it is expired now." Close without recording. | | |
| 29 | **Pipeline** → **Board**. Drag a quote that waits at G1 to **Engineering Review**. | The **Qualify & prioritize** dialog opens to confirm. Cancel. The card goes back. | | |
| 30 | Open a quote in **Quoting** or later → **Quoting** tab. | You can read the price approval record and the capital readiness (every role that can read a quote sees them). There is no button to change them. | | |
| 31 | **Pipeline** → **Columns**. | **Budgetary capital estimate** and **Capital readiness** are offered, like for every role. | | |
| 32 | Open a quote whose G3 or G4 is decided. | The section is locked: "Locked after G3 · decided by <name> on <date> · reopens if the quote is sent back". | | |
| 33 | **Analytics**. Pick your region and **Last 90 days**. | The **Leadership report** loads. Every chart has an ⓘ with its definition. | | |

## Part F: Terms and extra approval, read and record (FB-08)

Added 2026-11-10. Skipped on Nov 9, because FB-08 was not built yet.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 34 | Open a quote that has not been released at Final Review → **Overview** → **Commercial terms**. | You can edit the payment terms, the tooling payment, the terms check and the **Capital terms** pre-fill (the KAM and Pricing can too). **Tooling funding model** and **MOQ** are Engineering's: you read them. You cannot confirm the capital terms (the approver does) or approve a payment-terms exception (the pricing lead does). | | |
| 35 | Click **Approvals**. | You see the override requests (step 26). There is no Final Review queue for you: only the approver, leadership and Admin read it. Write in Notes what the page shows you. | | |
| 36 | **Optional.** Only if Bailey runs `approver.md` Part G (the extra customer-funded approval, switched on for the test): sign off as the **sales leader**. | See `approver.md` step 39. You sign first, on the quote's **Commercial terms**. Leadership signs after you. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Sales leader | | | |
