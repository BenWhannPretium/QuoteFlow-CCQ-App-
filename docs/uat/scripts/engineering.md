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
| `<CCQ-QT-6>` | The quote Pricing sends back to Engineering in pricing.md step 24 (staged by Ben) |

Labels for stages, outcomes and reasons are provisional configuration. Note a wrong meaning, not a different wording.

## Part A: Lead: the queue

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 1 | Lead | Sign in. Check your email and the bell. | Home **Engineering queue** with **Queue health**, **Open load per engineer**, **Time to assign and to G2** and **Returned to the KAM: top reasons**. You were alerted when each staged quote arrived (bell, and an email "[QuoteFlow] CCQ-… needs your review"). | | |
| 2 | Lead | Click **Engineering queue** in the navigation. | The page lists every quote in Engineering Review, highest priority first. Aging buckets show, with "Buckets, not an SLA (D-20)." Two tabs: **All** and **Ready for my review (n)**. | | |
| 3 | Lead | Check the columns and the order. | Columns: **Quote**, **Priority**, **Opportunity / account**, **Product / resin / volume**, **Destination**, **KAM**, **In queue**, **Since assignment**, **Engineer**, **Drawing**, **Warnings**. Order: tier, then score, then age. A priority a sales leader changed shows a chip with the reason. | | |
| 4 | Lead | Open the filters. Filter by **Tier**, then **Engineer (pick one)** = Unassigned, then **Product family**. Clear them. | The list narrows and comes back. | | |
| 5 | Lead | On `<CCQ-ENG-1>` open the row menu (**…**) → **Assign…**. Pick an engineer. Click **Assign**. | Dialog **Assign engineer** lists each engineer with their open count. Then "They have been notified." The **Engineer** column shows the name. | | |
| 6 | Lead | Assign `<CCQ-ENG-2>` to the same engineer. Then **…** → **Reassign…** to a second engineer. | Both engineers are notified. The quote moves to the second engineer. | | |
| 7 | Lead | Tick `<CCQ-ENG-3>` and `<CCQ-ENG-4>`. Click **Assign selected…**. Pick an engineer. | Both are assigned in one step. | | |
| 8 | Lead | Click **Reassign work…**. Move one engineer's open work to another. | Dialog **Reassign an engineer's work**. The work moves. Both are notified. | | |
| 9 | Lead | On `<CCQ-ENG-8>`: **…** → **Pin to top…**. Set **Queue position (1 = top)** to 1. Type a justification. **Apply override**. | The quote moves to the top. The override is in its **Timeline** (filter **Overrides**). This is the queue position, not the priority tier: you cannot change the tier (only a sales leader can). | | |
| 10 | Lead | On `<CCQ-ENG-7>`: **…** → **Return to KAM…**. Pick reason **Missing information**. Leave the note empty, then type what is missing. **Record decision**. | A note is required. The quote goes back to **Intake**. The KAM gets a notification and an email. | | |

## Part B: Engineer: accept and review

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 11 | Engineer | Sign in. | Home **My assignments**. Navigation: **Home**, **My assignments**, **Pipeline**. No Approvals, Analytics or Admin. | | |
| 12 | Engineer | Click **My assignments**. | "Your engineering reviews first, then the whole queue (read-only)." Your quotes are on top. | | |
| 13 | Engineer | Open `<CCQ-ENG-1>` → **Engineering** tab. Click **Accept (start review)**. | "Review accepted". **Accepted** shows the time. | | |
| 14 | Engineer | Read the product facts at the top of the tab. | A **Product facts** block shows what the KAM entered: resin and customer-specified grade, PCR %, color and additives, decoration and mold change, dimensions, destination, the needed-by dates and any variants note. You do not retype them. | | |
| 15 | Engineer | In **Solution** fill **Process type**, **Machine type**, **Plant / site**, **Cavitation**, **Cycle time (s)**, **Budgetary capital estimate (USD)**, **Tooling notes (mold, hot runner)**, **Downstream equipment**, **Technical concept**, **Equipment BOM**, **Supply Chain**. Click **Save solution**. | "Engineering review saved". The capital label reads **Budgetary capital estimate (USD)** with "A budgetary figure for quoting." **EBM wheel** is not in the **Machine type** list. **Cavitation** accepts only whole numbers from 1 to 99. | | |
| 16 | Engineer | Look at **Budgetary capital estimate (USD)** after the save. | You can read it back. Nothing is hidden from your role. | | |
| 17 | Engineer | In **Capacity evidence** click **Add capacity row**. Fill **Site**, **Line / asset**, **Utilization before %**, **Allocated annual volume (units)**, **Scheduled run days per year**, **Assumed effectiveness %**, **Cycle time (s)**, **Analysis date**, **Analyst**, **Notes and assumptions**. Click **Save capacity evidence**. | Saving without **Assumed effectiveness %** is refused ("state the assumed effectiveness %"). Then "Capacity evidence saved". **Utilization after % (calculated)** appears and you cannot type it. There is no **Buffer %** field. A line over 100 % shows red "exceeds line capacity"; over the warning level it is amber. The capacity basis line reads "Trailing 12 months actual, trending OEE (provisional, D-021)". | | |
| 18 | Engineer | Change **Cavitation** in **Solution** and save. Look at the capacity row. | **Utilization after % (calculated)** updates by itself. | | |
| 19 | Engineer | Add a second row that splits the quote's volume between two lines, then **Remove row 2**, then **Save capacity evidence**. | With two rows, an allocated volume that does not add up to the quote's volume shows a warning only. Only one row is kept after the removal. | | |
| 20 | Engineer | In **Capacity evidence** click **Download CSV**. Then click **Attach analysis** and upload your own analysis file. | A file `<CCQ-…>-capacity-evidence.csv` downloads with the saved rows. The analysis file is listed under the quote's attachments as a capacity analysis. | | |
| 21 | Engineer | Open the **Attachments** tab. Pick a **Kind**, add a **Note (optional)** and upload the CAD file and the PDF. | Both are listed with size, your name and time. **Timeline** → **Files** shows the uploads. | | |
| 22 | Engineer | Try to upload a file type that is not on the list under the drop zone (for example a `.zip` or `.exe`). | The upload is refused with a reason. | | |
| 23 | Engineer | Look for **Decide G2…** and for **Assign…** in the queue row menu. | Neither is there. Engineers do not decide G2 or assign. | | |
| 24 | Engineer | Open a quote assigned to someone else → **Engineering** tab. | It is read-only. You cannot change the solution. | | |
| 25 | Engineer | On `<CCQ-ENG-1>` click **Submit to engineering lead**. If something is missing, read the list. Fix it and click again. | A list of what is missing, if any. Then "Submitted to the engineering lead": "They have been notified. It is locked for you until they send it back." The tab is read-only for you. | | |

## Part C: Lead: review, capacity sign-off and every G2 outcome

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 26 | Lead | Open **Engineering queue** → **Ready for my review (n)**. | `<CCQ-ENG-1>` is listed: it was submitted to you (you were notified). | | |
| 27 | Lead | Open `<CCQ-ENG-1>` → **Engineering** tab. Click **Send back to engineer…** with no note. | A note is required. Type one and send. "Sent back to the engineer": they are notified with your note, the tab reopens for them and **Ready for my review** no longer lists it. | | |
| 28 | Engineer | Fix something and **Submit to engineering lead** again. | The lead is notified again. | | |
| 29 | Lead | Open `<CCQ-ENG-1>` → **Engineering** tab. | You can read the budgetary capital estimate and the capacity numbers. | | |
| 30 | Lead | Click **Decide G2…**. Choose **Advance**. | Under **Missing before it can move on:** "Capacity sign-off by the capacity owner". Close the dialog. | | |
| 31 | Lead | In **Capacity sign-off** click **Block capacity** with no note. | The button stays disabled until there is a **Sign-off note** ("Required to block capacity"). | | |
| 32 | Lead | Click **Approve capacity**. | "Capacity approved". | | |
| 33 | Lead | **Decide G2…** → **Advance** → **Record decision**. | "Advance recorded". Stage **Quoting**. Pricing and the KAM are notified. No note is needed for a plain Advance. | | |
| 34 | Lead, Engineer | Open `<CCQ-ENG-1>` → **Engineering** tab again. | A lock line: "Locked after G2 · decided by <lead> on <date> · reopens if the quote is sent back". The solution and capacity evidence are read-only for everyone, including you. Product facts stay visible. | | |
| 35 | Lead | On `<CCQ-ENG-2>` (solution, one capacity row, capacity approved): **Decide G2…** → **Advance with risk** with no note. Then add a note and record. | First refused: "Add a note." Then it moves to **Quoting**. | | |
| 36 | Lead | On `<CCQ-ENG-3>`: leave **Budgetary capital estimate (USD)** empty. **Decide G2…** → **Advance – capital required**. | Refused until the budgetary capital figure is saved, capacity is approved and a note is added. Fill them, then record. The quote moves to **Quoting** with capital readiness **Capital pending (budgetary)**. | | |
| 37 | Lead | On `<CCQ-ENG-4>`: **Decide G2…** → **Hold** with no note. Then set reason, **Review date (required)**, the hold owner and a note. | Refused until a note and a review date are given. Then the quote shows "On hold until <date> · owner <name>". It stays in Engineering Review. The KAM is told. | | |
| 38 | Lead | On `<CCQ-ENG-5>`: **Decide G2…** → **Redirect (alternative platform / site)** with a note. | The quote **stays** in Engineering Review. The decision and note are in the timeline. | | |
| 39 | Lead | On `<CCQ-ENG-6>`: **Decide G2…** → **Stop**, reason and note. | The quote closes as **Declined**. The KAM is notified. | | |
| 40 | Lead | Open the header button **Feasible solution?** on any quote in the queue. | It opens the same G2 dialog. Each outcome has an ⓘ definition. Cancel. | | |
| 41 | Engineer | Open `<CCQ-QT-1 staged by Ben>` → **Quoting** tab. | You can read the price approval and the pricing details. There is no button to change them. | | |
| 42 | Lead | When Pricing sends a quote back to Engineering (pricing.md step 24), open it. | You and the engineer are told ("back with you in Engineering"). The Engineering tab is reopened and the lock line is gone. | | |
| 43 | Lead | **Analytics** → **Engineering**. | The engineering view: who has what, waiting time, capacity blocks, G2 results. Each chart has an ⓘ. | | |
| 44 | Lead | Add a comment on a quote and @mention the KAM. Then another person comments. | The KAM and the assigned engineer are notified of each comment. Nobody is notified of their own. | | |

## Part D: Faron (capacity analyst)

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 45 | Faron | With a quote assigned to you, add a capacity row with your assumption in **Assumed effectiveness %**, **Utilization before %**, the allocated volume and a note. Save. | Saved. You are the **Analyst**. **Utilization after % (calculated)** shows. The hint reminds you to state your assumption. | | |
| 46 | Faron | Check the calculation by hand: cycle time, cavitation, effectiveness, run days and allocated volume against **Utilization after %**. Is OEE counted once? | The number matches your hand calculation, or you write the difference in Notes. (Open question D-021: OEE is applied once in QuoteFlow.) | | |
| 47 | Faron | Say whether the capacity fields are the right ones for each process (for example assembly has no cavitation). | Write the answer in Notes. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Engineering lead | | | |
| | Engineer | | | |
| | Capacity analyst | | | |
