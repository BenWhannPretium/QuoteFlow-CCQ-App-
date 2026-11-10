# Intake mandatory fields: proposal for Bailey Schmitt (D-006)

**Status:** proposal only. `intake_required_fields` is **not changed** by FB-09 (decision D-006 is open). This page lists what is required today, what Pricing and Engineering asked for since, and what we would make required if Bailey agrees. An Admin can apply any of it in Admin → Settings → `intake_required_fields` without a release.

**Why not just require everything?** Kal Kaliszewski warned (V-029) that a forced field becomes "N/A". So every field below is a **recommendation with a reason**, and the required ones get **no "N/A" choice** unless D-006 adds one on purpose.

## 1. Required today (blocks Submit)

Seed value of `intake_required_fields` (FB-02 updated it; migration 0028):

| Field | Why it is required |
|---|---|
| Salesforce opportunity | The front door (DEC-12): every quote links to one |
| Customer name (from the SF account) | Nothing is quoted without a customer |
| Ship / fill destination: city and state | Freight and plant choice (F-017) |
| Product family | Tells Engineering which line and tooling family |
| Resin | Decides process, machine and most of the cost |
| Estimated annual volume | Sizes the machine and capacity |
| Quote needed by, product needed by | Sets the timing score (F-009) |

Also blocking, by rule rather than by list:

- **Drawing or minimum spec (FB-02, D-018 decided).** Without a bottle or competitor drawing: height, width or diameter, depth, gram weight, neck, resin and color are all required (`intake_min_spec_fields`).
- **Conditional "Other" or "Custom" details.** A Custom neck or color, a customer-specified resin, a payment term of Other, a picked component's follow-ups, and (FB-09) **Resin, PCR or Additive = Other** each need their detail. Packaging **Other** needs the packaging note (FB-09, D-016 default).
- **Valid values only:** the https link format, a 1 to 12 print-color count, text limits.

## 2. Optional today, with a warning

FB-02 and FB-11 left these optional (a blank one is an amber warning, never a block): PCR level, additive and its note, packaging type and notes, requested payment terms, whether the customer funds tooling (defaults to "Not discussed"), delivered or FOB, freight type, returnable dunnage, bid / program reference, quote-variants note, RFP link, comments for Engineering, market.

## 3. What we would require, and why (for Bailey to approve or strike)

| Field | Recommend | Reason |
|---|---|---|
| Market | **Required** | It feeds strategic-fit scoring (F-073); a blank market scores neutral and hides the quote from the 9-box view. Melanie Rasche's list is arriving in FB-12 |
| Packaging type | **Required** | Pricing and freight both need it (the G3 rework reasons most often cite packaging) |
| Requested payment terms | **Required** | Gemma Cebolla: terms were missed in costing; a pick-list avoids "N/A" |
| Delivered or FOB | **Required** | Freight was missed in costing before (D-032) |
| Freight type | Required **only when** Delivered | Only applies to a delivered price |
| PCR level | **Required** | Same reason as resin: it changes material cost. Use "0% / Virgin" for none, not "N/A" |
| Additive | **Keep optional** | Most quotes have none; "None" is a real choice, so requiring it would add a click for nothing |
| Customer funds tooling | **Keep optional** | It defaults to "Not discussed", which is a true answer |
| Returnable dunnage | **Keep optional** | A checkbox; unchecked means single-trip |
| Bid / program reference | **Keep optional** | Many quotes have no bid |
| Quote-variants note, RFP link, comments | **Keep optional** | Free text; Kal's "N/A" risk is highest here |

**If all of section 3's "Required" rows are approved**, the setting gains these rules (as `present` rules, plus a `when delivered` rule for freight type):
`market`, `packaging_type`, `requested_payment_terms`, `price_basis`, `pcr_level`.

## 4. Questions for Bailey

1. Approve, change or strike each row of section 3.
2. Is "Not discussed" acceptable for customer funding, or should the KAM have to ask?
3. Who confirms the **PCR levels** (FB-09 names Engineering and Supply Chain) and who approves the **additive** list (no owner named yet)?
