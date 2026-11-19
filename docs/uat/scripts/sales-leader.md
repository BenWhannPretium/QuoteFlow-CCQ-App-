# UAT script: Sales leader

> Checked against the build on 2026-11-17 (pre-release audit): the stage after G1 is **Engineering & Capacity**, the Command Center block is **To qualify**, and the buttons read **Qualify quote**, **Override** and **Record customer decision**. Steps 3, 8, 15, 19, 28 and 29 are changed. Updated 2026-11-17 for the approved UX changes (docs/audit/03-ux-proposals.md).

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

**Changed 2026-11-15 (FB-17, walkthrough of Nov 13).** The decision dialog offers four choices: **Advance**, **Send back to…**, **Hold** and **Stop**. "Rework (back to KAM)" is **Send back to…** → **The KAM (fix the intake)**; "Redirect (not CCQ work)" is **Stop: not CCQ work (send elsewhere)**. Stopping no longer asks for a closure owner. Steps 7, 9, 11, 12, 14 and 15 are changed.

**Changed 2026-11-15 (FB-18, walkthrough of Nov 13).** Home is now the **Command Center**, with two views at the top: **My work** and **Analytics**. **Analytics** is no longer in the menu. A quote on hold shows an orange **On hold** chip on the Command Center. Steps 1, 2, 3, 11 and 33 are changed.

## Part A: The Command Center and the team dashboard

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Sign in. | The **Command Center** opens on **Sales pipeline** ("Qualification decisions and the health of your team’s pipeline."). The line above the title reads "Command Center · Sales leader". | | |
| 2 | Look at the navigation. | **Command Center**, **New intake**, **My proposals**, **To qualify**, **Pipeline**, **Approvals**. No Admin, and no **Analytics** item: the Command Center has two views at the top, **My work** and **Analytics**. | | |
| 3 | Read the blocks of **My work**. | **To qualify**, **Pending override requests** (empty is normal: new overrides apply at once), **Team pipeline by stage**, **Proposals with no outcome past validity**. | | |
| 4 | Click the ⓘ next to **Team pipeline by stage**. | A pop-up gives the definition and the time window. | | |
| 5 | Compare the **Team pipeline by stage** counts with **Pipeline** (filter by your team's KAMs). | The counts match. | | |

## Part B: G1 Qualify & prioritize, every outcome

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 6 | Click **To qualify**. | Tab **To qualify**: "Submitted intakes, highest priority first. The score is advisory: it orders the list; you decide." Each row has **Decide**. | | |
| 7 | Open `<CCQ-G1-A>`. Read the product facts, then **Why this priority?** | The Overview shows what the KAM entered (**Market** as "Market › Sub-market", resin, PCR %, dimensions, the two needed-by dates, any variants note). **Why this priority?** shows each attribute with its points. Strategic fit shows **Market: <Market › Sub-market>** (for example "Market: Food › Snacks & Confections") with a **provisional** chip. The live model scores strategic fit at a neutral 50; the sub-market points are only in the draft (priority-calibration.md). "Timing" reads the **Quote needed by** date. FB-17: on a laptop the whole explanation stays on the screen (it opens above the button when there is more room there) and scrolls inside when it is long. | | |
| 7a | Open a quote where the KAM picked **Other** for resin, PCR or additive (for example the quote from kam.md steps 10a–10d). Read **Resin**, **Customer-specified resin**, **PCR %** and **Additives**. | **Resin** reads "Other". The next three show what the KAM typed, so you can qualify without asking. Write in Notes if the customer's value would change your decision. | | |
| 8 | Click **Decide** on `<CCQ-G1-A>`. Choose **Advance**. Click **Record decision**. | The dialog shows the priority on one line, "Priority <score> · <tier> (advisory)" (for example "Priority 62 · High (advisory)"). The breakdown under it is closed, so the choices are on the screen without scrolling; click the line (or press Enter on it) to open the breakdown. The dialog also says "Intake complete for this decision." No note is asked for a plain Advance. Then "Advance recorded". The quote leaves the list. Its stage is **Engineering & Capacity**. | | |
| 9 | **Decide** on the KAM's Part C quote. Choose **Send back to…**. **Send to** already shows **The KAM (fix the intake)**, the only place a quote can go from here. Record with no reason and no note. Then pick reason **Missing information** and type a note in **Note (required)** (the KAM sees it as "What to fix:"). **Record decision**. | "Choose a reason." and "Add a note." Then "Send back to the KAM (fix the intake) recorded". The quote goes back to **Intake**. The KAM is notified and sees the banner (kam.md steps 37–40). Open the quote yourself: there is no **Qualify quote** button while it is back with the KAM. The line under the stage tracker reads "Back with the KAM for rework since <time>. Nothing to decide until it is resubmitted." | | |
| 10 | **Decide** on `<CCQ-G1-B>`. Choose **Hold**. Click **Record decision** with no review date and no note. | Refused: it asks for a review date and a note. | | |
| 11 | Read the text under **Hold**. Set **Review date (required)**, leave the **Hold owner** on **Me** (nobody is assigned at this stage), pick a reason, add a note, **Record decision**. | Hold reads "Pause the quote, for example when the customer asks to revisit it in 6 months. To get something fixed, use Send back to… instead." The **Hold owner** list offers **Me**, **The KAM (<name>)** and a search by name. After recording, the line under the quote's stage tracker reads "On hold: <reason>. Owner: <you>. Review by <date>. A decision by the sales leader ends the hold.", and the **Timeline** has the hold sentence with your note. The KAM is told it is on hold, with the owner, the reason and the review date. FB-18: on the Command Center, **Team pipeline by stage** lists the quote first in its stage with an orange **On hold** chip; rest the mouse on the chip, or tab to it, to read the same sentence. | | |
| 12 | **Decide** on `<CCQ-G1-C>`. Choose **Stop: not CCQ work (send elsewhere)** (one of the two choices under Stop; it was "Redirect (not CCQ work)"). Pick **Stock item**. Add a note. **Record decision**. | No **Closure owner** question is asked. The quote closes as **Redirected**. The closure card shows the reason and you as closure owner. The KAM is told it closed. | | |
| 13 | **Decide** on `<CCQ-G1-D>`. Choose **Stop**. Pick **Not strategic**. Leave the note empty. **Record decision**. | "Add a note." The option is marked "Closes the quote". | | |
| 14 | Add a note. **Record decision**. | No **Closure owner** question is asked (FB-17): the quote closes as **Declined** with you as closure owner. | | |
| 15 | Open `<CCQ-G1-E>`. Click the header button **Qualify quote**. Hover each ⓘ next to the options. | The same dialog opens from the quote page, titled **Qualify quote**. Advance, Hold and each Stop have a definition behind the ⓘ; **Send back to…** shows the definition of the place chosen under **Send to**. Cancel without deciding. | | |
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
| 19 | Open the KAM's Part B quote. Next to the priority, click **Override** (the pencil). | A dialog **Override priority tier** that says "Applies now and is logged with your reason". There is no request-and-wait step. | | |
| 20 | Pick **New tier** = **Critical** (or another). Type **Justification (required)** "Too short". Click **Apply override**. | Refused: the justification needs at least 15 characters. | | |
| 21 | Type a justification of 15 or more characters (for example "Strategic launch, customer line trial"). Click **Apply override**. | The dialog closes. The priority shows the new tier with a marker (original tier and why). The justification shows under **Why this priority?** | | |
| 22 | Advance the quote at G1 first if it is still in Intake (the Engineering queue only lists it after that). Sign in as the engineering lead (or ask the tester). Open **Engineering queue** and find the quote. | The row shows a chip with your justification, so Engineering knows why it moved. | | |
| 23 | In **Timeline**, click **Overrides**. | "Priority tier overridden: <old> → <new>", with your name and reason. | | |
| 24 | Click **Revert** on the override. Confirm **Revert**. | "Override reverted. The original value is back." The marker goes. The timeline shows the revert. | | |
| 25 | Ask a KAM tester, an engineer and a pricer to open a quote and look for an override button on the priority. | None of them has one. The KAM sees "Need a different priority? Escalate to your sales leader." | | |
| 26 | Only if Ben staged `<CCQ-OVR-OLD>`: **Approvals** → **Overrides**. Click **Approve** without a note, then with a note. | A request raised before the change stays open and you can decide it. A note is required. "Override approved and applied". | | |
| 27 | Try to approve a request you raised yourself (if one exists). | You cannot decide your own request. | | |

## Part E: Outcomes, board and what you can see

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 28 | Open `<CCQ-CD-3 staged by Ben>`. Click **Record customer decision** (header). Choose **No response / Expired**. Pick a reason. Leave the note empty. **Record decision**. | Refused: "The proposal is still valid: add a note saying why it is expired now." Close without recording. | | |
| 29 | **Pipeline** → **Board**. Drag a quote that waits at G1 to **Engineering & Capacity**. | The **Qualify quote** dialog opens to confirm. Cancel. The card goes back. | | |
| 30 | Open a quote in **Quoting** or later → **Quoting** tab. | You can read the price approval record and the capital readiness (every role that can read a quote sees them). There is no button to change them. | | |
| 31 | **Pipeline** → **Columns**. | **Budgetary capital estimate** and **Capital readiness** are offered, like for every role. | | |
| 32 | Open a quote whose G3 or G4 is decided. | The section is locked: "Locked after the Quoting decision · decided by <name> on <date and time> · reopens if the quote is sent back" (the time is US Central, for example "Nov 17, 2026, 12:18 PM CST"). | | |
| 33 | **Command Center** → **Analytics** (the second view, at the top). Pick your region and **Last 90 days**. Then click **Command Center** in the menu. | The **Leadership report** loads, with the same filters and charts as before. Every chart has an ⓘ with its definition. The Command Center opens again on **Analytics**: it remembers the view you chose last. Click **My work** to go back. An old `/analytics` link or bookmark opens this view with its filters. | | |

## Part F: Terms and extra approval, read and record (FB-08)

Added 2026-11-10. Skipped on Nov 9, because FB-08 was not built yet.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 34 | Open a quote that has not been released at Final Review → the **Commercial terms** tab. | You can edit the payment terms, the tooling payment, the terms check and the **Capital terms** pre-fill (the KAM and Pricing can too). **Tooling funding model** and **MOQ** are Engineering's: you read them. You cannot confirm the capital terms (the approver does) or approve a payment-terms exception (the pricing lead does). | | |
| 35 | Click **Approvals**. | You see the override requests (step 26). There is no Final Review queue for you: only the approver, leadership and Admin read it. Write in Notes what the page shows you. | | |
| 36 | **Optional.** Only if Bailey runs `approver.md` Part G (the extra customer-funded approval, switched on for the test): sign off as the **sales leader**. | See `approver.md` step 39. You sign first, on the quote's **Commercial terms**. Leadership signs after you. | | |

## UX changes (2026-11-17)

Added 2026-11-17 for the approved UX changes (`docs/audit/03-ux-proposals.md`). Steps 8, 9, 11 and 32 above were changed for the same reason. The gate and reason names in the examples are configuration.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 37 | Sign in on a browser where you have not opened QuoteFlow before (or in a private window). Read the card at the top of the **Command Center**. Click its link, then **Got it**. Reload the page. | A card **Welcome to QuoteFlow**: "Your main jobs here, and where each one is done." Three jobs: "Decide which new intakes go to Engineering: **To qualify**.", "Change a quote’s priority tier, with a reason: **Override, on the quote**." and "Follow your team’s quotes and missing outcomes: **Pipeline, and this page**." The link "Read the one-page quick-start for Sales leader" opens the quick-start in a new tab. **Got it** puts the card away for good (for you, in this browser); it does not come back after a reload. | | |
| 38 | On the **Command Center** read **Team pipeline by stage**. | Each quote in a stage list shows the customer after the quote number, and the opportunity name on a wide screen. A stage total reads "<amount> Salesforce opportunity amount". | | |
| 39 | Open a quote that waits at G1 (for example `<CCQ-G1-E>`). Then open the quote you advanced in step 8. Read the line under the stage tracker on each. | At G1: "Waiting on you. Next: qualify quote." The line has no button: **Qualify quote** is in the header. In Engineering & Capacity, until an engineer is assigned: "Waiting on: the engineering lead. Next: assign an engineer." | | |
| 40 | Open the KAM's Part C quote while it is back with the KAM (after step 9, before the KAM resubmits). Read the banner and the **Gate decisions** card. | The banner reads "Returned by <you> at Qualify & prioritize", then "Reason: Missing information", "What to fix: <your note>" and the time in US Central (for example "Nov 17, 2026, 12:18 PM CST"). **Gate decisions** shows "Reason: Missing information" (the reason's label, not a code in brackets). You have no **Fix and resubmit** button: that is the KAM's. | | |
| 41 | Open `<CCQ-G1-B>` (on hold since step 11). Click **Qualify quote** (or **Decide** on its row in **To qualify**) and read the choices. Cancel. | **Hold** is not offered on a quote that is already on hold. **Advance**, **Send back to…**, **Stop: not CCQ work (send elsewhere)** and **Stop** remain; recording any of them ends the hold. (If a second hold is sent from another tab, it is refused: "This quote is already on hold. Record a decision to end the hold.") | | |

## FB-25: To qualify opens from the notice (2026-11-19)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 42 | After a KAM submits a quote, click the bell and open "<CCQ-…> is waiting to qualify". (The daily email's rows do the same.) | **To qualify** opens, not the quote's Overview. The quote's card is open and on screen, showing what the KAM entered: the request, the commercial inputs, the items with their product facts and volumes, and the files. Nothing on it can be edited. | | |
| 43 | Click **Show details** on another card, then **Expand all** and **Collapse all** at the top. Try it with the keyboard (Tab to **Show details**, Enter). | Each card opens and closes on its own; **Expand all** opens every card and **Collapse all** closes them. The keyboard works, and a screen reader says whether a card is open. | | |
| 44 | On the card from step 42 click **Decide**, choose **Advance** and **Record decision**. | The card leaves the list; the quote goes to Engineering & Capacity. | | |
| 45 | Open a quote that waits at G1 (not from the notice). | It opens on the **Commercial terms** tab. The tabs read **Overview · Engineering · Quoting · Commercial terms · Attachments**; the tab bar stays under the page header when you scroll. **Overview** is a read-only summary ("At a glance": Intake, Engineering, Pricing, Commercial terms, Why this priority?, Gate decisions, the timeline). | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Sales leader | | | |
