# UAT script: Finance (payback model)

> Checked against the build on 2026-11-17 (pre-release audit): the summary line under the payback model names the version, the uploader and the date (not the file name). Steps 4a and 9 are changed. Updated 2026-11-17 for the approved UX changes (docs/audit/03-ux-proposals.md).

| | |
|---|---|
| Session | **U3** (with Pricing), or a short session with Stacy Slocum. Run by Bailey Schmitt. |
| Tester role | Finance, the payback model owner (app role `CCQ.Finance`, provisional name). An input, not an approver. |
| Test URL | https://quoteflow-test.azurewebsites.net |
| Sign in | **Sign in with Microsoft** with your Pretium account. Your account must be in **`SG-CCQ-Finance`**. The group and the `CCQ.Finance` app role exist (2026-11-10); Ben adds each tester to the group before the session. If you see "No QuoteFlow access yet", tell Ben. If your account is not in the group yet, Ben runs these steps with the dev Finance persona on a laptop. |
| Before you start | Pricing has uploaded a costing model on `<CCQ-QT-4>` (capital needed: Engineering's capital estimate is above $0) and attested costing (pricing.md steps 8a–9), and the pricer has asked Finance for a payback model on it, with a note (pricing.md step 20a). |
| How to log a problem | Tell Ben or Bailey with the step number (the **Report an issue** button is not part of the Finance role, see the FB-07 notes). |

**Data (placeholders until Bailey picks real opportunities)**

| Placeholder | What it is |
|---|---|
| `<CCQ-QT-4>` | A quote in Quoting that needs capital: Engineering advanced it with a capital estimate above $0 (FB-17; before that, **Advance – capital required**). The pricer has asked you for a payback model (FB-21) |
| `<CCQ-QT-2>` | A quote in Quoting with no capital, the costing model uploaded, and nobody has asked for a payback model |

Use synthetic workbooks only (a copy of your board template with made-up numbers). Never upload a real payback model to the test site.

After you upload the payback model, QuoteFlow shows a short summary of its headline figures, read from the workbook. It is read-only: it cannot be edited in QuoteFlow. An Excel error, a negative or zero payback, or a blank headline figure shows as a warning. A warning never blocks.

**Changed 2026-11-18 (FB-21, feedback of Nov 17: N17-21, N17-22, N17-24).** A payback model is no longer needed for every quote with capital. You are told only when the assigned pricer or the pricing lead asks for one (**Ask Finance for a payback model**, with an optional note), not when a costing model is uploaded. The email reads "… needs a payback model". When you upload after a request, whoever asked and every pricing lead are told. The pricer or the lead may withdraw a request with a reason; you are told "… no longer needs a payback model". You may still upload a payback model nobody asked for: then only the pricing leads are told. The upload button says "Excel workbook (.xlsx), up to 100 MB". Steps 1, 2, 4, 6, 8, 9, 11, 12 and 14 are changed, and steps 6a and 6b are new.

## Part A: Told, read, upload

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Open the email "[QuoteFlow] CCQ-… needs a payback model" (FB-21: it was "… is ready for its payback model", sent on every costing upload). | "A payback model is asked for". It names who asked ("<name> asked Finance for a payback model."), gives their note ("Their note: …") and says "Build it from the costing model and upload it on the Quoting tab.", with a link **Open Quoting**. No figures. The bell has the same notice. | | |
| 2 | Follow the link and sign in. | The quote's **Quoting** tab. **Costing, payback and price approval**: **1. Costing** done, **2. Payback** "Next", reading "Requested from Finance by <name> on <date>. Waiting on Finance to upload it." and "Note to Finance: …". | | |
| 3 | In **1. Costing** click the costing model's file name. | It downloads (the download is audited). | | |
| 4 | In **2. Payback** read the line beside **Upload the payback model**. Click it and look at which files you can pick. Pick the synthetic payback workbook. | Beside the button: "Excel workbook (.xlsx), up to 100 MB"; the file picker offers only .xlsx files. "Version 1 uploaded". **Payback model v1 · current**, your name and the time. **2. Payback** is **Done** and reads "… Finance has uploaded the payback model." **3. Price approved** is now "Next". The pricer who asked and every pricing lead are notified, once each ("<quote>: the payback model is uploaded"). | | |
| 4a | Upload the synthetic payback workbook; check the summary shows file, version, uploader and date, and the figures with their units. (The step 4 upload counts: do not upload it again.) | The summary is under **2. Payback**. It is headed **Payback model summary** and ends "Read from v<n>, uploaded by <name> on <date>. Figures come from the workbook and cannot be edited here." (the file name is on the line above the summary). Each figure shows its label, value and unit. A workbook QuoteFlow cannot read is still stored, and the summary says "Summary unavailable." Nothing in it can be edited. An Excel error, a negative or zero payback, or a blank headline figure shows a warning, and nothing is blocked. | | |
| 5 | Upload a changed workbook. | **v2 · current**; **Earlier versions (1)** lists v1, which still downloads. | | |
| 6 | Open `<CCQ-QT-2>` → **Quoting**. | You were not told about this quote: nobody asked. **2. Payback** reads "Not requested. A payback model is needed only when the pricer or the pricing lead asks Finance for one." **Upload the payback model** is still offered (FB-21: you may upload one without a request). If pricing.md step 21 has already approved its price, the step is locked and has no upload button: use any other quote in Quoting with a costing model and no request. | | |
| 6a | FB-21. On that quote upload a synthetic payback workbook. Ask the pricing lead and the pricer whether they were told. | "Version 1 uploaded"; **2. Payback** is **Done**. Only the pricing leads are notified ("<quote>: the payback model is uploaded"); the pricer is not (nobody asked). The price approval never waited for it. | | |
| 6b | FB-21. When the pricer withdraws a request (pricing.md step 61), check the bell and your email, then open that quote → **Quoting**. | "<quote> no longer needs a payback model": "<name> withdrew the request for a payback model. Reason: … You can stop work on it." **2. Payback** reads "Not requested. … The last request was withdrawn by <name> on <date>: <reason>". The price approval no longer waits for a payback model. | | |

## Part B: Only the payback model

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 7 | Look at the menu and the Command Center (it was "Home" before FB-18). | Menu: **Command Center**, **Pipeline**. Command Center: **Payback requests** with what to do. No pricing queue, no **Analytics** view, no approvals. Write in Notes if any text there still says you are told when a costing model is uploaded (FB-21 changed that). | | |
| 8 | On `<CCQ-QT-4>` look for **Save price approval**, **Save capital readiness**, **Ask Finance for a payback model**, **Withdraw request**, an upload on **Attachments**, or a gate decision. | None of them (FB-21: only the pricer or the pricing lead asks Finance or withdraws a request). The comment box on **Overview** is there: Finance may comment on a quote (decided 2026-11-11, DR-pricing-finance-09). | | |
| 9 | After the pricing lead approves the price (pricing.md step 20a), open `<CCQ-QT-4>`. | **3. Price approved** done, by whom and when. No upload buttons (locked after G3). | | |

## Part C: Funding and capital terms, read-only (FB-08)

Added 2026-11-10. Engineering now enters the tooling funding model on the quote, and the approver confirms the capital terms. You read them; you change none of them. Which funding models make QuoteFlow suggest a payback model is a provisional setting (customer-funded and $0 CER, D-001); since FB-21 it is only a hint beside the request button, and nothing waits for it.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 10 | On `<CCQ-QT-4>` open the **Commercial terms** tab. Read **Tooling funding model**, **MOQ** and **Capital terms**. | You can read them. There is no **Save terms**, **Save MOQ and funding** or **Save capital terms** button for you. | | |
| 11 | Ask Engineering to set **Tooling funding model** to **$0 CER (customer-reimbursed capital)** on `<CCQ-QT-2>` (engineering.md step 69). Then open `<CCQ-QT-2>` → **Quoting** → **2. Payback**. | FB-21: if nobody has asked for a payback model on it, **2. Payback** adds the hint "Finance’s payback model may be useful here: Tooling funding: $0 CER (customer-reimbursed capital)". It is a suggestion to the pricer and the pricing lead; you are not told. You can upload a payback model. | | |
| 12 | Ask Engineering to set the same quote back to **Not discussed**. Open **2. Payback** again. | The hint is gone (no capital, not flagged likely, and the funding model does not call for one). The step reads "Not requested" as before, or **Done** if you uploaded in step 6a. | | |

## UX changes (2026-11-17)

Added 2026-11-17 for the approved UX changes (`docs/audit/03-ux-proposals.md`).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 13 | Sign in on a browser where you have not opened QuoteFlow before (or in a private window). Read the card at the top of the **Command Center**. Click its link, then **Got it**. Reload the page. | A card **Welcome to QuoteFlow**: "Your main jobs here, and where each one is done." Three jobs: "Find out that a quote needs a payback model: **your notifications and email**.", "Download the current costing model: **the quote’s Quoting tab, step 1**." and "Upload the payback model: **the quote’s Quoting tab, step 2**." The link "Read the one-page quick-start for Finance" opens the quick-start in a new tab. **Got it** puts the card away for good (for you, in this browser); it does not come back after a reload. | | |
| 14 | From **Pipeline**, open a quote in Quoting that waits for its payback model (FB-21: someone asked you for one and you have not uploaded it yet). Read the line under the stage tracker. Click the **Overview** tab and read it again. | The quote opens on the **Quoting** tab without a click. The line reads "Waiting on you. Next: upload the payback model." On **Overview** the line has a button **Open the Quoting tab**. After you upload the model, the line names Pricing or the pricing lead instead. | | |

**Sign-off:** Tester ______________________ Date __________
