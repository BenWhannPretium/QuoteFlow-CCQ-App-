# UAT script: Engineering (lead and engineers)

| | |
|---|---|
| Session | **U2**, Tue Nov 10 (2 h). Run by Bailey Schmitt. Jim Zweifel's team and Faron Ipox. |
| Tester roles | Engineering lead (app role `CCQ.EngLead`), and engineers and the capacity analyst (app role `CCQ.Engineer`) |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft** with your Pretium account. The lead must be in **`SG-CCQ-EngLead`**. Engineers and Faron must be in **`SG-CCQ-Engineer`**. |
| Before you start | Ben has staged the quotes below in **Engineering Review**, unassigned. The lead and at least one engineer test side by side. |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Write the step number in the description. |

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<CCQ-ENG-1>` … `<CCQ-ENG-8>` | Eight quotes in Engineering Review, staged by Ben from `<SF-OPP-10..17 chosen by Bailey>`. ENG-1 has a drawing. |
| A CAD file | A STEP or DWG file and a PDF you may upload |
| `<CCQ-QT-1 staged by Ben>` | A quote in Quoting (for the read-only check) |

Labels for stages, outcomes and reasons are provisional configuration. Note a wrong meaning, not a different wording.

## Part A: Lead: the queue

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 1 | Lead | Sign in. Check your email and the bell. | Home **Engineering queue** with **Queue health**, **Open load per engineer**, **Time to assign and to G2** and **Returned to the KAM: top reasons**. You were alerted when each staged quote arrived (bell, and an email "[QuoteFlow] CCQ-… needs your review"). | | |
| 2 | Lead | Click **Engineering queue** in the navigation. | The page lists every quote in Engineering Review, highest priority first. Aging buckets show, with "Buckets, not an SLA (D-20)." | | |
| 3 | Lead | Check the columns and the order. | Columns: **Quote**, **Priority**, **Opportunity / account**, **Product / resin / volume**, **In queue**, **Since assignment**, **Engineer**, **Drawing**, **Warnings**. Order: tier, then score, then age. | | |
| 4 | Lead | Open the filters. Filter by **Tier**, then **Engineer (pick one)** = Unassigned, then **Product family**. Clear them. | The list narrows and comes back. | | |
| 5 | Lead | On `<CCQ-ENG-1>` open the row menu (**…**) → **Assign…**. Pick an engineer. Click **Assign**. | Dialog **Assign engineer** lists each engineer with their open count. Then "They have been notified." The **Engineer** column shows the name. | | |
| 6 | Lead | Assign `<CCQ-ENG-2>` to the same engineer. Then **…** → **Reassign…** to a second engineer. | Both engineers are notified. The quote moves to the second engineer. | | |
| 7 | Lead | Tick `<CCQ-ENG-3>` and `<CCQ-ENG-4>`. Click **Assign selected…**. Pick an engineer. | Both are assigned in one step. | | |
| 8 | Lead | Click **Reassign work…**. Move one engineer's open work to another. | Dialog **Reassign an engineer's work**. The work moves. Both are notified. | | |
| 9 | Lead | On `<CCQ-ENG-8>`: **…** → **Pin to top…**. Set **Queue position (1 = top)** to 1. Type a justification. **Apply override**. | The quote moves to the top. The override is in its **Timeline** (filter **Overrides**). | | |
| 10 | Lead | On `<CCQ-ENG-7>`: **…** → **Return to KAM…**. Pick reason **Missing information**. Type what is missing. **Record decision**. | The quote goes back to **Intake**. The KAM gets a notification and an email. | | |

## Part B: Engineer: accept and review

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 11 | Engineer | Sign in. | Home **My assignments**. Navigation: **Home**, **My assignments**, **Pipeline**. No Approvals, Analytics or Admin. | | |
| 12 | Engineer | Click **My assignments**. | "Your engineering reviews first, then the whole queue (read-only)." Your quotes are on top. | | |
| 13 | Engineer | Open `<CCQ-ENG-1>` → **Engineering** tab. Click **Accept (start review)**. | "Review accepted". **Accepted** shows the time. | | |
| 14 | Engineer | In **Solution** fill **Process type**, **Machine type**, **Plant / site**, **Cavitation**, **Cycle time (s)**, **Preliminary capital (USD)**, **Tooling notes (mold, hot runner)**, **Downstream equipment**, **Technical concept**, **Equipment BOM**, **Supply Chain**. Click **Save solution**. | "Engineering review saved". | | |
| 15 | Engineer | Look at **Preliminary capital (USD)** after the save. | It shows **Hidden**. A note says capital and capacity figures are commercial: your role can enter them but not read them back. | | |
| 16 | Engineer | In **Capacity evidence** click **Add capacity row**. Fill **Site**, **Line / asset**, **Assumed effectiveness %**, **Cycle time (s)**, **Utilization %**, **Buffer %**, **Analysis date**, **Analyst**, **Notes and assumptions**. Click **Save capacity evidence**. | "Capacity evidence saved". The numbers show as **Hidden** to you. | | |
| 17 | Engineer | Add a second row, then **Remove row 2**, then **Save capacity evidence**. | Only one row is kept. | | |
| 18 | Engineer | Open the **Attachments** tab. Pick a **Kind**, add a **Note (optional)** and upload the CAD file and the PDF. | Both are listed with size, your name and time. **Timeline** → **Files** shows the uploads. | | |
| 19 | Engineer | Try to upload a file type that is not on the list under the drop zone (for example a `.zip` or `.exe`). | The upload is refused with a reason. | | |
| 20 | Engineer | Look for **Decide G2…** and for **Assign…** in the queue row menu. | Neither is there. Engineers do not decide G2 or assign. | | |
| 21 | Engineer | Open a quote assigned to someone else → **Engineering** tab. | It is read-only. You cannot change the solution. | | |

## Part C: Lead: capacity sign-off and every G2 outcome

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 22 | Lead | Open `<CCQ-ENG-1>` → **Engineering** tab. | You can read the preliminary capital and the capacity numbers (the lead is a commercial role). | | |
| 23 | Lead | Click **Decide G2…**. Choose **Advance**. | Under **Missing before it can move on:** "Capacity sign-off by the capacity owner". Close the dialog. | | |
| 24 | Lead | In **Capacity sign-off** click **Block capacity** with no note. | The button stays disabled until there is a **Sign-off note** ("Required to block capacity"). | | |
| 25 | Lead | Click **Approve capacity**. | "Capacity approved". | | |
| 26 | Lead | **Decide G2…** → **Advance** → **Record decision**. | "Advance recorded". Stage **Quoting**. Pricing is notified. | | |
| 27 | Lead | On `<CCQ-ENG-2>` (solution, one capacity row, capacity approved): **Decide G2…** → **Advance with risk** with no note. Then add a note and record. | First refused: "Add a note." Then it moves to **Quoting**. | | |
| 28 | Lead | On `<CCQ-ENG-3>`: leave **Preliminary capital (USD)** empty. **Decide G2…** → **Advance – capital required**. | Refused until the preliminary capital figure is saved and capacity is approved. Fill them, then record. The quote moves to **Quoting** with capital readiness **Pending**. | | |
| 29 | Lead | On `<CCQ-ENG-4>`: **Decide G2…** → **Hold**. Set reason, **Review date (required)** and the hold owner. | The quote shows "On hold until <date> · owner <name>". It stays in Engineering Review. | | |
| 30 | Lead | On `<CCQ-ENG-5>`: **Decide G2…** → **Redirect (alternative platform / site)** with a note. | The quote **stays** in Engineering Review. The decision and note are in the timeline. | | |
| 31 | Lead | On `<CCQ-ENG-6>`: **Decide G2…** → **Stop**, reason and note. | The quote closes as **Declined**. The KAM is notified. | | |
| 32 | Lead | Open the header button **Feasible solution?** on any quote in the queue. | It opens the same G2 dialog. Each outcome has an ⓘ definition. Cancel. | | |
| 33 | Engineer | Open `<CCQ-QT-1 staged by Ben>` → **Quoting** tab. | Only "Price approved ✓ on <date> by <name>". No pricing details. | | |
| 34 | Lead | **Analytics** → **Engineering**. | The engineering view: who has what, waiting time, capacity blocks, G2 results. Each chart has an ⓘ. | | |

## Part D: Faron (capacity analyst)

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 35 | Faron | With a quote assigned to you, add a capacity row with your assumption in **Assumed effectiveness %** and a note. Save. | Saved. You are the **Analyst**. The hint reminds you to state your assumption. | | |
| 36 | Faron | Say whether the capacity fields are the right ones for each process (for example assembly has no cavitation). | Write the answer in Notes. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Engineering lead | | | |
| | Engineer | | | |
| | Capacity analyst | | | |
