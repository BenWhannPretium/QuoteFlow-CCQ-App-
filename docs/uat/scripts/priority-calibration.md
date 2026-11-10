# UAT script: Priority calibration (FB-10, FB-12)

| | |
|---|---|
| Session | **U3b**, Wed Nov 11 (30 min), straight after `leadership.md`. Run by Ben Whann (Admin) with Bailey Schmitt. |
| Tester roles | Admin (`CCQ.Admin`: Ben); Leadership (`CCQ.Leadership`: the U3 leadership tester); a sales leader (`CCQ.SalesLeader`); a KAM (`CCQ.KAM`). The sales leader and KAM can be test accounts Ben signs in as, if the U1 testers are not free. |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft**. Each tester must be in the group for their role (`SG-CCQ-Admin`, `SG-CCQ-Leadership`, `SG-CCQ-SalesLeader`, `SG-CCQ-KAM`). |
| Before you start | There are open quotes from U1–U3. **Quotes submitted before FB-12 have no sub-market**, so until step 2b every open quote previews at the neutral 50 (see "Sub-markets" below). **Both FB-10 switches are off** on the test site (`intake_guardrails` and `g1_volume_routing`), and the **G1 qualify gate is on**. Ben switches them on in Part C and **must switch them off again in Part E**. |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Write the step number in the description. |

**What FB-10 is.** Nothing here changes how live quotes are ranked. FB-10 built:
- a **draft** scoring model with strategic-fit points from the Where-to-Play 9-box, and a **preview** that compares it with the live model on the open quotes;
- a **platform-minimum warning** at intake that never blocks;
- **volume-band routing** at intake.

The warning and the routing are switched off; the draft is inactive. D-004 (weights, points, bands) is still open, so every number here is **provisional**. Note a wrong meaning, not a different number.

**Values on the test site.**
- Platform minimums: Danielle Leu's corrected table of Nov 9 (ISBM 1M, RHB 1M, Injection 3M, IBM 3M, EBM 1M units a year). While the platform is not known at intake, the lowest (1,000,000) applies.
- The draft scores strategic fit **by sub-market** (FB-12, PR #67; FB-10 had it by market). Melanie Rasche's 9-box colours set the points: Strategic Growth (green) **80**, Selectively Participate (yellow and gray) **50**, Rationalization (red and pink) **20**. 27 sub-markets are scored. Histology, Tubes & Vials and Home Care > Non-Core are not scored. A quote with no sub-market, or an unscored one, gets the neutral **50**. The points and the 30-sub-market list are **provisional**.
- If a tester remembers the first FB-10 numbers (ISBM 3M, injection 1M), those were corrected on Nov 9, and the test site has the corrected table.

**Sub-markets.** The draft changes nothing for a quote that has no sub-market. **Have a KAM pick sub-markets first** (steps 2a and 2b). A quote submitted before FB-12 gets a sub-market only if it goes back to Intake and the KAM resubmits it.

**Data (placeholders)**

| Placeholder | What it is |
|---|---|
| `<SF-OPP-30 chosen by Bailey>`, `<SF-OPP-31 chosen by Bailey>` | Two open Salesforce opportunities the KAM owns, for two short intakes (Parts C and D) |
| `<SF-OPP-32 chosen by Bailey>`, `<SF-OPP-33 chosen by Bailey>` | Two more open opportunities the KAM owns, for the two intakes in step 2b |

## Part A: Admin: the draft and the preview

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 1 | Admin | **Admin** → **Scoring model**. | Page **Scoring model**. The live model is **Active**. A **Draft** version is listed, provisional and **Not active**. | | |
| 2 | Admin | Select the draft. Compare its weights and tiers with the active model. | Weights and tiers are the same as the live model's. Only **Strategic fit** differs (it has points). | | |
| 2a | Admin | Scroll to **Preview on the open quotes** before any sub-market exists (only if no open quote has one). | A note: "No open quote has a sub-market yet, so this draft scores every one of them at the neutral 50 for strategic fit and nothing moves. Points move as KAMs pick sub-markets." Every row shows 0 **Points moved**. | | |
| 2b | KAM | **New intake** from `<SF-OPP-32 chosen by Bailey>` and again from `<SF-OPP-33 chosen by Bailey>`. On the **Product & volume** step pick a **Market**, then a **Sub-market** (kam.md has the checks). Pick a **Strategic Growth** sub-market (for example Food > Snacks & Confections) for the first quote and a **Rationalization** one (for example Home Care > Pet Care) for the second. Fill the other required fields and **Submit**. | Both are submitted. Write the two quote numbers in Notes. | | |
| 3 | Admin | Scroll to **Preview on the open quotes** again. | A summary: how many open quotes, how many change tier, the average **Points moved**, the biggest rise and fall. A table with **Quote**, **Old tier**, **New tier**, **Points moved**, **What moved**, **Rank**. Each quote number shows its stage and its **Market › Sub-market**. Nothing is saved by looking. Quotes with no sub-market show 0 points moved. The two quotes from step 2b are in the table. | | |
| 4 | Admin | Open the row of each step-2b quote. Read **What moved**. | **Strategic fit (sub-market): 50 → 80** on the Strategic Growth quote and **50 → 20** on the Rationalization quote. The live model scores strategic fit at a neutral 50, and the draft weights it at 15, so the totals move about **+4.5** and **−4.5** points before rounding. A Selectively Participate sub-market (50) does not move. Does the direction match the 9-box (Strategic Growth up, Rationalization down)? Write any surprise in Notes. | | |
| 4a | Admin | Select the draft. In the model editor open **Strategic fit (where to play)** and open each points group. | **Scores by sub-market (27 listed).** A market with no scored sub-market scores 50: "Pick a sub-market to score strategic fit". Groups of **80**, **50** and **20** points, each listing its sub-markets as "Market › Sub-market". The list is read-only. Write any sub-market that sits in the wrong group in Notes (Jessica Ransburg and Seamus Keith may still disagree). | | |
| 4b | Admin | **Only if Ben staged the five golden quotes A to E** (the F-005 test quotes, in the sub-markets named here): compare each total. Otherwise skip, and use the direction check in step 4. | A Food > Snacks & Confections: 83 → **87.5** (Critical, no tier change). B Home Care > Pet Care: 26 → **21.5** (Low, no change). C Nutrition & Wellness > VMS: 59 → **63.5** (Standard → **High**). D Personal Care > Bath & Shower: 53 → **57.5** (Standard, no change). E Nutrition & Wellness > Liquid Supplements: 62 → **62** (High, no move). These are hand-worked in `calibration.test.ts` (PR #67). | | |
| 5 | Admin | Click **Activate v…**. Read the dialog. Then **Cancel**. **Do not activate in UAT.** | The dialog needs a reason (**Why are you making this change?**) and offers **Rescore the open quotes now** (ticked). After **Cancel**, the draft is still **Not active** and the live model is unchanged. | | |

## Part B: Leadership: read-only preview

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 6 | Leadership | **Admin** → **Scoring model**. Select the draft. | The same preview as the Admin sees in step 3. | | |
| 7 | Leadership | Look for **Activate v…** and **Discard draft**. | Neither is there. You can read, not change. | | |
| 8 | Leadership | Looking at the preview, does ranking by these points make sense for where Pretium wants to win? | Write your view in Notes. It goes to D-004. | | |

## Part C: Platform-minimum warning (switched on for this test)

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 9 | Admin | **Admin** → **App settings** → **Platform-minimum warning**. Set `enabled` to `true`. Save. | Saved. The minimums read ISBM 1,000,000, RHB 1,000,000, IMM (injection) 3,000,000, IBM 3,000,000, EBM 1,000,000 (corrected on Nov 9, PR #66). The change is in **Admin** → **Audit log**. | | |
| 10 | KAM | **New intake** from `<SF-OPP-30 chosen by Bailey>`. Fill the required fields with **Estimated annual volume (units)** = **750,000**. Go to **Review**. | Under the volume, and on the review step: "Below the platform minimum for our machine platforms: 750,000 units/yr. You can still submit." **Submit** is still available. | | |
| 11 | KAM | Change the volume to **1,500,000**. | The warning goes away (1,000,000 is the lowest minimum while the platform is unknown). Change it back to **750,000** and **Submit**. | | |
| 12 | Sales leader | Click **To qualify**. Click **Decide** on the quote from step 11. | The **Qualify & prioritize** dialog shows the same warning. Choose **Advance**: **Record decision** is enabled and no exception note is needed for the warning. **Cancel** (leave it at G1 for Part D). | | |

## Part D: Volume-band routing (switched on for this test)

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 13 | Admin | **Admin** → **App settings** → **Volume-band routing at intake**. Set `enabled` to `true`, `metric` `est_annual_volume`, `min` 1000000, `max` empty. Save. | Saved. (It refuses if the G1 qualify gate is off: "Turn the G1 qualify gate on first…".) | | |
| 14 | KAM | **New intake** from `<SF-OPP-31 chosen by Bailey>` with **Estimated annual volume (units)** = **2,000,000**. Submit. | The quote goes **straight to Engineering Review**. It does not wait at G1. | | |
| 15 | Sales leader | Click **To qualify**. | The step-14 quote is **not** in the G1 queue. Quotes under 1,000,000 a year that are submitted while routing is on wait at G1, and the arrival notice says the volume was outside the band. | | |
| 16 | Admin | **Admin** → **Audit log**. Filter **Action** for routing. | Each routed submit is listed with the reason (in or outside the band). | | |

## Part E: Admin: switch both off again (do not skip)

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 17 | Admin | Set **Volume-band routing at intake** `enabled` to `false`. Save. Then set **Platform-minimum warning** `enabled` to `false`. Save. | Both saved. A new intake under 1,000,000 a year shows no warning and goes to G1 as before. Quotes already submitted keep their warning text on the quote. | | |
| 18 | Admin | **Admin** → **Scoring model**. | The live model is unchanged. The draft is still **Not active**. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Admin | | | |
| | Leadership | | | |
| | Sales leader | | | |
| | KAM | | | |
