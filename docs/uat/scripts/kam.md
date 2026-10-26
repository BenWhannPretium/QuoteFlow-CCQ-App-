# UAT script: KAM

| | |
|---|---|
| Session | **U1**, Mon Nov 9 (2 h). Run by Bailey Schmitt. |
| Tester role | Key account manager (app role `CCQ.KAM`) |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft** and use your Pretium account. Your account must be in **`SG-CCQ-KAM`** and in no other `SG-CCQ-*` group. |
| Devices | A laptop for Parts A–G. Your phone for Part H. |
| Before you start | Ben confirms the Salesforce sync ran today (Admin → Integrations). Ben stages the quotes in the Data list below. The sales leader tester is in the same session (Part E needs them). |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Pick a type and a severity (see `../README.md`). Write the step number in the description. |

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
| `<CCQ-FR-1 staged by Ben>` | Any quote in **Final Review** |

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
| 7 | Click **Use this opportunity**. | Step 2, **Customer & ship-to**. The customer is filled from the Salesforce account and marked **Existing customer** or **Not yet established**. There is no way to create a customer account. | | |
| 8 | Check **Ship-to / fill location**. | It shows the default address with "Default from the customer record." | | |
| 9 | Click **Next**. Fill step 3, **Product & volume**: Request class, Product family, Components, Market, Resin, Neck finish / type, Packaging type, Estimated annual volume (units), Estimated annual revenue (USD), Expected close date. | Each field has a one-line "why we ask" help. Nothing asks you to pick a plant, an engineer or a priority. | | |
| 10 | Click **Next**. On step 4, **Drawing, notes & review**, set **Drawing** to **Have drawing**. Drag the drawing PDF onto **Drawing and other files** (or click **choose files**). | The file uploads and is listed with its size and your name. | | |
| 11 | Type a note in **Comments for engineering**. Read the **Review** section. | **Needed before you can submit** is not shown. Each step summary has an **Edit** link. | | |
| 12 | Click **Submit to CCQ**. | "Quote **CCQ-2026-NNNNN** created". It says it is waiting for qualification by a sales leader. Write the number in Notes. | | |
| 13 | Click **Open the quote**. | The quote page shows the number, the stage **Intake**, a priority tier, the **Overview**, **Engineering**, **Quoting** and **Attachments** tabs, **Why this priority?** and a **Timeline**. | | |
| 14 | Open the **Attachments** tab. | The drawing is there. | | |

## Part C: Intake without a drawing, with a ship-to change

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 15 | **New intake** → find `<SF-OPP-2 chosen by Bailey>` → **Use this opportunity**. | Step 2 opens, pre-filled. | | |
| 16 | Click **Change ship-to**. Change the street and city. | "Original:" shows the default. A required field **Reason for changing the ship-to** appears. | | |
| 17 | Leave the reason empty. Go to step 4. | **Needed before you can submit** lists the ship-to reason. **Submit to CCQ** is disabled. | | |
| 18 | Go back to step 2 and type a reason. Fill step 3. On step 4 set **Drawing** to **None (quote will take longer)**. Do not upload a file. | **Engineering may ask about this** lists the open items, with "You can still submit." | | |
| 19 | Click **Submit to CCQ**. | The quote is created. It says Engineering may ask about the items you left open. | | |
| 20 | Open the quote. Look at **Ship-to** on the **Intake** card. In **Timeline**, click **Overrides**. | The new address shows. The timeline has the ship-to override with your reason. | | |

## Part D: Drafts and blocked submits (negative checks)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 21 | **New intake** → `<SF-OPP-3 chosen by Bailey>`. On step 3 leave **Resin** empty. Go to step 4. | **Resin** is listed under **Needed before you can submit**. **Submit to CCQ** is disabled. | | |
| 22 | Click **Home**, then **New intake** again. | **Continue a draft** lists the draft with its step and save time. | | |
| 23 | Click **Continue**, then **Discard**. Confirm **Discard draft**. | "Draft discarded". Salesforce is not changed. | | |
| 24 | **New intake** → search `<SF-OPP-1 chosen by Bailey>` again. | The card shows **Has quote CCQ-…** and **Open existing**. There is no **Use this opportunity** button (one quote per opportunity). | | |
| 25 | Search for a name that does not exist in Salesforce. | **Create the opportunity in Salesforce first**. | | |

## Part E: Priority override and rework after a return

Do steps 27–30 after the sales leader returns your Part C quote at G1 (sales-leader script, step 8).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 26 | Open your Part B quote. Next to the priority, click **Override**. Pick a tier. Type a justification (15 characters or more). Click **Request override**. | Dialog **Override priority tier**. Then "Override requested": it applies only after an approver accepts it. A pending badge shows. | | |
| 27 | After the return, click the bell (top right). | A notification says your quote was returned. | | |
| 28 | Go to **Home**. | **Returned to me** lists the quote. | | |
| 29 | Open the quote. | A banner: **Returned for rework at G1**, the reason and "What to fix:". A **Fix and resubmit** button. | | |
| 30 | Click **Fix and resubmit**. Fix the item. Click **Submit to CCQ**. | The wizard shows "Rework of CCQ-…". The opportunity cannot be changed. After submit: "Quote CCQ-… **resubmitted**" with the **same** number. | | |

## Part F: Customer outcome and Commit & Hand Off

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 31 | Click **My proposals**. | **My open proposals**, soonest to lapse first, with counts (open, expiring soon, past validity, on hold). | | |
| 32 | Open `<CCQ-CD-1 staged by Ben>`. Read the **Customer decision** panel. | It shows **Proposal issued**, **Valid until** and **Salesforce stage**. | | |
| 33 | Back on **My proposals**, click **Record outcome** for `<CCQ-CD-1>`. Choose **Awarded**. Set **Acceptance evidence** to **Purchase order (PO)**. Set **Customer accepted on** to tomorrow. Click **Record decision**. | Refused: "The acceptance date can’t be in the future." | | |
| 34 | Set **Customer accepted on** to today. Add a **Document link (optional)**. Click **Record decision**. | "Awarded recorded". The stage is **Commit & Hand Off**. The quote is **not** closed. The **Commit & hand off** card opens. | | |
| 35 | Click the header button **Commit & hand off**. Choose **Advance (close Won)**. | Under **Missing before it can move on:** the dialog lists "The CER approved, or marked not required" and "The receiving team accepted the hand-off". Recording it is refused. Close the dialog. | | |
| 36 | In the **Commit & hand off** card fill **CER status**, **CER ID (Apex)**, **CER approved on**, **Receiving role**, **Receiving contact** and **Accepted-by date**. Tick **Hand-off accepted by the receiving team**. Click **Save hand-off**. | "Hand-off accepted". The card shows **CER: Approved** (or Not required) and **Hand-off accepted**. | | |
| 37 | Click **Commit & hand off** → **Advance (close Won)** → **Record decision**. | The stage is **Closed – Won**. A closure card shows the outcome, reason, **Closure owner** (you) and date. | | |
| 38 | Open `<CCQ-CD-2 staged by Ben>` → **Record outcome** → **Lost**. Click **Record decision** with no reason. | "Choose a reason." | | |
| 39 | Pick **Other (note required)** and leave the note empty. Click **Record decision**. | Refused: a note is required. | | |
| 40 | Pick **Price**. Type a **Competitor (optional)**. Click **Record decision**. | The quote closes as lost. The closure card shows **Reason** Price, the competitor and **Closure owner** you. | | |

## Part G: What a KAM must not see or do (negative checks)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 41 | Open `<CCQ-QT-1 staged by Ben>` → **Quoting** tab. | Only "**Price approved ✓** on <date> by <name>" and the note "Pricing details, references and capital readiness are commercial…". No pricing basis, range, ERF number, capital readiness or any figure. | | |
| 42 | Open its **Engineering** tab. | No preliminary capital figure. No capacity numbers (effectiveness, utilization, buffer, cycle time). | | |
| 43 | **Pipeline** → **Columns**. | **Prelim capital (USD)** and **Capital readiness** are not offered. | | |
| 44 | Click **Export CSV**. Open the file. | The file has no capital or pricing columns. | | |
| 45 | Type `/quotes/<CCQ-FR-1 staged by Ben>/review` after the test URL. | "You don’t have access to this". | | |
| 46 | Type `/approvals` after the test URL. Then `/analytics`. Then `/admin`. | "You don’t have access to this" each time. | | |
| 47 | Open any quote in **Intake** that is yours. | There is no **Qualify & prioritize** button. A KAM cannot qualify. | | |

## Part H: Intake on a phone

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 48 | On your phone, open the test URL and sign in. | A bottom tab bar: **Home**, **Intake**, **Proposals**, **Pipeline**. | | |
| 49 | Tap **Intake** → find `<SF-OPP-4 chosen by Bailey>` → **Use this opportunity**. | The stepper reads "Step 2 of 4 · Customer & ship-to". No sideways scrolling. | | |
| 50 | Fill steps 2 and 3. On step 4 tap **Add photo** and take a photo of a sample. | The camera opens. The photo uploads as a sample photo. | | |
| 51 | Tap **Submit to CCQ**. | The quote is created. Note how long the whole intake took. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | KAM | | | |
| | KAM | | | |
