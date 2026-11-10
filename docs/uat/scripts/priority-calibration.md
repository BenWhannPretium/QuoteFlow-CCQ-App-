# UAT script: Priority calibration (FB-10)

| | |
|---|---|
| Session | **U3b**, Wed Nov 11 (30 min), straight after `leadership.md`. Run by Ben Whann (Admin) with Bailey Schmitt. |
| Tester roles | Admin (`CCQ.Admin`: Ben); Leadership (`CCQ.Leadership`: the U3 leadership tester); a sales leader (`CCQ.SalesLeader`); a KAM (`CCQ.KAM`). The sales leader and KAM can be test accounts Ben signs in as, if the U1 testers are not free. |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft**. Each tester must be in the group for their role (`SG-CCQ-Admin`, `SG-CCQ-Leadership`, `SG-CCQ-SalesLeader`, `SG-CCQ-KAM`). |
| Before you start | There are open quotes from U1–U3. **Both FB-10 switches are off** on the test site (`intake_guardrails` and `g1_volume_routing`), and the **G1 qualify gate is on**. Ben switches them on in Part C and **must switch them off again in Part E**. |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Write the step number in the description. |

**What FB-10 is.** Nothing here changes how live quotes are ranked. FB-10 built:
- a **draft** scoring model with strategic-fit points from the Where-to-Play 9-box, and a **preview** that compares it with the live model on the open quotes;
- a **platform-minimum warning** at intake that never blocks;
- **volume-band routing** at intake.

The warning and the routing are switched off; the draft is inactive. D-004 (weights, points, bands) is still open, so every number here is **provisional**. Note a wrong meaning, not a different number.

**Values on the test site.**
- Platform minimums: Danielle Leu's corrected table of Nov 9 (ISBM 1M, RHB 1M, Injection 3M, IBM 3M, EBM 1M units a year). While the platform is not known at intake, the lowest (1,000,000) applies.
- The draft scores strategic fit **by market** (FB-10). If **FB-12** has merged, it scores **by sub-market** instead (Strategic Growth 80, Selectively Participate 50, Rationalization 20). Steps 3 and 4 say what to expect in each case.

**Data (placeholders)**

| Placeholder | What it is |
|---|---|
| `<SF-OPP-30 chosen by Bailey>`, `<SF-OPP-31 chosen by Bailey>` | Two open Salesforce opportunities the KAM owns, for two short intakes |

## Part A: Admin: the draft and the preview

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 1 | Admin | **Admin** → **Scoring model**. | Page **Scoring model**. The live model is **Active**. A **Draft** version is listed, provisional and **Not active**. | | |
| 2 | Admin | Select the draft. Compare its weights and tiers with the active model. | Weights and tiers are the same as the live model's. Only **Strategic fit** differs (it has points). | | |
| 3 | Admin | Scroll to **Preview on the open quotes**. | A summary: how many open quotes, how many change tier, the average **Points moved**, the biggest rise and fall. A table with **Quote**, **Old tier**, **New tier**, **Points moved**, **What moved**, **Rank**. Nothing is saved by looking. *With FB-12 merged:* quotes with no sub-market show 0 points moved. | | |
| 4 | Admin | Open a row whose points moved. Read **What moved**. | **Strategic fit (where to play)** (or "strategic fit (sub-market)" with FB-12), with the market (or sub-market) that set it. Does the direction match the 9-box (Strategic Growth up, Rationalization down)? Write any surprise in Notes. | | |
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
| 9 | Admin | **Admin** → **App settings** → **Platform-minimum warning**. Set `enabled` to `true`. Save. | Saved. The minimums read ISBM 1,000,000, RHB 1,000,000, IMM 3,000,000, IBM 3,000,000, EBM 1,000,000. The change is in **Admin** → **Audit log**. | | |
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
