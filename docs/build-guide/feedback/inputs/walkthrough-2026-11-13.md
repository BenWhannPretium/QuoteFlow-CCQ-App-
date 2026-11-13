# Walkthrough continuation, 2026-11-13: feedback record (FB-15 to FB-19)

**Meeting:** "QuoteFlow Walkthrough Continuation", Fri 2026-11-13, 10:30–12:55 US Central (Teams; transcript in Ben Whann's Teams meeting record, not committed).
**Present:** Ben Whann (build), Bailey Schmitt (PMO, product owner), Zachary Cairns (Salesforce / Midas; walked the app as a first-time user with every role), Tre Curry (left at 11:00).
**Synthetic data only.** The quote walked was CCQ-…-00002 on a fake Salesforce opportunity. No customer data is recorded here.

Each item has a **W13** ID. The build steps cite these IDs. Proposed tracker rows (F-087 onward) are added at close-out by each step, after checking the next free F- number in the tracker. Times are transcript offsets.

**Triage (Ben, 2026-11-13):**
- **Build:** agreed in the meeting, no open question.
- **Build as provisional:** built now on a stated assumption, seeded `provisional: true` (CLAUDE.md rule 4) and changed by config when the owner answers.
- **Wait:** needs information first. Sent to Bailey for follow-up and not built.

## Intake (KAM)

| ID | Feedback | Raised by | Triage | Step |
|---|---|---|---|---|
| W13-01 | **Bug:** an intake with every field filled still says "The intake is missing required information" and won't submit. It does not say which field is missing; once it said components was blank (0:53–0:59). Bailey's resubmit of 00002 kept the warning after she filled "Quote needed by" (1:13) | Zachary Cairns; Bailey Schmitt | Build | FB-15 |
| W13-02 | Mark required fields with a red asterisk before the label, as Salesforce does; today required and optional look the same. Include Sub-market (0:54, 1:12) | Zachary Cairns; Bailey Schmitt | Build | FB-15 |
| W13-03 | Picking "Other" still shows nothing (also reported Nov 12) (1:12) | Bailey Schmitt | Build | FB-15 |
| W13-04 | Product facts from the opportunity's products (container size, neck finish, from MDM via Salesforce) do not pre-fill. Check the field API names: market and sub-market moved from the opportunity to the product record (parent market, end-use market). Fields stay editable (0:13–0:17) | Zachary Cairns; Ben Whann (confirmed bug) | Build | FB-15 |
| W13-05 | A send-back notification should open the intake at the field to fix, not at the top of the page (1:07) | Bailey Schmitt; Zachary Cairns | Build | FB-15 |
| W13-06 | Bid / program reference: customers rarely send their own ID. Remove it or reword it (0:10) | Bailey Schmitt; Zachary Cairns | Build as provisional: keep the field (Pricing asked for it, F-085), make sure it is optional, relabel it "Customer bid / RFP reference (if the customer gave one)" | FB-15 |
| W13-07 | Color is missing the stock colorants by resin (PET, HDPE, PP). HDPE and PP stock colors are white and black (0:26–0:29) | Zachary Cairns | Build as provisional: add "Stock white" and "Stock black" for HDPE and PP now; PET stock colors wait for Seamus's list | FB-15 |
| W13-08 | Fluorination may be an additive (0:29) | Zachary Cairns | Build as provisional: add "Fluorination" to the additive list, provisional; Engineering confirms | FB-15 |
| W13-09 | Funding "Shared": capture the split (customer vs Pretium) (0:37) | Zachary Cairns; Bailey Schmitt | Build as provisional: optional "Customer share %" (0–100); Pretium's share is the remainder | FB-15 |
| W13-10 | "Not yet a customer" should signal at close-out that master data must set the customer up (help-desk ticket during commercial activation) (0:07) | Bailey Schmitt | Build as provisional: a "Customer needs master-data setup" notice on the won hand-off and the closed quote | FB-15 |
| W13-11 | Beverage sub-market "Spirits & mixers" is what Midas calls "Alcoholic"; add a training / FAQ note (0:21) | Bailey Schmitt | Build | FB-15 |

## Engineering and capacity

| ID | Feedback | Raised by | Triage | Step |
|---|---|---|---|---|
| W13-12 | Merge Process type and Machine type into one "Process & machine type" pick (1:18) | Bailey Schmitt | Build | FB-16 |
| W13-13 | Offer only the machine types the chosen plant runs, and only the plants that run the process (Jim's plant × machine-type list) (1:19, 1:23) | Zachary Cairns; Bailey Schmitt | Build | FB-16 |
| W13-14 | Pack-out: only one of units per bag / tray / case should be needed; bags and cases are never filled in together. Today all three look required (nothing enforces it; the fields are optional and unlabelled) (1:26–1:29) | Zachary Cairns | Build as provisional: at least one of the three when pack-out is entered, bag and case not both; Engineering confirms names and rule | FB-16 |
| W13-15 | A Production Scheduler role (Faron Ipox's job title) works the capacity part of the same quote alongside the engineer: same permissions within Engineering, notified when the engineer has saved the plant and machine, can start any time, and sees clearly which section is theirs (1:30–1:33) | Ben Whann; Bailey Schmitt; Zachary Cairns | Build as provisional | FB-16 |
| W13-16 | Show capacity as its own step, or rename the timeline step "Engineering & Capacity". Bailey: a separate page is not needed for the MVP unless it is simple (1:35–1:37) | Zachary Cairns; Ben Whann; Bailey Schmitt | Build as provisional: rename only | FB-16 |
| W13-17 | Blocking capacity leaves the quote stuck. It should immediately send the work back to Engineering with the blocker's note and tell the KAM, with no separate decision step (1:48–1:52) | Zachary Cairns; Bailey Schmitt; Ben Whann | Build | FB-16 |
| W13-18 | "Capacity sign-off" and "Decide feasibility" repeat each other; combine them into one step (1:56, 1:59) | Bailey Schmitt; Zachary Cairns | Build | FB-16 |
| W13-19 | A send-back for a scheduler's own input error (e.g. 750 % effectiveness) must go to the scheduler; otherwise send-backs go to Engineering (2:05–2:08) | Zachary Cairns; Bailey Schmitt | Build as provisional | FB-16 |
| W13-20 | Assumed effectiveness accepted 750 %. Cap every percentage input (100 for now; Zac floated 200) (2:07–2:10) | Zachary Cairns; Bailey Schmitt | Build: cap at 100 in the form (the server already does) | FB-16 |
| W13-21 | Utilization colour: above the target amber, below green (2:09) | Bailey Schmitt; Zachary Cairns | Build | FB-16 |

## Gate decisions and holds

| ID | Feedback | Raised by | Triage | Step |
|---|---|---|---|---|
| W13-22 | Remove "Advance – capital required" from G2 (agreed Nov 12) (2:00) | Bailey Schmitt; Ben Whann | Build | FB-17 |
| W13-23 | Merge Rework and Redirect into one "Send back to…" with a target and a required reason (2:01–2:03) | Bailey Schmitt; Zachary Cairns | Build as provisional | FB-17 |
| W13-24 | Keep Hold, but make clear it is for a pause (e.g. "customer says revisit in 6 months"), not for a fix (1:58–1:59) | Zachary Cairns; Bailey Schmitt | Build as provisional (help text) | FB-17 |
| W13-25 | The hold owner defaults to the KAM, who has nothing to do with capacity. It should be the person responsible for clearing the hold, and they should be notified (1:53, 1:55) | Zachary Cairns; Bailey Schmitt | Build as provisional: the decider by default, changeable in the dialog | FB-17 |
| W13-26 | A KAM can't see that a quote is on hold. Show an orange "On hold" next to it in the KAM's open quotes and on the timeline (1:51) | Zachary Cairns; Bailey Schmitt | Build | FB-17 |
| W13-27 | Stop: remove the "Closure owner" picker. Whoever stops the quote owns the closure (2:13) | Ben Whann; Zachary Cairns | Build | FB-17 |
| W13-28 | The score explanation popover ("Y") is cut off by the taskbar on a laptop (1:00) | Zachary Cairns | Build | FB-17 |

## Command Center and screen polish

| ID | Feedback | Raised by | Triage | Step |
|---|---|---|---|---|
| W13-29 | Rename Home to "Command Center" and merge each role's analytics into it (no separate Analytics tab) (0:03) | Ben Whann; Bailey Schmitt; Tre Curry | Build | FB-18 |
| W13-30 | Show a small "Progress saved" next to the Save button; the bottom-right toast is easy to miss (1:22) | Ben Whann; Bailey Schmitt | Build | FB-18 |
| W13-31 | Make the Salesforce opportunity a clickable link (helps on mobile), and show the customer's ERP number in the intake summary when known (1:02–1:04) | Zachary Cairns; Bailey Schmitt | Build (the customer number shows only once a source exists: see W13-W1) | FB-18 |

## Multi-item quotes

| ID | Feedback | Raised by | Triage | Step |
|---|---|---|---|---|
| W13-32 | One quote number holds several items (e.g. three custom bottles); fields shared by the request are entered once, each item's own fields per item; all items are quoted together. Bailey: **MVP**. Ben: by Monday Nov 16 (0:41–0:44) | Bailey Schmitt; Zachary Cairns | Build as provisional (field split and gate model assumed) | FB-19 |
| W13-33 | Still allow a quote with one item, and a KAM may split hot items into a separate quote (Midas 2.0 lesson) (1:41–1:43) | Zachary Cairns; Bailey Schmitt | Build: single-item quotes keep working. Linking related quotes is not needed now (Bailey) | FB-19 |
| W13-34 | Each variant (another plant, another PCR %) is its own item; costing uses each plant's own costs (0:45–0:51) | Zachary Cairns | Build (items carry their own plant); Finance examples asked (W13-W6) | FB-19 |

## Wait: sent to Bailey for follow-up (not built)

| ID | Question | Who answers |
|---|---|---|
| W13-W1 | Payment terms and the ERP customer number for existing customers: which Phoenix / Fabric table and field | AR / Finance and Brennan Paul |
| W13-W2 | Quote-type list and its name ("Commercial capital request / quote"); remove stock, stock plus, pricing query | Sarah |
| W13-W3 | Standard description wording (drop the redundant "container") | Sarah (naming convention) |
| W13-W4 | Neck-finish list (Jim's file) against the full MDM list | Niket (MDM); Cory (extracts) |
| W13-W5 | PET stock colorants | Seamus |
| W13-W6 | How the same item is costed at two plants (examples) | Finance |
| W13-W7 | Is fluorination an additive; do engineers know pack-out at quote time; pack-out field names; "two-step" vs "two-stage"; effectiveness cap 100 or 200 | Engineering (Jim Zweifel) |
| W13-W8 | Teams notifications (Graph permission or bot) | IT |
| W13-W9 | The engineering lead names (Paul Slomkowski's team) and the production scheduler user(s) | Operations engineering; Supply Chain |

**No change needed:** Salesforce write-back (not in the MVP, D-014); dimensions stay optional behind the drawing-or-minimum-spec rule; uploads are not read (Engineering can send back); per-item close dates are handled by "Product needed by" per item (FB-19); the capacity-bottleneck concern (Faron) is a process question.

**Not from this meeting but agreed in it:** Bailey will run a role-by-role round-table walkthrough on **Tue Nov 17** (one person per role, each with only their role) before the Sarah meeting. FB-15 to FB-18 should be merged before it.
