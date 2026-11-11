# UAT script: Final Review approver

| | |
|---|---|
| Session | **U3**, Wed Nov 11 (2 h). Run by Bailey Schmitt. |
| Tester role | Final Review approver, the G4 decider (app role `CCQ.Approver`). Names still open (D-10). |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | Click **Sign in with Microsoft** with your Pretium account. Your account must be in **`SG-CCQ-Approver`**. |
| Devices | **Your phone** for Parts A and B. A laptop for Part C. |
| Before you start | Ben has staged the quotes below in **Final Review**, with the price approved, capital readiness recorded, the terms checked and **the capital terms already confirmed** (unless noted), so Parts A to C test the decision itself. Part E tests confirming the capital terms. |
| How to log a problem | Use **Report an issue** (user menu, or the page footer). Write the step number in the description. |

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<CCQ-FR-2>` … `<CCQ-FR-5>` | Four quotes in Final Review, staged by Ben from `<SF-OPP-23..26 chosen by Bailey>` |
| `<CCQ-FR-6>` | A quote in Final Review with **Terms checked** not done, and a tooling commitment (so Legal review applies) |
| `<CCQ-FR-CAP>` | A quote in Final Review whose capital terms are **not confirmed**: the KAM pre-filled only **Mold ownership**, and the **Funding model** is **Not discussed** (staged by Ben). Part E |
| `<CCQ-FR-EXC>` | A quote in Final Review with a **Net 60** payment-terms exception **waiting** for the pricing lead (staged by Ben; the pricing lead decides it in step 30) |
| `<CCQ-FR-OTHER>` | A quote in Final Review whose KAM picked **Other** for **Resin**, **PCR** and **Additive** and chose a Market and Sub-market (staged by Ben). Part F |
| `<CCQ-FR-CF>`, `<CCQ-FR-CO>` | Two quotes in Final Review with the capital terms confirmed: **CF** is **Customer-funded**, **CO** is **Company-funded**. Only for the optional Part G |
| `<CCQ-FR-KAM>` | A quote in Final Review where **you** are the KAM (staged by Ben) |
| `<CCQ-FR-PRICE>` | A quote in Final Review whose price **you** approved (Ben gives you the Pricing role for one step, then removes it) |

Labels for stages, outcomes and reasons are provisional configuration. Note a wrong meaning, not a different wording.

## Part A: The queue on a phone

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | On your phone, open the email "[QuoteFlow] CCQ-… needs your decision: Final Review". | It names the quote, account, product and priority tier, with a link. It has **no** price, margin or capital amount. | | |
| 2 | Tap the link and sign in. | Home **Approvals** ("Quotes waiting for your final review decision.") with **Pending final review (G4)** and **Decided recently**. Bottom tabs: **Home**, **Pipeline**, **Approvals**, **Analytics**. | | |
| 3 | Tap **Approvals**. | Tab **Final Review**: "Quotes Pricing has submitted, highest tier first…". Chips: **Waiting**, **Capital required / with risk (G2)**, **Capital pending**, **You can decide**. | | |
| 4 | Read one card. | It shows **Price approval**, **Capital readiness**, **Engineering (G2)**, **KAM** and **Pricing approver**, and a **Review & decide** button. | | |
| 5 | Tap **Review & decide** on `<CCQ-FR-2>`. | The Final Review page: **The request**, **Priority (advisory)**, **Engineering solution and capacity evidence**, **Price approval**, **Capital readiness**, a **Terms and Legal** section (the terms are read-only; the capital terms are yours to edit and confirm, Part E), the files, **Decisions so far**. If anything is open it shows **Open warnings (n)** at the top. A decision bar stays at the bottom. | | |
| 6 | Read the figures. | You see the budgetary capital estimate, the capacity numbers (utilization before and after), the pricing basis and range. Everything fits the screen with no sideways scroll. | | |

## Part B: Decide on a phone

Steps 7 to 9 assume the capital terms on `<CCQ-FR-2>` are already confirmed (see **Before you start**). If the release is refused for the capital terms, do Part E step 27 first, then continue.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 7 | On `<CCQ-FR-2>` tap **Advance (release the offer)**. | The dialog says approving is internal: it releases the proposition to Customer Decision and does not award the quote. **Proposal issued (defaults to now)** and "Valid until <date> (30 days from the issue date, provisional)". | | |
| 8 | Set **Proposal issued** to tomorrow. Tap **Record decision**. | Refused: "The proposal issue date can’t be in the future…". | | |
| 9 | Set it back to now. Tap **Record decision**. | "Advance (release the offer) recorded". The stage is **Customer Decision**, not Awarded. The KAM and the pricing approver are notified. | | |
| 10 | Open `<CCQ-FR-3>`. Tap **Stop (withdraw)**. Tap **Record decision** with no reason and no note. | "Choose a reason." and "Add a note." | | |
| 11 | Pick a reason (for example **Capacity unavailable**) and type a note. **Record decision**. | The quote closes as **Declined**. The KAM and Pricing are notified. | | |
| 12 | Open `<CCQ-FR-4>`. Tap **Rework (back to the affected gate)**. | **Send back to (required)** offers the earlier stages (Quoting, Engineering Review). The note is required. The reason is **optional** (it reads "Reason (optional)"). | | |
| 13 | Pick **Quoting**, type a note, **Record decision**. | The quote is back in **Quoting** as a new version. Pricing is told. | | |
| 14 | Open `<CCQ-FR-5>`. Tap **Hold**. Pick a reason, **Review date (required)** and the hold owner. Leave the note empty and record, then add a note. | A note is required. "On hold until <date> · owner <name>". It stays in Final Review. The KAM is told. | | |

## Part C: Rules that must stop you (negative checks)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 15 | Open `<CCQ-FR-6>` (terms not checked, tooling commitment, no Legal review, capital terms confirmed). Read **Open warnings (n)** and the **Terms and Legal** section. Tap a link **Open the Commercial panel**. | Two warnings: the terms are not checked, and the Legal review is not recorded (Legal review is optional). Each has a link to the quote's Commercial panel. **Terms and Legal** shows the payment terms and the tooling commitment read-only: you cannot edit them here. Only the **Capital terms** form has fields you can change (Part E). | | |
| 16 | On `<CCQ-FR-6>` tap **Advance (release the offer)** and **Record decision**. | **The terms check and the Legal review do not block you.** The offer is released with the warnings recorded on the decision. A payment-terms exception that is waiting or rejected, and capital terms that are not confirmed, **do** block you (Part E). (Ben may switch the terms check on as a blocker in **Admin → App settings → Final Review**, the setting `g4_required_checks`: then the release step is refused with the check named. Note which setting you tested.) | | |
| 17 | Open the released quote → **Overview** → **Commercial terms**. | Terms and the capital flag are now read-only: "Locked after G4 · decided by <you> on <date>". The KAM and Pricing cannot edit them. | | |
| 18 | Open `<CCQ-FR-KAM>`. | No decision buttons. The bar says "You cannot decide Final Review on a quote where you are the KAM". | | |
| 19 | Open `<CCQ-FR-PRICE>`. | No decision buttons. The bar says "You cannot decide Final Review on a quote whose price you approved or submitted". | | |
| 20 | Open a quote that is not in Final Review and type `/review` after its address. | "No decision is waiting on this quote." | | |
| 21 | Look for **Record price approval**, **Save terms** or a gate button for G1, G2, G3 or G5 on any quote. | None. Approvers only decide G4. | | |
| 22 | Check **Home** → **Decided recently**. | Your decisions from Part B are listed. | | |

## Part D: Engineering details at Final Review (FB-06)

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 23 | Open a quote in Final Review that came through G2 as **Advance – capital required**. Find the engineering section of the review. | The equipment BOM (file, version, uploader, date, download), the two-step details and the pack-out are shown, read-only. A quote created before FB-06 may also show **Legacy notes** (the old downstream-equipment and BOM text), read-only. | | |

## Part E: Capital terms and payment-terms exceptions (FB-08)

Added 2026-11-10. **You** edit and confirm the capital terms on the Final Review screen. Releasing the offer needs the confirmation, and the terms lock when you approve. A payment-terms exception the pricing lead has not approved also stops the release. Which checks block you is a provisional setting (`g4_required_checks`, D-003): note a wrong meaning, not a different wording. **Use a laptop or your phone.**

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 24 | Open `<CCQ-FR-CAP>` → **Terms and Legal**. Read the line above **Capital terms**. Then read **Capital terms**. | "Confirm the capital terms before you release the offer." **Capital terms**: "Edit them if needed, then confirm. Releasing the offer needs the confirmation; the terms lock when you approve." Fields: **Funding model** (with the ⓘ **What do the funding options mean?**), **Mold ownership**, **Amortized**, **Agreement in place** and **Minimum supply / shortfall terms**. **Mold ownership** shows what the KAM pre-filled. It reads "Not confirmed by the approver yet." | | |
| 25 | On `<CCQ-FR-CAP>` tap **Advance (release the offer)** and **Record decision**. | Refused. The reason names the capital terms that are not confirmed (the exact wording is provisional: write it in Notes). The quote stays in Final Review. | | |
| 26 | Leave **Funding model** on **Not set** or **Not discussed**, fill the other four, and tap **Confirm capital terms**. Then pick **Amortized** = Yes and leave **Amortized over (months)** empty, and confirm again. | Refused each time, naming what is missing. "Not discussed" does not count as a funding model. The months are required when **Amortized** is Yes, and the agreement duration when **Agreement in place** is Yes. | | |
| 27 | Pick a funding model (for example **$0 CER (customer-reimbursed capital)**), **Mold ownership**, **Amortized** = No, **Agreement in place** = Yes with **Agreement duration (months)** = 60, and a **Minimum supply / shortfall terms** note (or "None"). Tap **Confirm capital terms**. | "Capital terms confirmed". The line reads "Confirmed by <you> on <date>." The button reads **Confirmed**. The decision is now open to you (step 28). | | |
| 28 | Change **Mold ownership** and tap **Save capital terms**. | "Capital terms saved": "The change cleared the approver’s confirmation." The line goes back to "Not confirmed by the approver yet." Tap **Confirm capital terms** again. | | |
| 29 | Open `<CCQ-FR-EXC>` → **Terms and Legal**. Read **Payment-terms exception**. Tap **Advance (release the offer)** and **Record decision**. | "Payment-terms exception (must be approved to release)". The card **Payment-terms exception: Net 60** shows **Waiting for the pricing lead**. You have no **Approve the exception** or **Reject**: only the pricing lead decides. The release is refused while it is waiting, and also if it is **Rejected**. | | |
| 30 | Ask the pricing lead to approve the exception with a rationale (the same way as pricing.md steps 37–39). Reload `<CCQ-FR-EXC>`. | The card shows **Approved**, with the rationale, who decided and when. The release is no longer blocked by it. | | |
| 31 | On `<CCQ-FR-CAP>` (now confirmed) tap **Advance (release the offer)** and **Record decision**. Then open **Overview** → **Commercial terms**. | The offer is released. The capital terms and the payment terms show read-only: "Locked after G4 · decided by <you> on <date>". Nobody can change them (the KAM, Pricing and the lead included). | | |
| 32 | Is the **Funding model** list the one you need? Is it right that you confirm the capital terms, and not Pricing or Engineering? | Write the answer in Notes (D-003 is open). | | |

## Part F: Market and the "Other" detail at Final Review (FB-12, FB-09)

Added 2026-11-10.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 33 | Open `<CCQ-FR-OTHER>` → **The request**. Read **Market**. | "<Market> › <Sub-market>", for example "Food › Snacks & Confections". A quote with a market and no sub-market shows the market alone. A quote on a retired market shows "(no longer offered)" after it. | | |
| 34 | In **The request** read **Resin**, **Customer-specified resin**, **PCR %** and **Additives**. | **Resin** reads "Other". The other three show what the KAM typed: the resin and grade, the PCR level and the additive. | | |

## Part G: OPTIONAL: the extra customer-funded approval (FB-08, F-082)

**Skip this part unless Bailey says to run it.** The extra approval is **switched off** on the test site and ships off. It is Bailey's Nov 9 proposal: when the customer funds the capital (**Customer-funded** or **$0 CER**), the sales leader signs off, then leadership, before you can release the offer. Oleg Yarovinski and Sarah Brennan have not confirmed it yet (A-035). An Admin (Ben) switches it on for this part and **must switch it off again at the end (step 41)**. Testers: the approver, a sales leader and a leadership tester (test accounts if they are not free), and the Admin. Note a wrong meaning, not a different wording.

| # | Who | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 35 | Approver | With the setting still off, open `<CCQ-FR-CF>` → **Terms and Legal**. | No extra sign-off section. You can release it (do not release it yet: stop at the dialog and **Cancel**). | | |
| 36 | Admin | **Admin** → **App settings** → **Final Review** → **Extra Final Review sign-offs by funding model (e.g. sales leader, then leadership). Rules with active: false do nothing** → **Edit**. In the JSON set `"active": true` on the rule "Customer-funded capital: sales leader, then leadership". Type a reason. Save. | Saved. The setting shows `active: true`. The change is in **Admin** → **Decision log** and **Audit log**. | | |
| 37 | Approver | Open `<CCQ-FR-CF>` → **Terms and Legal**. Tap **Advance (release the offer)** and **Record decision**. | A section "Customer-funded capital: sales leader, then leadership" lists **Sales leader: waiting** and **Leadership: waiting**. The release is refused: "Final Review also needs: Sales leader, then Leadership". You have no **Sign off** button. | | |
| 38 | Leadership | Open `<CCQ-FR-CF>` → **Overview** → **Commercial terms**. | The same section. **Leadership: waiting** has no **Sign off** button yet: it waits for the sales leader. | | |
| 39 | Sales leader | Open `<CCQ-FR-CF>` → **Overview** → **Commercial terms**. Click **Sign off** next to **Sales leader**. | "Sales leader signed off". The line reads "signed by <name>, <time>". (You cannot open the Final Review queue: you sign on the quote.) | | |
| 40 | Leadership | Reload the quote. Click **Sign off** next to **Leadership**. Then, as the approver, release the offer. Also open `<CCQ-FR-CO>` (Company-funded). | "Leadership signed off". The approver's release now works and the stage is **Customer Decision**. `<CCQ-FR-CO>` shows no sign-off section and can be released without them. | | |
| 41 | Admin | **Do not skip.** Set `"active": false` on the same rule. Type a reason. Save. | Saved. A Customer-funded quote in Final Review shows no sign-off section again, and the approver can release it without signatures. The change is in the **Audit log**. | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Approver | | | |
| | Approver | | | |
