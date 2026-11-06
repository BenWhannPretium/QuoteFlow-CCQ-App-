# QuoteFlow quick-start: KAM

**What QuoteFlow is for you.** One place to request a commercial capital quote and follow it to the customer's answer. You start from your Salesforce opportunity. Engineering, Pricing and Final Review do their part in QuoteFlow, and you see where it is at every step.

**Your home screen: My quotes.** It shows what is **Returned to me**, **My drafts**, **My open quotes by stage**, **Proposals expiring soon** and **My outcome capture rate**. Your menu: **Home**, **New intake**, **My proposals**, **Pipeline**.

## What you'll do

1. **Start an intake.** Click **New intake**, find your Salesforce opportunity and click **Use this opportunity**. Four steps: Opportunity, Customer & ship-to, Product & volume, Drawing, notes & review. Click **Submit to CCQ**. You get a quote number like `CCQ-2026-00042`.
2. **Attach the drawing, or give the minimum spec.** On step 4, drag files onto **Drawing and other files**, or tap **Add photo** on your phone. Without a drawing you must give the minimum spec on step 3 (height, width or diameter, depth, gram weight, neck, resin, color), or the quote cannot be submitted.
3. **Fix a returned quote.** If a sales leader or Engineering returns it, you get a notification. Open the quote and click **Fix and resubmit**. The quote keeps its number. If Pricing sent it back, you are asked whether the scope changed: **No, same scope** sends it straight back to Pricing; **Yes** sends it through qualification and Engineering again.
4. **Record the customer's answer.** Go to **My proposals** and click **Record outcome**: **Awarded**, **In negotiation**, **Lost**, **No response / Expired**, **On hold** or **Re-quote**. No response is not a loss.
5. **Hand off a win.** After **Awarded**, fill the **Commit & hand off** card (CER and receiving team), then click **Commit & hand off** → **Advance (close Won)**.

## What changed from the ERF

- Every quote starts from a Salesforce opportunity. One quote per opportunity.
- You no longer pick the plant, the engineer or the priority. Engineering decides the plant and engineer. The priority score is calculated and advisory.
- The customer is the Salesforce Account on the opportunity. You don't create customer accounts: tick **Not yet a Pretium customer (no ERP account)** if that applies.
- You give **Quote needed by** and **Product needed by** dates. The Salesforce close date is shown but not typed.
- You can't change the priority tier. Ask your sales leader to override it.
- Awarded is the customer's yes. The quote closes Won only after Commit & Hand Off.
- You can see the price approval, pricing basis and capital figures on your quotes. Only Pricing changes them.
- Once a gate is decided, its section is locked until a send-back reopens it.
- After you record an outcome, QuoteFlow reminds you to update the Salesforce opportunity. It does not write to Salesforce.

## Who to ask

- **Bailey Schmitt**, product owner: how QuoteFlow should work.
- **Tre Curry**, coordination: access, sessions, follow-ups.
- **Ben Whann**, builder: anything broken.
- Found a problem? Click **Report an issue** in your user menu or at the bottom of any page.
