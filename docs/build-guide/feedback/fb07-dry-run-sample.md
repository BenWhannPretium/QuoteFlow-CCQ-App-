# FB-07 dry run: sample report (synthetic data)

Run on 2026-11-09 against a database built and seeded by `main` (150 synthetic quotes) with two open quotes in Quoting given an attested costing record, as a pricer would have left them. First the report before migration 0031, then the config section after it. Synthetic data only: quote numbers, no customers, no figures. Run `pnpm --filter @ccq/db fb07:dry-run` against each real environment before deploying FB-07 and keep its output with the release notes.

## Before 0031

### Grandfathered: 2 quote(s)

In Quoting with costing attested and no costing model on file. They keep working: the Quoting tab shows "no model on file" and G3 does not ask for the model on this version.

| Quote | Status | Version | Pricer | Costing attested (UTC) |
|---|---|---|---|---|
| CCQ-2026-00085 | active | 1 | – | 2026-11-07T17:29:24.759Z |
| CCQ-2026-00089 | active | 1 | – | 2026-11-07T17:29:24.759Z |

### Need a costing model: 16 quote(s)

In Quoting with costing not yet attested. Pricing uploads the costing model before attesting costing; the pricing lead cannot approve the price without it.

| Quote | Status | Version | Pricer | Costing attested (UTC) |
|---|---|---|---|---|
| CCQ-2026-00054 | on_hold | 1 | – | – |
| CCQ-2026-00071 | on_hold | 1 | – | – |
| CCQ-2026-00073 | on_hold | 1 | – | – |
| CCQ-2026-00075 | active | 2 | – | – |
| CCQ-2026-00078 | active | 2 | – | – |
| CCQ-2026-00081 | active | 2 | – | – |
| CCQ-2026-00096 | active | 1 | – | – |
| CCQ-2026-00100 | active | 1 | – | – |
| CCQ-2026-00101 | active | 1 | – | – |
| CCQ-2026-00103 | active | 1 | – | – |
| CCQ-2026-00105 | active | 1 | – | – |
| CCQ-2026-00106 | active | 1 | – | – |
| CCQ-2026-00107 | active | 1 | – | – |
| CCQ-2026-00114 | active | 1 | – | – |
| CCQ-2026-00120 | active | 1 | – | – |
| CCQ-2026-00122 | active | 1 | – | – |

### Config

| Item | Now | Outcome |
|---|---|---|
| G3 gate label → "Price approved" | Price approved & capital ready | will change |
| G3 Advance label → "Advance – price approved" | Advance to Final Review | will change |
| G3 Advance help text | The cost sheet is done, the price is approved and capital readiness is confirmed. The quote goes to Final Review. | will change |
| G3 Advance rule + costing model + ROI model | [{"anyOf":[{"allOf":[{"op":"present","field":"pricing_record.price_approved_by"},{"op":"present","field":"pricing_record | will change |
| app_setting roi_required_when (provisional) | – | will change |
| role_permission: Finance (3 rows) + roi.upload for PricingLead and Admin | – | will change |

## After 0031 (config)

| Item | Now | Outcome |
|---|---|---|
| G3 gate label → "Price approved" | Price approved | already done |
| G3 Advance label → "Advance – price approved" | Advance – price approved | already done |
| G3 Advance help text | The pricing lead confirms the price. The costing model is on file and costing is attested; when capital is required ($0  | already done |
| G3 Advance rule + costing model + ROI model | [{"anyOf":[{"allOf":[{"op":"present","field":"pricing_record.price_approved_by"},{"op":"present","field":"pricing_record | already done |
| app_setting roi_required_when (provisional) | {"g2Outcomes":["capital_required"],"capitalLikely":true,"fundingModels":["CUSTOMER_FUNDED","ZERO_CER"]} | already done |
| role_permission: Finance (3 rows) + roi.upload for PricingLead and Admin | Finance:quote.read, Finance:quote.read.commercialFields, Finance:roi.upload, PricingLead:roi.upload, Admin:roi.upload | already done |
