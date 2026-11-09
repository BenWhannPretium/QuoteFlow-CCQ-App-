# Tracker updates from the Nov 6 and Nov 9 meetings (paste into QuoteFlow Feedback Tracker.xlsx)

Prepared 2026-11-09 from the Teams transcripts of three meetings: **CCQ | QuoteFlow Standard Pricing Options** (Nov 6; Bailey Schmitt, Gemma Cebolla, Kyle Arnold, Cait Catanzaro, Ben Whann), **Project Book Review** (Nov 6; Kal Kaliszewski, Bailey, Danielle Leu, Jim Zweifel, Ben) and **Costing, Pricing & ROI Alignment - CCQ** (Nov 9; Bailey, Gemma, Stacy Slocum, Oleg Yarovinski, Ben).

**Why this is a file and not an edit.** The tracker is an Excel workbook with formulas and charts. The Microsoft 365 connector can only replace a whole file, which would destroy them (`03-build-steps.md` change-log procedure). So the rows are below, ready to paste. Each block says which tab and where.

**Check before pasting:**
- Marking **D-001 Decided** flips Ready to Size to Y for F-031 automatically (its other blocker, D-013, is already Decided). Oleg was present but mostly listened; A-036 asks Bailey to confirm in writing. If you would rather wait for that, set D-001 to In Discussion and keep the outcome text.
- The transcripts are auto-generated and noisy (Cait is "Kade" in places; Gemma was driving). Only what was clear is recorded.
- New IDs are proposed (the last used are D-030, A-029, F-079). Change them if they are taken.
- Add the three meetings to the **Sessions** tab.

## 1. Decision Log: update existing rows (tab 7)

Columns: K = Status, L = Outcome / Rationale, M = Date Decided. Leave a cell as it is when "(unchanged)".

| ID | K Status | M Date Decided |
|---|---|---|
| D-001 | Decided | 2026-11-09 |
| D-002 | In Discussion | (unchanged) |
| D-003 | In Discussion | (unchanged) |
| D-029 | In Discussion | (unchanged) |
| D-005 | In Discussion | (unchanged) |
| D-023 | Decided | 2026-11-03 |

Outcome / Rationale (column L) for each row; replace the cell:

**D-001**

> Nov 9 (Bailey, Gemma Cebolla, Stacy Slocum, Oleg Yarovinski, Ben): costing, then ROI, then price confirmation, as steps inside Quoting. Pricing uploads the costing model (costs and the initial pricing assumptions). Stacy Slocum builds the ROI from it on her financial-model template (the board template) and uploads it. The pricing lead (Gemma) confirms the price, optionally uploading an updated price table, and the quote goes to Final Review. ROI is needed only when capital is required, $0 CER included. Stacy provides an input and is not an approver. This is option B with the parts in sequence, not a separate Costing gate and not in parallel. Bailey to confirm with Oleg in writing. Earlier note (Nov 3, Oleg): ROI and gross-margin targets are set by Oleg, validated by Stacy.

**D-002**

> Nov 9: first tier trigger proposed by Bailey: when the customer funds capital (customer-funded or $0 CER), Final Review needs two approvals, the sales leader first and then leadership (Sarah or a delegate). Gemma: it should be leadership and not Pricing, because the price is already approved and the question is whether the business wants the capacity commitment. Oleg: not settled in the session ("we'll figure it out"). Thresholds by revenue or capital are still open.

**D-003**

> Nov 6 (Gemma, Bailey, Kyle Arnold, Cait Catanzaro): payment terms and tooling funding are two separate things. The standard payment term is "ideally" Net 30 or Net 15; not chosen. A longer term is a negotiation lever because Pretium carries the borrowing cost, so the KAM records the customer's request at intake (D-032). For tooling funding, intake only needs to know whether the customer funds any of it. A tool the customer owns is not Pretium capital and brings sales-tax and contract terms (Tax). Nov 9: $0 CER and customer-funded see D-002.

**D-029**

> Nov 6 (Gemma): customer-funded tooling is paid upfront, 50/50 (at the order and at qualification) or amortized into the per-piece price. Gemma does not want quarterly installments (someone has to remember to invoice). Recommendation A plus these three as the milestone options. The net-days standard is still to confirm (A-012).

**D-005**

> Nov 6 (Kal Kaliszewski, Danielle Leu, Bailey, Ben): every item in a multi-item bid needs the same information as a standalone request. Today one ERF is filled in and Engineering builds a tab per item. Proposed: one record for the bid with items and a duplicate-and-edit action (container fields change; customer, delivery and drawing status mostly stay). Only related items belong together; an unrelated request is separate. Finance and the Engineering Program Office want one master reference. Not decided whether this is MVP. Recommendation: P1 (it needs a quote-items model and a change to one active quote per opportunity), with the bid file and the variants note as the MVP interim.

**D-023**

> (Outcome unchanged.) Nov 9 (Oleg): a $0 CER is an easy cash-flow decision but ties up capacity, and it must not slow the process. Gemma: treat it as a capital request with an ROI and let leadership decide whether to take the business. See D-002.

## 2. Decision Log: new rows (tab 7, below D-030; columns A to M)

Tab-separated. Paste at the first empty row of column A.

```
D-031	Label of the final Pricing gate	Today the gate and its orange box read "Price approved & capital ready". Stacy Slocum and Bailey: it reads like clearance to spend and invites POs before a CER exists (Nov 9).	A) "Price approved"; B) "Price approved & capital ready" (as built); C) "Ready for CER"	A	Bailey Schmitt	Stacy Slocum; Gemma Cebolla; Oleg Yarovinski; Ben Whann	ROI & capital session (Nov 9)	–	F-081	Decided	Nov 9: rename to "Price approved". Capital readiness stays a separate field on the quote; it is no longer part of the gate name. Agreed by Bailey, Gemma, Stacy and Ben; Oleg present.	2026-11-09
D-032	What the KAM captures at intake about payment, funding, packaging and freight	Pricing (Nov 6): payment terms and tooling funding are two different things. Pricing needs to know early what the customer is asking for so it is not an afterthought after award (Sam's: dunnage, freight and safety stock were missed in costing).	A) Capture a short set at intake; B) Leave all of it to Pricing after intake	A	Bailey Schmitt	Gemma Cebolla; Kyle Arnold; Cait Catanzaro	Standard Pricing Options (Nov 6)	–	F-080; F-063	Decided	Nov 6 (Gemma, Bailey): capture at intake (1) the payment terms the customer requests, flagged if non-standard (for awareness; Pricing does not need it to cost); (2) whether the customer funds any of the tooling or capital (not the amount); (3) a checkbox for returnable (multi-trip) dunnage, otherwise single-trip; (4) delivered or FOB price and, when delivered, the freight type (flatbed, van, drop trailer, T-bar) and any special arrangement. Drop trailers and T-bars are the expensive cases. Pretium has no packaging standard for returnable dunnage yet (A-033). Safety stock and stocking program were raised but not confirmed.	2026-11-06
D-033	Equipment BOM format and the customer-paid flag	Engineering Program Office keeps a project workbook (charter, scope, BOM in 11 sections, a one-page CSR BOM, resource sheets, action register). Bailey and Ben need the minimum Engineering fills in at quote time.	A) Upload the CSR BOM one-pager from the workbook; B) Rebuild the BOM as in-app rows; C) Keep free text	A	Kal Kaliszewski; Bailey Schmitt	Danielle Leu; Jim Zweifel; Ben Whann	Project Book Review (Nov 6)	–	F-058; F-026	Decided	Nov 6 (Kal): at quote time the BOM is a generic ballpark. The one-page CSR BOM (scope, assumptions, high-level cost by category, total) is what goes with the ERF; the detailed BOM comes after CER approval and is usually a little smaller. Each BOM line carries a flag: C for capital, P for customer paid (QuoteFlow uses the same wording). The workbook has a tax column that is not automated; a plant tax lookup would need the plants' tax status (A-034). Still needed: a blank template and Kal's minimum fields (A-030).	2026-11-06
```

## 3. Action Items: update existing rows (tab 8)

| ID | F Status | H Notes |
|---|---|---|
| A-015 | Done | Held Nov 9 (Bailey, Gemma, Stacy, Oleg, Ben). Outcome: D-001, D-031. |
| A-022 | Done | Held Nov 6 as "CCQ | QuoteFlow Standard Pricing Options" (Bailey, Gemma, Kyle, Cait, Ben). Outcome: D-029, D-032. The Net 15 / Net 30 standard is still open under A-012. |
| A-003 | In Progress | Kal's "Project Book Review" was held Nov 6; he walked through the workbook (D-033). Still needed: a blank template and the minimum fields (A-030). |

## 4. Action Items: new rows (tab 8; columns A to H)

```
A-030	Say which tab of the blank Pretium Project Workbook Template is the one-page CSR BOM and what the minimum fields are for a quote. The blank template was emailed to Bailey (cc Ben) on 11/4; the Hormel example holds a real customer's data and should not be sent	Kal Kaliszewski	Project Book Review (Nov 6)	[Set date]	Open	F-058; D-033	Template link already received (Kal, 11/4). Needed for the one-page extraction, not for the upload.
A-031	Send the standard costing-model template and Stacy Slocum's ROI template, with which cells carry cost, price, contribution margin and ROI/payback	Gemma Cebolla; Stacy Slocum	Costing, Pricing & ROI Alignment (Nov 9)	[Set date]	Open	F-031; D-001; D-013	Uploads can be built without them; the one-page summary needs the cell map.
A-032	Ask IT for a Finance app role and group so Stacy Slocum can upload the ROI model (suggested CCQ.Finance and SG-CCQ-Finance; the Entra steps are in runbook 06)	Ben Whann; Vincent Brown (IT)	Costing, Pricing & ROI Alignment (Nov 9)	[Set date]	Open	F-083; D-001	Stacy wants to take her assumptions from QuoteFlow, not email.
A-033	Define Pretium's standard terms for returnable (multi-trip) and single-trip dunnage, and confirm whether safety stock and a stocking program belong at intake	Bailey Schmitt; Gemma Cebolla; Faron Ipox	Standard Pricing Options (Nov 6)	[Set date]	Open	F-063; F-080; D-032	Gemma: Pretium has no standard and needs one.
A-034	Find out which plants are sales-tax exempt for tooling and the rate, so a lookup can be built into the BOM later	Gemma Cebolla (Tax); Kal Kaliszewski	Project Book Review (Nov 6)	[Set date]	Open	D-033; F-058	Bailey will also raise it in the Ranger cost-model talks.
A-035	Confirm with Oleg and Sarah the extra approval when the customer funds capital (sales leader, then leadership) and its triggers	Bailey Schmitt	Costing, Pricing & ROI Alignment (Nov 9)	[Set date]	Open	D-002; D-023; F-082	Oleg did not settle it on Nov 9.
A-036	Confirm the D-001 outcome (costing, ROI, price confirmation) with Oleg in writing	Bailey Schmitt	Costing, Pricing & ROI Alignment (Nov 9)	[Set date]	Open	D-001	Oleg joined late and mostly listened.
```

## 5. Build Backlog: update existing cells (tab 3)

Set the named column on the named row.

| ID | Column | New value |
|---|---|---|
| F-031 | Acceptance Criteria | Pricing uploads the costing model (costs and initial price assumptions) and the Finance ROI owner uploads the ROI model; QuoteFlow keeps both as versioned files and shows file, version, uploader and date on the quote and at Final Review. The one-page summary of cost, price, contribution margin and ROI follows once the standard templates are provided (A-031). |
| F-032 | Item (short title) | Costing, then ROI, then price confirmation before Final Review |
| F-032 | Detail / Context | Agreed Nov 9 (D-001): sequential steps inside Quoting, not a separate gate and not in parallel. Pricing uploads the costing model, Finance uploads the ROI (only when capital is required, $0 CER included), then the pricing lead confirms the price. Replaces "separate Costing gate; Pricing + ROI in parallel". |
| F-032 | Validated (Y / N / Pending) | Y |
| F-032 | Validation Basis | Agreed Nov 9 by Pricing, Finance (ROI) and the PMO; sponsor present (D-001) |
| F-032 | Acceptance Criteria | The pricing lead cannot confirm the price until the costing model is uploaded and, when capital is required, the ROI model is uploaded; each step shows who completed it and when. |
| F-058 | Detail / Context | Nov 6 (Kal, D-033): the equipment BOM is an upload of the one-page CSR BOM from the Engineering Program Office workbook (generic ballpark at quote time), with each line flagged C (capital) or P (customer paid). Replaces the in-app rows idea. |
| F-058 | Acceptance Criteria | One required equipment BOM upload replaces the downstream equipment and equipment BOM text fields; a quote with capital required cannot leave Engineering without it; the uploaded file keeps the C / P flag. |
| F-063 | Priority | P0 – MVP (returnable dunnage only; safety stock and stocking program stay P1 until A-033) |
| F-063 | Validated (Y / N / Pending) | Y |
| F-063 | Validation Basis | Pricing (Gemma Cebolla) confirmed Nov 6 |
| F-021 | Notes | Nov 6: the customer's requested payment terms are captured at intake (F-080). This item still covers who owns and approves the standard term and exceptions (D-003). |
| F-068 | Notes | Nov 6 and Nov 9: the KAM pre-fills whether the customer funds capital at intake (F-080). A customer-funded quote may need a leadership approval at Final Review (F-082, D-002). |

## 6. Build Backlog: new rows (tab 3; columns A to S, with column M, Ready to Size, left to its formula)

```
F-080	Standard Pricing Options (Nov 6)	Intake	Commercial inputs at intake: payment terms, customer funding, dunnage, delivery and freight	New Capability	Costing elements (dunnage, freight, safety stock) were found after award on Sam's. Pricing wants the customer's asks at intake: requested payment terms, whether the customer funds tooling or capital, returnable dunnage, delivered or FOB price and the freight type and special arrangements (drop trailer, T-bar).	Gemma Cebolla; Kyle Arnold; Cait Catanzaro	Pricing	Y	Raised by Pricing; the process owner (Gemma) confirmed the list	Intake captures the customer's requested payment terms (flagged when non-standard), whether the customer funds any tooling or capital, returnable (multi-trip) dunnage, delivered or FOB price and, for delivered, freight type and special arrangements; Pricing and Final Review can see them; none blocks submit until the mandatory list is decided (D-006).	–		P0 – MVP	H	TBD	Ben Whann	New	Added from the Nov 6 pricing session. D-032.
F-081	Costing, Pricing & ROI Alignment (Nov 9)	Pricing & ROI	Rename the final Pricing gate to "Price approved"	Change	"Price approved & capital ready" reads as clearance to spend and invites POs before a CER exists.	Stacy Slocum; Bailey Schmitt	Finance; PMO	Y	Agreed in session (D-031)	The gate, its button, notifications and quick-starts say "Price approved"; capital readiness remains a separate field.	D-031		P0 – MVP	L	TBD	Ben Whann	New	Added from the Nov 9 ROI session.
F-082	Costing, Pricing & ROI Alignment (Nov 9)	Final Review	Extra Final Review approval when the customer funds capital	New Capability	Bailey proposed that a customer-funded or $0 CER quote needs the sales leader and then leadership (Sarah or a delegate) at Final Review. Gemma: leadership decides whether to take the business, not Pricing. Oleg: not settled.	Bailey Schmitt; Gemma Cebolla; Oleg Yarovinski	PMO; Pricing; Sponsor	Pending	Proposed in session; sponsor did not settle it	When the funding model is customer-funded or $0 CER, Final Review also needs a leadership sign-off after the sales leader's; triggers and approvers are configurable.	D-002		P1 – Before Full Rollout	M	TBD	Ben Whann	New	Build as provisional config in FB-08 once A-035 confirms it.
F-083	Costing, Pricing & ROI Alignment (Nov 9)	Pricing & ROI	Finance role uploads the ROI model	New Capability	Stacy Slocum wants to take her assumptions from QuoteFlow and upload the ROI, not work from email. She is not a QuoteFlow user today.	Stacy Slocum	Finance	Y	Raised by the ROI owner; Pricing and the sponsor agreed	A Finance user can sign in, read quotes, and upload or replace the ROI model on quotes that need one, and nothing else.	–		P0 – MVP	M	TBD	Ben Whann	New	Needs an Entra app role and group (A-032).
F-084	Project Book Review (Nov 6)	Intake	Multi-item bids as one quote with items (duplicate and edit)	New Capability	Each item in a bid needs the same information as a standalone request. Danielle's solution: one record with items and a duplicate-and-edit action; only related items together. Needs a quote-items model and a change to one active quote per opportunity.	Danielle Leu; Kal Kaliszewski; Bailey Schmitt; Kyle Arnold	Engineering; PMO; Pricing	Pending	Proposed in session; not decided for MVP (D-005)	A KAM can add related items to one request, duplicate an item and change only its container fields; Engineering and Pricing evaluate each item and the quote rolls up under one master reference.	D-005		P1 – Before Full Rollout	H	TBD	Bailey Schmitt	New	MVP interim: the bid file, the variants note (F-075) and F-085.
F-085	Standard Pricing Options (Nov 6)	Intake	Bid / program reference across related quotes	Change	Finance and Pricing want one master number or link across related quotes (one ERF per plant today).	Kyle Arnold; Gemma Cebolla	Pricing	Y	Raised by 2 people in Pricing	Intake has an optional short bid / program reference, searchable and shown to Engineering, Pricing and Final Review.	–		P1 – Before Full Rollout	L	TBD	Ben Whann	New	Rides along with F-080 if cheap.
```

Column M holds a formula (`Ready to Size`). When you paste, skip it: copy the formula down from the row above so it keeps working. In the block above the M position is the empty cell between "Blocked By" and "Priority".

## 7. After pasting

1. Check the Summary tab's open-decision count and the Ready to Size counts: F-031 and F-032 should read Y, F-058 stays N until A-030 is done.
2. Refresh the Change Log tab (Data → Refresh All). The matching Change Log rows are already in `QuoteFlow Change Log.csv`.
3. **Change Log file.** The connector can only replace the whole `QuoteFlow Change Log.csv` in SharePoint, and retyping it risks damaging the history, so the complete, current file is in this folder: [`QuoteFlow Change Log.csv`](<QuoteFlow Change Log.csv>), generated from `feedback-change-log.md` (it adds the five FB-04 rows the SharePoint copy is missing, marks the FB-05 rows Merged, and adds today's row). Upload it over the SharePoint file (same name, same folder), then refresh the Change Log tab. Regenerate it from the markdown whenever the log changes.
4. **Also record from the inbox (Nov 4):**
   - **A-006** (engineering roles): Paul Slomkowski's email lists Rany [sic; tracker says Randy] Neiberger for PET (ISBM, RHB and Injection) and Rafael Pasillas for polyolefins (EBM and IBM). Paul also said he is good with all the drawing formats (A-021, done).
   - **A-024** (no-drawing minimum set): Paul wants a picture of the container plus material type, color, **layer structure**, gram weight, finish size, height, width and depth. Jim (Nov 5) lists height, width, depth, weight and neck finish, with a photograph "always helpful". The two still differ on layer structure and the photo; leave A-024 open.
   - **D-019** (concept projects): Paul says Innovation and Concepts should be handled by Danielle's team until a concept drawing exists. Danielle says a concept project should select a type that minimizes the required fields, and that an opportunity is required before concept design starts.
   - **D-022** (plant operations): Paul says for a customer quote plant engagement should be as-needed to answer Engineering's questions on existing line capabilities; for a CER the plants should be fully engaged.
   - **A-023** (Faron's utilization formula): his Nov 4 email repeats "trending OEE" twice in step 2, so the typo question is still open.
