# UAT script: Tie-out (CCQ ↔ Salesforce ↔ pricing history ↔ Fabric)

| | |
|---|---|
| Session | **U5**, Thu Nov 12 (45 min). Run by Ben Whann with Zac Cairns, Graham Parle and D&A (Brennan Paul's engineer). Gate 5 requirement. |
| Tester roles | Salesforce reviewers (Zac, Graham), D&A reviewer, Ben (driver, signed in as Admin) |
| Test URL | https://quoteflow-test.azurewebsites.net (or prod, if production data is approved and loaded by then) |
| Sign in | Ben signs in with an account in **`SG-CCQ-Admin`**. The commercial check in Part D also needs one D&A account that is **not** in a commercial group. |
| Before you start | Ben runs a Salesforce sync (**Admin** → **Integrations**) and notes the time. The pricing-history export is imported (same page). The Fabric test mirror shows **Running** (B-27). Zac has Salesforce open with read access to the same opportunities. |
| How to log a problem | Use **Report an issue**. A mismatch in data is **Sev-2**. |

## Part A: Pick the 20 quotes

Bailey and Zac pick 20 quotes that cover every stage and outcome. Ben fills the list before the session.

| Slot | Mix | Quote number | SF opportunity |
|---|---|---|---|
| 1–3 | Intake (one returned for rework) | `<CCQ-T01..03>` | `<SF-OPP-T01..03 chosen by Bailey>` |
| 4–6 | Engineering Review | `<CCQ-T04..06>` | `<SF-OPP-T04..06>` |
| 7–9 | Quoting (one with a legacy ERF #) | `<CCQ-T07..09>` | `<SF-OPP-T07..09>` |
| 10–11 | Final Review | `<CCQ-T10..11>` | `<SF-OPP-T10..11>` |
| 12–14 | Customer Decision (one in negotiation, one past validity) | `<CCQ-T12..14>` | `<SF-OPP-T12..14>` |
| 15 | Commit & Hand Off | `<CCQ-T15>` | `<SF-OPP-T15>` |
| 16 | Closed – Won | `<CCQ-T16>` | `<SF-OPP-T16>` |
| 17 | Closed Lost | `<CCQ-T17>` | `<SF-OPP-T17>` |
| 18 | Declined or Redirected | `<CCQ-T18>` | `<SF-OPP-T18>` |
| 19–20 | Customer marked **Not yet established** | `<CCQ-T19..20>` | `<SF-OPP-T19..20>` |

## Part B: CCQ against Salesforce (each of the 20)

Open the quote in CCQ (**Overview** tab and the **Customer decision** panel) and the opportunity in Salesforce side by side. CCQ never writes to Salesforce, so CCQ shows what Salesforce had at the last sync.

| Field | Where in CCQ | Where in Salesforce |
|---|---|---|
| Opportunity | **Intake** card → **Opportunity** | Opportunity Name |
| Account / customer | **Intake** card → **Customer**, **Customer status** | Account Name |
| Owner | **Intake** card → **KAM** | Opportunity Owner |
| Amount | **Pipeline** column **Amount (SF)** | Amount |
| Close date | **Intake** card → **Expected close** (and the **Close date** column) | Close Date |
| SF stage | **Customer decision** → **Salesforce stage**, or **Pipeline** column **SF stage** | Stage |
| ERF number | **Admin** → **ERF linkage** → **SF ERF #** and **CCQ ERF #** | ERF number field |
| Opportunity id | **Admin** → **ERF linkage** → **SF opportunity** | Opportunity Id (URL) |

| # | Quote | Opportunity / account / owner match | Amount and close date match | SF stage matches the last sync | CCQ ↔ SF stage mismatch flag is right | ERF # linkage right | Pass/Fail | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | `<CCQ-T01>` | | | | | | | |
| 2 | `<CCQ-T02>` | | | | | | | |
| 3 | `<CCQ-T03>` | | | | | | | |
| 4 | `<CCQ-T04>` | | | | | | | |
| 5 | `<CCQ-T05>` | | | | | | | |
| 6 | `<CCQ-T06>` | | | | | | | |
| 7 | `<CCQ-T07>` | | | | | | | |
| 8 | `<CCQ-T08>` | | | | | | | |
| 9 | `<CCQ-T09>` | | | | | | | |
| 10 | `<CCQ-T10>` | | | | | | | |
| 11 | `<CCQ-T11>` | | | | | | | |
| 12 | `<CCQ-T12>` | | | | | | | |
| 13 | `<CCQ-T13>` | | | | | | | |
| 14 | `<CCQ-T14>` | | | | | | | |
| 15 | `<CCQ-T15>` | | | | | | | |
| 16 | `<CCQ-T16>` | | | | | | | |
| 17 | `<CCQ-T17>` | | | | | | | |
| 18 | `<CCQ-T18>` | | | | | | | |
| 19 | `<CCQ-T19>` | | | | | | | |
| 20 | `<CCQ-T20>` | | | | | | | |

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 21 | **Admin** → **Integrations**. Read the last Salesforce run. | It succeeded, today, with a row count. No failures since the last fix. | | |
| 22 | In Salesforce, change nothing. Check that no CCQ field was written back to any of the 20 opportunities (Zac checks field history). | No write from the CCQ integration user. | | |
| 23 | **Admin** → **ERF linkage**. Read the counts for **Match**, **Mismatch**, **SF only**, **CCQ only** and **Neither**. | Every **Mismatch** is explained (Notes). | | |

## Part C: CCQ against the pricing-history import

Pick 5 of the 20 that have an ERF in the pricing app (Bailey's list: `<CCQ-T07..09>`, `<CCQ-T12>`, `<CCQ-T16>`).

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 24 | Open each quote → **Quoting** tab → **Pricing history**. | The customer's ERFs and SPRs are listed. The quote's own ERF is tagged **Quote ERF**. | | |
| 25 | Follow the link to **Pricing history**. Compare each record with the pricing app (or the export file). | Number, customer, product, dates and the estimate and price fields match. Nothing is editable. | | |
| 26 | Count the records for one customer in the export file and in **Pricing history**. | Same count. | | |
| 27 | In the price approval record, check **Legacy ERF #** against the pricing app. | Same number. CCQ holds no price figure of its own. | | |

## Part D: CCQ against the Fabric mirror (B-27)

Ben runs the CCQ counts with a read-only SQL login on the test Postgres. D&A runs the Fabric counts on the mirrored database's SQL analytics endpoint. Run both within 5 minutes and pause testing on the app while you do.

| # | Action | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 28 | D&A: open the mirrored database in Fabric. | Status **Running**. **Admin** → **Integrations** shows the last Fabric check as healthy. | | |
| 29 | Both sides: `SELECT COUNT(*)` for each table in the table below. | Every count matches, or differs only by rows written in the gap (re-run to confirm). | | |
| 30 | Both sides: `SELECT COUNT(*) FROM audit_event` (CCQ) and `FROM audit_event_fabric` (both). | The three counts are equal. | | |
| 31 | Pick 5 of the 20 quotes. For each, compare the `quote` row field by field (CCQ vs Fabric): `quote_number`, `sf_opportunity_id`, stage, status, version, KAM, customer, product fields, `submitted_at`, `closed_at`, outcome, reason code. | Every field matches. Timestamps match in UTC. | | |
| 32 | For the same 5, compare their `gate_decision` and `stage_history` rows. | Same rows, same deciders, same times. | | |
| 33 | For one quote, compare a `jsonb` field with its `_json` text twin in Fabric (for example the gate decision evidence). | The `_json` text holds the same content. | | |
| 34 | For `pricing_history_record`, compare one estimate value. | Same value with its decimals (not rounded to a whole number). | | |
| 35 | Note the time of a new gate decision in CCQ. Check when it shows in Fabric. | It appears. Write the latency in Notes. | | |
| 36 | Sign in to Fabric as the D&A account that is **not** in a commercial `SG-CCQ-*` group. Query `pricing_record`, `pricing_history_record`, `eng_review.prelim_capital_usd` and the `capacity_evidence` numbers. | Access is denied, or the commercial columns are hidden. | | |
| 37 | Repeat step 36 with an account in a commercial group (for example `SG-CCQ-Pricing`). | The commercial columns are readable. | | |
| 38 | As the non-commercial account, query the `_json` companions of the tables in step 36 (and `audit_event_fabric`). | No commercial value can be read through a `_json` column either. | | |

**Tables for step 29** (tick each; D&A decides whether the two marked D-FB2 are mirrored):

| Table | CCQ count | Fabric count | Match |
|---|---|---|---|
| `quote` | | | |
| `quote_draft` | | | |
| `customer` | | | |
| `stage_history` | | | |
| `gate_decision` | | | |
| `quote_hold` | | | |
| `eng_review` | | | |
| `capacity_evidence` | | | |
| `pricing_record` | | | |
| `handoff_record` | | | |
| `override` | | | |
| `attachment` | | | |
| `comment` | | | |
| `activity_event` | | | |
| `notification` | | | |
| `feedback` | | | |
| `app_user` | | | |
| `user_role` | | | |
| `user_scope` | | | |
| `audit_event_fabric` | | | |
| `sf_opportunity_snapshot` (D-FB2) | | | |
| `pricing_history_record` (D-FB2) | | | |
| Config tables: `stage_definition`, `gate_definition`, `gate_outcome_definition`, `transition_rule`, `reason_code`, `value_list`, `app_setting`, `scoring_model` | | | |

## Sign-off

| Tester | Role | Date | Overall pass/fail | Comments |
|---|---|---|---|---|
| | Salesforce (Zac Cairns) | | | |
| | Sales Ops (Graham Parle) | | | |
| | D&A | | | |
| | Builder (Ben Whann) | | | |
