# Intake value lists (Danielle Leu, 2026-11-09)

**Source:** Danielle Leu's reply of 2026-11-09 to Ben Whann's "QuoteFlow: need your resin, market and product family lists by Tuesday" (Bailey Schmitt copied). Danielle is Director of Product Commercialization and the named owner of the resin and product family lists (FB-09). She passed the **market** list to Melanie Rasche, whose answer is in `markets.md` (FB-12).

Her words on scope:

> "For resin, I'd keep the intake list simple and capture the majority of what we quote today."
>
> "If 'Other' is selected, we should have a field to enter the customer-specified resin, grade or additive. I'd rather capture the 80% we use regularly and use 'Other' for specialty requirements than overbuild the dropdown."

## The lists, exactly as sent

| List | Values, in her order |
|---|---|
| **Product family** | Bottle, Jar, Closure, Preform, Canister/Tub, Handleware, Other |
| **Resin** | PET, HDPE, PP, LDPE, PS, Other |
| **PCR** | 0% / Virgin, 25%, 30%, 50%, 100%, Other |
| **Additive** | None, UV, Barrier, Antistat, Impact Modifier, Other |

## How they compare with QuoteFlow today

| List | `value_list` key | Today | Change |
|---|---|---|---|
| Product family | `product_family` | Bottle, Jar, Closure, Preform, Canister/Tub, Handleware, Other | **None.** Identical; mark it approved. |
| Resin | `resin` | HDPE, PET, PP, LDPE, PCR-HDPE, PCR-PET, PETG, PVC, PS, Bio-resin, Other | Reorder to her list. **Deactivate** (do not delete) `PCR_HDPE`, `PCR_PET`, `PETG`, `PVC`, `BIO_RESIN`. PCR content now lives in the PCR field. |
| PCR | `pcr_level` | 0%, 25%, 50%, 100% | Relabel `0` to "0% / Virgin". **Add** `30` (30%) and `OTHER` (Other). |
| Additive | none: `quote.additives` is a free-text note (≤ 200, FB-02) | | **New** value list `additive` and a coded intake field. The existing `additives` text stays as the detail for "Other". |

## The "Other" rule (Danielle)

When **Resin**, **PCR** or **Additive** is "Other", the intake asks for the customer-specified resin, grade or additive in a short text field. That field is required **only while "Other" is picked** and cleared when it isn't. It is capped (D-016 default: short, not the 500-character cap for long notes).

"Other" in **Product family** follows FB-09's general D-016 rule (a capped short note).

## Who signs off

- **Resin and product family:** Danielle Leu, 2026-11-09. Named owner in FB-09; mark approved.
- **PCR:** FB-09 names Engineering and Supply Chain as the owner of the PCR levels. Danielle sent this list. Load it, but keep it `provisional` until Engineering and Supply Chain (or Bailey on their behalf) confirm.
- **Additive:** no owner named in FB-09. Load Danielle's list, keep it `provisional`, and ask Bailey who approves it.
