# UAT script: Finance (ROI)

| | |
|---|---|
| Session | **U3** (with Pricing), or a short session with Stacy Slocum. Run by Bailey Schmitt. |
| Tester role | Finance, the ROI owner (app role `CCQ.Finance`, provisional name). An input, not an approver. |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | **Sign in with Microsoft** with your Pretium account. Your account must be in **`SG-CCQ-Finance`**. The group and the `CCQ.Finance` app role exist (2026-11-10); Ben adds each tester to the group before the session. If you see "No QuoteFlow access yet", tell Ben. If your account is not in the group yet, Ben runs these steps with the dev Finance persona on a laptop. |
| Before you start | Pricing has uploaded a costing model on `<CCQ-QT-4>` (capital required at G2) and attested costing (pricing.md steps 8a–9). |
| How to log a problem | Tell Ben or Bailey with the step number (the **Report an issue** button is not part of the Finance role, see the FB-07 notes). |

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<CCQ-QT-4>` | A quote in Quoting where Engineering said **capital required** |
| `<CCQ-QT-2>` | A quote in Quoting with no capital (no ROI needed) |

Use synthetic workbooks only (a copy of your board template with made-up numbers). Never upload a real ROI to the test site.

## Part A: Told, read, upload

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Open the email "[QuoteFlow] CCQ-… is ready for its ROI". | It names who uploaded the costing model and the version, and links to the quote. No figures. | | |
| 2 | Follow the link and sign in. | The quote's **Quoting** tab. **Costing, ROI and price approval**: **1. Costing** done, **2. ROI** "Next", "Needed: Engineering (G2): Advance – capital required". | | |
| 3 | In **1. Costing** click the costing model's file name. | It downloads (the download is audited). | | |
| 4 | In **2. ROI** click **Upload the ROI model** and pick your workbook. | "Version 1 uploaded". **ROI model v1 · current**, your name and the time. **3. Price approved** is now "Next". The pricing lead is notified. | | |
| 5 | Upload a changed workbook. | **v2 · current**; **Earlier versions (1)** lists v1, which still downloads. | | |
| 6 | Open `<CCQ-QT-2>` → **Quoting**. | **2. ROI**: "Not required: …" and why. No upload button. | | |

## Part B: Only the ROI

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 7 | Look at the menu and the home page. | Menu: **Home**, **Pipeline**. Home: **ROI requests** with what to do. No pricing queue, no analytics, no approvals. | | |
| 8 | On `<CCQ-QT-4>` look for **Save price approval**, **Save capital readiness**, an upload on **Attachments**, or a gate decision. | None of them. | | |
| 9 | After the pricing lead approves the price (pricing.md step 20a), open `<CCQ-QT-4>`. | **3. Price approved** done, by whom and when. No upload buttons (locked after G3). | | |

## Part C: Funding and capital terms, read-only (FB-08)

Added 2026-11-10. Engineering now enters the tooling funding model on the quote, and the approver confirms the capital terms. You read them; you change none of them. Which funding models need an ROI is a provisional setting (customer-funded and $0 CER, D-001).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 10 | On `<CCQ-QT-4>` open **Overview** → **Commercial terms**. Read **Tooling funding model**, **MOQ** and **Capital terms**. | You can read them. There is no **Save terms**, **Save MOQ and funding** or **Save capital terms** button for you. | | |
| 11 | Ask Engineering to set **Tooling funding model** to **$0 CER (customer-reimbursed capital)** on `<CCQ-QT-2>` (engineering.md step 69). Then open `<CCQ-QT-2>` → **Quoting** → **2. ROI**. | **2. ROI** now reads "Needed: Tooling funding: $0 CER (customer-reimbursed capital)". You can upload an ROI. | | |
| 12 | Ask Engineering to set the same quote back to **Not discussed**. Open **2. ROI** again. | "Not required: …" again, with the reason (no capital, not flagged likely, and the funding model does not call for one). | | |

**Sign-off:** Tester ______________________ Date __________
