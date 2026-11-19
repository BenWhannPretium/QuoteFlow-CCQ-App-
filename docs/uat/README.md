# QuoteFlow UAT pack (B-23)

> Checked against the build on 2026-11-17 (pre-release audit): every script and quick-start was walked against the app's source and Playwright specs; the block below says what changed and where the Production scheduler and Finance roles are tested.

This folder is what testers use in UAT week (Mon Nov 9 to Fri Nov 13). Bailey Schmitt runs the sessions. Ben Whann fixes. Tre Curry coordinates.

> **Pilot-group UAT runs Nov 13 to Nov 20, 2026** (Ben, 2026-11-10). The sessions below (U0 to U6, Nov 9 to 13) come first. Before the pilot, Claude Code also runs a dry run of every script against a local copy of the app; its reports are in [`dry-run/`](dry-run/README.md). That does not replace the pilot or any sign-off.

> **Source of truth.** The `.md` files are the source. `quickstart/print.html` is a hand-made printable copy of the quick-starts. When you change a quick-start `.md`, change `print.html` the same way.

> **Updated 2026-11-06 for the feedback builds (FB-01 to FB-05) and for the rule that every role sees commercial figures.** Changes testers will notice:
> - **Intake:** the customer is the Salesforce Account (no new-customer form), a destination city and state are required, two needed-by dates replace the close date, the neck is three lists, and a quote with no drawing needs the minimum spec (KAM script Parts B and C).
> - **Priority:** only a sales leader overrides the tier, and it applies at once with a reason (KAM Part E, sales-leader Part D).
> - **Sections lock** after G2, G3 and G4 until a send-back reopens them (engineering Part C, pricing Part D, KAM Part H).
> - **Pricing sends back to the KAM** (G3), and the KAM answers whether the scope changed (pricing step 22, KAM Part F).
> - **Lead review:** engineers and pricers submit to their lead, who decides or sends back (engineering Part C, pricing Part D).
> - **Capacity evidence:** utilization before and after, calculated; no buffer; CSV export (engineering Part B).
> - **Final Review:** open terms or Legal checks are warnings, not blockers (approver Part C).
> - **Notifications** for hand-offs, returns, holds, closures and comments (KAM Part I).
> - **No hidden figures:** every role that can read a quote sees pricing, margin and capital (KAM Part H, pricing Part E, security-access Parts C and E).
>
> Labels in the scripts come from the app's code as built; Ben re-checks them against the test site before Nov 9.

> **Updated 2026-11-19 for FB-31 (Nov 19 feedback: commercial terms governance).** Changes testers will notice:
> - **Who approves payment terms (N19-07, provisional guess):** Net 45 still goes to the pricing lead; Net 60, Net 90, Net 120 and Other go to **Leadership** (standing in for the CFO), who can approve only once a **supporting document** (Payment-terms approval) is attached on the Commercial terms tab. The intake and the tab say who must approve. Open Net 60+ requests now wait for Leadership (kam steps 132–136, leadership steps 33–36).
> - **Tooling funding (N19-08):** four choices: **Customer funded (lump sum)**, **Customer funded (amortized)**, **Pretium funded**, **To be determined**. **$0 CER** and **Shared** are no longer offered (old quotes keep them, marked "(no longer offered)"). Amortized needs a **finance review** sign-off by Leadership in Final Review before release (kam steps 133–134, leadership step 37).
> - **Stock wording (N19-10):** "Does the customer have inventory or safety stock requirements?" (kam steps 109, 135).

> **Updated 2026-11-18 for FB-21 (feedback of Nov 17 and 18: capital readiness, payback on request, the pricer's hand-off).** Changes testers will notice:
> - **Capital readiness is filled in** when a quote reaches Quoting: pending when Engineering's budgetary capital is above $0 (or blank), not required at $0. **Pending is normal before award** and never stops the price approval; the pending note is optional. **Not approved** means stop: the pricing lead cannot advance it (pricing steps 10, 12, 14, 15, 47, 48, 58, 64 and 65; engineering steps 92 and 94; approver step 23a).
> - **Payback only on request.** **2. Payback** reads **Not requested** until the assigned pricer or the pricing lead clicks **Ask Finance for a payback model**. Finance is told then (not on a costing upload); the price waits for Finance's upload only while the request is open; **Withdraw request** needs a reason (pricing steps 8b, 20a, 21, 59 to 61 and 63; finance Part A; security-access step 21c, the new permission `payback.request`).
> - **Submit at the top.** The assigned pricer also has **Submit to pricing lead** at the top of the Quoting tab, or a line saying what is still missing; a pricing lead may price a quote assigned to themselves and approve it (pricing steps 58, 62 and 66).
> - **Quoting tab order.** Engineering's hand-over comes first, and each model upload says "Excel workbook (.xlsx), up to 100 MB" (pricing steps 7, 8a and 59; finance step 4).
> - This replaces two lines of the FB-17 block below: a payback model is no longer needed for every quote with capital, and capital no longer has to be pre-approved before the price is approved.

> **Updated 2026-11-17 (pre-release audit, FB-15 to FB-20 as built).** Changes testers will notice:
> - **Button names.** One name per decision: **Qualify quote**, **Decide feasibility**, **Decide price approval**, **Record customer decision**, **Commit and hand off**. Engineers click **Start review**; the row menus read **Assign engineer** and **Assign pricer**. The gate names (for example "Feasible solution?") still show in the timeline.
> - **Nothing moves forward half-done.** **Submit to engineering lead** / **Submit to pricing lead** and the lead's decision button appear only when nothing is missing; until then the bottom of the tab lists what is. A decision that is still blocked switches **Record decision** off and says what is missing.
> - **Stage name.** Stage 2 is **Engineering & Capacity** in every script.
> - **Several items in one quote (FB-19):** KAM Part K, engineering Part J, approver step 34a, tie-out step 29.
> - **Offer letter (FB-20):** KAM Part L (who may generate, when it is ready, the download; nothing is sent from QuoteFlow).
> - **Production scheduler (FB-16, provisional):** no script of its own. It is tested in `scripts/engineering.md` **Part H** (steps 76 to 88) and `scripts/security-access.md` steps 14a and 21b; its quick-start is `quickstart/production-scheduler.md`.
> - **Finance:** `scripts/finance.md` (uploads the payback model, nothing else; since FB-21, when asked) and `scripts/security-access.md` steps 14a and 21a; its quick-start is `quickstart/finance.md`.
> - The Finance and Production scheduler roles have no **Report an issue** button: they tell Ben or Bailey.

> **Updated 2026-11-15 for FB-17 (walkthrough of Nov 13).** Changes testers will notice:
> - **Four choices.** Every decision dialog (except the customer's decision) offers **Advance**, **Send back to…**, **Hold** and **Stop**. **Send back to…** asks where the quote goes and always needs a reason and a note. "Rework" and "Redirect" are gone as names; at qualification "Redirect (not CCQ work)" is **Stop: not CCQ work (send elsewhere)** (sales-leader steps 9 to 15, engineering steps 36 to 40 and Part I, pricing steps 22 to 26 and Part H, approver steps 12 to 14).
> - **Capital.** **Advance – capital required** is gone. Engineering enters the capital estimate on every quote ($0 when none); above $0 the quote needs the equipment BOM, is flagged capital likely and needs the payback model, and capital must be pre-approved before the price is approved (FB-21 changed both: see the 2026-11-18 block above) (engineering steps 36 and 91 to 94, pricing steps 46 to 48, finance step 2, approver step 23).
> - **Holds.** The hold owner starts on the person working the stage and is told; the header and the timeline say why, who owns it and the review date (engineering steps 37 and 97, pricing step 26).
> - **Stop** asks for no closure owner, and the **Why?** score explanation stays on a laptop screen (engineering step 98).

> **Updated 2026-11-10 for FB-06 and FB-10.**
> - **FB-06 (engineering):** `engineering.md` step 36 now expects the equipment BOM before "Capital required", and a new **Part E** (steps 48–54) covers the engineer suggestions, removing a BOM, the lock after G2, the two-step and pack-out limits, and the **From engineering** card. Pricing checks that card in `pricing.md` **Part F** (steps 33–34), approvers in `approver.md` **Part D** (step 23).
> - **FB-10 (priority calibration):** new script `scripts/priority-calibration.md` (session **U3b**). The Admin preview of the draft scoring model, Leadership's read-only view, and the platform-minimum warning and volume-band routing, which an Admin switches on for the test and **off again** at the end.

> **Updated 2026-11-10 for FB-08, FB-09, FB-12 and FB-13.** Changes testers will notice:
> - **"Other" rule (FB-09):** a KAM who picks **Other** for **Resin**, **PCR %** or **Additive** must type the customer's own value, and Engineering, Pricing and Final Review read it. The resin list is Danielle Leu's and approved; PCR and additive are provisional. A new packaging **Other** note is capped at 500 characters (KAM script steps 10a–10e and 13e, engineering Part G steps 62–65, pricing step 43, approver step 34).
> - **Market and Sub-market (FB-12):** eight markets replace the old five. The KAM then picks a **Sub-market** of that market (optional; changing the market clears it). It shows as "Market › Sub-market" on the quote, in Final Review and in Engineering's product facts. The draft scoring model now scores by sub-market, and every open quote previews at the neutral 50 until KAMs pick one (KAM steps 9a–9c, engineering step 66, pricing step 44, approver step 33, priority-calibration steps 2a–4b).
> - **Plants and machine types (FB-13):** Jim Zweifel's 22 plants and 14 machine types replace the placeholders. An old quote on a retired value still opens and reads "(no longer offered)" (engineering Part F, steps 55–61; already in the script from the FB-13 pull request).
> - **Funding and MOQ are Engineering's (FB-08):** the assigned engineer or the lead enters the **Tooling funding model** and **MOQ** on the quote (engineering steps 69–73). Pricing and the KAM read them (pricing step 16, finance Part C).
> - **Payment terms and exceptions (FB-08):** payment terms are a list. Anything other than Net 15 or Net 30 goes to the pricing lead as an exception, who approves or rejects it with a rationale (pricing steps 35–40).
> - **Capital terms (FB-08):** Sales and Pricing pre-fill them (pricing steps 41–42). The approver edits and **confirms** them on the Final Review screen, and cannot release the offer without that or while an exception is waiting or rejected. The terms then lock at G4 (approver Part E, steps 24–32; steps 15–16 and 17 changed).
> - **Extra customer-funded approval (FB-08):** ships **off**. `approver.md` **Part G** (steps 35–41) is **optional**: an Admin switches it on for the test and **off again** at step 41. The sales leader signs, then leadership (leadership step 28, sales-leader step 36).
> - **Platform minimums (priority calibration):** corrected on Nov 9 to ISBM 1M, RHB 1M, injection (IMM) 3M, IBM 3M, EBM 1M a year; the script's numbers match the test site.
> - **Security:** FB-08 added four permissions and two quote-child tables with row-level security (security-access steps 22a–22e and 28a). FB-09, FB-12 and FB-13 changed no permission.
> - **Finance:** the `CCQ.Finance` app role and `SG-CCQ-Finance` group now exist. Ben adds the Finance testers to the group before U3.
> - **Retest:** the KAM and sales-leader scripts ran on Mon Nov 9, before FB-09 and FB-12 were built. The new steps are there for a retest and for the record (KAM script, sales-leader steps 7, 7a and Part F).
>
> Labels come from the code as built, the Playwright specs and the build notes. Where the wording of a refusal was not fixed in the code (for example the message when capital terms are not confirmed), the step says so and asks the tester to write it in Notes.

## What is in the pack

| Path | What it is |
|---|---|
| `scripts/*.md` | One UAT script per role. Numbered steps with the expected result, a Pass/Fail column and a sign-off table. |
| `quickstart/*.md` | One printed page per role: what QuoteFlow is for you, your Command Center (the home screen), what you'll do, what changed from the ERF, who to ask. |
| `quickstart/print.html` | All quick-starts in one file, one role per printed page. Open it in a browser and print. |
| `defect-log.md` | The defect log. **Generated** from the in-app reports by `pnpm uat:defects`. Do not edit it by hand. It is git-ignored: report text can name customers, so it is shared on the QuoteFlow SharePoint, not committed. |

## Test environment

- URL: **https://quoteflow-test.azurewebsites.net**
- Sign in with **Sign in with Microsoft** and your Pretium account. What you see depends on your `SG-CCQ-*` group.
- Ask Tre Curry if you can't sign in ("No QuoteFlow access yet" means you are not in a group yet).
- The scripts use placeholders such as `<SF-OPP-1 chosen by Bailey>` and `<CCQ-CD-1 staged by Ben>`. Bailey picks the real production opportunities. Ben stages the quotes each session needs. Both fill a copy of each script before the session.
- Stage, gate, outcome and reason-code labels are configuration and still **provisional**. A different wording is not a failure. A wrong meaning is.

## Session map

| Session | When | Script(s) | Testers (personas) | Groups |
|---|---|---|---|---|
| **U0** kickoff | Mon Nov 9, 9:00 (45 min) | This README, the quick-starts | All testers | All |
| **U1** | Mon Nov 9 (2 h) | `scripts/kam.md`, `scripts/sales-leader.md` | Jordan Albin and 1–2 KAMs (e.g. Linda Vinegar, Josh Edmonson); a sales leader (Matt Graden or Jack Gordon's delegate) | `SG-CCQ-KAM`, `SG-CCQ-SalesLeader` |
| **U2** | Tue Nov 10 (2 h) | `scripts/engineering.md` (Part H: the Production scheduler, FB-16) | Jim Zweifel's team (lead and engineers), Faron Ipox (capacity) | `SG-CCQ-EngLead`, `SG-CCQ-Engineer`, `SG-CCQ-ProductionScheduler` (once IT has created it) |
| **U3** | Wed Nov 11 (2 h) | `scripts/pricing.md`, `scripts/finance.md` (FB-07), `scripts/approver.md`, `scripts/leadership.md` | Gemma Cebolla and a pricing analyst, the pricing lead; Stacy Slocum (Finance, payback model); the Final Review approver candidate(s) (D-10); leadership | `SG-CCQ-Pricing`, `SG-CCQ-PricingLead`, `SG-CCQ-Finance`, `SG-CCQ-Approver`, `SG-CCQ-Leadership` |
| **U3b** | Wed Nov 11 (30 min), after U3 | `scripts/priority-calibration.md` (FB-10) | Ben (Admin), the U3 leadership tester, a sales leader and a KAM (test accounts if the U1 testers are not free) | `SG-CCQ-Admin`, `SG-CCQ-Leadership`, `SG-CCQ-SalesLeader`, `SG-CCQ-KAM` |
| **U4** | Wed Nov 11 (60 min) | `scripts/security-access.md` | IT security delegate, with Ben | One test account per group, plus one in no group |
| **U5** | Thu Nov 12 (45 min) | `scripts/tie-out.md` | Zac Cairns, Graham Parle, D&A (Brennan Paul's engineer), with Ben | `SG-CCQ-Admin` (Ben); a non-commercial D&A account |
| **U6** sign-off | Fri Nov 13, 10:00 (45 min) | The signed sign-off tables of every script, plus `defect-log.md` | Darren Miller, Bailey, Tre, Ben, gate-owner candidates (Jim, Gemma, the approver), Oliver Kade / IT | — |

Admins (`SG-CCQ-Admin`: Ben, Tre, and Bailey as interim Knowledge Steward) use `quickstart/admin.md`. There is no separate admin script: the admin screens are covered in `leadership.md` (read-only), `security-access.md` and `tie-out.md`.

## How to test

1. Do the steps in order. Some steps depend on another script (they say which).
2. Mark **Pass** when the result matches. Mark **Fail** when it doesn't, and report it.
3. Write what you saw in **Notes**, even on a pass, when something felt slow or unclear.
4. Sign the table at the end of your script.

## How to report an issue

Use the **Report an issue** button. It is in your user menu (your initials, top right) and at the bottom of every page. (Finance and Production scheduler testers have no such button: tell Ben or Bailey.)

1. **What kind of issue?** Something is broken (bug), Something is confusing, Something is missing, An idea.
2. **How bad is it?** Severity 1 to 4 (rules below).
3. **What happened?** Write the script and step number, what you did, what you expected and what you saw.
4. **Screenshot (optional).** **Capture screen** where the browser allows it, or **Upload image**. Only QuoteFlow admins see screenshots. Avoid capturing other apps.
5. Click **Send report**.

QuoteFlow adds the context for you: the page, the quote number, the app version, your role and your browser.

Admins triage reports at **Admin → Feedback** (`/admin/feedback`). Each report gets a status (New, Triaged, Fixing, Fixed, Won't fix), an owner and a link to its GitHub issue.

## Severity rules

| Severity | Means | Example | Fix by |
|---|---|---|---|
| **Sev-1** | Blocks a core flow | You can't submit an intake, decide a gate, or sign in | **Thu Nov 12** |
| **Sev-2** | Wrong data or permission | A KAM can change a price approval; a count doesn't match Salesforce; a decision is allowed that shouldn't be | **Thu Nov 12** |
| **Sev-3** | Usability | A label is unclear; a step takes too many clicks | P1 backlog, unless trivial |
| **Sev-4** | Cosmetic | Alignment, spelling, colour | P1 backlog, unless trivial |

- Every Sev-1 and Sev-2 is fixed and retested before U6 sign-off.
- Sev-3 and Sev-4 go to the P1 backlog unless the fix is trivial.
- If you are not sure, pick the higher severity. Triage will adjust it.

## Daily triage

- Every UAT day at **4:00 PM**, 15 minutes: Bailey, Ben, Tre.
- Go through the new reports in **Admin → Feedback**. Set severity, owner and status.
- Then run `pnpm uat:defects` (with `DATABASE_URL` pointing at the UAT database, as the migration login) to regenerate `docs/uat/defect-log.md`, and upload it to the QuoteFlow SharePoint folder. Don't commit it (rule 8: report text can name customers). The log is part of the Gate 5 package.

## Quick-start help page

The quick-starts are linked from every Command Center ("New here?", on **My work**), served at `/help/quickstart.html#<role>` from `apps/web/public/help/`. After editing `quickstart/print.html`, run `UPDATE_QUICKSTART=1 pnpm --filter @ccq/web test` to republish it (a test fails until you do).

