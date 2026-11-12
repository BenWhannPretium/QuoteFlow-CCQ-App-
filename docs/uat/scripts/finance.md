# UAT script: Finance (payback model)

| | |
|---|---|
| Session | **U3** (with Pricing), or a short session with Stacy Slocum. Run by Bailey Schmitt. |
| Tester role | Finance, the payback model owner (app role `CCQ.Finance`, provisional name). An input, not an approver. |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | **Sign in with Microsoft** with your Pretium account. Your account must be in **`SG-CCQ-Finance`**. The group and the `CCQ.Finance` app role exist (2026-11-10); Ben adds each tester to the group before the session. If you see "No QuoteFlow access yet", tell Ben. If your account is not in the group yet, Ben runs these steps with the dev Finance persona on a laptop. |
| Before you start | Pricing has uploaded a costing model on `<CCQ-QT-4>` (capital required at G2) and attested costing (pricing.md steps 8a–9). |
| How to log a problem | Tell Ben or Bailey with the step number (the **Report an issue** button is not part of the Finance role, see the FB-07 notes). |

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<CCQ-QT-4>` | A quote in Quoting where Engineering said **capital required** |
| `<CCQ-QT-2>` | A quote in Quoting with no capital (payback not required) |

Use synthetic workbooks only (a copy of your board template with made-up numbers). Never upload a real payback model to the test site.

After you upload the payback model, QuoteFlow shows a short summary of its headline figures, read from the workbook. It is read-only: it cannot be edited in QuoteFlow. An Excel error, a negative or zero payback, or a blank headline figure shows as a warning. A warning never blocks.

## Part A: Told, read, upload

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Open the email "[QuoteFlow] CCQ-… is ready for its payback model". | It names who uploaded the costing model and the version, and links to the quote. No figures. | | |
| 2 | Follow the link and sign in. | The quote's **Quoting** tab. **Costing, payback and price approval**: **1. Costing** done, **2. Payback** "Next", "Needed: Engineering (G2): Advance – capital required". | | |
| 3 | In **1. Costing** click the costing model's file name. | It downloads (the download is audited). | | |
| 4 | In **2. Payback** click **Upload the payback model** and pick the synthetic payback workbook. | "Version 1 uploaded". **Payback model v1 · current**, your name and the time. **3. Price approved** is now "Next". The pricing lead is notified ("<quote>: the payback model is uploaded"). | | |
| 4a | Upload the synthetic payback workbook; check the summary shows file, version, uploader and date, and the figures with their units. (The step 4 upload counts: do not upload it again.) | The summary is under **2. Payback**. It reads "Read from <file> v<n>, uploaded by <name> on <date>". Each figure shows its label, value and unit. Nothing in it can be edited. An Excel error, a negative or zero payback, or a blank headline figure shows a warning, and nothing is blocked. | | |
| 5 | Upload a changed workbook. | **v2 · current**; **Earlier versions (1)** lists v1, which still downloads. | | |
| 6 | Open `<CCQ-QT-2>` → **Quoting**. | **2. Payback** reads "Not required: a payback model is needed only when capital is required ($0 CER included)." with the reason. No upload button. | | |

## Part B: Only the payback model

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 7 | Look at the menu and the home page. | Menu: **Home**, **Pipeline**. Home: **Payback requests** with what to do. No pricing queue, no analytics, no approvals. | | |
| 8 | On `<CCQ-QT-4>` look for **Save price approval**, **Save capital readiness**, an upload on **Attachments**, or a gate decision. | None of them. The comment box on **Overview** is there: Finance may comment on a quote (decided 2026-11-11, DR-pricing-finance-09). | | |
| 9 | After the pricing lead approves the price (pricing.md step 20a), open `<CCQ-QT-4>`. | **3. Price approved** done, by whom and when. No upload buttons (locked after G3). | | |

## Part C: Funding and capital terms, read-only (FB-08)

Added 2026-11-10. Engineering now enters the tooling funding model on the quote, and the approver confirms the capital terms. You read them; you change none of them. Which funding models need a payback model is a provisional setting (customer-funded and $0 CER, D-001).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 10 | On `<CCQ-QT-4>` open **Overview** → **Commercial terms**. Read **Tooling funding model**, **MOQ** and **Capital terms**. | You can read them. There is no **Save terms**, **Save MOQ and funding** or **Save capital terms** button for you. | | |
| 11 | Ask Engineering to set **Tooling funding model** to **$0 CER (customer-reimbursed capital)** on `<CCQ-QT-2>` (engineering.md step 69). Then open `<CCQ-QT-2>` → **Quoting** → **2. Payback**. | **2. Payback** now reads "Needed: Tooling funding: $0 CER (customer-reimbursed capital)". You can upload a payback model. | | |
| 12 | Ask Engineering to set the same quote back to **Not discussed**. Open **2. Payback** again. | "Not required: a payback model is needed only when capital is required ($0 CER included)." again, with the reason (no capital, not flagged likely, and the funding model does not call for one). | | |

**Sign-off:** Tester ______________________ Date __________
