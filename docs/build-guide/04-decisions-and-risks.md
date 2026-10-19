# 04: Decisions, Open Questions, PRD Corrections, Risks

Rule for the build: **decided → code. Pending → config with a provisional seed. Undefined → defer.** (Operating Model §4.)

IDs `D-xx` match the CCQ Operating Model decision register where one exists. `D-H*` and `D-K*` are build-specific additions.

---

## 1. Decisions already locked for the build (2026-10-15)

| ID | Decision | Made by | Basis |
|---|---|---|---|
| L-1 | Host on **Azure** (App Service + PostgreSQL Flexible + Key Vault + App Insights). Replaces the Copilot Managed Runtime assumption: CMR hosts only TypeScript single-page apps with connector-based data, and has no app database or server code. | Ben (builder); **needs IT/Darren ratification at M1** (Gate 2) | PRD §6 lists Azure as Option A |
| L-2 | Code-first build with Claude Code; React + Node/TypeScript monorepo | Ben | EI web-app playbook direction (9/4, React/Node) |
| L-3 | Configurable stage/gate engine seeded with the hybrid model | Ben | Op Model §4 "configure what is pending"; R-01 mitigation |
| L-4 | MVP done = UAT-ready on approved data by **Fri Nov 13** | Ben | Asana REQ-8815 due date |
| DEC-12 | Every quote starts from a Salesforce opportunity | Sarah Brennan, 9/4 | Evidence base |
| DEC-20 | All pricing decisions go through Pricing | Kathleen Gogola, 9/21 (needs re-confirmation; she has left) | Evidence base |
| DEC-23 | Pricing method is out of scope; Pricing's final say is in | Darren, 10/6 | Evidence base |
| DEC-26 | MVP engineering routing = manual prioritized queue to the upfront eng lead; rules-based routing is P1 | Darren, 10/14 | Requirements Sync |
| DEC-27 | No customer-account setup at intake; existing vs not-yet-established | Darren, 10/14 | Requirements Sync |
| PRD §9 | Out of MVP scope: editing pricing, write-back, pricing-engine rebuild, post-award PM features, AI auto-prioritization, customer portal | PRD v1 | — |

---

## 2. Open decisions the build depends on (owner, needed-by, what ships if late)

| ID | Question | Recommended direction | Decision owner | Get it at | Needed by | If not decided, ship with |
|---|---|---|---|---|---|---|
| **D-16h** | Approve Azure hosting + resource groups + IT provisioning owner | Approve; test RG by Oct 21 | Darren + **Oliver Kade** (Brennan Paul consulted) | **M1** | **Oct 21** | ⚠ No fallback. UAT date slips day for day. |
| **D-H2** | Exposure: "internal only, no public domain" vs "phone access without VPN" | Private endpoint + Entra Application Proxy / Private Access; interim Easy Auth + CA in test | Oliver Kade | M1 / M2 | Oct 23 (test), Nov 6 (prod) | Easy Auth + Conditional Access |
| **D-23** | Production-data approval. **The 205 live SF records already in Bailey's prototype** conflict with the PRD's own sample-data rule. | Get IT + D&A approval now; purge or approve the prototype copy | Darren; approvers **Oliver Kade + Brennan Paul** | M1, confirm at M9 | Nov 2 | UAT on the SF UAT org + masked data ("UAT-ready on masked data") |
| **D-17** | Application support model ("if you build it, you support it") | IT hosts/patches/monitors; EI fixes app defects for 90 days of hypercare; named on-call | Darren + Oliver Kade | M1 (principle), M9 (detail) | Nov 2 | Ben + Tre as interim support; risk logged |
| **D-05** | Minimum intake set + "stop vs enrich" | PRD F-03 ∪ 10/14 demo list ∪ Jim's list + **neck finish + packaging**; blocking = SF opp, customer, ship-to, product family, resin, volume | Jim Zweifel + sales leadership | **M4** | Oct 20 | Seed list (provisional) |
| **D-06** | G1: who qualifies; min value/volume screens (3M IBM vs 300k resin; $18k example) | Sales leader decides; screens as **warnings** in MVP | Sales leadership (Jack Gordon) | M4 | Oct 23 | `SG-CCQ-SalesLeader` = provisional; warnings off |
| **D-19** | Scoring attribute set + weights (PRD 7 vs prototype 7, X-89) | PRD set, equal-ish weights, **advisory only**; Knowledge Steward governs | Jim Zweifel + sales leadership; approver Process Owner | M4 | Oct 23 | PRD set, provisional v1 |
| **D-OA** | Who approves priority / ship-to overrides (blueprint gap) | Priority: SalesLeader or EngLead; ship-to: self + logged | Bailey to confirm with Darren | R1 | Oct 27 | As recommended (config) |
| **D-10** | Final Review (G4) approver(s) and tiers | Interim: sales leader within the Pricing-approved range; tiers aligned to the CER matrix later | Sarah Brennan via **Bailey's decision package** | D-pack | **Oct 28** | Provisional members of `SG-CCQ-Approver` named by Darren |
| **D-15** | Outcome taxonomy, reason codes, closure owner | Op Model §5.2 taxonomy; KAM records, sales leader accountable | Sales leadership + Process Owner; approver sponsor | D-pack | **Oct 28** | Seeded taxonomy (provisional) |
| **D-12** | Quote validity default (30 days PTF vs 60-day proposals) | Record the date in MVP; default 30; alerts only | Pricing + Sales leadership | D-pack / R3 | Oct 28 | 30 days (provisional) |
| **D-K1** | Can KAMs see peers' priority scores? | Yes (PRD lean); override log restricted to leadership | Darren / Sarah | D-pack | Oct 28 | Yes (setting) |
| **D-18** | Authoritative source for customer + ship-to (SF Account vs ERP customer master) | SF Account for MVP; flag gaps | Zac Cairns + Graham Parle; data owner TBD | **M3** | Oct 21 | SF Account |
| **D-PR** | Pricing-app read path (SQL replica vs Fabric) + columns + sensitivity labels | Whichever Cory can grant fastest | Cory McGahan, Gemma Cebolla, Brennan Paul | **M5** | Oct 21 | Manual ERF/BPR reference fields. *B-15 built both routes behind `PRICING_MODE` (fake until M5); see the B-15 questions below.* |
| **D-SP** | SharePoint site/folder for attachments; `Sites.Selected` grant | `/CCQ/{quote_number}/` on the CCQ site | IT M365 admin + Bailey | **M7** | Oct 27 | Azure Blob behind the same interface |
| **D-03** | Stage-gate model (PRD 5 vs Op Model 6) | Configurable engine, hybrid seed. **Steering can relabel without code.** | Oleg Yarovinski; approver CCQ Steering | Bailey's decision package | Before scale | Hybrid seed |
| **D-16w** | Salesforce write-back | None in MVP | Darren + Salesforce owner | — | Before scale | Read-only |
| **D-20** | SLA / turnaround targets | Set after baseline + pilot | Process Owner | — | After pilot | Aging buckets only, no SLA |
| **D-02** | Process Owner / Knowledge Steward | Commercial-side owner + Rules Steward | Sarah Brennan | — | Before pilot | Admin = Ben/Tre; Bailey approves config |

**Provisional choices B-08 shipped for M4 to confirm (D-06, D-19).** All are config rows, not code:

- **Scoring v1** (`scoring_model` v1, `packages/domain/src/scoring/seeds.ts`): the PRD's 7 attributes with weights 0.20 / 0.15 / 0.15 / 0.15 / 0.10 / 0.15 / 0.10 (sum 1), the bands in the B-08 prompt, and **neutral** strategic-fit and product-fit maps (every market and product family+resin = 50) so nothing is favoured before the business says so. Tiers Critical ≥ 80, High ≥ 60, Standard ≥ 40, Low. The 10/14 prototype set can be loaded as v2 with no code change (a unit test proves it).
- **G1 decider:** `gate.G1.decide` → SalesLeader only (seed of `role_permission`), and a SalesLeader cannot qualify an opportunity they own as KAM (segregation rule).
- **G1 outcome rules:** Hold needs a reason code and a review date; Rework needs a reason code and a note (shown to the KAM as "what to fix"); Redirect needs a reason code; Stop needs a reason code and a note and closes as **DECLINED** (an internal "won't pursue", not a customer loss).
- **Qualification screens (D-06):** `min_opportunity_value_warning_usd` (null) and `min_volume_warning_by_process` (`{}`; the key `*` applies when the process is not known yet, which is the usual case at G1) only warn. New setting `qualification_exception_note_outcomes` (seed `["G1:advance"]`): advancing a warned quote needs a strategic exception note. Set it to `[]` to make the warnings purely informational.


**Provisional choices B-09 shipped for R1 to confirm (D-OA, blueprint gap).** All config (`app_setting`), not code:

- **`overridable_fields`**: `priority_tier` → approval by **SalesLeader or EngLead** (requested by KAM, SalesLeader, EngLead, Pricing; reverted by SalesLeader, EngLead, Admin); `ship_to` → **self-applied by the KAM on their own quotes (or a SalesLeader), logged**, reverted by the requester, SalesLeader or Admin; `queue_position` → **EngLead pins, self-applied**. Admin holds `override.approve` in the matrix but is not a configured approver, so it approves nothing until R1 says otherwise. Nobody decides their own request.
- **`override_justification_min_length`** = 15 characters.
- **New permission `audit.read`** (Leadership + Admin): the usage audit viewer, its CSV export and the usage report ("config.manage + Leadership read").

**Provisional choices B-10 shipped for R2 (Oct 29) to confirm (DEC-26, D-20, R-04).** Config rows, not code, except where noted:

- **G2 outcome rules** (workflow config, 9/15 interim one-pager): Proceed / Proceed with risk need process, machine, plant/site, cavitation, cycle time + ≥ 1 capacity row (risk: + note); Capital required needs the preliminary capital only; Hold: reason + review date; Rework (Return to KAM): reason + note; Stop: reason + note, closes as **DECLINED**. *Ask R2:* is that the right solution field set (e.g. Assembly has no cavitation)? Should Capital required also need capacity evidence?
- **`eng_queue_aging_days`** = { aging: 3, old: 10 } business days (US Central, no holiday calendar). 3 is Jim's unwritten target. **Buckets only, not an SLA** (D-20 stays open).
- **`eng_queue_backup_assigner_user_ids`** = [] (R-04 / BR-8). *Ask R2:* who covers for Jim? Add their app_user id; they need a role that can open the queue (Engineer or EngLead).
- **`capital_readiness_on_outcome`** = { "G2:capital_required": "pending" }.
- **New permission `engQueue.read`** (EngLead, Engineer, Leadership, Admin): the queue page.
- **Engineers do not read commercial numbers** (architecture §3.3): prelim capital and the capacity figures are write-only for an assigned Engineer. *Ask R2:* should an Engineer see the numbers on quotes assigned to them? That would be a matrix change (an `assigned` qualifier on `quote.read.commercialFields`) agreed with the data owners.
- **Accept** is open to the EngLead and the assigned engineer. *Ask R2:* lead-only?

**B-15 questions for M5 (Wed Oct 21: Cory McGahan, Gemma Cebolla, Brennan Paul) (D-PR).** B-15 was built on 2026-10-16, before M5, with the fake reader as the default and both real routes ready behind `PRICING_MODE`. Code, not config, where noted:

- **Route A or B?** `PRICING_MODE=sqlserver` (read-only SQL login, encrypted, `ApplicationIntent=ReadOnly`, password from Key Vault) or `PRICING_MODE=fabric` (SQL analytics endpoint, managed identity). Either needs only env settings; record the choice in `03-build-steps.md` (B-15).
- **View names and every column** (code: `packages/integrations/src/pricing/columnMap.ts`). The ERF figure, decision, flag and elapsed-day columns use the names in Cory's 2026-09-22 export (`evidence`); the key, customer, description, dates, all BPR and all SPR columns are **guesses** (`placeholder`). *Ask Cory:* the views he will expose (names, schema), the key column types, how a BPR points at its ERF (a column, or a link table: cardinality is not 1:1), whether the pricing app carries the SF opportunity id, the exact accepted/rejected/abandoned flag columns, and whether a 0 in revenue/volume/capital ever means "blank" (B-15 treats only NULL/blank as unknown).
- **Sensitivity labels** (code: `packages/domain/src/policy/sensitivity.ts`). Provisional: every pricing-app record (ERF, BPR, SPR) is commercial as a whole, for Pricing / EngLead / Approver / Leadership / Admin only. *Ask Gemma:* is that the right role list (architecture §3.3), and may any ERF field (e.g. the decision or elapsed days) go to KAMs or Engineers?
- **Linkage rule** (code): the first ERF reference recorded on the pricing record becomes `quote.erf_number` when the quote has none; it never overwrites. A different SF ERF number is a warning only (CCQ never writes to SF). *Ask Gemma* if Pricing wants to be able to correct `quote.erf_number`.

**Provisional choices B-11 shipped for R3 (Thu Nov 5, Gemma Cebolla + pricing analyst) and M5 (Cory McGahan) to confirm (DEC-19/20/23, D-10, D-11, D-PR).** Config rows, not code, except where noted:

- **G3 outcome rules** (workflow config): Submit needs the price approver and approval time, at least one ERF / BPR reference **or** a "no pricing-app record yet" note, and a capital readiness status; **pending capital needs a justification** and then shows as a warning on the decision (D-11 is open: warn, don't block). Hold: reason + review date. Rework (back to Engineering): reason code only, bumps the version. **Stop: reason + note, closes as DECLINED** (was CLOSED_LOST): Pricing's "won't pursue" is internal, like G1/G2. *Ask R3:* should "Costing completed" (CR-25) be required to submit rather than a warning? Should "capital not approved" block?
- **`pricing_ref_formats`** = ERF `^\d{4,7}$` (e.g. 26367, the shape in the SF fixture), BPR `^(BPR-?)?\d{3,10}$`: **guesses**. *Ask Cory at M5* for the real formats; change the setting.
- **Price approver** = any active user holding a role with `quoting.edit` (today: Pricing). Defaults to the caller in the UI.
- **Versioned pricing records** (code): one `pricing_record` per quote version. Entering Quoting on a new version (G2 after a G3 Rework, G4 Return, G5 Re-quote) starts a new record carrying forward only the ERF / BPR and CER references; the approval is recorded afresh and the prior version's record is never edited (CR-38).
- **Segregation** (config): new deny `actor_is_price_approver`, rule `g4-price-approver-cannot-release`: whoever recorded the price approval or decided G3 on the current version cannot decide G4, even if they also hold the Approver role.
- **New permission `pricingQueue.read`** (Pricing, Leadership, Admin): the queue page ("role Pricing; Leadership read"). Admin added for parity with the engineering queue. **The nav changed:** Leadership and Admin now get "Pricing queue"; Admin's mobile tabs are home, intake, engineering queue, pricing queue + More (Pipeline moves under More).
- **Capital readiness is commercial**: it joins the redaction registry, so KAMs, Engineers and SalesLeaders no longer see it anywhere.
- **D-11** is cited by the B-11 prompt as open but has no row in the table above yet. *Ask Bailey* to add it (what "capital ready" means before Final Review).

**Provisional choices B-12 shipped for the D-pack (Oct 28) to confirm (D-10, D-12).** Config rows, not code:

- **Who approves (D-10): still open.** Approver = members of `SG-CCQ-Approver` (IT). No names are in code or seeds. *Ask Darren / Sarah via Bailey:* confirm the members, and whether a sales leader within delegation holds the Approver role.
- **`g4_tier_rules`** = `null` (disabled): any Approver may release any quote. The hook exists for tiers by preliminary capital or annual revenue naming approver roles or user ids (aligned to the CER matrix later).
- **`validity_days_default`** = 30 (D-12, provisional). Approve sets `validity_until` = issue date + 30 days (US Central calendar); the approver may change the issue date to the actual send date (not in the future).
- **Decline** is an internal no-go: closes as DECLINED with a `decline` reason + note; the Approve / Decline / Return outcomes never set Awarded or Lost (X-88).
- **Segregation (config):** the approver is not the quote's KAM and not the Pricing approver / G3 submitter on that version, on every G4 outcome.

**Provisional choices B-13 shipped for the D-pack (Oct 28) and R3 (Nov 5) to confirm (D-12, D-14, D-15).** Config rows unless marked "code":

- **D-15 (outcome taxonomy, reason codes, closure owner): still provisional.** Not approved as of 2026-10-16, so every `reason_code` row stays `provisional = true` with no `approved_by`. When D-15 lands, Admin edits the rows (or the seed) and sets `provisional = false` + `approved_by`; no code change. The outcomes report shows a "provisional taxonomy" banner until then. Seeded:
  - **Lost:** price, lead time, capability, capacity, customer cancelled, competitor relationship, other (note required). Optional competitor name, kept on the decision.
  - **Expired:** no customer response, proposal validity lapsed.
  - **Re-quote:** scope / volume / resin / terms change, other (note required). The B-03 `price_change` and `validity_lapsed` re-quote codes are retired (inactive, kept so old decisions keep their labels).
  - **Awarded (new context `awarded`):** the acceptance evidence is the reason code: verbal award, PO, LOI, contract (also `handoff_record.acceptance_evidence`).
  - **On hold** reuses the `hold` codes (awaiting customer info / capital decision / internal input, customer requested delay) and now **requires** one (it was optional at G5).
- **Closure owner (D-15, "KAM records, sales leader accountable"):** customer outcomes (G5 Awarded / Lost / Expired) default to the quote's KAM; internal no-gos (G1 Stop / Redirect, G2 Stop, G3 Stop, G4 Decline) default to the decider (CR-40). `transition_rule.closure_owner` (kam | decider). New permission **`outcome.assignOwner`** (SalesLeader): only a sales leader may name someone else (themselves or another user). *Ask the D-pack:* is that the right accountability split?
- **The closure rule is enforced, not configurable (code, CR-39):** any closing transition needs a reason code even if its outcome row says otherwise, and the database has a CHECK (`quote_closure_complete_check`). Config that lets a closing outcome skip the reason is refused at load.
- **"No response / Expired" before the validity date needs a note** (e.g. "customer confirmed the project is shelved"); after the date the reason alone is enough. *Ask:* should Expired be allowed at all before the validity date?
- **D-12 (validity): no auto-close.** The daily expiry job (`VALIDITY_EXPIRY_INTERVAL_HOURS` = 24, advisory lock) flags `validity_expired_flagged_at`, writes a `validity_expired` timeline event and tells the KAM "Revalidate or record the outcome" (in-app; email is B-18). It never changes stage or status. A new release (after a re-quote) clears the flag. **`validity_warning_days`** = 7 (amber at ≤ 7 days left, red once expired). Revalidation (extend the date without a re-quote) is **not built**: it waits for D-12.
- **SF stage mismatch** is flagged only when either side is an outcome (a terminal CCQ stage, or an SF stage `sf_stage_map` hints at a terminal stage), e.g. CCQ "Customer Decision" vs SF "Closed Won – Product Shipping". Mid-pipeline differences (CCQ Engineering Review vs SF "Qualifying") are shown side by side but not flagged, because SF stages are used loosely before the outcome. *Ask R3 / Rachel Dew* whether that is the right noise level.
- **Hand-off (Stage 6, minimal; CR-41/42):** acceptance evidence + date + optional document link (from the Awarded decision), CER ID, BPR ID (references only, no integration), receiving role (`handoff_receiving_roles`: Commercial Activation, NPI post-award technical PM, other + name), receiving contact, accepted-by date, notes, "Hand-off complete" (records who and when; needs role, contact and date). New permission **`handoff.edit`** (KAM own, SalesLeader, Admin). *Confirm the fields with Amanda Cronkhite at R3 (optional);* D-14 (the P2 post-award view for Nicole Donnelly / Anne DeSmet) is untouched.
- **Outcomes report** (`GET /admin/reports/outcomes`, page `/admin/reports/outcomes`) is read by `analytics.read` (SalesLeader, EngLead, Pricing, Approver, Leadership, Admin), not only Admin, because sales leadership owns the capture rate. Capture rate = recorded customer outcomes ÷ (recorded + "gone dark": open in Customer Decision past validity); proposals still within validity are pending, not missing. Win rate = awarded ÷ (awarded + lost); expired is excluded.

**Provisional choices B-14 shipped (pipeline views), to confirm in R2 / R3:**

- **KAMs see peers' priority** per `kam_can_see_peer_scores` (D-K1, default `true`). When it is `false`, peers' tier and score are withheld on the list, board and export, and can't be filtered or sorted on.
- **The SF amount is visible to everyone** on the board and list (column totals included), because it mirrors Salesforce visibility; preliminary capital and capital readiness are commercial columns.
- **"Age" / "aged over N days"** is calendar days in the current stage, holds included. The engineering queue keeps its business-day buckets. *Ask:* one definition everywhere?
- **The Prioritization view shows open quotes** unless a status is chosen; the list shows everything.
- **Export cap = 5,000 rows** (code constant `QUOTE_EXPORT_MAX_ROWS`, a technical limit, not a business rule).

---

## 3. PRD v1 → v1.1 corrections the build already applies (send to Bailey for A-03)

1. **"ERS" → "ERF"** everywhere (X-33). **SPR** is historical only: no SPR connector feature, history panel only (X-96).
2. The ERF template is an **Excel workbook with ~45 inputs (Rev D, 2026-03-17)**, not "Word/SharePoint with ~20 fields" (X-46).
3. "Agreed with Engineering" rests on a ~20-minute 1:1 with Danielle Leu. Reword to "discussed with Danielle Leu; validation with Jim Zweifel scheduled (M4)" (X-87).
4. Remove **"engineer"** from the intake field set; the engineer is assigned in Engineering Review (X-90, 10/14).
5. Add **neck finish/type and packaging requirements** to intake (REQ-05; the most commonly missing attributes).
6. Add a **G1 qualify decision** (configurable) and redirect paths for stock / price inquiry (REQ-06, REQ-41).
7. Add **capacity evidence** to Engineering Review, with stated assumptions and no 85% OEE default (X-56, DF-22).
8. **Final Review ≠ customer outcome.** G4 approve/decline is internal; Awarded/Lost/Expired come from the customer decision (X-88).
9. Outcome closure needs a **reason code, closure owner and date**; "expired/no response" ≠ lost (CR-39).
10. The alert to the engineering lead on queue arrival is **P0** (X-91); other notifications stay P1.
11. **Hosting:** Azure (Option A) chosen, pending Gate 2 ratification; CMR not used because it can't host the database or server-side authorization the PRD requires.
12. Note that the **QuoteFlow prototype currently holds ~205 live SF records**, contrary to PRD §6/§7.3 (X-92). Resolve under D-23.

---

## 4. Build risks (watch weekly at the Thursday sync)

| ID | Risk | Likelihood / impact | Mitigation in this plan | Early warning | Owner |
|---|---|---|---|---|---|
| BR-1 | Azure provisioning stalls (IT's 9/15 pushback on #131026) | High / High | Narrow ask (2 RGs, named resources, Bicep shown at M2); escalate via Darren on Oct 21; local + CI keep the build moving | No RG by Oct 21 | Darren |
| BR-2 | Support model unresolved → IT won't take prod | Medium / High | Raise at M1; runbook by Nov 2; hypercare offer | No owner named at M9 | Darren / Oliver |
| BR-3 | Production-data approval late | Medium / High | Ask at M1; UAT org fallback | Not approved by Nov 2 | Darren |
| BR-4 | Salesforce integration user / custom field names late | Medium / Medium | Fake reader with "New Last Week" shape; UAT org first | No creds by Oct 22 | Rachel Dew |
| BR-5 | Business decisions late (D-05, D-10, D-15) | High / Medium | Config + provisional seeds; decision package via Bailey | Missed Oct 28 | Bailey |
| BR-6 | Encoding an unapproved process (Op Model R-01) | High / Medium | Configurable engine; workflow-ordered stakeholder reviews; PRD v1.1 list above | Hard-coded labels or thresholds in a PR | Ben |
| BR-7 | One builder, 21 working days | High / High | Ordered cut lines (`02` §3); Claude Code with tested prompts; pilot has precedence with extra hours authorized (DEC-25) | > 1 day behind the calendar for 2 consecutive days | Ben → Darren |
| BR-8 | Engineering queue still depends on Jim (Op Model R-04) | High / Medium | Backup assigner setting; aging visible; P1 rules | Time-to-assign rising | Jim / Process Owner |
| BR-9 | KAMs see QuoteFlow as a second tool (Op Model R-07) | Medium / High | SF front door, no re-keying, fewer fields than the ERF, mobile, R1 with KAMs | Intakes created outside CCQ | Sales leadership |
| BR-10 | Pricing becomes the next bottleneck (Op Model R-05) | Medium / Medium | Time in Quoting visible on the dashboard | Time at G3 rising | Gemma Cebolla |
| BR-11 | Legacy pricing data is messy (blanking fields, not 1:1 links) | High / Low (MVP) | Read-only context, blanks = unknown, manual refs fallback | — | Cory McGahan |
| BR-12 | Ranger scope creeps into the MVP | Medium / Medium | Ranger assist is P1 and advisory only | New AI asks before Nov 13 | Darren |

---

## 5. Source notes (what this guide is built on)

**Read in full**
- CCQ Transformation Web App PRD v1 (Populated), 2026-10-12. Note: the copy in `3. Design/App Builder/` is an **empty v2 template**; the populated v1 is in `Artificial Intelligence/Embedded Intelligence/QuoteFlow (CCQ App)/`.
- CCQ Workflow Blueprint (Tre Curry): the data embedded in the artifact.
- CCQ Future-State Operating Model & Implementation Blueprint, 2026-10-15.
- CCQ Discovery & Design Evidence Base v1.0 (all 3 pages).
- CCQ Web App Requirements Sync AI recap, 2026-10-14.
- Salesforce "New Last Week" report, 2026-10-12.
- Microsoft Learn: Copilot Managed Runtime architecture, connectors, governance and licensing (preview).
- Team chat and email context: triage 10/13, Darren's 10/15 note, Tre's GitHub request 10/15.

**Couldn't read**
- `Pricing Application Exports.xlsx`: Microsoft refused text extraction (likely a sensitivity label). The column facts here come from the evidence base. Ask Cory at M5.
- Meeting recordings/transcripts (.mp4): not machine-readable here.
