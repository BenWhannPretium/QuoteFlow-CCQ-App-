# UAT script: KAM

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

## Part A: Sign in and home

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Open the test URL. Click **Sign in with Microsoft** and sign in. | Home opens with the title **My quotes** ("Your intakes and quotes, and anything waiting on you."). | | |
| 2 | Look at the left navigation. | You see **Home**, **New intake**, **My proposals** and **Pipeline**. You do **not** see To qualify, Approvals, Analytics or Admin. | | |
| 3 | Click your initials (top right). | The menu shows your name, email and the role chip **KAM**. | | |
| 4 | Read the home blocks. | You see **Returned to me**, **My drafts**, **My open quotes by stage**, **Proposals expiring soon** and **My outcome capture rate**. | | |

## Part B: Intake with a drawing

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 5 | Click **New intake**. | Page **New intake**. Step 1 of 4, **Opportunity**. A search box **Find the Salesforce opportunity**, with **Mine** selected. | | |
| 6 | Type part of the name of `<SF-OPP-1 chosen by Bailey>`. | Its card shows the name, account, **Amount**, **Close**, **SF stage** and **Owner**. They match Salesforce. | | |
| 7 | Click **Use this opportunity**. | Step 2, **Customer & destination**. The customer is the Salesforce Account on the opportunity, shown read-only. There is no new-customer form and nothing to type about the customer. One checkbox: **Not yet a Pretium customer (no ERP account)**, unticked for an existing customer. | | |
| 8 | Look at **Ship / fill destination**. | It shows the default address with the label from Salesforce. **City** and **State** are required. A **Change destination** button is there. | | |
| 9 | Click **Next**. On step 3 read **Request**, **Product** and **Packaging**. Fill **Request class**, **Product family**, **Container size**, **Market**, **Components** and **Packaging type**. | **Request class** lists **CCQ (new business + capital/engineering)** and three classes that stay in the pricing application (**Stock / stock-plus**, **Price inquiry / RFP check**, **Other capital**): only CCQ can be submitted (step 29). Each field has a one-line "why we ask" help. Nothing asks you to pick a plant, an engineer or a priority. | | |
| 9a | Open the **Market** list. | Eight markets: Food, Beverage, Nutrition & Wellness, OTC Health, Clinical, Personal Care, Home Care, Auto & Commercial Chemical. The five old ones (Nutrition/Supplements, Household Chemical, Pharma/Health, Industrial/Chemical, Pet) are not offered. | | |
| 9b | Look at **Sub-market** before you pick a market. Then pick **Food**. Then pick **Beverage**, then **Food** again. | Before a market: the list is disabled and reads "Choose a market first". With **Food**: **Choose…** and the seven Food sub-markets (for example Snacks & Confections, Oils, Spices, Seasonings & Extracts). With **Beverage**: only Non-Alcoholic and Spirits & Mixers. The help reads "Pick the closest sub-market. It sets the strategic-fit score." | | |
| 9c | Pick **Food** and the sub-market **Snacks & Confections**. Then change **Market** to **Beverage**. | The sub-market is cleared (**Choose…** again): a sub-market that does not belong to the new market is never kept. Pick **Food** and **Snacks & Confections** again for the rest of this intake. **Sub-market** is optional: you can leave it empty and still submit, but then the strategic-fit points stay neutral. | | |
| 10 | Fill **Resin** (a listed one: PET, HDPE, PP, LDPE or PS). Tick **Customer-specified resin**. Pick a **PCR %**. Pick **Neck diameter**, **Neck finish** and **Special feature** from the lists. Pick **Custom** in one of them. | **Customer-specified resin and grade** appears and is required. Each neck field is a pick-list. **Custom** opens a required short description (for example **Custom neck finish**). Pick a listed value again to remove it. If Salesforce already gave the resin, **Resin** is read-only: pick another opportunity for steps 10a–10e or skip them. | | |
| 10a | Set **Resin** to **Other** (untick **Customer-specified resin** first). Leave **Customer-specified resin and grade** empty and go to step 4. Then fill it (for example `Eastman Tritan TX1001`) and try to type 130 characters. | The box **Customer-specified resin and grade** appears and is required. **Needed before you can submit** lists **Customer-specified resin and grade**. It stops at 120 characters. Pick a listed resin: the box goes away and its text is cleared (unless **Customer-specified resin** is ticked). | | |
| 10b | Set **PCR %** to **Other**. Look at the list first. Leave the box empty and go to step 4, then type `35% PCR`. Then pick **30%**, then **Other** again. | The list reads 0% / Virgin, 25%, 30%, 50%, 100%, Other. **Customer-specified PCR level** appears and is required (listed under **Needed before you can submit** while empty, 120 characters at most). Picking **30%** hides it and clears it: it is empty when you pick **Other** again. | | |
| 10c | Set **Additive** to **Other**. Look at the list first. Leave the note empty and go to step 4, then type `UV inhibitor, grade and supplier`. Then pick **UV**. | The list reads None, UV, Barrier, Antistat, Impact Modifier, Other. For **Other** the note is called **Customer-specified additive**, is required (**Additives is required** under **Needed before you can submit**) and stops at 200 characters. For any other additive the note is **Additives** and optional, and it keeps your text. | | |
| 10d | With **Other** picked for resin, PCR and additive and their boxes filled, finish the intake, **Submit to CCQ** and open the quote → **Overview** → **Intake**. | **Resin** reads "Other". **Customer-specified resin**, **PCR %** and **Additives** show what you typed. Engineering and Pricing see the same (engineering.md steps 62–64). A draft saved with an empty box still saves: it only blocks the submit. | | |
| 10e | Is Danielle Leu's "Other" rule easy to follow? Is anything you quote often missing from the resin, PCR or additive list? | Write the answer in Notes. (The resin list is approved. The PCR and additive lists are provisional until Engineering and Supply Chain confirm.) | | |
| 11 | Set **Color** to a custom color. Pick an **Additive** and fill **Additives** (see step 10c). Tick **Decoration** under **Components**. | The custom color asks for a description. **Decoration type** and **Number of print colors** appear and are required. | | |
| 12 | Fill **Height (mm)**, **Width or diameter (mm)**, **Depth (mm)** and **Gram weight (g)**. Fill **Estimated annual volume (units)** and **Estimated annual revenue (USD)**. | The numbers are accepted. A volume that looks like a placeholder (for example 1,000,000) asks you to confirm it is the real annual volume. | | |
| 13 | Look at the dates. Fill **Quote needed by** and **Product needed by (best estimate of launch need)**. Optionally fill **Quote variants requested**. | **Salesforce close date (updates with Salesforce)** is shown read-only: you cannot type it. The two needed-by dates are yours and required. The variants note stops at its character limit. | | |
| 13a | Still on step 3, find **Commercial inputs for Pricing** and the **Bid / program reference** under **Request**. Pick **Payment terms the customer requests**: first **Net 30**, then **Net 60**. | **Net 30** shows no flag. **Net 60** shows **Non-standard: Pricing will review**. **Other** asks for a short description. | | |
| 13b | Look at **Does the customer fund any of the tooling?** | It starts at **Not discussed**. The (i) **What do the funding options mean?** explains each option. Pick **Customer-funded**: a hint says that if the customer owns the tool it is not Pretium capital and sales tax and contract terms apply. There is no amount and no payment method here. | | |
| 13c | Under **Packaging** tick **Customer wants returnable (multi-trip) dunnage**. Under **Delivered or FOB** pick **Delivered**. | The help says multi-trip comes back and single-trip is charged to the customer. **Freight type** (Flatbed, Van, Drop trailer, T-bar, Other) and **Special freight arrangements** appear. The arrangements hint names drop trailers and T-bars as costly. | | |
| 13d | Pick **T-bar** and type a note. Switch **Delivered or FOB** to **FOB Pretium plant**, then back to **Delivered**. Type a **Bid / program reference** (for example `RFP-2026-114`). | Switching to FOB hides the freight fields and clears them: back on **Delivered** they are empty. The reference stops at 60 characters. Nothing here is required. | | |
| 13e | Under **Packaging** set **Packaging type** to **Other**. Leave the note empty and go to step 4. Then type a note and keep typing past 500 characters. | The note becomes **Customer-specified packaging (describe)** and is required. A hint says "Other is for packaging the customer dictates. Attach the customer's packaging document under "Drawing and other files" on the next step." It stops at 500 characters. A packaging note saved before FB-09 that is longer than 500 stays readable and shows an amber line "This note is N characters; new edits are limited to 500." | | |
| 14 | Click **Next**. On step 4, set **Drawing status** to the "have a drawing" option. Drag the drawing PDF onto **Drawing and other files** (or click **choose files**). Optionally add the **Customer RFP / portal link**. | The file uploads and is listed with its size and your name. The **Drawing or minimum spec** box says a drawing is attached. | | |
| 15 | Type a note in **Comments for engineering**. Read the **Review** section. | **Needed before you can submit** is not shown. Each step summary has an **Edit** link. | | |
| 16 | Click **Submit to CCQ**. | "Quote **CCQ-2026-NNNNN** created". It says it is waiting for qualification by a sales leader. Write the number in Notes. | | |
| 17 | Click **Open the quote**. | The quote page shows the number, the stage **Intake**, a priority tier, the **Overview** (with the product facts you entered: **Market** as "Market › Sub-market", resin grade, PCR %, color, additives, dimensions), **Engineering**, **Quoting** and **Attachments** tabs, **Why this priority?** and a **Timeline**. The Salesforce opportunity is a link, **Open in Salesforce ↗** (or the plain ID if Admin has not set the Salesforce URL yet). | | |
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
| 30 | Click **Home**, then **New intake** again. | **Continue a draft** lists the draft with its step and save time. | | |
| 31 | Click **Continue**, then **Discard**. Confirm **Discard draft**. | "Draft discarded". Salesforce is not changed. | | |
| 32 | **New intake** → search `<SF-OPP-1 chosen by Bailey>` again. | The card shows **Has quote CCQ-…** and **Open existing**. There is no **Use this opportunity** button (one quote per opportunity). | | |
| 33 | Search for a name that does not exist in Salesforce. | **Create the opportunity in Salesforce first**. | | |

## Part E: Priority and rework after a return at G1

Do steps 37–40 after the sales leader returns your Part C quote at G1 (sales-leader.md step 9).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 34 | Open your Part B quote. Look at the priority. | There is **no** override button. A hint reads "Need a different priority? Escalate to your sales leader." Only a sales leader changes the tier. | | |
| 35 | Ask the sales leader tester to override the tier on this quote (sales-leader.md Part D). Reload. | The priority shows the new tier with a marker. The original tier and the justification show under **Why this priority?** | | |
| 36 | Open **Timeline** → **Overrides**. | The override is listed with who applied it and why. You cannot revert it. | | |
| 37 | After the return, click the bell (top right). | A notification says your quote was returned to you for rework, with the reason and the note in the notification. | | |
| 38 | Go to **Home**. | **Returned to me** lists the quote. | | |
| 39 | Open the quote. | A banner: **Returned for rework at G1**, the reason and "What to fix:". A **Fix and resubmit** button. | | |
| 40 | Click **Fix and resubmit**. Fix the item. Click **Submit to CCQ**. | The wizard shows "Rework of CCQ-…". The opportunity cannot be changed. After submit: "Quote CCQ-… **resubmitted**" with the **same** number. | | |

## Part F: Pricing sends a quote back to you (G3)

Do this after the pricing lead returns `<CCQ-RW-1>` and `<CCQ-RW-2>` to you (pricing.md step 22).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 41 | Click the bell. Open the notification for `<CCQ-RW-1>`. | It says the quote was returned to you for rework and that Quoting sent it back. The reason and the pricing lead's note are in the notification. The email names the reason only and carries no note. | | |
| 42 | Go to **Home**. | **Returned to me** lists `<CCQ-RW-1>` with the reason and note from Pricing. | | |
| 43 | Open `<CCQ-RW-1>`. Click **Fix and resubmit**. | The notice says that if the scope did not change, the quote goes straight back to Pricing. Nothing else in the quote asks to be redone. | | |
| 44 | Go to step 4. Try **Submit to CCQ** before answering **Did the scope change? (required)**. | **Submit to CCQ** is disabled until you answer. | | |
| 45 | Choose **No, same scope**. Click **Submit to CCQ**. | "Quote … **resubmitted**" and "It is now in Quoting." The stage is **Quoting**, not Intake. The same pricer and pricing lead are still assigned. They are told it is back from you. | | |
| 46 | Open `<CCQ-RW-2>` → **Fix and resubmit** → step 4. Choose **Yes, the scope changed**. Click **Submit to CCQ**. | The quote is resubmitted as a new submission: it waits for a sales leader at G1 and then goes through Engineering again. | | |

## Part G: Customer outcome and Commit & Hand Off

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 47 | Click **My proposals**. | **My open proposals**, soonest to lapse first, with counts (open, expiring soon, past validity, on hold). | | |
| 48 | Open `<CCQ-CD-1 staged by Ben>`. Read the **Customer decision** panel. | It shows **Proposal issued**, **Valid until** and **Salesforce stage**. The header links to the opportunity (**Open in Salesforce ↗**). | | |
| 49 | Back on **My proposals**, click **Record outcome** for `<CCQ-CD-1>`. Choose **Awarded**. Set **Acceptance evidence** to **Purchase order (PO)**. Set **Customer accepted on** to tomorrow. Click **Record decision**. | Refused: "The acceptance date can’t be in the future." | | |
| 50 | Set **Customer accepted on** to today. Add a **Document link (optional)**. Click **Record decision**. | "Awarded recorded". The stage is **Commit & Hand Off**. The quote is **not** closed. The **Commit & hand off** card opens. A reminder reads "Update the Salesforce opportunity to match: <stage name>." with the link. | | |
| 51 | Click the link in the reminder. Then dismiss the reminder. | The opportunity opens in a new tab (or the plain ID is shown if the URL is not set). The reminder goes away. Nothing was written to Salesforce: QuoteFlow only reminds you. | | |
| 52 | Click the header button **Commit & hand off**. Choose **Advance (close Won)**. | Under **Missing before it can move on:** the dialog lists "The CER approved, or marked not required" and "The receiving team accepted the hand-off". Recording it is refused. Close the dialog. | | |
| 53 | In the **Commit & hand off** card fill **CER status**, **CER ID (Apex)**, **CER approved on**, **Receiving role**, **Receiving contact** and **Accepted-by date**. Tick **Ready for CER development**. Tick **Hand-off accepted by the receiving team**. Click **Save hand-off**. | "Hand-off accepted". The card shows **CER: Approved** (or Not required), **Ready for CER development** and **Hand-off accepted**. | | |
| 54 | Click **Commit & hand off** → **Advance (close Won)** → pick the **Reason (required)** (the acceptance evidence, for example **Purchase order (PO)**) → **Record decision**. | Without a reason: "Choose a reason." The stage is **Closed – Won**. A closure card shows the outcome, reason, **Closure owner** (you) and date. | | |
| 55 | Open `<CCQ-CD-2 staged by Ben>` → **Record outcome** → **Lost**. Click **Record decision** with no reason. | "Choose a reason." | | |
| 56 | Pick **Other (note required)** and leave the note empty. Click **Record decision**. | Refused: a note is required. | | |
| 57 | Pick **Price**. Type a **Competitor (optional)**. Click **Record decision**. | The quote closes as lost. The closure card shows **Reason** Price, the competitor and **Closure owner** you. The Salesforce reminder names the closed-lost stage. | | |

## Part H: What you can see, and what is locked

You can read pricing, margin and capital figures on any quote you can open. You cannot change them. After a gate is decided its section is locked for everyone until a send-back reopens it.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 58 | Open `<CCQ-QT-1 staged by Ben>` → **Quoting** tab. | You read the price approval record: "Price approved ✓ on <date> by <name>", the pricing basis and range, references and the capital readiness. There is no **Save price approval** or **Save capital readiness** button for you. | | |
| 59 | Open its **Engineering** tab. | You read the **Budgetary capital estimate (USD)** and the capacity evidence (utilization before and after, assumed effectiveness, cycle time). Nothing is editable. | | |
| 60 | Open `<CCQ-FR-1 staged by Ben>` → **Quoting** tab. | A lock line reads "Locked after G3 · decided by <name> on <date> · reopens if the quote is sent back". The Engineering tab shows the same for G2. | | |
| 61 | Open `<CCQ-CD-4 staged by Ben>` and find **Commercial terms**. | Terms and the capital flag are read-only: "Locked after G4 · decided by <name> on <date> …". You cannot edit them. | | |
| 62 | **Pipeline** → **Columns**. | The **Budgetary capital estimate** and **Capital readiness** columns are offered (they are the same for every role). | | |
| 63 | Choose both columns. Click **Export CSV**. Open the file. | The file has the columns you chose. | | |
| 64 | Open the emails QuoteFlow sent you about quotes. | No price, margin or capital amount in any email. | | |
| 65 | Type `/quotes/<CCQ-FR-1 staged by Ben>/review` after the test URL. | The Final Review page opens **read-only** (no decision buttons: every role that can read a quote can read it). Trying to decide G4 through the API is refused with a 403. | | |
| 66 | Type `/approvals` after the test URL. Then `/analytics`. Then `/admin`. | "You don’t have access to this" each time. | | |
| 67 | Open any quote in **Intake** that is yours. | There is no **Qualify & prioritize** button. A KAM cannot qualify. | | |

## Part I: Notifications and comments

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 68 | Ask an engineer or a pricer tester to add a comment on one of your quotes. Click the bell. | A notice says there is a new comment, with a link. The email, if you get one, never contains the comment text. | | |
| 69 | Ask them to add two more comments within a few minutes. Check your email. | The comments arrive as **one** email ("3 new comments"), not three. | | |
| 70 | Watch your bell while the engineering and pricing testers move one of your quotes on (engineering.md Part C, pricing.md Part D). | You are told each time a quote of yours moves on, is sent back, goes on hold or closes. You are told once per event, even if you hold two roles. | | |
| 71 | Open your user menu → **Email preferences** (`/me/preferences`). Switch off the email for **Your quote moves or a decision is recorded**. | It saves. The in-app notices stay. | | |

## Part J: Intake on a phone

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 72 | On your phone, open the test URL and sign in. | A bottom tab bar: **Home**, **Intake**, **Proposals**, **Pipeline**. | | |
| 73 | Tap **Intake** → find `<SF-OPP-4 chosen by Bailey>` → **Use this opportunity**. | The stepper reads "Step 2 of 4 · Customer & destination". No sideways scrolling. | | |
| 74 | Fill steps 2 and 3 (including the needed-by dates and the dimensions). On step 4 tap **Add photo** and take a photo of a sample. | The camera opens. The photo uploads as a sample photo. | | |
| 75 | Tap **Submit to CCQ**. | The quote is created. Note how long the whole intake took. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | KAM | | | |
| | KAM | | | |
