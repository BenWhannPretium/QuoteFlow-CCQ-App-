# UAT script: KAM

> Checked against the build on 2026-11-17 (pre-release audit): button names follow the app (**Qualify quote**, **Record customer decision**, **Commit and hand off**), a Salesforce pre-fill is editable, a blocked decision switches **Record decision** off, and Part L says who may generate the offer letter and that nothing is sent. Steps 10, 50, 52, 54, 55, 67, 77 and 87 are changed; steps 89a, 93a and 95a are new. Updated 2026-11-17 for the approved UX changes (docs/audit/03-ux-proposals.md).

| | |
|---|---|
| Session | **U1**, Mon Nov 9 (2 h). Run by Bailey Schmitt. |
| Tester role | Key account manager (app role `CCQ.KAM`) |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft** and use your Pretium account. Your account must be in **`SG-CCQ-KAM`** and in no other `SG-CCQ-*` group. |
| Devices | A laptop for Parts A–I. Your phone for Part J. |
| Before you start | Ben confirms the Salesforce sync ran today (Admin → Integrations). Ben stages the quotes in the Data list below. The sales leader tester is in the same session (Parts E and F need them), and a pricing lead tester for Part F. |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Pick a type and a severity (see `../README.md`). Write the step number in the description. |

**Retest for FB-09, FB-11 and FB-12 (added 2026-11-10).** Session U1 ran on Mon Nov 9, before FB-09 (the "Other" rule) and FB-12 (sub-market and the new market list) were built. Steps 9a–9c, 10a–10e, 13e, 17 and 18 are new or changed. A KAM retests them on the test site, and they stay here for the record. Steps 13a–13d and 17a (FB-11) were already in the Nov 9 script.

**Changed 2026-11-15 (FB-18, walkthrough of Nov 13).** Home is now the **Command Center** (the menu says **Command Center**, the phone tab **Command**). A quote on hold shows an orange **On hold** chip on the Command Center. The Salesforce opportunity ID on the **Intake** card is a link once an Admin has set the Salesforce URL. Steps 1, 2, 17, 30, 38, 42, 66 and 72 are changed, and step 70a is new.

**Changed 2026-11-16 (FB-19, walkthrough of Nov 13: W13-32 to W13-34).** A quote can now hold several **items** (products or variants quoted together). Step 3 is now **Request & items**: the request fields once, then an **Items** list, then the open item's own product fields. An opportunity that already has an active quote no longer blocks a new one: with the provisional setting **warn**, you confirm **Start a separate quote**. Steps 9 and 32 are changed, and **Part K** (steps 76 to 88) is new.

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<SF-OPP-1 chosen by Bailey>` | An open Salesforce opportunity you own, with a drawing PDF you can upload |
| `<SF-OPP-2 chosen by Bailey>` | An open Salesforce opportunity you own, no drawing, ship-to will change |
| `<SF-OPP-3 chosen by Bailey>` | An open Salesforce opportunity you own (used for a draft, then discarded) |
| `<SF-OPP-4 chosen by Bailey>` | An open Salesforce opportunity you own (phone intake) |
| `<CCQ-CD-1 staged by Ben>` | Your quote in **Customer Decision** (proposal issued) |
| `<CCQ-CD-2 staged by Ben>` | Your quote in **Customer Decision** (proposal issued) |
| `<CCQ-QT-1 staged by Ben>` | Your quote in **Quoting** with a price approval recorded |
| `<CCQ-RW-1 staged by Ben>` | Your quote in **Quoting**. The pricing lead returns it to you in Part F (pricing.md step 22) |
| `<CCQ-RW-2 staged by Ben>` | Same as RW-1 (the second return) |
| `<CCQ-FR-1 staged by Ben>` | Any quote in **Final Review** |
| `<CCQ-CD-4 staged by Ben>` | Any quote already released at Final Review (in **Customer Decision**) |

Stage, gate, outcome and reason-code labels are configuration and still provisional. If a label reads differently, note it. It is only a failure if the meaning is wrong.

## Part A: Sign in and the Command Center

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Open the test URL. Click **Sign in with Microsoft** and sign in. | The **Command Center** opens with the title **My quotes** ("Your intakes and quotes, and anything waiting on you."). The line above the title reads "Command Center · Key account manager". | | |
| 2 | Look at the left navigation. | You see **Command Center**, **New intake**, **My proposals** and **Pipeline**. You do **not** see To qualify, Approvals or Admin. The Command Center has no **My work** / **Analytics** switch at the top: analytics is not part of the KAM role. | | |
| 3 | Click your initials (top right). | The menu shows your name, email and the role chip **KAM**. | | |
| 4 | Read the home blocks. | You see **Returned to me**, **My drafts**, **My open quotes by stage**, **Proposals expiring soon** and **My outcome capture rate**. | | |

## Part B: Intake with a drawing

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 5 | Click **New intake**. | Page **New intake**. Step 1 of 4, **Opportunity**. A search box **Find the Salesforce opportunity**, with **Mine** selected. | | |
| 6 | Type part of the name of `<SF-OPP-1 chosen by Bailey>`. | Its card shows the name, account, **Amount**, **Close**, **SF stage** and **Owner**. They match Salesforce. | | |
| 7 | Click **Use this opportunity**. | Step 2, **Customer & destination**. The customer is the Salesforce Account on the opportunity, shown read-only. There is no new-customer form and nothing to type about the customer. One checkbox: **Not yet a Pretium customer (no ERP account)**, unticked for an existing customer. | | |
| 8 | Look at **Ship / fill destination**. Read the line under the stepper. | It shows the default address with the label from Salesforce. **City** and **State** are required. A **Change destination** button is there. FB-15: the line reads "\* Required to submit", and required fields have a red **\*** before their label. If Salesforce has no city or state for this address, a **City** or **State / region** box shows under it: fill it; no reason is asked for filling a blank. | | |
| 9 | Click **Next**. On step 3 (**Request & items**) read **Request**, **Items**, **Product** and **Packaging**. Fill **Request class**, **Product family**, **Container size**, **Market**, **Components** and **Packaging type**. | FB-19: **Items** shows one item ("1 item"); this quote stays a one-item quote, and the item fields below it are the product's. **Request class** lists **CCQ (new business + capital/engineering)** and three classes that stay in the pricing application (**Stock / stock-plus**, **Price inquiry / RFP check**, **Other capital**): only CCQ can be submitted (step 29). Each field has a one-line "why we ask" help. Nothing asks you to pick a plant, an engineer or a priority. | | |
| 9a | Open the **Market** list. | Eight markets: Food, Beverage, Nutrition & Wellness, OTC Health, Clinical, Personal Care, Home Care, Auto & Commercial Chemical. The five old ones (Nutrition/Supplements, Household Chemical, Pharma/Health, Industrial/Chemical, Pet) are not offered. | | |
| 9b | Look at **Sub-market** before you pick a market. Then pick **Food**. Then pick **Beverage**, then **Food** again. | Before a market: the list is disabled and reads "Choose a market first". With **Food**: **Choose…** and the seven Food sub-markets (for example Snacks & Confections, Oils, Spices, Seasonings & Extracts). With **Beverage**: only Non-Alcoholic and Spirits & Mixers. The help reads "Pick the closest sub-market. It sets the strategic-fit score. Beverage › Spirits & Mixers covers alcoholic drinks (Midas calls it Alcoholic)." **Market** and **Sub-market** have a red **\*** (FB-15). | | |
| 9c | Pick **Food** and the sub-market **Snacks & Confections**. Then change **Market** to **Beverage**. | The sub-market is cleared (**Choose…** again): a sub-market that does not belong to the new market is never kept. Pick **Food** and **Snacks & Confections** again for the rest of this intake. An amber note says "Sub-market cleared: it belongs to another market." FB-15 (Bailey Schmitt, D-006, provisional): **Sub-market** is required: an empty one is listed under **Needed before you can submit**. | | |
| 9d | FB-15: set **Product family** to **Other**. Tick **Other** under **Components**. Leave both new boxes empty and go to step 4. Then fill them (for example `Squeeze tube`, `Measuring cup`) and pick **Bottle** again. | **Describe the product family** and **Describe the other component** appear with a red **\***, up to 200 characters. Step 4 lists **Product family description is required** and **Other component description is required**, each with a **Fix** link that lands in the box. Picking **Bottle** (or unticking **Other**) hides the box and clears it. Leave them filled for this intake if you want to see them on the quote. | | |
| 10 | Fill **Resin** (a listed one: PET, HDPE, PP, LDPE or PS). Tick **Customer-specified resin**. Pick a **PCR %**. Pick **Neck diameter**, **Neck finish** and **Special feature** from the lists. Pick **Custom** in one of them. | **Customer-specified resin and grade** appears and is required. Each neck field is a pick-list. **Custom** opens a required short description (for example **Custom neck finish**). Pick a listed value again to remove it. If Salesforce already gave the resin, **Resin** is pre-filled and you can still change it: the note under it reads "Change it here if it is wrong. Salesforce is not updated." Once you change it, the note reads "Salesforce has <value>." with **Use the Salesforce value** to go back. | | |
| 10a | Set **Resin** to **Other** (untick **Customer-specified resin** first). Leave **Customer-specified resin and grade** empty and go to step 4. Then fill it (for example `Eastman Tritan TX1001`) and try to type 130 characters. | The box **Customer-specified resin and grade** appears and is required. **Needed before you can submit** lists **Customer-specified resin and grade**. It stops at 120 characters. Pick a listed resin: the box goes away and its text is cleared (unless **Customer-specified resin** is ticked). | | |
| 10b | Set **PCR %** to **Other**. Look at the list first. Leave the box empty and go to step 4, then type `35% PCR`. Then pick **30%**, then **Other** again. | The list reads 0% / Virgin, 25%, 30%, 50%, 100%, Other. **Customer-specified PCR level** appears and is required (listed under **Needed before you can submit** while empty, 120 characters at most). Picking **30%** hides it and clears it: it is empty when you pick **Other** again. | | |
| 10c | Set **Additive** to **Other**. Look at the list first. Leave the note empty and go to step 4, then type `UV inhibitor, grade and supplier`. Then pick **UV**. | The list reads None, UV, Barrier, Antistat, Impact Modifier, Other. For **Other** the note is called **Customer-specified additive**, is required (**Additives is required** under **Needed before you can submit**) and stops at 200 characters. For any other additive the note is **Additives** and optional, and it keeps your text. | | |
| 10d | With **Other** picked for resin, PCR and additive and their boxes filled, finish the intake, **Submit to CCQ** and open the quote → **Overview** → **Intake**. | **Resin** reads "Other". **Customer-specified resin**, **PCR %** and **Additives** show what you typed. Engineering and Pricing see the same (engineering.md steps 62–64). A draft saved with an empty box still saves: it only blocks the submit. | | |
| 10e | Is Danielle Leu's "Other" rule easy to follow? Is anything you quote often missing from the resin, PCR or additive list? | Write the answer in Notes. (The resin list is approved. The PCR and additive lists are provisional until Engineering and Supply Chain confirm.) | | |
| 11 | Set **Color** to a custom color. Pick an **Additive** and fill **Additives** (see step 10c). Tick **Decoration** under **Components**. Tick **Silk screen** and **Other** under **Decoration types**. | The custom color asks for a description. **Decoration types** (checkboxes, FB-24: several at once) and **Number of print colors** appear and are required. FB-15: **Other** decoration opens **Describe the decoration** (required). The **Additive** list also has **Fluorination** (provisional). | | |
| 11a | FB-15: with **Resin** HDPE or PP, open **Color**. Then change **Resin** to PET. | **Stock white** and **Stock black** are offered for HDPE and PP (help: "A stock color is the colorant Pretium uses for its stock items at that plant."). With PET they are not offered; if one was picked, it is cleared with a note "Color cleared: … is not offered for PET." | | |
| 12 | Look at the labels of **Height (mm)**, **Width or diameter (mm)**, **Depth (mm)**, **Gram weight (g)** and the neck fields before step 14 (no drawing yet). Fill **Height (mm)**, **Width or diameter (mm)**, **Depth (mm)** and **Gram weight (g)**. Fill **Estimated annual volume (units)** and **Estimated annual revenue (USD)**. | The numbers are accepted. A volume that looks like a placeholder (for example 1,000,000) asks you to confirm it is the real annual volume. FB-15: while no drawing is attached they carry the red **\*** (they are the minimum spec); once a drawing is attached the asterisks go away. | | |
| 13 | Look at the dates. Fill **Quote needed by** and **Product needed by (best estimate of launch need)**. Optionally fill **Quote variants requested**. | **Salesforce close date (updates with Salesforce)** is shown read-only: you cannot type it. The two needed-by dates are yours and required. The variants note stops at its character limit. | | |
| 13a | Still on step 3, find **Commercial inputs for Pricing** and the **Customer bid / RFP reference (if the customer gave one)** under **Request**. Pick **Payment terms the customer requests**: first **Net 30**, then **Net 60**. | **Net 30** shows no flag. **Net 60** shows **Non-standard: Pricing will review**. **Other** asks for a short description. | | |
| 13b | Look at **Does the customer fund any of the tooling?** | It starts at **Not discussed**. The (i) **What do the funding options mean?** explains each option. Pick **Customer-funded**: a hint says that if the customer owns the tool it is not Pretium capital and sales tax and contract terms apply. There is no amount and no payment method here. FB-15: pick **Shared (company and customer)**: an optional **Customer share %** appears ("Pretium covers the rest"); type `40`. A value over 100 is refused. Pick another option: the share is cleared. | | |
| 13c | Under **Packaging** tick **Customer wants returnable (multi-trip) dunnage**. Under **Delivered or FOB** pick **Delivered**. | The help says multi-trip comes back and single-trip is charged to the customer. **Freight type** (Flatbed, Van, Drop trailer, T-bar, Other) and **Special freight arrangements** appear. The arrangements hint names drop trailers and T-bars as costly. | | |
| 13d | Pick **T-bar** and type a note. Switch **Delivered or FOB** to **FOB Pretium plant**, then back to **Delivered**. Pick freight type **Other** and leave **Special freight arrangements** empty. Type a **Customer bid / RFP reference** (for example `RFP-2026-114`). | Switching to FOB hides the freight fields and clears them: back on **Delivered** they are empty. FB-15: freight **Other** makes **Special freight arrangements** required (red **\***). The reference stops at 60 characters; its help says most customers don't send one. | | |
| 13e | Under **Packaging** set **Packaging type** to **Other**. Leave the note empty and go to step 4. Then type a note and keep typing past 500 characters. | The note becomes **Customer-specified packaging (describe)** and is required. A hint says "Other is for packaging the customer dictates. Attach the customer's packaging document under "Drawing and other files" on the next step." It stops at 500 characters. A packaging note saved before FB-09 that is longer than 500 stays readable and shows an amber line "This note is N characters; new edits are limited to 500." | | |
| 14 | Click **Next**. On step 4, set **Drawing status** to the "have a drawing" option. Drag the drawing PDF onto **Drawing and other files** (or click **choose files**). Optionally add the **Customer RFP / portal link**. | The file uploads and is listed with its size and your name. The **Drawing or minimum spec** box says a drawing is attached. | | |
| 15 | Type a note in **Comments for engineering**. Read the **Review** section. | **Needed before you can submit** is not shown. Each step summary has an **Edit** link. | | |
| 16 | Click **Submit to CCQ**. | "Quote **CCQ-2026-NNNNN** created". It says it is waiting for qualification by a sales leader. Write the number in Notes. | | |
| 17 | Click **Open the quote**. | The quote page shows the number, the stage **Intake**, the priority with its label (for example "Priority 62 HIGH"), the **Overview** (with the product facts you entered: **Market** as "Market › Sub-market", resin grade, PCR %, color, additives, dimensions), **Engineering**, **Quoting** and **Attachments** tabs, **Why this priority?** and a **Timeline**. Under the stage tracker a line says whose move it is: "Waiting on: the sales leader. Next: qualify quote." The header link to the opportunity reads **Salesforce opportunity ↗** (or "Salesforce opportunity" and the plain ID if Admin has not set the Salesforce URL yet). FB-18: the **SF opportunity ID** on the **Intake** card is the same link, and it opens the Salesforce app on a phone that has it. | | |
| 17a | On the **Overview** tab read the **Intake** card, and open **Commercial terms**. | The card shows **Bid / program reference**, **Payment terms requested** (with the non-standard flag when it applies), **Customer funds any tooling**, **Dunnage** and **Delivered or FOB**. **Commercial terms** starts with **Customer requested:** and the same flag. | | |
| 18 | Open **Why this priority?** | It lists the attributes and points. The strategic-fit line shows **Market: <Market › Sub-market>** (for example "Market: Food › Snacks & Confections") with a **provisional** chip (the points are not set until the business decides). The live model still scores strategic fit at a neutral 50: the sub-market points are only in the draft (priority-calibration.md). | | |
| 19 | Open the **Attachments** tab. | The drawing is there. | | |

## Part C: Intake without a drawing, a mold change and a destination change

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 20 | **New intake** → find `<SF-OPP-2 chosen by Bailey>` → **Use this opportunity**. | Step 2 opens, pre-filled. | | |
| 21 | Click **Change destination**. Change the street and city. | "From Salesforce:" shows the default. A required field **Reason for changing the destination** appears. | | |
| 22 | Leave the reason empty. Go to step 4. | **Needed before you can submit** lists "Say why the ship-to differs from the customer default". **Submit to CCQ** is disabled. | | |
| 23 | Go back to step 2 and type a reason. On step 3 fill everything **except Gram weight (g)**. Tick **Modify an existing mold**. | **Existing mold / part number** and **What changes** appear. Fill both. | | |
| 24 | On step 4 set **Drawing status** to **None (quote will take longer)**. Do not upload a file. | The **Drawing or minimum spec** box says what is missing, for example "Missing: gram weight." **Submit to CCQ** is disabled. | | |
| 25 | Click **Fix** in that box. Fill **Gram weight (g)**. Click **Next** back to step 4. | **Fix** jumped to the field on step 3. The box now says **Minimum spec complete (no drawing)**. **Submit to CCQ** is enabled. **Engineering may ask about this** may list open items, with "You can still submit." | | |
| 26 | Click **Submit to CCQ**. | The quote is created. | | |
| 27 | Open the quote. Look at **Ship / fill destination** on the **Intake** card. In **Timeline**, click **Overrides**. | The new address shows. The timeline has the ship-to override with your reason. The mold change is in the product facts. | | |

## Part D: Drafts and blocked submits (negative checks)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 28 | **New intake** → `<SF-OPP-3 chosen by Bailey>`. On step 3 leave **Resin** empty. Go to step 4. | **Resin** is listed under **Needed before you can submit**. **Submit to CCQ** is disabled. | | |
| 29 | Go back to step 3. Set **Request class** to **Stock / stock-plus**. Go to step 4. | A message says stock requests stay in the pricing application. **Submit to CCQ** is disabled. Set the class back. | | |
| 30 | Click **Command Center**, then **New intake** again. | **Continue a draft** lists the draft with its step and save time, in US Central with the zone named (for example "Step 3 · saved Nov 17, 2026, 12:09 PM CST"). | | |
| 31 | Click **Continue**, then **Discard**. Confirm **Discard draft**. | "Draft discarded". Salesforce is not changed. | | |
| 32 | **New intake** → search `<SF-OPP-1 chosen by Bailey>` again. | The card shows **Has quote CCQ-…** and **Open existing**. There is no **Use this opportunity** button. FB-19: with the provisional setting **warn** it also offers **Start a separate quote** (Part K, step 84); with **one**, it does not. | | |
| 33 | Search for a name that does not exist in Salesforce. | **Create the opportunity in Salesforce first**. | | |

## Part E: Priority and rework after a return at G1

Do steps 37–40 after the sales leader returns your Part C quote at G1 (sales-leader.md step 9).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 34 | Open your Part B quote. Look at the priority. | There is **no** override button. A hint reads "Need a different priority? Escalate to your sales leader." Only a sales leader changes the tier. | | |
| 35 | Ask the sales leader tester to override the tier on this quote (sales-leader.md Part D). Reload. | The priority shows the new tier with a marker. The original tier and the justification show under **Why this priority?** | | |
| 36 | Open **Timeline** → **Overrides**. | The override is listed with who applied it and why. You cannot revert it. | | |
| 37 | After the return, click the bell (top right). Click the notification. | A notification says your quote was returned to you for rework, with the reason and the note in the notification. FB-15: clicking it opens the rework draft, not the top of the quote: "Rework of CCQ-…. Sent back by <name>: <reason>." and the note are pinned at the top. If something blocks the submit, you land on step 4 with the first **Fix** link selected; otherwise on the field the note names (or step 1). The email's link does the same. | | |
| 38 | Go to the **Command Center**. | **Returned to me** lists the quote, with the reason and the gate by its name, not its number (for example "Missing information · returned at Qualify & prioritize"). | | |
| 39 | Open the quote. | A banner: "Returned by <name> at <gate label>" (for example "Returned by Sam Leader at Qualify & prioritize"), then "Reason: <reason>", "What to fix: <note>" and the time. The line under the stage tracker reads "Waiting on you. Next: fix the intake and resubmit." with a **Fix and resubmit** button (the button is on that line, not in the banner). | | |
| 40 | Click **Fix and resubmit**. Fix the item. Click **Submit to CCQ**. Then click **Open the quote**. | The wizard shows "Rework of CCQ-…". The opportunity cannot be changed. After submit: "Quote CCQ-… **resubmitted**" with the **same** number. FB-15: the quote no longer shows the **Returned by …** banner (no stale warning), and the line under the stage tracker reads "Waiting on: the sales leader. Next: qualify quote." again. | | |

## Part F: Pricing sends a quote back to you (G3)

Do this after the pricing lead returns `<CCQ-RW-1>` and `<CCQ-RW-2>` to you (pricing.md step 22).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 41 | Click the bell. Open the notification for `<CCQ-RW-1>`. | It says the quote was returned to you for rework and that Quoting sent it back. The reason and the pricing lead's note are in the notification. The email names the reason only and carries no note. | | |
| 42 | Go to the **Command Center**. | **Returned to me** lists `<CCQ-RW-1>` with the reason and note from Pricing. | | |
| 43 | Open `<CCQ-RW-1>`. Click **Fix and resubmit**. | The notice says that if the scope did not change, the quote goes straight back to Pricing. Nothing else in the quote asks to be redone. | | |
| 44 | Go to step 4. Try **Submit to CCQ** before answering **Did the scope change? (required)**. | **Submit to CCQ** is disabled until you answer. | | |
| 45 | Choose **No, same scope**. Click **Submit to CCQ**. | "Quote … **resubmitted**" and "It is now in Quoting." The stage is **Quoting**, not Intake. The same pricer and pricing lead are still assigned. They are told it is back from you. | | |
| 46 | Open `<CCQ-RW-2>` → **Fix and resubmit** → step 4. Choose **Yes, the scope changed**. Click **Submit to CCQ**. | The quote is resubmitted as a new submission: it waits for a sales leader at G1 and then goes through Engineering again. | | |

## Part G: Customer outcome and Commit & Hand Off

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 47 | Click **My proposals**. | **My open proposals**, soonest to lapse first, with counts (open, expiring soon, past validity, on hold). | | |
| 48 | Open `<CCQ-CD-1 staged by Ben>`. Read the **Customer decision** panel. | It shows **Proposal issued**, **Valid until** and **Salesforce stage**. The header links to the opportunity (**Salesforce opportunity ↗**). | | |
| 49 | Back on **My proposals**, click **Record outcome** for `<CCQ-CD-1>`. Choose **Awarded**. Set **Acceptance evidence** to **Purchase order (PO)**. Set **Customer accepted on** to tomorrow. Click **Record decision**. | Refused: "The acceptance date can’t be in the future." | | |
| 50 | Set **Customer accepted on** to today. Add a **Document link (optional)**. Click **Record decision**. Then open the quote. | "Awarded recorded", and the same message says the quote is now in **Commit & Hand Off** and "Update the Salesforce opportunity to match: <stage name>." On the quote: the stage is **Commit & Hand Off**, the quote is **not** closed, the **Commit & hand off** card is there, and a reminder reads "Update the Salesforce opportunity to match: <stage name>." with the link. (Recorded from the quote page with **Record customer decision** instead, the card opens by itself.) FB-15: if the customer was flagged **Not yet a Pretium customer** at intake, the card (here and on the closed-won quote) says "This customer has no ERP account yet. Request master-data setup (help-desk ticket) as part of commercial activation." | | |
| 51 | Click the link in the reminder. Then dismiss the reminder. | The opportunity opens in a new tab (or the plain ID is shown if the URL is not set). The reminder goes away. Nothing was written to Salesforce: QuoteFlow only reminds you. | | |
| 52 | Click the header button **Commit and hand off**. Choose **Advance (close Won)**. | Under **Missing before it can move on:** the dialog lists "The CER approved, or marked not required" and "The receiving team accepted the hand-off". **Record decision** is switched off, and a line says the choice can't be recorded yet: first complete what is listed. Close the dialog. | | |
| 53 | In the **Commit & hand off** card fill **CER status**, **CER ID (Apex)**, **CER approved on**, **Receiving role**, **Receiving contact** and **Accepted-by date**. Tick **Ready for CER development**. Tick **Hand-off accepted by the receiving team**. Click **Save hand-off**. | "Hand-off accepted". The card shows **CER: Approved** (or Not required), **Ready for CER development** and **Hand-off accepted**. | | |
| 54 | Click **Commit and hand off** → **Advance (close Won)**. The **Reason (required)** is already filled with the acceptance evidence recorded at **Awarded** (for example **Purchase order (PO)**); change it if needed → **Record decision**. | The reason is pre-filled from Awarded. If you clear it: "Choose a reason." The stage is **Closed – Won**. A closure card shows the outcome, reason, **Closure owner** (you) and date. | | |
| 55 | On **My proposals** click **Record outcome** for `<CCQ-CD-2 staged by Ben>` (on the quote page the same button reads **Record customer decision**) → **Lost**. Click **Record decision** with no reason. | "Choose a reason." | | |
| 56 | Pick **Other (note required)** and leave the note empty. Click **Record decision**. | Refused: a note is required. | | |
| 57 | Pick **Price**. Type a **Competitor (optional)**. Click **Record decision**. | The quote closes as lost. The closure card shows **Reason** Price, the competitor and **Closure owner** you. The Salesforce reminder names the closed-lost stage. | | |

## Part H: What you can see, and what is locked

You can read pricing, margin and capital figures on any quote you can open. You cannot change them. After a gate is decided its section is locked for everyone until a send-back reopens it.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 58 | Open `<CCQ-QT-1 staged by Ben>` → **Quoting** tab. | You read the price approval record: "Price approved ✓ on <date> by <name>", the pricing basis and range, references and the capital readiness. There is no **Save price approval** or **Save capital readiness** button for you. | | |
| 59 | Open its **Engineering** tab. | You read the **Budgetary capital estimate (USD)** and the capacity evidence (utilization before and after, assumed effectiveness, cycle time). Nothing is editable. | | |
| 60 | Open `<CCQ-FR-1 staged by Ben>` → **Quoting** tab. | A lock line reads "Locked after the Quoting decision · decided by <name> on <date and time> · reopens if the quote is sent back" (the time is US Central, for example "Nov 17, 2026, 12:18 PM CST"). The Engineering tab shows the same, naming the Engineering & Capacity decision. | | |
| 61 | Open `<CCQ-CD-4 staged by Ben>` and find **Commercial terms**. | Terms and the capital flag are read-only: "Locked after the Final Review decision · decided by <name> on <date and time> …". You cannot edit them. | | |
| 62 | **Pipeline** → **Columns**. | The **Budgetary capital estimate** and **Capital readiness** columns are offered (they are the same for every role). | | |
| 63 | Choose both columns. Click **Export CSV**. Open the file. | The file has the columns you chose. | | |
| 64 | Open the emails QuoteFlow sent you about quotes. | No price, margin or capital amount in any email. | | |
| 65 | Type `/quotes/<CCQ-FR-1 staged by Ben>/review` after the test URL. | The Final Review page opens **read-only** (no decision buttons: every role that can read a quote can read it). Trying to decide G4 through the API is refused with a 403. | | |
| 66 | Type `/approvals` after the test URL. Then `/analytics`. Then `/admin`. | "You don’t have access to this" each time. FB-18: `/analytics` now forwards to the Command Center's Analytics view (the address becomes `/?view=analytics`), which a KAM still cannot open. | | |
| 67 | Open any quote in **Intake** that is yours. | There is no **Qualify quote** button. A KAM cannot qualify. | | |

## Part I: Notifications and comments

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 68 | Ask an engineer or a pricer tester to add a comment on one of your quotes. Click the bell. | A notice says there is a new comment, with a link. The email, if you get one, never contains the comment text. | | |
| 69 | Ask them to add two more comments within a few minutes. Check your email. | The comments arrive as **one** email ("3 new comments"), not three. | | |
| 70 | Watch your bell while the engineering and pricing testers move one of your quotes on (engineering.md Part C, pricing.md Part D). | You are told each time a quote of yours moves on, is sent back, goes on hold or closes. You are told once per event, even if you hold two roles. FB-17: the on-hold notice names the hold owner, the reason and the review date, and the line under the quote's stage tracker and the **Timeline** read "On hold: <reason>. Owner: <name>. Review by <date>." On the quote the line goes on: "A decision by <role> ends the hold." | | |
| 70a | FB-18. When one of your quotes has been put on hold (sales-leader.md step 11, or engineering.md step 37 or 97), go to the **Command Center** and find it under **My open quotes by stage**. Rest the mouse on the orange **On hold** chip. Then press Tab until the chip has the focus. On a phone, tap it. | The quote is listed first in its stage, with an orange **On hold** chip. Each way opens the same sentence as the line under the quote's stage tracker and the **Timeline**: "On hold: <reason>. Owner: <name>. Review by <date>." Once a decision ends the hold, the chip is gone. | | |
| 71 | Open your user menu → **Email preferences** (`/me/preferences`). Switch off the email for **Your quote moves or a decision is recorded**. | It saves. The in-app notices stay. | | |

## Part J: Intake on a phone

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 72 | On your phone, open the test URL and sign in. | A bottom tab bar: **Command**, **Intake**, **Proposals**, **Pipeline**. | | |
| 73 | Tap **Intake** → find `<SF-OPP-4 chosen by Bailey>` → **Use this opportunity**. | The stepper reads "Step 2 of 4 · Customer & destination". No sideways scrolling. | | |
| 74 | Fill steps 2 and 3 (including the needed-by dates and the dimensions). On step 4 pick **Sample photo / render** as the **File type**, tap **Add file** and take a photo of a sample. | The phone offers the camera or a file. The photo uploads as **Sample photo / render**. | | |
| 75 | Tap **Submit to CCQ**. | The quote is created. Note how long the whole intake took. | | |

## Part K: FB-19 checks (several items in one quote, and a second quote on an opportunity)

Data: `<SF-OPP-5 chosen by Bailey>`, an open opportunity you own whose Salesforce record lists **two or more products**, and a drawing PDF for one of them. The quote is sent back to you in step 86, so a sales leader tester (or Ben) is needed for that step.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 76 | **New intake** → `<SF-OPP-5 chosen by Bailey>` → **Use this opportunity**. Fill step 2 and click **Next**. | Step 3 reads **Request & items**. At the top: **Request** and **Commercial inputs for Pricing** (once for the whole quote). Below: the item's own sections under a highlighted **Item 1** heading (**Item**, **Product**, **Packaging**, **Volume and need-by**, **Description**), then the **Items** box ("1 item") after them (FB-24). Item 1 holds the first Salesforce product's details. | | |
| 77 | Under **Items** click **Add from Salesforce products (n)**. | An item is added for each Salesforce product not used yet, and the first new one opens (**Add another item** adds one empty item instead; the new item opens above the box with its name field focused). With two Salesforce products the count reads "2 items". Each row shows the product family, size, volume and need-by date it has, and "Complete" or "n to do". | | |
| 78 | Give each item a name in **Item name (optional, e.g. 16 oz bottle)**, for example "16 oz bottle" and "24 oz bottle". Fill each item's product fields, its **Estimated annual volume (units)** and **Product needed by**. | Clicking a row opens that item: its fields are its own. The request fields (market, payment terms, quote needed by …) are not repeated per item. | | |
| 79 | With item 2 open, click **Duplicate this item** in the **Items** box. Rename the copy "24 oz bottle 25% PCR" and change only **PCR %**. | Item 3 is a copy of item 2 with every product field filled, and it opens above the box with "Item 3 of 3" at the top. Changing it does not change item 2. | | |
| 80 | Move item 3 up with the arrow, then back down. Click **Remove** on item 3, then **Cancel**. | The order changes and the names follow ("Item 2", "Item 3"). Removing asks "Remove Item 3 (24 oz bottle 25% PCR)?" first; **Cancel** keeps it. | | |
| 81 | Clear **Gram weight (g)** on item 2. Go to step 4. | **Needed before you can submit** names the item: "Item 2 (24 oz bottle): …". Its **Fix** link opens item 2 at that field. Fill it again. | | |
| 82 | On step 4 use **Drawings for** to pick item 1 and drag the drawing onto **Drawing and other files**. Then pick item 2. | The drawing belongs to item 1. Item 2 (no drawing) still needs its minimum spec, which you filled. The file list says which item each drawing is for. | | |
| 83 | Click **Submit to CCQ**. Open the quote. | One quote number for all three items. The **Intake** card lists the three items with their volumes. Lists and the board show "16 oz bottle + 2 more". The priority **Why?** says "3 items, … units a year in total". | | |
| 84 | **New intake** → search `<SF-OPP-5 chosen by Bailey>` again. | The card shows **Has quote CCQ-…**, **Open existing** and **Start a separate quote** (the provisional setting is **warn**; with **one**, only **Open existing**). | | |
| 85 | Click **Start a separate quote**, fill the steps and go to step 4. | A warning names the open quote and its KAM ("… is already open for this opportunity (KAM: …). Add these items to it instead if it is still with you, or continue to start a separate quote."). Submit is refused until you tick **Start a separate quote for these items**. Then discard this draft (we don't need a second quote). | | |
| 86 | A sales leader (or Ben) sends the quote from step 83 back to you. Open it with **Fix and resubmit**. Remove item 3. | Removing asks first and says that any engineering work done on it is discarded when you resubmit (the audit keeps it). Confirm, then resubmit. | | |
| 87 | Open the quote. | Two items. The **Timeline** has an entry that names the item, "Item 3 (24 oz bottle 25% PCR) removed", with your name and the time. If engineering work had been done on the item, the entry adds "Its engineering work was discarded." | | |
| 88 | Does the split between **Request** and the item fields fit how you quote? Is anything asked per item that is the same for the whole quote, or the other way round? Is 20 items per quote enough? Should a second quote on an opportunity be allowed (warn) or refused (one)? | Write the answers in Notes. | | |

## Part L: FB-20 checks (the customer offer letter)

Data: `<CCQ-OL-1 staged by Ben>`, a quote of yours with two or more items that Final Review has approved (it is in **Customer Decision**), priced from a costing workbook whose price cells are mapped (Ben stages a synthetic map and workbook on test until Pricing's new costing template arrives); and `<CCQ-RW-1 staged by Ben>` (still in Quoting).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 89 | Open the quote that is still in Quoting and look for **Offer letter** on the **Overview** tab. | There is no **Offer letter** card yet. It appears once Final Review approves the quote. | | |
| 89a | If the **Offer letter** card on an approved quote reads **The offer letter cannot be generated yet:**, read the list. | It says why in words (for example "No costing workbook is on file. Pricing uploads it on the Quoting tab.") and, where the fix is on a tab, gives a link (**Open the Quoting tab →**). There is no form until the list is empty. | | |
| 90 | Go to **My proposals**. On the approved quote's card click **Offer letter**. | The quote opens at the **Offer letter** card. An orange banner says the wording is a draft ("DRAFT: wording not yet approved by Legal"). | | |
| 91 | Look at the table of what will print. | One row per item with its plant, volume, **Piece price per 1,000 pcs** and, where the workbook has them, **Molds** and **Change parts**. The line under it names the costing file and version ("Read from … v…"). None of the prices can be edited. | | |
| 92 | Leave **Attention** empty and fill a **Part #** for only one item. | Warnings appear: the draft wording, no Attention, no Part # for the other items. **Generate Word document** stays off until you tick each one. | | |
| 93 | Type an **Attention** name and the Part #s, tick the remaining warning, click **Generate Word document**. | A Word file named "CCQ-… Offer Letter 1.docx" downloads. The card lists **Letter 1** with today's date and your name. The **Timeline** says "Offer letter 1 generated". | | |
| 93a | After generating, check your email and the bell. | No email and no notice about the letter: nothing is sent from QuoteFlow, to the customer or to anyone else. You send the Word file yourself. The letter stays under **Letters generated** with a **Download** button. | | |
| 94 | Open the file in Word. | The new Pretium logo top left, DRAFT top right, the customer and Attention, the quote number, date and valid-until date, one pricing row per item, the specifications and the pricing assumptions with your payment terms. Your name signs it. The text can be edited. | | |
| 95 | Generate a second letter, then (with a sales leader) re-quote the quote from **My proposals**. | **Letter 2** is listed above letter 1. After the re-quote both are marked **Superseded** and still download. | | |
| 95a | Ask a sales leader or a pricer tester to open the approved quote and scroll to **Offer letter**. Then ask an engineer or an approver tester to do the same. | The sales leader and the pricer get the same form and can generate (so can the pricing lead and an Admin). The engineer and the approver can read and **Download** the letters, and see "The quote's KAM, a sales leader or Pricing generates the offer letter." instead of the form. | | |
| 96 | Is the wording right for your customers? Is anything missing (a contact, a lead time, the customer's part number at intake)? Would you send Word or need a PDF? | Note your answers for Bailey. | | |

## UX changes (2026-11-17)

Added 2026-11-17 for the approved UX changes (`docs/audit/03-ux-proposals.md`). Steps 17, 30, 38 to 40, 48, 60, 61, 70, 70a, 87 and 89 above were changed for the same reason. The gate and reason names in the examples are configuration.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 97 | Sign in on a browser where you have not opened QuoteFlow before (or in a private window). Read the card at the top of the **Command Center**. Click its link, then **Got it**. Reload the page. | A card **Welcome to QuoteFlow**: "Your main jobs here, and where each one is done." It lists three jobs, each with where it is done: "Start a quote from your Salesforce opportunity: **New intake**.", "Fix and resubmit a quote that was sent back: **Returned to me, on this page**." and "Record the customer’s answer: **My proposals**." The link "Read the one-page quick-start for Key account manager" opens the quick-start in a new tab. **Got it** puts the card away for good (for you, in this browser): the line "New here? Read the one-page quick-start for Key account manager" takes its place, and the card does not come back after a reload. | | |
| 98 | On the **Command Center** read **My open quotes by stage** and **My outcome capture rate**. | Each quote in a stage list shows the customer after the quote number, and the opportunity name on a wide screen. A stage total reads "<amount> Salesforce opportunity amount" (for example "$459.1K Salesforce opportunity amount"). The line under the capture rate reads like "13 recorded, 5 past validity with no outcome recorded, 0 still waiting." | | |
| 99 | Open one of your quotes in **Engineering & Capacity** or **Quoting**, one in **Customer Decision** and one that is closed. Read the line under the stage tracker on each. | The line says whose move it is. In Engineering: "Waiting on: the engineering lead. Next: assign an engineer.", then, once an engineer has it, "Waiting on: Engineering (<name>). Next: complete the solution and capacity, then submit to the engineering lead." In Quoting it names Pricing, the pricing lead or Finance the same way. In Customer Decision: "Waiting on: the customer. Next: record customer decision." Closed: "Closed. No next step." The line has a button only when the move is yours and is made in the intake or on a tab. | | |
| 100 | While a quote is returned to you and not yet resubmitted (for example between steps 39 and 40), click **New intake**. | **Returned for rework** lists the quote with "Returned at <gate label>: <reason> · <note>" (for example "Returned at Qualify & prioritize: Missing information · …") and a **Fix and resubmit** button (it reads **Continue fixing** once you have opened the rework draft). The gate is named, not numbered. | | |
| 101 | Open the Part C quote after you resubmitted it (step 40). Read **Time in stage**, the **Gate decisions** card and the times on the page. | Under **Time in stage**, the **Intake** entry ends "· entered this stage twice" (it was "2 visits"). The send-back in **Gate decisions** shows "Reason: Missing information" (the reason's label, not a code in brackets). Every time on the page is US Central in one format, for example "Nov 17, 2026, 12:18 PM CST". | | |
| 102 | In a draft, on step 3, type `9999999999999999` (16 digits) in **Estimated annual revenue (USD)** and wait a few seconds. Then type a real figure. | The save status reads "Not saved. Estimated annual revenue: enter 999,999,999,999.99 or less." The field is marked and shows the same message under it. With a real figure the message goes away and the draft saves. | | |
| 103 | Type `/quotes/CCQ-2026-99999` (a number that does not exist) after the test URL. | "We could not find CCQ-2026-99999, or it is outside what your role can see." and "Check the number, or search from the Pipeline.", with a **Go to the Pipeline** button and, in small print, "Reference for support: <id>". The page does not say whether the quote exists. | | |

## Part M: FB-24 checks (concept requests, item fields first, files, red and yellow)

Data: `<SF-OPP-6 chosen by Bailey>`, an open opportunity you own; a PNG or JPG "render" of a product (any synthetic picture).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 104 | **New intake** → `<SF-OPP-6 chosen by Bailey>` → **Use this opportunity**. Read step 2. | The ship-to says where it came from: "From the opportunity's product in Salesforce." or "From the account in Salesforce.". If the opportunity has a **Ship to Locations** note, it is shown above as "Ship-to noted on the opportunity: …" (it is not copied into the address). | | |
| 105 | On step 3 open **Request class**. | The list is A to Z and includes **Concept / innovation**. Every other dropdown is A to Z too, with **Other** last (payment terms read Net 15, Net 30 … Net 120, Other). **Drawing status** keeps its own order. | | |
| 106 | Pick **Concept / innovation**. | A **Concept** badge appears, a note says the minimum spec is optional, and **Assumptions for this concept** (required, up to 1,000 characters, with a counter) opens. The dimensions lose their red **\***. | | |
| 107 | Leave the dimensions empty. Go to step 4 without a file. | A red box (light red, red border, icon): "Add the customer's render or photo, or a drawing". Above the steps, a key says "Red: fix before you can go on." (and "Yellow: worth checking; you can still go on." when an amber note is on screen). | | |
| 108 | Pick **File type** **Sample photo / render**, click **Add file** (paperclip) and choose the render. Fill the assumptions on step 3. | The red box turns into "Render or photo attached". The file types offered are only Bottle drawing, Sample photo / render, Bid file, Project brief, Competitor / incumbent drawing and Other. | | |
| 109 | Under **Commercial inputs for Pricing** answer **Will the customer commit to the tooling?** **Yes** and **Does the customer have inventory or safety stock requirements?** **Yes**, 12 weeks, with a note (FB-31 wording). Leave **Customer wants returnable (multi-trip) dunnage** unticked, and click in the empty space to the right of its words. | The box stays unticked (only the box and its words toggle it). The review shows **Returnable dunnage: No**, **Customer commits to the tooling: Yes** and **Inventory or safety stock requirements: Yes, for 12 weeks · <note>**. | | |
| 110 | Submit. Open the quote. | The **Request class** shows the **Concept** badge; the facts start with **Concept assumptions**. Engineering, Pricing and Final Review testers see the same. The offer letter (once approved) says "This is a concept quote. It assumes: …". | | |
| 111 | Is "Concept / innovation" the right name? Is anything else needed for a concept (a design brief, a target weight)? Which dropdowns should keep their own order? Was the item name you typed in the demo the **Item name** (now 120) or the **Standard description** (500)? | Write the answers in Notes. | | |

## FB-25: the quote page (2026-11-19)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 112 | Open one of your quotes. Read the tab bar, then scroll down. | The tabs read **Overview · Engineering · Quoting · Commercial terms · Attachments**, in larger type, and the bar stays under the page header while you scroll. A small red dot marks a tab where something waits for you. | | |
| 113 | On **Overview**, read **At a glance**. | Read-only: the **Intake**, **Engineering** (per item: plant, process and machine, cavitation, cycle time, budgetary capital, the engineer's and the capacity notes, who decided feasibility), **Pricing** (costing, payback, price approval, capital readiness) and **Commercial terms**, with **Edit on the Commercial terms tab**. Rows with nothing in them are left out. No boxes to type in. | | |
| 114 | Open **Commercial terms**. Pick **Net 30**, then **Net 60**, then nothing. | At Net 30 (and Net 15) there is no **Non-standard terms** box. At Net 60 it is ticked and greyed out. With nothing picked it can be ticked by hand. | | |
| 115 | On a quote in Final Review, answer **Customer tooling commitment** and **Save terms**. | It saves. Final Review needs it (yes or no) before the offer can be released; you may also have answered it at intake. | | |

## Part N: FB-26 checks (linked re-quote, CER at hand-off)

Added 2026-11-19 (FB-26, N17-30, N17-32). Bailey prepares `<CCQ-EXPIRED-1>`: one of your quotes released by Final Review more than 30 days ago and still open at Customer Decision (its offer has expired), with at least two items.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 116 | Open `<CCQ-EXPIRED-1>`. Read the **Customer decision** box. | A red chip "Expired N days ago", the note to revalidate or record the outcome, and a **Start a linked re-quote** button with "The offer has expired. If the customer now says yes, start a linked re-quote …". | | |
| 117 | Click **Record customer decision** and read the help under **Re-quote**. Cancel. | "… Use while the offer is still valid. After it has expired, start a linked re-quote from the closed quote." | | |
| 118 | Click **Start a linked re-quote**. Pick **Why did the offer expire?** **Proposal validity lapsed**, type why it is re-quoted, click **Start the re-quote**. | The quote is closed as **No response / Expired** with your note, and an intake draft opens at step 2 with "Re-quote of `<CCQ-EXPIRED-1>` (expired <date>). Check every value; Engineering and Pricing will review it again." The opportunity cannot be changed. | | |
| 119 | Walk through the steps. | The request fields and every item are filled from the old quote, each item with its drawings (they show as linked). **Quote needed by** is empty. No "this opportunity already has an active quote" warning. | | |
| 120 | Fill **Quote needed by**, change the volume of one item and submit. Open the new quote. | Under the stage tracker: "Re-quote of `<CCQ-EXPIRED-1>`" (a link). It waits for qualification (G1) as a new quote. The timeline starts "Quote created as a re-quote of …". | | |
| 121 | Click the link to the old quote. | "Re-quoted as CCQ-… on <date>". The old quote keeps its decisions, prices and files; **Start a linked re-quote** is gone. Its timeline shows "Linked re-quote started" and "Re-quoted as CCQ-…". | | |
| 122 | Ask an engineering tester to open the new quote's **Engineering** tab and expand **From the expired quote**. | The old quote's plant, process and machine, cavitation, cycle time, budgetary capital and tooling notes per item, and its price approval and capital readiness, read only. | | |
| 123 | On a quote of yours in **Commit & Hand Off**, read the hand-off card. Click **Upload the CER proof** and choose a PNG screenshot. | "CER proof · Optional". After the upload: "v1 · <file> · <you> · <time>". A second upload shows v2. If an Admin has set the CER links, **Open the CER tool ↗** and **CER template ↗** open in a new tab; otherwise there are no links. | | |
| 124 | Should a **Lost** quote be re-quotable too? Should the old engineering solution be copied as a starting point? Is "CER request number" the Apex CER ID? Should the proof be required? | Write the answers in Notes for Bailey. | | |

## FB-27: lists, timeline and polish (2026-11-19)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 125 | **Pipeline** → **Filters**. Under **Plant** tick one plant that has quotes in Engineering. Then **Columns**. | The list shows only quotes with an item at that plant (the link carries `plant=…`). **Columns** lists **Shown, in order** with **Move up** / **Move down** on each, then **Not shown**. A quote whose items have no plant yet never appears under a plant filter. | | |
| 126 | In **Columns** tick **Plant**, then press **Move up** until **Plant** is first. Close it and read the table. | **Plant** is the first column and shows the plant names of each quote's items ("Aurora · Carrollton"; blank before Engineering picks one). The order is still there after you reload. | | |
| 127 | **Views** → type a name → **Save**. Choose **Reset to default** in **Columns**, then open the view from **Views**. | The filter **and** the columns come back in your order. A view you saved before this release brings back its filters and leaves your columns alone. The menu says views stay in this browser and do not follow you to another device. | | |
| 128 | Open a quote that has an uploaded file. On **Overview** read the **Timeline** and click the file name in "File uploaded: …". | The name is a link; the file opens through the same download as the **Attachments** tab. A file that was removed afterwards stays plain text, and so does "File removed: …". | | |
| 129 | Move the mouse over the **Pipeline** filter button, a tab, the equipment BOM button (Engineering tab) and a file name. Then over a button that is switched off. | A pointing hand over each; the "not allowed" sign over the one that is switched off. | | |
| 130 | On the Engineering tab (as someone who may edit it) and on **Attachments**, read the line beside each upload button. | The BOM and the capacity analysis say which file types and "up to 100 MB"; **Attachments** lists the accepted types. The file picker offers only those types. | | |
| 131 | **Report an issue**. Type "abc". Read under the box. Type more, pick another type and severity, then **Cancel**. Open it again. Repeat with **Esc**. | Under the box: "Describe the issue in at least 5 characters." until there are 5. After Cancel or Esc the form is empty again (type "Bug", severity "Minor"). After a real send: "Thanks: your report was sent", and the next time the form is empty. | | |

## FB-31: payment terms, tooling funding, inventory wording (2026-11-19)

Added for the Nov 19 feedback (N19-07, N19-08, N19-10). Who approves which payment terms is a **provisional guess** until Sarah Brennan and Oleg Yarovinski set thresholds.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 132 | **New intake**, step 3, **Commercial inputs for Pricing**: pick payment terms **Net 45**, then **Net 60**. | Net 45: "Non-standard: needs approval by the pricing lead". Net 60: "Non-standard: needs approval by Leadership" and "A written rationale and a supporting document (Payment-terms approval) are needed." Net 15 and Net 30 show nothing. | | |
| 133 | Open **Does the customer fund any of the tooling?** | Four choices, A to Z: **Customer funded (amortized)**, **Customer funded (lump sum)**, **Pretium funded**, **To be determined** (the default). No **$0 CER**, no **Shared**. **What do the funding options mean?** explains each in one sentence. | | |
| 134 | Pick **Customer funded (amortized)**. | A line: "Needs a finance review: an extra sign-off at Final Review before the offer goes out." It goes away for any other choice. | | |
| 135 | Read the stock question. | "Does the customer have inventory or safety stock requirements?" with Yes / No / Not known yet; Yes asks for the weeks and a note. | | |
| 136 | On a quote of yours in Engineering or later, **Commercial terms** tab: pick **Net 60**, answer the tooling commitment, **Save terms**. Then **Upload the supporting document** (a PDF). | The toast says Leadership has been asked to decide. The **Payment-terms exception** card says **Waiting for Leadership**, "Supporting document (Payment-terms approval): Needed before it can be approved", then shows your file (v1). Leadership is told; the pricing lead is not. | | |
| 137 | Are "inventory requirements" and "safety stock requirements" the words in the contracts? Are the four funding choices the right ones (is anything lost without $0 CER and Shared)? | Write the answers in Notes. | | |

## FB-32: less double entry (2026-11-19)

Added for the Nov 19 feedback (N19-04, Sarah Brennan). The Color hint is **off** until Zachary Cairns confirms what the Salesforce field means (Admin → Settings → `intake_sf_suggestions_enabled`).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 138 | **New intake**, pick an opportunity that has a Salesforce product, go to step 3. Read **Item name** under **Item**. | It is filled with the Salesforce product's name (else its size) and carries **from Salesforce** and "Change it here if it is wrong. Salesforce is not updated." | | |
| 139 | Type your own item name. Read the line under it. Click **Use the Salesforce value**. | The line says what Salesforce has and offers the way back; the click puts the Salesforce name back. | | |
| 140 | Go back to step 1, pick the same opportunity again (or another), return to step 3 with an item name you typed yourself. | Your typed name is still there; Salesforce does not replace it. | | |
| 141 | (Admin turns the setting on first.) On step 3 under **Color** for an opportunity whose Salesforce **Color** is "Natural". | "Color in Salesforce says "Natural"." and a **Use this** button; nothing is chosen for you. **Use this** picks Natural, tags it **from Salesforce** and offers the way back. With the setting off, or a Salesforce color that is not on the list, there is no hint. | | |
| 142 | Is anything still typed twice (in Salesforce and here) that a KAM would expect QuoteFlow to know? Which of these should Zachary confirm first (market, sub-market, container size, neck finish, finished-good type)? | Write the answers in Notes; they go to `docs/build-guide/feedback/salesforce-prefill-candidates.md`. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | KAM | | | |
| | KAM | | | |
