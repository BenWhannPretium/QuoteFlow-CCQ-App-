# QuoteFlow quick-start: Finance (payback model)

> Updated 2026-11-18 for FB-21: a payback model only when the pricer or the pricing lead asks for one.

**What QuoteFlow is for you.** Quotes where the pricer or the pricing lead has asked for a payback model. Pricing uploads the costing model (costs and the initial price assumptions); you build the payback from it on your template and upload the payback model. You are an input, not an approver: the pricing lead approves the price (G3, **Price approved**), and while a request is open the price waits for your payback model.

**Your Command Center.** **Payback requests**, with what to do. Your menu: **Command Center**, **Pipeline**. Your role reads quotes, uploads the payback model and may comment on a quote; it changes nothing else.

## What you'll do

1. **Get told.** When the pricer or the pricing lead asks for a payback model, you get a bell notice and an email: "… needs a payback model", with their note if they wrote one. It opens the quote's **Quoting** tab. A costing model upload on its own does not tell you.
2. **Take the assumptions.** **Costing, payback and price approval** → **1. Costing**: download the current costing model (the latest version is flagged **current**).
3. **Upload the payback model.** **2. Payback** says who asked and when. Click **Upload the payback model** (an Excel workbook (.xlsx), up to 100 MB). Whoever asked and the pricing leads are told.
4. **Check the summary.** After the upload, QuoteFlow shows a short summary of the headline figures it read from your workbook. It is read-only: you cannot edit it in QuoteFlow. An Excel error, a negative or zero payback, or a blank headline figure shows as a warning. A warning never blocks anything.
5. **Request withdrawn?** You are told "… no longer needs a payback model", with the reason: you can stop work on it. The price no longer waits for it.
6. **Costing changed?** Step 2 says when your payback model is older than the current costing model. If Pricing needs a new one, they ask again. **Upload a new version**: the earlier one stays under **Earlier versions**.
7. **After the price is approved** the steps are locked. A send-back to Quoting reopens them.

## What changed

- Assumptions come from QuoteFlow, not from email: the costing model is on the quote.
- The payback is a step inside Quoting, after costing and before the price is approved (D-001). It is needed only when the pricer or the pricing lead asks for it; until then the step says **Not requested**. You may still upload a payback model nobody asked for: then only the pricing leads are told.

## Who to ask

- **Gemma Cebolla**, Sr Director Pricing: the costing model and the price.
- **Bailey Schmitt**, product owner. **Ben Whann**, builder.
- Found a problem? Tell Ben or Bailey (the **Report an issue** button is not part of the Finance role).
