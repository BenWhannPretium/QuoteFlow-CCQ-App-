# QuoteFlow UAT pack (B-23)

This folder is what testers use in UAT week (Mon Nov 9 to Fri Nov 13). Bailey Schmitt runs the sessions. Ben Whann fixes. Tre Curry coordinates.

> **Source of truth.** The `.md` files are the source. `quickstart/print.html` is a hand-made printable copy of the quick-starts. When you change a quick-start `.md`, change `print.html` the same way.

## What is in the pack

| Path | What it is |
|---|---|
| `scripts/*.md` | One UAT script per role. Numbered steps with the expected result, a Pass/Fail column and a sign-off table. |
| `quickstart/*.md` | One printed page per role: what QuoteFlow is for you, your home screen, what you'll do, what changed from the ERF, who to ask. |
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
| **U2** | Tue Nov 10 (2 h) | `scripts/engineering.md` | Jim Zweifel's team (lead and engineers), Faron Ipox (capacity) | `SG-CCQ-EngLead`, `SG-CCQ-Engineer` |
| **U3** | Wed Nov 11 (2 h) | `scripts/pricing.md`, `scripts/approver.md`, `scripts/leadership.md` | Gemma Cebolla and a pricing analyst, the pricing lead; the Final Review approver candidate(s) (D-10); leadership | `SG-CCQ-Pricing`, `SG-CCQ-PricingLead`, `SG-CCQ-Approver`, `SG-CCQ-Leadership` |
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

Use the **Report an issue** button. It is in your user menu (your initials, top right) and at the bottom of every page.

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
| **Sev-2** | Wrong data or permission | A KAM sees a price figure; a count doesn't match Salesforce; a decision is allowed that shouldn't be | **Thu Nov 12** |
| **Sev-3** | Usability | A label is unclear; a step takes too many clicks | P1 backlog, unless trivial |
| **Sev-4** | Cosmetic | Alignment, spelling, colour | P1 backlog, unless trivial |

- Every Sev-1 and Sev-2 is fixed and retested before U6 sign-off.
- Sev-3 and Sev-4 go to the P1 backlog unless the fix is trivial.
- If you are not sure, pick the higher severity. Triage will adjust it.

## Daily triage

- Every UAT day at **4:00 PM**, 15 minutes: Bailey, Ben, Tre.
- Go through the new reports in **Admin → Feedback**. Set severity, owner and status.
- Then run `pnpm uat:defects` (with `DATABASE_URL` pointing at the UAT database, as the migration login) to regenerate `docs/uat/defect-log.md`, and upload it to the QuoteFlow SharePoint folder. Don't commit it (rule 8: report text can name customers). The log is part of the Gate 5 package.

## Known gaps found while writing the pack

The quick-starts are linked from every home screen ("New here?"), served at `/help/quickstart.html#<role>` from `apps/web/public/help/`. After editing `quickstart/print.html`, run `UPDATE_QUICKSTART=1 pnpm --filter @ccq/web test` to republish it (a test fails until you do).

- The **Analytics** page does not show the "operational, not certified" label. The Usage report and ERF linkage pages do. See `scripts/leadership.md` step 11.
- The quote page does not show the Salesforce opportunity id. The tie-out reads it from **Admin → ERF linkage**.
