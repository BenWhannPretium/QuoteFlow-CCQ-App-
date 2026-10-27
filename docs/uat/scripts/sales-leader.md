# UAT script: Sales leader

| | |
|---|---|
| Session | **U1**, Mon Nov 9 (2 h), alongside the KAMs. Run by Bailey Schmitt. |
| Tester role | Sales leader, the G1 qualifier (app role `CCQ.SalesLeader`) |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft** and use your Pretium account. Your account must be in **`SG-CCQ-SalesLeader`**. |
| Before you start | The KAMs have submitted their Part B and Part C quotes (kam.md). Ben has staged the quotes below. A KAM has requested a priority override (kam.md step 26). |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Write the step number in the description. |

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<CCQ-G1-A>` … `<CCQ-G1-E>` | Five submitted intakes waiting at G1, staged by Ben from `<SF-OPP-5..9 chosen by Bailey>` |
| KAM Part C quote | The quote the KAM tester submitted in kam.md Part C (you return it at step 8) |
| `<SF-OPP-OWN chosen by Bailey>` | A Salesforce opportunity **you** own, used to submit your own intake |
| `<CCQ-CD-3 staged by Ben>` | A quote in Customer Decision, still inside its validity date |

Labels for stages, outcomes and reasons are provisional configuration. Note a wrong meaning, not a different wording.

## Part A: Home and the team dashboard

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Sign in. | Home **Sales pipeline** ("Qualification decisions and the health of your team’s pipeline."). | | |
| 2 | Look at the navigation. | **Home**, **New intake**, **My proposals**, **To qualify**, **Pipeline**, **Approvals**, **Analytics**. No Admin. | | |
| 3 | Read the home blocks. | **To qualify (G1)**, **Pending override requests**, **Team pipeline by stage**, **Proposals with no outcome past validity**. | | |
| 4 | Click the ⓘ next to **Team pipeline by stage**. | A pop-up gives the definition and the time window. | | |
| 5 | Compare the **Team pipeline by stage** counts with **Pipeline** (filter by your team's KAMs). | The counts match. | | |

## Part B: G1 Qualify & prioritize, every outcome

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 6 | Click **To qualify**. | Tab **To qualify**: "Submitted intakes, highest priority first. The score is advisory: it orders the list; you decide." Each row has **Decide**. | | |
| 7 | Click **Decide** on `<CCQ-G1-A>`. Choose **Advance**. Click **Record decision**. | The dialog shows the priority (advisory) and "Intake complete for this decision." Then "Advance recorded". The quote leaves the list. Its stage is **Engineering Review**. | | |
| 8 | **Decide** on the KAM's Part C quote. Choose **Rework (back to KAM)**. Pick reason **Missing information**. In the note ("What should the KAM fix?") say what to fix. **Record decision**. | The quote goes back to **Intake**. The KAM is notified and sees the banner (kam.md steps 27–30). | | |
| 9 | **Decide** on `<CCQ-G1-B>`. Choose **Hold**. Click **Record decision** with no review date. | "Choose a review date." | | |
| 10 | Set **Review date (required)**, keep the hold owner as yourself, pick a reason, **Record decision**. | The quote shows "On hold until <date> · owner <you>". | | |
| 11 | **Decide** on `<CCQ-G1-C>`. Choose **Redirect (not CCQ work)**. Pick **Stock item**. Add a note. **Record decision**. | The quote closes as **Redirected**. The closure card shows the reason and you as closure owner. | | |
| 12 | **Decide** on `<CCQ-G1-D>`. Choose **Stop**. Pick **Not strategic**. Leave the note empty. **Record decision**. | "Add a note." The option is marked "Closes the quote". | | |
| 13 | Add a note. **Record decision**. | The quote closes as **Declined**. | | |
| 14 | Open `<CCQ-G1-E>`. Click the header button **Qualify & prioritize**. Hover each ⓘ next to the options. | The same dialog opens from the quote page. Each outcome has a definition. Cancel without deciding. | | |
| 15 | After the KAM resubmits the Part C quote, check **To qualify**. | It is back in the list with the same quote number. | | |

## Part C: You cannot qualify your own deal (negative check)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 16 | Click **New intake**. Submit an intake from `<SF-OPP-OWN chosen by Bailey>` (you are the KAM). | The quote is created and waits at G1. | | |
| 17 | Find it in **To qualify**, or open it. | You cannot decide it: no **Decide** button, or the dialog says you can't record a decision. The rule is "You cannot qualify an opportunity you own as KAM". Another sales leader must decide it. | | |

## Part D: Priority override: approve, reject, revert

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 18 | Click **Approvals** → **Overrides** tab. | **Override requests**: the KAM's request with the current and requested tier, who asked and the justification. | | |
| 19 | Click **Approve** without a note. | Refused: a note is required. | | |
| 20 | Type a note. Click **Approve**. | "Override approved and applied". The quote's priority shows the overridden tier with a marker. | | |
| 21 | Ask a KAM to raise a second request. Type a note. Click **Reject**. | "Override rejected". The tier does not change. | | |
| 22 | Open the quote from step 20. In **Timeline**, click **Overrides**. Click **Revert** on the override. Confirm **Revert**. | "Override reverted. The original value is back." The timeline shows the revert. | | |
| 23 | On any quote, click **Override** next to the priority yourself and **Request override**. Then look in **Approvals** → **Overrides**. | You cannot approve your own request ("You cannot decide your own override request"). | | |

## Part E: Outcomes, board and redaction

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 24 | Open `<CCQ-CD-3 staged by Ben>`. Click **Outcome recorded** (header). Choose **No response / Expired**. Pick a reason. Leave the note empty. **Record decision**. | Refused: "The proposal is still valid: add a note saying why it is expired now." Close without recording. | | |
| 25 | **Pipeline** → **Board**. Drag a quote that waits at G1 to **Engineering Review**. | The **Qualify & prioritize** dialog opens to confirm. Cancel. The card goes back. | | |
| 26 | Open a quote in **Quoting** or later → **Quoting** tab. | Only "Price approved ✓ on <date> by <name>". No pricing or capital figures (sales leaders are not a commercial role). | | |
| 27 | **Pipeline** → **Columns**. | **Prelim capital (USD)** and **Capital readiness** are not offered. | | |
| 28 | **Analytics**. Pick your region and **Last 90 days**. | The **Leadership report** loads. Every chart has an ⓘ with its definition. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Sales leader | | | |
