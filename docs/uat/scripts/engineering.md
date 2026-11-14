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
| `<CCQ-ENG-OLD>` | A quote from before FB-13 whose Engineering Review is on a placeholder plant or machine type (Ben stages one; Part F step 61) |
| `<CCQ-ENG-OTHER>` | A quote whose KAM picked **Other** for **Resin**, **PCR** and **Additive** and typed the customer's values (resin and grade, PCR level, additive), with a Market and Sub-market chosen. Ben stages it and uses the longest entries the intake allows (resin and grade 120 characters, PCR level 120, additive note 200). Part G steps 62–66 |
| `<CCQ-ENG-GRADE>` | A quote with a listed resin (for example HDPE), **Customer-specified resin** ticked and a grade typed (Ben stages it). Part G step 63 |
| `<CCQ-ENG-RETIRED>` | A quote from before FB-09 and FB-12 on a retired resin (for example PCR-HDPE) and a retired market (for example Pharma/Health) (Ben stages it). Part G step 67 |
| A CAD file | A STEP or DWG file and a PDF you may upload |
| `<CCQ-QT-1 staged by Ben>` | A quote in Quoting (for the read-only check) |
| `<CCQ-QT-6>` | The quote Pricing sends back to Engineering in pricing.md step 24 (staged by Ben) |

Labels for stages, outcomes and reasons are provisional configuration. Note a wrong meaning, not a different wording.

## Part A: Lead: the queue

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 1 | Lead | Sign in. Check your email and the bell. | Home **Engineering queue** with **Queue health**, **Open load per engineer**, **Time to assign and to G2** and **Returned to the KAM: top reasons**. You were alerted when each staged quote arrived (bell, and an email "[QuoteFlow] CCQ-… needs your review"). | | |
| 2 | Lead | Click **Engineering queue** in the navigation. | The page lists every quote in Engineering Review, highest priority first. Aging buckets show, with "Buckets, not an SLA (D-20)." Two tabs: **All** and **Ready for my review (n)**. | | |
| 3 | Lead | Check the columns and the order. | Columns: **Quote**, **Priority**, **Opportunity / account**, **Product / resin / volume**, **Destination**, **KAM**, **In queue**, **Since assignment**, **Engineer**, **Drawing**, **Warnings**, **SF close** (and a menu column). Order: tier, then score, then age. A priority a sales leader changed shows a chip with the reason. | | |
| 4 | Lead | Open the filters. Filter by **Tier**, then **Engineer (pick one)** = Unassigned, then **Product family**. Clear them. | The list narrows and comes back. | | |
| 5 | Lead | On `<CCQ-ENG-1>` open the row menu (**…**) → **Assign…**. Pick an engineer. Click **Assign**. | Dialog **Assign engineer** lists each engineer with their open count. When a routing rule fits (resin, or process type once chosen), it also says **Suggested: <name>** with a **Use it** link; nothing is chosen for you. Then "They have been notified." The **Engineer** column shows the name. | | |
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
| 14 | Engineer | Read the product facts at the top of the tab. | A **From the intake** block shows what the KAM entered: **Resin** (with the customer-specified grade), **Market** (with the sub-market, FB-12), **Neck**, **PCR**, **Color**, **Additives** and **Variants requested**. A fact the KAM left blank is not listed. You do not retype them. The checks for an "Other" resin, PCR or additive and for Market are in Part G. | | |
| 15 | Engineer | In **Solution** fill **Process type**, **Machine type**, **Plant / site**, **Cavitation**, **Cycle time (s)**, **Budgetary capital estimate (USD)**, **Tooling notes (mold, hot runner)**, **Technical concept**, **Supply Chain**. Click **Save solution**. | "Engineering review saved". The capital label reads **Budgetary capital estimate (USD)** with "A budgetary figure for quoting." **EBM wheel** and the old placeholder machine types (EBM shuttle, IBM press, …) are not in the **Machine type** list: it shows Jim Zweifel's 14 types (FB-13, Part F). **Cavitation** accepts only whole numbers from 1 to 99. There is no **Downstream equipment** or **Equipment BOM** text box any more (FB-06). | | |
| 15a | Engineer | In **Equipment BOM** click **Upload the equipment BOM** and pick an .xlsx (the one-page CSR BOM). Then **Upload a new version**. | "Equipment BOM version 1 uploaded", then the file shows **v1 · current** with your name and the time. After the second upload it shows **v2 · current** and **Earlier versions (1)** lists v1. Before the first upload the card says it is needed for "Capital required". | | |
| 15b | Engineer | In **Two-step process and pack-out** tick **Two-step process**. Pick a **Preform plant** and a **Blow plant**, type a **Preform number** and a **Freight between the plants** note. Fill **Units per case** and **Units per pallet**. Click **Save**. Then untick the box and save. | "Saved". The four two-step details appear only while the box is ticked and are cleared when you untick it. Pack-out takes whole numbers only. | | |
| 15c | Engineer | If you have a quote with older **Downstream equipment** or **Equipment BOM** text, open its **Engineering** tab. | A read-only **Legacy notes** card shows the old text. You cannot edit it. | | |
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
| 36 | Lead | On `<CCQ-ENG-3>` (no equipment BOM uploaded yet): leave **Budgetary capital estimate (USD)** empty. **Decide G2…** → **Advance – capital required**. | Refused until the budgetary capital figure is saved, **the equipment BOM is uploaded** (FB-06), capacity is approved and a note is added. The missing list names the equipment BOM. Fill them (the engineer uploads the BOM as in step 15a), then record. The quote moves to **Quoting** with capital readiness **Capital pending (budgetary)**. | | |
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

## Part E: FB-06 checks (equipment BOM, suggestions, two-step, pack-out)

Added 2026-11-10 for FB-06 (F-058, F-062, F-024, F-025). Steps 5, 15, 15a–15c and 36 above already cover the main path; these are the edges. The engineer suggestions, the two-step and pack-out fields and the BOM rule are **provisional** (D-007, D-008, A-014, A-030): note a wrong meaning, not a different wording.

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 48 | Lead | On an unassigned quote whose resin is **PET**, open **…** → **Assign…**. Then do the same on one whose resin is **HDPE** (or PP or LDPE). | The PET quote shows **Suggested: Neiberger (PET)** with **Use it**; the HDPE one **Suggested: Pasillas (HDPE)**. Nothing is preselected until you click **Use it**. If that engineer has never signed in to QuoteFlow, there is no suggestion: that is expected. | | |
| 49 | Lead | Is the suggestion the engineer you would pick for this kind of quote (process type × request type)? | Write yes, or who it should be, in Notes. (Paul Slomkowski's Nov 4 pairs; D-008 is still open.) | | |
| 50 | Engineer | On a quote you own in Engineering Review, upload an equipment BOM (step 15a). Within 24 hours, open the **Attachments** tab and click **Remove** on the newest version, then confirm. | The removed version disappears. The previous version is **current** again (or the card is empty if it was the only one). The removal is in the **Timeline** → **Files**. | | |
| 51 | Engineer | On a quote another engineer owns, open the **Engineering** tab. | No **Upload the equipment BOM** button. You can open and download the current BOM. | | |
| 52 | Lead | On `<CCQ-ENG-3>` after its G2 in step 36, open the **Engineering** tab. Try **Upload a new version** of the BOM. | Not offered, or refused as locked: "Locked after G2". The BOM, two-step and pack-out details are read-only for everyone until a send-back reopens them. | | |
| 53 | Engineer | On `<CCQ-ENG-3>` before G2 (or any quote you own), in **Two-step process and pack-out** type letters or a decimal in **Units per pallet**. Then type a **Preform number** over 40 characters. | Pack-out takes whole numbers only. The preform number stops at 40 characters (the freight note at 300). | | |
| 54 | Engineer | On a quote that reached **Quoting** after you entered two-step and pack-out details, open the **Quoting** tab. | A **From engineering** card shows the equipment BOM (file, version, who uploaded it and when), the two-step details and the pack-out. Read-only. (Pricing checks the same in pricing.md step 33.) | | |

## Part F: FB-13 checks (plants and machine types)

Added 2026-11-10 for FB-13 (F-057). The plant and machine-type lists are Jim Zweifel's, sent on 2026-11-10 and approved: nothing here is provisional. **Jim or the lead checks the lists against the spreadsheet he sent; an odd-looking entry ("12B", "Etten.Leur") is as he sent it and is not a defect.**

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 55 | Engineer | On a quote you own, open **Solution** and open the **Plant / site** list. | 22 locations, in this order: Aurora, Bethlehem, Boxmore, Carrollton, Cleveland, OH, Cleveland, TN, Lerma, Ediplast, Lerma, Ediprint, Etten.Leur, Greensboro, Hazleton, Hillsborough, Leipsic, Manchester, Peru, Salt Lake City, St. Charles, St. Laurent, St. Louis, Toronto, Troy, Vancouver. No **Placeholder plant**. | | |
| 56 | Engineer | Open the **Machine type** list. | 14 types: EBM, IBM, ISBM, RHB, INJ - CAP, INJ - PREFORM, INJ - OTHER, DECO, PAD PRINTING, 12B, DIE CUTTING, LAMINATION, PRINTING, STAMPING. No **Provisional list** note under the label. | | |
| 57 | Lead | Compare each location's machine types with Jim's spreadsheet (for example St. Charles: 12B, INJ - CAP, ISBM, RHB, DECO). Write any difference in Notes. | The list matches the spreadsheet. (The machine types per plant are held with the plant but are not used to filter the lists yet; you may pick any pair.) | | |
| 58 | Engineer | Pick a **Plant / site** and a **Machine type**, fill the rest of the solution and **Save solution**. Reload the page. | "Engineering review saved". Both values are shown as you picked them. | | |
| 59 | Engineer | With **Two-step process** ticked (step 15b), open **Preform plant** and **Blow plant**. In **Capacity evidence**, open a row's **Site**. | The same 22 locations in all three lists. | | |
| 60 | Lead | Repeat step 48 (**…** → **Assign…** on a PET and an HDPE quote). | The suggestions are the same as before FB-13: Neiberger for PET, Pasillas for HDPE. The new machine types do not change who is suggested: it follows the **Process type** (ISBM, RHB and injection to the PET engineer; EBM and IBM to the polyolefin engineer) and the resin. (D-008 is still open.) | | |
| 61 | Lead | Open a quote from before today that was on a placeholder plant or machine type (Ben stages one as `<CCQ-ENG-OLD>`). | The old value shows as **Placeholder plant 01 (no longer offered)**; the quote still opens, and other edits save. The new list is offered for a change. | | |

## Part G: FB-09, FB-12 and FB-08 checks (the "Other" rule, Market, funding and MOQ)

Added 2026-11-10. **FB-09:** the KAM picks **Other** for **Resin**, **PCR** or **Additive** and must type the customer's own value. You read it in the product facts. **FB-12:** the KAM picks a **Market** and then a **Sub-market**. **FB-08:** the tooling funding model and the MOQ are Engineering's to enter on the quote. The resin, PCR and additive lists are Danielle Leu's (resin approved, PCR and additive still provisional). The market and sub-market lists are Melanie Rasche's (the sub-market list is still provisional). Note a wrong meaning, not a different wording.

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 62 | Engineer | Open `<CCQ-ENG-OTHER>` → **Engineering** tab. Read **Resin**, **PCR** and **Additives** in **From the intake**. | **Resin** shows the customer-specified resin and grade the KAM typed, not the word "Other". **PCR** shows the level the KAM typed (for example "35% PCR"), not "Other". **Additives** shows the additive the KAM typed. You do not retype or confirm them here. | | |
| 63 | Engineer | Open `<CCQ-ENG-GRADE>` → **Engineering** tab. Read **Resin**. | The listed resin and the grade together, for example "HDPE · <grade>". | | |
| 64 | Engineer | On `<CCQ-ENG-OTHER>` look at the longest entries (resin and grade, PCR level, additive). | They show in full. Write in Notes if any is cut off (the limits are 120, 120 and 200 characters). | | |
| 65 | Engineer | Could you start the review from what the KAM typed for the resin, PCR and additive? | Write yes, or what you would still have to ask the KAM, in Notes. | | |
| 66 | Engineer | On `<CCQ-ENG-OTHER>` read **Market** in **From the intake**. | **Market** sits after **Resin** and reads "<Market> › <Sub-market>" (for example "Food › Snacks & Confections"). On a quote with a market and no sub-market it shows the market alone. On a quote with neither, **Market** is not listed. You cannot edit it here. | | |
| 67 | Engineer | Open `<CCQ-ENG-RETIRED>` → **Engineering** tab. | **Resin** reads "PCR-HDPE (no longer offered)" and **Market** reads "Pharma/Health (no longer offered)" (or the retired values Ben staged). The quote still opens, and **Save solution** works. Nothing was changed on the quote. | | |
| 68 | Lead | Repeat step 48 on a quote whose resin is **PS** or **Other**, and on `<CCQ-ENG-RETIRED>`, each with no **Process type** saved yet. | No **Suggested:** line: the rules name PET (Neiberger) and HDPE, PP and LDPE (Pasillas), and no longer name the retired resins. Once a **Process type** is saved, the process rule can suggest an engineer. Nothing is preselected. | | |
| 68a | Engineer | FB-15: open a quote whose KAM picked **Other** for **Product family**, **Components** or **Decoration** (staged by Ben, or one from kam.md step 9d) → **Engineering** tab. Read **From the intake**. | **Product family (Other)**, **Other component** and **Decoration (Other)** show what the KAM typed. The **Overview** → **Intake** card shows the same. You do not retype them. | | |
| 69 | Engineer | On a quote you own (for example `<CCQ-ENG-3>`) open **Overview** → **Commercial terms** → **MOQ and tooling funding (Engineering)**. Pick a **Tooling funding model**, open the ⓘ **What do the funding options mean?**, type an **MOQ** and click **Save MOQ and funding**. | "MOQ and funding saved". The list offers Company-funded, Customer-funded, $0 CER (customer-reimbursed capital), Amortized, Shared (company and customer) and Not discussed (and **Not set**, which clears it). **MOQ** is a free-text box of up to 200 characters, not a number. The ⓘ explains the options that have help text. After a reload both values are still there. | | |
| 70 | Engineer | Open a quote another engineer owns → **Overview** → **Commercial terms**. | **Tooling funding model** and **MOQ** are shown as read-only values. There is no **Save MOQ and funding** button. | | |
| 71 | Lead | On any quote in Engineering Review open **Overview** → **Commercial terms**. Change the **Tooling funding model** and **MOQ**, then save. | The lead can edit them on any quote. "MOQ and funding saved". | | |
| 72 | Engineer | On the same panel look for **Payment terms**, **Tooling payment**, **Terms checked** and **Save terms**. | Payment terms and the terms check are for Sales and Pricing. They show as read-only values, and there is no **Save terms** button. | | |
| 73 | Engineer | On a quote the KAM answered "Does the customer fund any of the tooling?" at intake, compare that answer with the **Tooling funding model** in step 69. | It is the same field as the KAM's intake answer (**Not discussed** until someone sets it). What you save replaces it. Write in Notes if the list is missing an option you need (D-003 is open). | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Engineering lead | | | |
| | Engineer | | | |
| | Capacity analyst | | | |
