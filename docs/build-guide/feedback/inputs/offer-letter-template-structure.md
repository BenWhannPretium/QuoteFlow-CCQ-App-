# The old Standard Quote Template ("Offer Letter"): structure and wording

**Source:** `Standard Quote Template.docx`, sent by Bailey Schmitt to Ben on 2026-11-16 (owner: Sarah, surname and role not given). Read for FB-20 from outside the repo; the file is **not** committed. It is Pretium's own blank template, so its labels and boilerplate are recorded here. It contains no customer, price or quote data. Its signer drop-down lists real sales staff by name: those names are deliberately **not** copied here or anywhere in the repo.

## Layout (one US Letter page, Word)

| Part | What the template has |
|---|---|
| Header | The pre-rebrand Pretium logo (blue wordmark, "Packaging ideas into your solutions"), top right |
| Footer | "CONFIDENTIAL", right |
| Address block | `To:` · `End User:` · `Attention:` · `Date:` (a Word DATE field, `MMMM d, yyyy`) · `Quote #:` (right) |
| Title | **OFFER LETTER**, centred, bold |
| Part block | `Part description:` · `Part #:` (right) · `Plant of manufacture:` (a drop-down of plant locations, "Choose an item.") · `Estimated annual volumes: XXX, XXX pcs` |
| Pricing table | An embedded Excel worksheet: header **Pricing (USD$)**; rows **Piece Part, per 1,000 pcs** (`$0.00`), **Molds** (`$`), **Change Parts** (`$`) |
| Pricing assumptions | A bullet list (wording below) |
| Other Assumptions | A two-column table: Material (resin type) (drop-down: HDPE, PET, LDPE, PP, PVC), Color, # of Cavities, Gram weight, Neck finish, Decoration, Packaging, Treatment(s) |
| Sign-off | "Yours Sincerely," then a drop-down of sales staff (names not recorded) |

## Pricing assumptions, as written

1. Pricing does not include pallet costs.
2. Pricing of pallets is subject to change at the time of shipping due to market conditions.
3. Pricing offer is valid for 30 days from date of offer.
4. FOB plant of manufacture.
5. Payment terms NET 30 days from date of invoice.
6. Lead time to be confirmed at time of Purchase Order.
7. Standard Pretium Quality specifications apply.
8. Pretium specified resin applies.
9. Tooling Payment Terms:
   - If < $25,000, 50% with order, 50% upon approval of samples
   - If > $25,000, 1/3 with order, 1/3 upon completion of molds, 1/3 upon approval of samples
10. Final Price is subject to changes based on final specifications, and qualification of molds and any resultant change in process conditions.
11. All prices will be subject to resin and other raw material escalation and reduction. Pricing is based on the offer date's previous months CDI resin costs.
12. Pretium standard terms & conditions apply.

## How FB-20 maps it (seeded into `app_setting.offer_letter_template`, provisional, not approved by Legal)

| Old | FB-20 | Why |
|---|---|---|
| Blue pre-rebrand logo, top right | The current primary logo (full colour), top left | Pretium design system 1.5.2: the wordmark sits top left of document headers |
| `To:` and `End User:` | **To**: the Salesforce Account on the quote | CCQ quotes the customer; there is no separate end-user field |
| `Plant of manufacture` | **Place of manufacture** | The FB-20 prompt's label; the value is Engineering's plant decision |
| Single part block | One row per item (FB-19) | One letter per quote, a row per item (Ben, 2026-11-16) |
| Embedded Excel price table | A native Word table: Item, Place of manufacture, Estimated annual volume, Piece price per 1,000 pcs, Molds, Change parts | Editable in Word, no embedded object; a column no item has is omitted |
| 3. "valid for 30 days from date of offer" | "This offer is valid until {{validUntil}}." | The validity date is the quote's own (`validity_until`, set at G4) |
| 4. "FOB plant of manufacture." | "Pricing is {{priceBasis}}." · "Freight: {{freight}}." | FB-11 records the price basis (FOB Pretium plant / Delivered) and the freight type per quote |
| 5. "Payment terms NET 30 days from date of invoice." | "Payment terms: {{paymentTerms}} from date of invoice." | FB-08 / FB-11 record the payment terms per quote |
| 9. Tooling Payment Terms | Kept as written | Not a field on the quote; for Legal to confirm |
| (new) | "Tooling funding: {{toolingFunding}}." · "Mold ownership: {{moldOwnership}}." | FB-08 records both; dropped when the quote has no value |
| 10. "Final Price is subject to changes …" | "Final price is subject to change based on final specifications, mold qualification and any resulting change in process conditions." | Grammar only |
| 11. "… the offer date's previous months CDI resin costs." | "… the previous month's CDI resin costs as of the offer date." | Grammar only (the apostrophe) |
| Other Assumptions | **Specifications**, one column per item, from the item's intake and engineering facts; a row with no value is omitted | No typing: the facts are on the quote. "Treatment(s)" has no field and is left out |
| "Yours Sincerely," + staff drop-down | "Yours sincerely," + the quote's KAM | The KAM owns the customer relationship; no staff list in config |
| Footer "CONFIDENTIAL" | "Confidential" note, `Page X of Y`, and the legal entity and address once Legal gives them | Brand footer convention for external documents |
