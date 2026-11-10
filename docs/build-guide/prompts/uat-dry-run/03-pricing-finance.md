# Session 3: Pricing, Pricing Lead and Finance

Read `00-common.md` first. Scope name for the report and branch: `pricing-finance`.

**Scripts:** `docs/uat/scripts/pricing.md` (all parts), `docs/uat/scripts/finance.md`.
**Quick-starts:** `pricing.md`, `finance.md`.
**Personas:** `pricing`, `pricing-lead`, `finance`. Use `kam`, `eng-lead` and `approver` to feed and move quotes.

## Features to cover

**Queue and assignment**
- The pricing queue and the pricing lead's assign and reassign (an analyst cannot assign). Filters and order.
- **Lead review:** the analyst submits to the pricing lead, who is told, reviews and decides or sends back with a note; the analyst's part is locked while submitted. **G3 is decided by the pricing lead only**; an analyst's attempt is refused in the UI and the API.

**The Quoting tab**
- "From intake" (commercial inputs, including requested terms, funding, dunnage, delivery and freight, bid reference, Other details) and "From engineering" (BOM file and version, two-step, pack-out, budgetary capital estimate). Both read-only for Pricing.
- **Costing, then ROI, then Price approved, in that order** (D-001):
  1. Costing: upload the costing model (`cost_model`); "Costing completed" needs a current one (422 `COST_MODEL_REQUIRED` without it). A new upload is version 2 and flagged current; earlier versions stay downloadable; remove within 24 hours restores the previous one.
  2. ROI: applies only when capital is likely or required, or the funding is customer-funded or $0 CER (setting `roi_required_when`). **Finance uploads it.** Uploading an ROI before the costing model is refused (409); uploading one on a quote that needs none is refused (409). Otherwise the step reads "Not required" and says why. Check the pricing-lead fallback upload still works (it stays until Pricing and Finance agree to remove it).
  3. **Price approved** (the G3 label; the decision is "Advance – price approved"): needs the current costing model and, when required, the ROI model. An optional updated price table can be uploaded by the lead.
- The panel shows each step's status, the current file (version, uploader, date), the attestation and who decided G3, on the Quoting tab and read-only at Final Review.
- After G3 every upload is refused with 409 `SECTION_LOCKED`. A send-back reopens the steps.

**Terms (FB-08, provisional)**
- Payment terms are a list, pre-selected from the customer's request or the default (Net 30). A code outside Net 15 and Net 30 opens a **terms exception request** to the pricing lead, who approves or rejects it with a required rationale. The requester and KAM are told. **A pending or rejected exception blocks G4.** Switching terms back to standard withdraws the request (write down what the panel shows).
- Tooling payment options (upfront; 50/50; amortized per piece; no quarterly) and the milestone note (300).
- Capital terms pre-fill on the Commercial panel (funding, mold ownership, amortization and months, minimum supply and shortfall, agreement and duration). The **approver** confirms them at Final Review, not Pricing.
- MOQ and tooling funding are Engineering's: Pricing sees them and cannot edit them.

**Send-back to the KAM (G3)**
- The pricer or lead sends it back with a reason; the KAM answers whether the scope changed and resubmits; the pricer and the lead are told.

**Finance role**
- A Finance user can sign in, read every quote **including its figures**, download the costing model and upload or replace the ROI model, and nothing else. Check every other action as Finance: refused in the UI and the API. Finance is told when a quote needs an ROI (home page "ROI requests"); the pricing lead is told when it arrives.

**Pricing history.** If the pricing-history reader is on a screen, check it reads the imported export only, and that no pricing figure can be edited in QuoteFlow (CLAUDE.md rule 5).

## Cross-role checks you own

- A quote leaves Engineering and shows the right "From engineering" data in Quoting.
- After G3 advance, the approver is told and the quote is in Final Review with the three steps read-only.
- Every role that can read the quote sees pricing, margin and capital (CLAUDE.md rule 2): check as `kam`, `engineer` and `leadership`.
