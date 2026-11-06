# UAT script: Final Review approver

| | |
|---|---|
| Session | **U3**, Wed Nov 11 (2 h). Run by Bailey Schmitt. |
| Tester role | Final Review approver, the G4 decider (app role `CCQ.Approver`). Names still open (D-10). |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft** with your Pretium account. Your account must be in **`SG-CCQ-Approver`**. |
| Devices | **Your phone** for Parts A and B. A laptop for Part C. |
| Before you start | Ben has staged the quotes below in **Final Review**, with the price approved, capital readiness recorded and the terms checked (unless noted). |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Write the step number in the description. |

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<CCQ-FR-2>` … `<CCQ-FR-5>` | Four quotes in Final Review, staged by Ben from `<SF-OPP-23..26 chosen by Bailey>` |
| `<CCQ-FR-6>` | A quote in Final Review with **Terms checked** not done, and a tooling commitment (so Legal review applies) |
| `<CCQ-FR-KAM>` | A quote in Final Review where **you** are the KAM (staged by Ben) |
| `<CCQ-FR-PRICE>` | A quote in Final Review whose price **you** approved (Ben gives you the Pricing role for one step, then removes it) |

Labels for stages, outcomes and reasons are provisional configuration. Note a wrong meaning, not a different wording.

## Part A: The queue on a phone

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | On your phone, open the email "[QuoteFlow] CCQ-… needs your review". | It names the quote, account, product and tier, with a link. It has **no** price, margin or capital amount. | | |
| 2 | Tap the link and sign in. | Home **Approvals** ("Quotes waiting for your final review decision.") with **Pending final review (G4)** and **Decided recently**. Bottom tabs: **Home**, **Pipeline**, **Approvals**, **Analytics**. | | |
| 3 | Tap **Approvals**. | Tab **Final Review**: "Quotes Pricing has submitted, highest tier first…". Chips: **Waiting**, **Capital required / with risk (G2)**, **Capital pending**, **You can decide**. | | |
| 4 | Read one card. | It shows **Price approval**, **Capital readiness**, **Engineering (G2)**, **KAM** and **Pricing approver**, and a **Review & decide** button. | | |
| 5 | Tap **Review & decide** on `<CCQ-FR-2>`. | The Final Review page: **The request**, **Priority (advisory)**, **Engineering solution and capacity evidence**, **Price approval**, **Capital readiness**, a read-only **Terms and Legal** section, the files, **Decisions so far**. If anything is open it shows **Open warnings (n)** at the top. A decision bar stays at the bottom. | | |
| 6 | Read the figures. | You see the budgetary capital estimate, the capacity numbers (utilization before and after), the pricing basis and range. Everything fits the screen with no sideways scroll. | | |

## Part B: Decide on a phone

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 7 | On `<CCQ-FR-2>` tap **Advance (release the offer)**. | The dialog says approving is internal: it releases the proposition to Customer Decision and does not award the quote. **Proposal issued (defaults to now)** and "Valid until <date> (30 days from the issue date, provisional)". | | |
| 8 | Set **Proposal issued** to tomorrow. Tap **Record decision**. | Refused: "The proposal issue date can’t be in the future…". | | |
| 9 | Set it back to now. Tap **Record decision**. | "Advance (release the offer) recorded". The stage is **Customer Decision**, not Awarded. The KAM and the pricing approver are notified. | | |
| 10 | Open `<CCQ-FR-3>`. Tap **Stop (withdraw)**. Tap **Record decision** with no reason and no note. | "Choose a reason." and "Add a note." | | |
| 11 | Pick a reason (for example **Capacity unavailable**) and type a note. **Record decision**. | The quote closes as **Declined**. The KAM and Pricing are notified. | | |
| 12 | Open `<CCQ-FR-4>`. Tap **Rework (back to the affected gate)**. | **Send back to (required)** offers the earlier stages (Quoting, Engineering Review). A reason and a note are required. | | |
| 13 | Pick **Quoting**, type a note, **Record decision**. | The quote is back in **Quoting** as a new version. Pricing is told. | | |
| 14 | Open `<CCQ-FR-5>`. Tap **Hold**. Pick a reason, **Review date (required)** and the hold owner. Leave the note empty and record, then add a note. | A note is required. "On hold until <date> · owner <name>". It stays in Final Review. The KAM is told. | | |

## Part C: Rules that must stop you (negative checks)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 15 | Open `<CCQ-FR-6>` (terms not checked, tooling commitment, no Legal review). Read **Open warnings (n)** and the **Terms and Legal** section. Tap a link **Open the Commercial panel**. | Two warnings: the terms are not checked, and the Legal review is not recorded (Legal review is optional). Each has a link to the quote's Commercial panel. **Terms and Legal** shows the terms and the tooling commitment read-only: you cannot edit them here. | | |
| 16 | On `<CCQ-FR-6>` tap **Advance (release the offer)** and **Record decision**. | **Nothing owned by another role blocks you.** The offer is released with the warnings recorded on the decision. (Ben may switch the terms check on as a blocker in **Admin → Settings → g4_required_checks**: then the release step is refused with the check named. Note which setting you tested.) | | |
| 17 | Open the released quote → **Overview** → **Commercial terms**. | Terms and the capital flag are now read-only: "Locked after G4 · decided by <you> on <date>". The KAM and Pricing cannot edit them. | | |
| 18 | Open `<CCQ-FR-KAM>`. | No decision buttons. The bar says "You cannot decide Final Review on a quote where you are the KAM". | | |
| 19 | Open `<CCQ-FR-PRICE>`. | No decision buttons. The bar says "You cannot decide Final Review on a quote whose price you approved or submitted". | | |
| 20 | Open a quote that is not in Final Review and type `/review` after its address. | "No decision is waiting on this quote." | | |
| 21 | Look for **Record price approval**, **Save terms** or a gate button for G1, G2, G3 or G5 on any quote. | None. Approvers only decide G4. | | |
| 22 | Check **Home** → **Decided recently**. | Your decisions from Part B are listed. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Approver | | | |
| | Approver | | | |
