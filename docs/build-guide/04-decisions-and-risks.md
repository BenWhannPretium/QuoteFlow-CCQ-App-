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
| L-5 | CCQ reads Salesforce as **one read-only integration user** for every CCQ user (External Client App, OAuth client credentials). Nobody gets their own Salesforce access through CCQ. | Ben, 2026-10-24 | B-06; the 15-minute sync has no signed-in user |
| L-6 | **CCQ is the access control for Salesforce data.** Salesforce sharing doesn't apply per user, so CCQ scopes what each user sees: a KAM sees the opportunities they own in Salesforce plus their region / account scope; `all`-scope roles see everything (adjust with feedback). Price, cost, margin, revenue and capital fields are never read. | Ben, 2026-10-24 | Built: RLS on `sf_opportunity_snapshot` (migration 0021) + the same check on live Salesforce rows |
| L-7 | The Salesforce sync keeps **every opportunity**, closed history included (31,947 on 2026-10-24); no cut-off for now. | Ben, 2026-10-24 | Revisit with feedback |
| L-8 | **All new data QuoteFlow creates is stored in Pretium's Fabric tenant.** Met by Fabric mirroring of the CCQ Postgres database (`01-architecture.md` §6.1, B-27); Postgres stays the app's store (D-FB1: mirroring plan accepted by Brennan Paul, 2026-10-26). | **Oleg Yarovinski + Brennan Paul**; recorded 2026-10-24 (Ben). Add the date and the written source when it arrives. | D&A data platform standard |
| L-9 | **Lead review, and G3 by the pricing lead only** (2026-10-30). The assigned engineer or pricer submits their part to their lead, who is notified, reviews it under "Ready for my review" and decides the gate or sends it back with a note; the assignee's part is locked while it waits. The lead may act at any time. G3 is decided by the pricing lead only, mirroring G2 (EngLead only). Architecture §2 (stages), §3.4 | Ben, 2026-10-30 | Pricing should mirror Engineering; leads need to know when to review |
| PRD §9 | Out of MVP scope: editing pricing, write-back, pricing-engine rebuild, post-award PM features, AI auto-prioritization, customer portal | PRD v1 | — |

---

## 2. Open decisions the build depends on (owner, needed-by, what ships if late)

| ID | Question | Recommended direction | Decision owner | Get it at | Needed by | If not decided, ship with |
|---|---|---|---|---|---|---|
| **D-16h** | Approve Azure hosting + resource groups + IT provisioning owner | Approve; test RG by Oct 21 | Darren + **Oliver Kade** (Brennan Paul consulted) | **M1** | **Oct 21** | ⚠ No fallback. UAT date slips day for day. |
| **D-H2** | Exposure: "internal only, no public domain" vs "phone access without VPN" | Private endpoint + Entra Application Proxy / Private Access; interim Easy Auth + CA in test | Oliver Kade | M1 / M2 | Oct 23 (test), Nov 6 (prod) | Easy Auth + Conditional Access |
| **D-23** | Production-data approval. **The 205 live SF records already in Bailey's prototype** conflict with the PRD's own sample-data rule. | Get IT + D&A approval now; purge or approve the prototype copy | Darren; approvers **Oliver Kade + Brennan Paul** | M1, confirm at M9 | Nov 2 | UAT on the SF UAT org + masked data ("UAT-ready on masked data"). **2026-10-23:** Ben reports IT + D&A approved production data; the test environment now runs on it (B-06). Record the approvers and date here when the written approval arrives; the Bailey prototype copy is still open. |
| **D-17** | Application support model ("if you build it, you support it") | IT hosts/patches/monitors; EI fixes app defects for 90 days of hypercare; named on-call. **Principle decided 2026-10-21: EI supports** (Ben). Detail (on-call, hypercare window, IT's part) still at M9; draft in `docs/gate/runbook.md` | Darren + Oliver Kade | M1 (principle ✅), M9 (detail) | Nov 2 | Ben + Tre as interim support; risk logged |
| **D-05** | Minimum intake set + "stop vs enrich" | PRD F-03 ∪ 10/14 demo list ∪ Jim's list + **neck finish + packaging**; blocking = SF opp, customer, ship-to, product family, resin, volume | Jim Zweifel + sales leadership | **M4** | Oct 20 | Seed list (provisional) |
| **D-06** | G1: who qualifies; min value/volume screens (3M IBM vs 300k resin; $18k example) | Sales leader decides; screens as **warnings** in MVP | Sales leadership (Jack Gordon) | M4 | Oct 23 | `SG-CCQ-SalesLeader` = provisional; warnings off |
| **D-19** | Scoring attribute set + weights (PRD 7 vs prototype 7, X-89) | PRD set, equal-ish weights, **advisory only**; Knowledge Steward governs | Jim Zweifel + sales leadership; approver Process Owner | M4 | Oct 23 | PRD set, provisional v1 |
| **D-OA** | Who approves priority / ship-to overrides (blueprint gap) | Priority: SalesLeader or EngLead; ship-to: self + logged | Bailey to confirm with Darren | R1 | Oct 27 | As recommended (config) |
| **D-10** | Final Review (G4) approver(s) and tiers | Interim: sales leader within the Pricing-approved range; tiers aligned to the CER matrix later | Sarah Brennan via **Bailey's decision package** | D-pack | **Oct 28** | Provisional members of `SG-CCQ-Approver` named by Darren |
| **D-15** | Outcome taxonomy, reason codes, closure owner | Op Model §5.2 taxonomy; KAM records, sales leader accountable | Sales leadership + Process Owner; approver sponsor | D-pack | **Oct 28** | Seeded taxonomy (provisional) |
| **D-12** | Quote validity default (30 days PTF vs 60-day proposals) | Record the date in MVP; default 30; alerts only | Pricing + Sales leadership | D-pack / R3 | Oct 28 | 30 days (provisional) |
| **D-K1** | Can KAMs see peers' priority scores? | Yes (PRD lean); override log restricted to leadership | Darren / Sarah | D-pack | Oct 28 | Yes (setting) |
| **D-18** | Authoritative source for customer + ship-to (SF Account vs ERP customer master) | SF Account for MVP; flag gaps | Zac Cairns + Graham Parle; data owner TBD | **M3** | Oct 21 | SF Account |
| **D-PR** | ~~Pricing-app read path (SQL replica vs Fabric)~~ **Decided 2026-10-22 (Ben): no live connection.** The legacy app is unsupported and being retired as QuoteFlow takes over its job; its history comes from Cory's export (approved data), imported by an Admin | Import the export | Cory McGahan (export), Gemma Cebolla (scope, sensitivity) | — | Done | — (B-15 revised: `pricing_history_record`) |
| **D-SP** | SharePoint site/folder for attachments; `Sites.Selected` grant | `/CCQ/{quote_number}/` on the CCQ site | IT M365 admin + Bailey | **M7** | Oct 27 | Azure Blob behind the same interface. *B-16 built SharePoint, Blob and local behind `FILESTORE_MODE` (local until M7); see the B-16 questions below.* |
| **D-03** | Stage-gate model (PRD 5 vs Op Model 6) | Configurable engine, hybrid seed. **Steering can relabel without code.** | Oleg Yarovinski; approver CCQ Steering | Bailey's decision package | Before scale | Hybrid seed |
| **D-16w** | Salesforce write-back | None in MVP | Darren + Salesforce owner | — | Before scale | Read-only |
| **D-20** | SLA / turnaround targets | Set after baseline + pilot | Process Owner | — | After pilot | Aging buckets only, no SLA |
| **D-02** | Process Owner / Knowledge Steward | Commercial-side owner + Rules Steward | Sarah Brennan | — | Before pilot | Admin = Ben/Tre; Bailey approves config |
| **D-24** | Pricing pass-through: below what estimated annual revenue can a quote skip the Pricing approval at G3? (deck slide 12) | Set after the pilot baseline; Pricing lead owns the number | Pricing lead + Sales leadership; approver Process Owner | R3 | Before pilot | `pricing_pass_through.maxAnnualRevenueUsd` = null (off: every quote needs a price approval) |
| **D-25** | Legal review triggers at G4 (deck slide 13) | New customer, non-standard terms, tooling commitment | Legal + Sales leadership | R3 | Before pilot | All three triggers on (`legal_review_triggers`, provisional) |
| **D-26** | CER matrix and Stage 6 owners: who approves the CER, and who accepts the hand-off (deck slide 15) | CER per the capital matrix; KAM records, Commercial Activation / NPI post-award accept | Finance (capital) + Sales leadership; approver sponsor | D-pack | Before pilot | CER as a reference ID with a status; G6 decided by the KAM (own) or a sales leader |
| **D-27** | Capital standard and Market Development threshold: when is capital "likely", who in Capital Management is told, and above what value is Market Development told? (deck slides 8–9) | KAM or engineering flags at intake / G2; threshold set by Market Development | Capital Management + Market Development | R3 | Before pilot | Flag available; no recipients; Market Development threshold null (off) |
| **D-28** | Escalation routes and the CCQ Process Owner (deck slide 11) | Routes as seeded; Process Owner named with D-02 | Sarah Brennan (D-02) + Bailey | D-pack | Before pilot | Seeded routes; `process_owner.userId` = null, so the process route answers "no recipients" until named |
| **D-29** | Migrate legacy ERF records into CCQ, or keep the Legacy ERF # as a lookup only? | Lookup only for MVP. *2026-10-22: the history is imported as read-only records (B-15 revised); they are looked up, not converted into quotes (see D-30).* | Bailey + Pricing | — | Before scale | Optional "Legacy ERF #" reference field |
| ~~**D-FB1**~~ | ✅ **Decided 2026-10-26: Brennan Paul accepted the mirroring plan** (reported by Ben): a continuous copy by Fabric mirroring meets L-8; Postgres stays the app's store. Add the written source when it arrives. | (was: continuous copy vs Fabric as the only store) | Oleg Yarovinski + Brennan Paul | — | — | Mirroring (B-27), schema prep built 2026-10-26 |
| **D-FB2** | What's mirrored: all CCQ tables? Also `sf_opportunity_snapshot` (Salesforce copy, 31,947 rows) and `pricing_history_record` (legacy import)? Attachment files (SharePoint) or only their metadata? **Note (2026-10-26):** `audit_event_fabric` (audit JSON copies) must be included, and the analytics twins read `sf_opportunity_snapshot`. | Every CCQ base table; the two copies only if D&A doesn't already hold the source; files stay in SharePoint, metadata mirrored | Brennan Paul | MF | Oct 28 | Every base table except `__drizzle_migrations`; files not copied |
| **D-FB3** | Test Postgres must leave Burstable (mirroring doesn't support it). Approve General Purpose for test (a monthly cost increase), or mirror prod only? | Approve GP for test: the test environment already runs on approved production data and is where we prove the mirror | Oliver Kade (cost) + Brennan Paul | MF | Oct 30 | Prove on a temporarily scaled-up test, scale back after; prod only |
| **D-FB4** | Fabric workspace, capacity and security: which workspace and F-SKU capacity, who owns the mirrored item (a service principal, not a person), who may read commercial columns in Fabric, acceptable latency | D&A workspace per env; owner = D&A service principal; commercial columns only to the `SG-CCQ-*` commercial groups (§3.3); latency target 15 min | Brennan Paul | MF | Oct 30 | Workspace limited to D&A + CCQ Admin; no downstream readers until decided |
| **D-FB5** | Is a running prod mirror part of the Nov 13 MVP bar? | Yes, if the workspace, capacity and VNet data gateway are ready by Nov 4; otherwise it starts in hypercare week 1. No data is lost by waiting: the mirror's first sync copies everything | Darren + Brennan Paul | MF | Nov 2 | Test mirror proven at MVP; prod mirror in hypercare week 1 |
| **D-30** | In-flight legacy ERFs at cutover: the export has 3,395 ERFs still "open" (810 from FY25–26). Re-enter the live ones as CCQ quotes, close them in the old app, or both? | Treat every legacy record as history; Sales re-enters live deals as CCQ quotes from a cutover list | Bailey + Sales leadership + Pricing | — | Before the old app is switched off | Imported as history only; nothing becomes a CCQ quote automatically |

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
- ~~**Engineers do not read commercial numbers**~~ **Decided 2026-10-30 (Ben):** no role is hidden from data it can enter, so every role now reads the commercial fields (prelim capital, capacity numbers, the pricing record and the pricing history). Architecture §3.3, `CLAUDE.md` rule 2. If Gemma Cebolla's sensitivity review (M5) wants a restriction back, it is a matrix change.
- **Accept** is open to the EngLead and the assigned engineer. *Ask R2:* lead-only?

**B-15 revised (2026-10-22): pricing history from the export.** Decided with Ben: no live connection (D-PR); Cory's export is approved data; the free text is included for context (it can be removed later); attachments are not needed for now; in-flight ERFs are a business decision (D-30). Provisional choices, to confirm with Gemma Cebolla / Pricing. Code, not config, where noted:

- **A zero estimate is unknown** (code: `ZERO_IS_UNKNOWN` in `packages/integrations/src/pricing/exportColumns.ts`). The old app wrote 0 for blank: ERF volume is 0 on 98–99% of ERFs since FY23 and revenue zeros climb to 44% in FY26. Revenue, volume and the BPR/SPR prices of 0 show as "Unknown". **Net capital 0 is kept as $0** (no capital): it is 0 on ~80% of ERFs in every year since FY19, so it reads as a real value. *Ask Pricing* whether that is right.
- **BPRs appear only on the Pricing history page**, never on a quote (B-26: the BPR is the price-implementation step after CCQ). They are imported because they hold the agreed prices. *Ask Pricing* whether a quote should show the customer's recent BPR prices after all.
- **Customer matching by name** (code: `customerKey`). The export has no Salesforce id and no ERF↔BPR link; a quote finds history through its Legacy ERF #s and its customer's name, normalised for case, punctuation, "&" and a trailing legal suffix. Names spelled differently in the old app won't match (the search page is the fallback). Only 411 names are common to the ERF and BPR sheets.
- **`pricing_ref_formats`** now follows the export: ERF `^(ERF|EP)\d{2}-\d{2,5}$` (e.g. ERF25-123; EP for older ERFs). The old 5-digit guess is gone; a stored older value updates on the next seed while the setting is untouched.
- **Refresh.** Re-importing a newer export updates changed rows and adds new ones; nothing is deleted (a row missing from a later export stays). *Ask Cory* whether a final export will be taken when the old app is switched off.
- **Sensitivity** (code: `policy/sensitivity.ts`). Every history record is commercial as a whole (Pricing, PricingLead, EngLead, Approver, Leadership, Admin); RLS on the table enforces the same list. *Ask Gemma* if any field may go to KAMs or Engineers.
- **Linkage rule** (code, unchanged from B-15): the first Legacy ERF # recorded becomes `quote.erf_number` when the quote has none; it never overwrites. A different SF ERF number is a warning only.

**B-16 questions for M7 (Tue Oct 27: SharePoint/M365 admin, Bailey, Tre) (D-SP).** B-16 was built on 2026-10-19, before M7, with `FILESTORE_MODE=local` as the default and the SharePoint and Blob stores ready behind the same interface. Config, not code, except where noted:

- **The site and library.** `SP_SITE_ID` (recorded, the site `Sites.Selected` is granted on) and `SP_DRIVE_ID` (the document library). *Ask IT:* grant the API app registration / App Service managed identity `Sites.Selected` with **`write`** on that site only (an `application` permission grant on the site, not tenant-wide `Sites.ReadWrite.All`), and a **test** site with the same grant for `SP_LIVE_TEST=1` (client secret, test site only; refused in production).
- **The folder convention** (`app_setting.attachment_settings`, provisional): `quoteFolder` = `CCQ/{quote_number}`, `draftFolder` = `CCQ/_drafts/{draft_id}`, `removedFolder` = `CCQ/_removed`. *Ask Bailey:* does the ERF restructure for Ranger define something else (e.g. by customer or ERF number)? Changing the template moves new files only; existing files keep their folder (their item ids are stored).
- **Soft delete.** Removed files move to `CCQ/_removed/<old folder>/` and stay restorable; nothing is hard-deleted by CCQ. *Ask IT:* a retention policy for `_removed` and `_drafts` (abandoned drafts' files)?
- **Scanning.** CCQ checks extension, size (100 MB) and content (magic bytes); malware scanning is Microsoft Defender for Office 365 / SharePoint per tenant policy. *Confirm with IT* that Safe Attachments for SharePoint is on for the site, and what a blocked file looks like to Graph (CCQ would show "storage unavailable" on download).
- **Uploader removal window** (`attachment_settings.uploaderRemoveHours`) = 24 h; Admin may always remove (new permission `attachment.removeAny`). *Ask R2/R3* whether EngLead should also hold `attachment.removeAny`.
- **Blob fallback.** If SharePoint access slips: a private storage account container (`BLOB_ACCOUNT_URL`, `BLOB_CONTAINER`) with the App Service managed identity as Storage Blob Data Contributor (it also signs user-delegation SAS links). Files uploaded under one mode stay in that store: switching modes does not migrate them (their download answers 503 until switched back or migrated).

**B-17 questions for M6 (Thu Oct 22: D&A, Brennan Paul) and R3 (Nov 5: leadership).** Built 2026-10-19. The definitions live in `packages/db/sql/analytics/*.sql` (one `COMMENT ON VIEW` each); D&A can read them and reuse them in Fabric. Config or one SQL line, not a redesign:

- **Windows.** Outcomes are a *proposal cohort* (proposals issued in the window); cycle times use stays that *ended* in the window. *Ask D&A:* is that how the certified models should window them, or by decision date?
- **Win rate and capture.** Win rate = awarded ÷ (awarded + lost), Expired excluded ("silence is not a loss"); capture = recorded ÷ (recorded + gone dark). The page warns when capture is under 50% (`LOW_CAPTURE_BELOW` in `contracts/analytics.ts`). *Ask R3:* is 50% the right line, and should a win rate be hidden entirely below it?
- **Amounts** are the Salesforce opportunity amount as entered; there is no price or margin in any chart. *Ask:* is "SF amount as entered" the right label for leadership?
- **Cycle time** = wall clock minus recorded holds (CR-57). Holds are only the ones recorded at G1–G3/G5; a quote that sits idle without a Hold decision counts as active time. End-to-end stops at the first G4 Approve.
- **First-pass (S-03)** counts a G1 or G2 Rework as "not first pass"; requests still waiting for G1 are left out. **Gate compliance (S-08)** accepts any decision on the gate, including `SUBMIT` as G1 when G1 is off.
- **Queue aging buckets** (< 3 / 3–10 / > 10 business days) use `eng_queue_aging_days` for Engineering and, for now, Pricing too. *Ask Gemma* whether Pricing wants its own edges.
- **Adoption** needs `audit.read` (Leadership, Admin), not `analytics.read`. *Ask R3* whether SalesLeader / others should see it, which needs a summary view that is not row-level secured by audit actor.
- **Plain views, no 15-minute refresh job** (see B-17 in `03-build-steps.md`). If D&A wants materialized snapshots, they can build them in Fabric from the same SQL.
- **Region** filters the analytics but not the quote-list drill-down (the list has no region filter yet).

**Provisional choices B-11 shipped for R3 (Thu Nov 5, Gemma Cebolla + pricing analyst) and M5 (Cory McGahan) to confirm (DEC-19/20/23, D-10, D-11, D-PR).** Config rows, not code, except where noted:

- **Superseded in part by B-26 (2026-10-21) and B-15 (2026-10-22); see `03-build-steps.md` B-26 A4.** BPR is gone from CCQ, the "no pricing-app record" note is gone, and ERF is only an optional Legacy ERF #. The two bullets below are kept as the B-11 record.
- **G3 outcome rules (as B-11 shipped them)** (workflow config): Submit needs the price approver and approval time, at least one ERF / BPR reference **or** a "no pricing-app record yet" note, and a capital readiness status; **pending capital needs a justification** and then shows as a warning on the decision (D-11 is open: warn, don't block). Hold: reason + review date. Rework (back to Engineering): reason code only, bumps the version. **Stop: reason + note, closes as DECLINED** (was CLOSED_LOST): Pricing's "won't pursue" is internal, like G1/G2. *Ask R3:* should "Costing completed" (CR-25) be required to submit rather than a warning? Should "capital not approved" block?
- **`pricing_ref_formats` (as B-11 shipped it)** = ERF `^\d{4,7}$`, BPR `^(BPR-?)?\d{3,10}$`: guesses. **Now** ERF `^(ERF|EP)\d{2}-\d{2,5}$` from the real export (B-15); BPR ignored (B-26).
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
- **D-12 (validity): no auto-close.** The daily expiry job (`VALIDITY_EXPIRY_INTERVAL_HOURS` = 24, advisory lock) flags `validity_expired_flagged_at`, writes a `validity_expired` timeline event and tells the KAM "Revalidate or record the outcome" (in-app and, from B-18, by email). The same run warns the KAM once when the date comes within `validity_warning_days` (in-app + email, once per validity date). It never changes stage or status. A new release (after a re-quote) clears the flag. **`validity_warning_days`** = 7 (amber at ≤ 7 days left, red once expired). Revalidation (extend the date without a re-quote) is **not built**: it waits for D-12.
- **SF stage mismatch** is flagged only when either side is an outcome (a terminal CCQ stage, or an SF stage `sf_stage_map` hints at a terminal stage), e.g. CCQ "Customer Decision" vs SF "Closed Won – Product Shipping". Mid-pipeline differences (CCQ Engineering Review vs SF "Qualifying") are shown side by side but not flagged, because SF stages are used loosely before the outcome. *Ask R3 / Rachel Dew* whether that is the right noise level.
- **Hand-off (Stage 6, minimal; CR-41/42):** acceptance evidence + date + optional document link (from the Awarded decision), CER ID, BPR ID (references only, no integration; *B-26 replaced the BPR with the CER status and moved the hand-off to Stage 6*), receiving role (`handoff_receiving_roles`: Commercial Activation, NPI post-award technical PM, other + name), receiving contact, accepted-by date, notes, "Hand-off complete" (records who and when; needs role, contact and date). New permission **`handoff.edit`** (KAM own, SalesLeader, Admin). *Confirm the fields with Amanda Cronkhite at R3 (optional);* D-14 (the P2 post-award view for Nicole Donnelly / Anne DeSmet) is untouched.
- **Outcomes report** (`GET /admin/reports/outcomes`, page `/admin/reports/outcomes`) is read by `analytics.read` (SalesLeader, EngLead, Pricing, Approver, Leadership, Admin), not only Admin, because sales leadership owns the capture rate. Capture rate = recorded customer outcomes ÷ (recorded + "gone dark": open in Customer Decision past validity); proposals still within validity are pending, not missing. Win rate = awarded ÷ (awarded + lost); expired is excluded.

**Provisional choices B-14 shipped (pipeline views), to confirm in R2 / R3:**

- **KAMs see peers' priority** per `kam_can_see_peer_scores` (D-K1, default `true`). When it is `false`, peers' tier and score are withheld on the list, board and export, and can't be filtered or sorted on.
- **The SF amount is visible to everyone** on the board and list (column totals included), because it mirrors Salesforce visibility; preliminary capital and capital readiness are commercial columns.
- **"Age" / "aged over N days"** is calendar days in the current stage, holds included. The engineering queue keeps its business-day buckets. *Ask:* one definition everywhere?
- **The Prioritization view shows open quotes** unless a status is chosen; the list shows everything.
- **Export cap = 5,000 rows** (code constant `QUOTE_EXPORT_MAX_ROWS`, a technical limit, not a business rule).

---

**Provisional choices B-26 shipped (demo feedback + future-state deck), to confirm with Bailey and Darren:**

- **Stage 6, Commit & Hand Off (D-26).** G5 Awarded now enters `COMMIT_HANDOFF` instead of closing. G6 (`gate.G6.decide`: KAM own, SalesLeader) offers Advance (close **Closed – Won**: CER `approved` with ID + date, or `not_required`, and the hand-off accepted), Hold (commitment pending), Re-quote (back to Quoting or Engineering Review, new version) and Stop (**Closed – Commitment not authorized**; reasons: CER not approved, terms not confirmed, hand-off not accepted, other + note). *Ask:* is the KAM the right G6 decider, or should Finance record the CER?
- **Five standard outcomes (deck slide 6).** G2 gains Redirect; G3 gains Re-cost (clears the costing attestation and stays in Quoting) and Redirect; G4 gains Hold; G5 gains In negotiation. Every outcome has a one-line definition (`help_text`), provisional and editable by Admin.
- **Holds name an owner** (default the decider), and the owner must be an active user.
- **Capacity sign-off at G2** is the EngLead's (`capacity.signoff`). *Ask Darren:* should a plant or operations role sign instead?
- **PricingLead** (new role) sees every quote like Pricing, and assigns pricers (`pricingQueue.assign`, with Admin). *Ask Bailey:* who holds the role first?
- **Terms check** is the KAM's (also SalesLeader, Pricing, PricingLead: `terms.edit`). Changing a term clears the check.
- **Legal review** is recorded in CCQ as a date, reviewer name and note; Legal does not use the app in MVP.
- **Escalation routes** (`escalation_routes`): queue or priority conflict → EngLead then the Process Owner; capacity → (nobody yet: name the plant owner); strategic exception → SalesLeader; pricing exception → PricingLead; payback → Approver; process → Process Owner.

---

## 2a. User-feedback decisions (Feedback Tracker, Nov 2026)

These come from the **QuoteFlow Feedback Tracker** (`3. Design › Quote Flow › QuoteFlow Feedback Tracker.xlsx`, Decision Log tab). Tracker IDs have three digits (**D-001**…) and are a different series from the build-guide IDs above (D-02…D-30). The build steps they unblock are FB-01 to FB-10 in `03-build-steps.md` → "User feedback updates". Status as read on 2026-11-05, updated 2026-11-09 after the Nov 6 pricing and Engineering Program Office meetings and the Nov 9 ROI session (paste-ready tracker rows: [`feedback/tracker-updates-2026-11-09.md`](feedback/tracker-updates-2026-11-09.md)).

**Decided in the feedback sessions (build follows these):**

| Tracker ID | Decision | Built in |
|---|---|---|
| D-011 | No ERP account setup until the business is won; new accounts start in Salesforce; remove the QuoteFlow new-customer form (Nov 2) | FB-02 (F-007), **built 2026-11-05**: the customer is always the opportunity's SF Account; one checkbox "Not yet a Pretium customer (no ERP account)" |
| D-012 | Engineering decides the plant, with KAM input on destination and logistics (Nov 2) | FB-02 (F-017), **built 2026-11-05**: "Ship / fill destination" city + state required, shown on the Engineering queue and header |
| D-013 | MVP cost model = upload the standard template and extract a one-page summary; in-app model later (Oct 30) | FB-07 (F-031, F-074), **built 2026-11-09 (uploads and versions)**: `cost_model`, `roi_model`, `price_table` attachments, one current record per quote and kind with version history. The one-page summary is **not built**: it waits for the templates and their cell map (A-031) |
| D-014 | Salesforce write-back deferred to Phase 1 (Oct 26) | P1 backlog (F-035); FB-04 ships the link-and-prompt stopgap (F-076) |
| D-015 | Minimise free text; notes only on exceptions (Oct 30) | FB-01 (F-027), built 2026-11-05: a note on every exception outcome, none on a plain Advance; caps wait for D-016 (FB-09) |
| D-018 | A drawing, or a required minimum spec set (height, diameter/width/depth, gram weight, neck finish, resin, color), to advance (Nov 3). Final list: Jim Zweifel / Danielle Leu (A-005, A-024) | FB-02 (F-016), **built 2026-11-05**: enforced at submit; the list is `intake_min_spec_fields` (provisional, seeded height, widthOrDiameter, depth, gramWeight, neck, resin, color) |
| D-023 | A $0 CER follows the standard quoting path; capital is reimbursed by the customer (Oleg, Nov 3). **Nov 9 (Oleg):** it ties up capacity, so treat it as a capital request with an ROI and let leadership decide whether to take the business (D-002) | FB-04 (F-022), **built 2026-11-05**: relabelled "$0 CER (customer-reimbursed capital)" with Oleg's wording as an ⓘ; no separate path |
| D-028 | Only sales leaders override priority, with the justification passed to Engineering; KAMs use escalation (Bailey, Nov 3; confirm with KAMs before the pilot) | FB-04 (F-065), **built 2026-11-05**: `priority_tier` is SalesLeader-only, self-applied; waiting requests are left for the SalesLeader |
| D-001 | Costing, then ROI, then price confirmation, as steps inside Quoting. Pricing uploads the costing model (costs and initial price assumptions); Stacy Slocum builds the ROI from it on her template and uploads it; the pricing lead confirms the price; then Final Review. ROI only when capital is required, $0 CER included. Stacy is an input, not an approver. Not a separate gate, not parallel (Nov 9; Oleg to confirm in writing, A-036) | FB-07 (F-031, F-032, F-074), **unblocked 2026-11-09** **Built 2026-11-09:** three steps inside Quoting (`packages/domain/src/quoting-steps`); G3 Advance needs the current costing model and, when `roi_required_when` applies, the ROI model; Finance role `CCQ.Finance` (A-032 outstanding). A-036 (Oleg in writing) still open: the build follows the Nov 9 record |
| D-031 | The final Pricing gate is renamed "Price approved"; capital readiness stays a separate field (Nov 9) | FB-07 (F-081), **built 2026-11-09**: gate "Price approved", Advance "Advance – price approved", button "Price approved: advance to Final Review…"; migration 0031 renames untouched rows |
| D-032 | The KAM captures at intake: the payment terms the customer requests (flagged if non-standard), whether the customer funds any tooling or capital, returnable (multi-trip) dunnage, delivered or FOB price and, when delivered, freight type and special arrangements. Payment terms and funding are two separate things (Gemma, Nov 6) | FB-11 (F-080, F-063), **built 2026-11-09**: step 3 of the intake, shown on the quote, the Quoting tab ("From intake") and at Final Review; `standard_payment_terms` seeded Net 15 and Net 30 (A-012, decided Nov 9) and the new lists seeded provisional; optional at submit until D-006 |
| D-033 | The equipment BOM is an upload of the one-page CSR BOM from the Engineering Program Office workbook (a generic ballpark at quote time), each line flagged C (capital) or P (customer paid) (Kal, Nov 6). **Update 2026-11-10:** the template's one-page tab is named **CER BOM**, not CSR; the flag has a third value, **E** (expense). A blank template and the minimum fields are still needed (A-030) | FB-06 (F-058), **built 2026-11-09**: attachment kind `equipment_bom`, versioned, uploaded on the Engineering tab; G2 "Capital required" needs it on file (a config rule); Pricing and Final Review see the file, version, uploader and date. No extraction until A-030; the two free-text fields are read-only "Legacy notes" |

**Open, and what each one blocks:**

| Tracker ID | Decision needed | Owner | Raise in | Blocks | What ships until it is decided |
|---|---|---|---|---|---|
| **D-002** | Final Review approval tiers | Oleg; sales leadership | Decision session with Oleg | FB-08 (tiers part) | One approver group (build-guide D-10 fallback). **Nov 9:** first tier proposed, not settled: a customer-funded or $0 CER quote needs the sales leader and then leadership (Sarah or a delegate); Gemma: leadership, not Pricing (A-035). **FB-08 (built 2026-11-10):** the hook `g4_additional_approvals` (rules by funding model, sign-offs in order, `finalReview.signoff` for SalesLeader and Leadership) is seeded with Bailey's proposal **switched off**; `g4_tier_rules` stays null (no thresholds decided) |
| **D-003** + **D-029** | Who owns commercial terms (MOQ and tooling funding to Engineering?), the standard payment term (Net 15 or 30), exception approval, milestone payment terms | Oleg; Gemma Cebolla; Bailey | ROI & capital session (Nov 9); Bailey/Gemma call (A-022) | FB-08 (F-021, F-068, T-007, T-031) | Today's terms check (KAM, free-text payment terms); "Shared" funding option added as provisional in FB-04. **Nov 6:** payment terms and tooling funding are separate; the customer's requested terms and funding go on intake (FB-11, D-032); upfront, 50/50 or per-piece are the tooling payment options, no quarterly (D-029); **Nov 9 (Gemma): Net 15 and Net 30 are both standard; anything beyond Net 30 needs review (A-012 closed).** The exception approver is still open (PricingLead assumed). **FB-08 (built 2026-11-10) used D-003's recommendation as provisional defaults:** MOQ and tooling funding edited by Engineering (`terms.engineering.edit`), payment terms a list with non-standard terms opening an exception for the PricingLead (`terms.exception.decide`, rationale required), the D-029 options as `tooling_payment_terms` (no quarterly) plus a ≤ 300 note, and the capital terms confirmed by the approver at Final Review (`terms.finalize`); `g4_required_checks` gains `terms_exception` and `terms_finalized`. See the FB-08 table below |
| **D-004** | Qualification bands, scoring weights, 9-box strategic-fit points by market, guardrail thresholds | Sales/Marketing leadership (Matthew Graden, Jennifer Wulf, Tania Nazario, Melanie Rasche) | Decision session with Oleg | FB-10 values (F-005 weights, F-073 points, F-066 thresholds) | FB-04 (built 2026-11-05) built the strategic-fit mechanism (`byMarket` plus optional `bySegment`) and the panel display with **no points seeded**; the map is empty (every quote scores 50, shown as provisional). D-004 must choose segment vs market and the points per 9-box cell; FB-10 loads them. Weights stay provisional. **FB-10 (built 2026-11-09, in PR):** seeded provisional config for the open decision: an INACTIVE draft scoring model (weights and tiers equal to the live model; strategic fit by market from the 9-box, Strategic Growth 90 / 75 / 60, Selectively Participate 50, Rationalization 20, placement unconfirmed), an Admin preview on the open quotes before anything is activated, `g1_volume_routing` (T-011, OFF; seed band 1,000,000 units and up, no maximum; the tracker says revenue bands, the prompt volume, so the measure is a setting) and `intake_guardrails` (F-066, OFF; 1M units RHB, injection, EBM and 3M ISBM, IBM, from the platform guide, column mapping unconfirmed). D-004 still has to choose segment vs market, the points, the weights and the band; Danielle Leu confirms the platform mapping. Nothing live changes until an Admin activates or switches them on **Answered 2026-11-09 (Melanie Rasche, Director of Market Development; built by FB-12):** segment vs market is settled as **(a) sub-market** (her word, not "segment"), and the points are by 9-box colour: Strategic Growth (green) 80, Selectively Participate (yellow and gray) 50, Rationalization (red and pink) 20 (Jessica Ransburg and Seamus Keith were invited to disagree). The FB-10 draft is now keyed by sub-market (inactive; unscored sub-markets and a missing sub-market score the neutral 50), and the new market list (8 markets, 30 sub-markets) is live at intake. **Still open:** the weights, the tier bands, activation of the draft, the volume band and platform minimums, and Melanie's four questions (Sun Care not in the list; what Home Care > Non-Core means; Histology and Tubes & Vials are not on the 9-box; Life Sciences under Clinical, 20 either way). |
| **D-006** | The mandatory-field list | Bailey Schmitt | Decision session with Oleg | FB-09 | Today's required fields plus FB-02's drawing-or-minimum-spec rule. **Not changed by FB-09:** the proposal for Bailey is in `feedback/mandatory-fields-proposal.md` |
| **D-007** | Does two-step (preform) continue across plants? | Engineering | Engineering follow-up (A-014) | FB-06 (F-024) | Pricing carries it in the costing workbook. **Built 2026-11-09 as provisional:** an optional "Two-step process" checkbox on the Engineering Review (preform plant, blow plant, preform number, freight note), shown to Pricing; Engineering says whether it continues (A-014) |
| **D-008** | Engineering and capacity roles: who is lead, one or several engineers, who owns capacity | Paul Slomkowski; Danielle Leu | Engineering roles session. *A-006 (Nov 4): Paul is the Engineering Lead; Randy Neiberger and Rafael Pasillas are assigned by project × request type (e.g. PET × ISBM)* | FB-06 (F-062, capacity owner) | One assignee; EngLead signs capacity. **Built 2026-11-09 as provisional:** one assignee per quote, with "Suggested: <name>" in the assign dialog from `engineering_assignment_rules` (Paul Slomkowski's Nov 4 email: ISBM, RHB, IMM → Neiberger; EBM, IBM → Pasillas; resin fallback); no several-engineers build, no capacity role; the EngLead sign-off stays (A-007) |
| **D-016** | Data standards: packaging list ("Plant specified" vs "not acceptable"), free-text caps, where "Other" is allowed | Bailey Schmitt | Engineering follow-up (A-028) | FB-09 (F-012, F-019) | Current packaging list and text limits. **Built 2026-11-10 as provisional defaults:** packaging "Other" needs the packaging note; the packaging note is capped at 500 characters for new edits (`intake_free_text_max_length`); `plant_packaging_standards` is empty, so "Plant specified" is not offered (A-028 not received); only the packaging note is capped (D-016 names no other field in the repo) |
| **D-017** | Multi-scenario quotes | Bailey Schmitt | Decision session with Oleg | F-056 (P1). F-075's short variant note is built in FB-02 as the recommended interim (option B) | The variant note: **built 2026-11-05**, limit in `intake_variants_note_max_length` (300, provisional) |
| **D-020** | Quote turnaround standards | Oleg | Decision session with Oleg | F-072 (P1) | Aging only |
| **D-010** | Interaction model (how requests and comments between roles work: in-app threads, email, assignments) | Bailey Schmitt; Sales leadership | Sales/Marketing leadership (Nov 3) | Nothing built so far; it informs F-034 / F-079 | FB-05 (built 2026-11-06) notifies on every hand-off, return, hold, closure and comment; it adds no request or approval workflow. One provisional value: `comment_email_collapse_minutes = 10` (comment emails are folded into one) |
| **D-021** | Standard utilization basis; confirm Faron's formula (A-023: trending OEE appears twice as emailed) | Faron Ipox with leadership | Supply Chain follow-up | F-060 (P1); the run-days basis in FB-03 | FB-03 calculates with Faron's formula shape (OEE applied once) and a provisional `app_setting.capacity_basis` (350 run days, amber over 85 %, basis label "Trailing 12 months actual, trending OEE (provisional, D-021)"); built 2026-11-05 |
| **D-005**, **D-019**, **D-022**, **D-030** | Bid scope rules; innovation projects; operations alignment on large projects; where stock / stock-plus requests go | Bailey; sales leadership; Engineering | See the tracker | P1 (T-006, T-028, T-029, F-071); F-067 ships with a configurable redirect message | Bid file attached to a single-item quote (FB-02 added the `bid_file` kind); CCQ-only request class (FB-02, **built 2026-11-05**: `intake_allowed_request_classes` `["CCQ"]` and `intake_redirect_message`, both provisional; D-030 may change the pack-out wording) |
| **D-005** (multi-item bids, Nov 6) | One record for a bid with items and a duplicate-and-edit action (Danielle Leu, Kal Kaliszewski, Bailey); related items only; one master reference for Finance | Bailey Schmitt; Sales leadership | Decision with Bailey and Danielle | F-084 (P1). Needs a quote-items model and a change to one active quote per opportunity | The bid file (FB-02), the variants note and an optional bid / program reference (F-085, FB-11) |
| **D-004** (FB-02 note) | Scoring weights stay open | Sales/Marketing leadership | Decision session with Oleg | — | FB-02 added scoring model **v2**: `timing` reads "Quote needed by" (F-009) with v1's weight and bands, provisional |

**Provisional values FB-04 seeded (built 2026-11-05):**

| Value | Seed | Waits on | Who signs off |
|---|---|---|---|
| `tooling_funding_model` = `SHARED` "Shared (company and customer)" | Active, provisional, help text "record the split in the terms notes" | **D-003** (terms structure) | Oleg Yarovinski; Jennifer Wulf (asked for it) |
| `app_setting.sf_outcome_stage_names` | awarded → Verbal Award; negotiating → Negotiating; lost, expired → Closed Lost; requote → Quoting | KAMs confirming which SF stage they use; goes away with write-back (F-035) | KAMs with Bailey Schmitt |
| `app_setting.salesforce_instance_url` | `""` (not set) | An Admin entering the Lightning URL | Admin |

**Provisional values FB-01 seeded (built 2026-11-05, awaiting sign-off; all `provisional: true`, changed by config, not code):**

| Value | Seed | Waits on | Who signs off |
|---|---|---|---|
| `app_setting.g4_required_checks`: which checks block G4 Advance | `[]`: neither the terms check nor the Legal review blocks the approver; both show as warnings on the Final Review screen (F-069). **FB-08 (2026-11-10) adds `terms_exception` and `terms_finalized`** (migration 0038); the FB-01 two stay warnings | **D-003** (who owns and finalizes terms); FB-08 (F-068) | Oleg Yarovinski, with Gemma Cebolla and Sales leadership |
| G3 "Rework (back to KAM)" (`rework_kam`): label, help text, `rework` reasons, note required, `resume_at = origin` (F-029 / F-030) | Seeded as described in `03` → FB-01 | Pricing confirms the wording and the reason list (D-15 taxonomy still provisional) | Kyle Arnold, Gemma Cebolla |
| The scope-change question ("product, volume, resin, drawing or plant changed") that decides whether a KAM's fix skips Engineering | That wording, in the intake screen | Pricing and Engineering agree what counts as a scope change | Kyle Arnold; Jim Zweifel |
| The exception-note set (`requires_note`) per D-015 | Advance with risk, Capital required, Hold, Rework / Return / Re-quote / Re-cost, Redirect, Stop / Decline, In negotiation | D-015 is decided; the rows stay provisional until Bailey approves the list (Admin → Workflow) | Bailey Schmitt |

**Provisional values FB-08 seeded (built 2026-11-10; all `provisional: true`, changed by config, not code):**

| Value | Seed | Waits on | Who signs off |
|---|---|---|---|
| Who edits MOQ and tooling funding on the quote | `terms.engineering.edit`: EngLead, Engineer (assigned). `terms.edit` no longer covers them; the KAM still answers funding at intake (FB-11) | **D-003** | Oleg Yarovinski, with Engineering |
| Who decides a payment-terms exception | `terms.exception.decide`: PricingLead (a designee gets the PricingLead role); rationale required, ≤ 1000 | **D-003** (exception approver) | Gemma Cebolla; Oleg Yarovinski |
| `app_setting.g4_required_checks` | `["terms_exception", "terms_finalized"]`: a pending or rejected exception and unconfirmed capital terms block G4 Advance | **D-003** | Oleg Yarovinski |
| `app_setting.capital_terms_required` | all five: funding model, mold ownership, amortization (months when yes), minimum supply / shortfall, agreement (duration when yes). "Not discussed" funding is not an answer | **D-003** (V-054) | Matthew Graden; Jennifer Wulf |
| `app_setting.default_payment_terms` | `NET_30`, pre-selected when the customer requested none (the request wins) | A-012 / A-022 | Gemma Cebolla |
| Value list `tooling_payment_terms` | Upfront (100 % at the order); 50/50 (at the order, at qualification); Amortized into the per-piece price. `meta.milestones` per option | **D-029** (Gemma, Nov 6) | Gemma Cebolla |
| Value list `mold_ownership` | Pretium; Customer; Shared (Pretium and customer) | **D-003** | Sales leadership |
| `terms.finalize`: who confirms the capital terms | Approver, in Final Review only | **D-003**; D-10 (G4 approver) | Oleg Yarovinski; Sales leadership |
| `app_setting.g4_additional_approvals` | One rule, **off**: customer-funded or $0 CER → Sales leader, then Leadership (`finalReview.signoff`: SalesLeader, Leadership) | **A-035**, D-002 | Oleg Yarovinski; Sarah |
| `app_setting.g4_tier_rules` | Unchanged: null (no tiers) | **D-002** thresholds | Oleg Yarovinski |

**Provisional values FB-07 seeded (built 2026-11-09; all `provisional: true`, changed by config, not code):**

| Value | Seed | Waits on | Who signs off |
|---|---|---|---|
| `app_setting.roi_required_when` | `{ g2Outcomes: ["capital_required"], capitalLikely: true, fundingModels: ["CUSTOMER_FUNDED", "ZERO_CER"] }` ("Shared" not included) | Stacy Slocum and Gemma Cebolla confirming the trigger; A-036 | Oleg Yarovinski; Stacy Slocum |
| Role `Finance` (app role `CCQ.Finance`, group `SG-CCQ-Finance`): `quote.read`, `quote.read.commercialFields`, `roi.upload`; no "Report an issue" | Names provisional; the Entra role and group were created 2026-11-10 (A-032 closed) | A-032 | Vincent Brown (IT); Bailey Schmitt |
| `roi.upload` also held by the **PricingLead** (fallback until a Finance tester is in `SG-CCQ-Finance`) and Admin (support) | In `matrix.ts` and `role_permission` | Finance testers added to the group (role created 2026-11-10); Pricing and Finance agree to remove the fallback | Gemma Cebolla; Stacy Slocum |
| G3 labels: gate "Price approved", outcome "Advance – price approved", its help text | D-031 is decided; the rows stay provisional until Bailey approves them in Admin → Workflow | — | Bailey Schmitt |
| Accepted model file types | Today's attachment types (`.xlsx`, `.pdf`, …); **`.xlsm` is not accepted** | The templates (A-031): if they are macro workbooks, add `.xlsm` to the file types | Gemma Cebolla; Stacy Slocum |

**Provisional values the Nov 9 build steps will seed (to be marked when built):**

| Value | Seed | Waits on | Who signs off |
|---|---|---|---|
| Standard payment terms (the set not flagged as non-standard) | Net 15 and Net 30 (**seeded by FB-11**, `standard_payment_terms`) | A-012 (Gemma) | Gemma Cebolla |
| Extra Final Review approval for customer-funded quotes | Sales leader, then leadership; off until A-035 (**seeded by FB-08**, `g4_additional_approvals`, `active: false`) | D-002, A-035 | Oleg Yarovinski; Sarah |
| New intake fields (payment terms, customer funding, dunnage, delivery, freight) | Optional (a warning, not a block) | D-006 (mandatory list) | Bailey Schmitt |

**Inputs the business still has to send (tracker Action Items):**

| Input | From | Action | Used by |
|---|---|---|---|
| Standard neck diameters, finishes, special features | Jim Zweifel | A-001 (received 11/4; values in the Field Inventory) | FB-02 (F-010): seeded as provisional value lists `neck_diameter`, `neck_finish_type`, `neck_special_feature` (2026-11-05); sign-off still needed (F-020) |
| No-drawing minimum set, incl. whether layer structure and a container photo join it | Jim Zweifel, Danielle Leu | A-005, A-024 | FB-02 (F-016): the D-018 set is seeded provisionally; layer structure / photo would need new fields first |
| Component list and follow-ups (liner spec, labels purchased by, decoration type and colors) | Bailey Schmitt with Engineering (V-090: the list isn't final) | F-020 | FB-02 (F-013): Decoration added; follow-ups in `component` meta, provisional |
| PCR levels and color list | Engineering and Supply Chain; Kyle Arnold, Tania Nazario | F-055, F-023 | FB-02: `pcr_level` (0/25/50/100) and `color_type` (Natural / Custom), provisional |
| Utilization formula confirmation and basis | Faron Ipox | A-023 (email copied to `feedback/inputs/capacity-formula.md`; OEE appears twice) | FB-03 (F-059) |
| Equipment BOM template and component list | Kal Kaliszewski | A-003 (session 11/6) | FB-06 (F-058) |
| Engineering estimate workbook (the costing input Engineering fills today). **Identified 2026-11-10:** Kal Kaliszewski says it is the *Pretium Project Workbook Template*, the same file as the BOM template; mapped in `feedback/engineering-estimate-mapping.md`, four open points remain | Engineering (Paul Slomkowski), Kal Kaliszewski | new | FB-06 (F-026) |
| ~~Active plant list (~29) and machine types~~ | Jim Zweifel | F-020 / **F-057 done**. **Received 2026-11-10** (QuoteFlow Plants and Process.xlsx, dated 11.10.26) and **approved** (Ben Whann confirmed it is correct): 22 locations and 14 machine types, loaded exactly as sent by FB-13 (`feedback/inputs/plants-machine-types.md`, migration 0039). The "about 29" figure was only an estimate and is not a check. | FB-09, FB-13 |
| Resin, market, product family, packaging lists | Danielle Leu; Engineering with the plants | F-020, A-028. **Received 2026-11-09:** product family and resin (approved by Danielle Leu; loaded by FB-09), PCR and additive (loaded, provisional) and the "Other" rule. The market list moved to Melanie Rasche (FB-12). Pack-out standards (A-028) not received | FB-09 |
| 9-box grid; machine platform guide (MOQs) | Melanie Rasche; Danielle Leu | A-009, A-010 (received). Copied 2026-11-05 to `feedback/inputs/9-box.md` (placement and points to confirm; grid is by segment) and `platform-guide.md`. **Platform guide confirmed by Danielle Leu 2026-11-09** (ISBM 1M, Injection 3M; seed corrected by migration 0035). **9-box placement and points from Melanie Rasche 2026-11-09**: score by sub-market, Strategic Growth 80, Selectively Participate 50, Rationalization 20, with a new market and sub-market list (FB-12) | FB-04 mechanism, FB-10 values, FB-12 |
| Standard cost-model template | Gemma Cebolla, Kyle Arnold | new | FB-07 (F-031) |
| Standard payment terms and exceptions | Gemma Cebolla | A-012, A-022 | FB-08: **built 2026-11-10** with Net 15 / Net 30 standard and the PricingLead deciding exceptions (provisional); A-022 may add common exceptions to the list |
| Kal's minimum quote-time fields. **The blank template was already sent**: Kal emailed Bailey (cc Ben) on 2026-11-04 a link to *Pretium Project Workbook Template.xlsx* (SharePoint site AutomationAPTeam). The Hormel copy holds a real customer's data: do not send or commit it | Kal Kaliszewski | A-030 (workbook walked through Nov 6) | FB-06 (F-058) |
| Standard costing-model template and Stacy Slocum's ROI template, with the cell map | Gemma Cebolla; Stacy Slocum | A-031 | FB-07 one-page summary (uploads and versions **built 2026-11-09**; drop the templates and the cell map in `feedback/inputs/` to build the extraction) |
| A Finance app role and group in Entra for Stacy Slocum | Vincent Brown (IT) | A-032 | FB-07 (F-083): **code built 2026-11-09**; Entra role and group **created 2026-11-10** (`06-azure-entra-setup.md` A4b); Ben adds the Finance testers to the group |
| Standard for returnable and single-trip dunnage; whether safety stock belongs at intake | Bailey Schmitt; Gemma Cebolla; Faron Ipox | A-033 | FB-11 (F-063): **dunnage checkbox built 2026-11-09** with provisional label and help ("multi-trip" returns, "single-trip" is charged to the customer); safety stock and stocking programs deliberately not built |
| Plants' sales-tax status for tooling | Gemma Cebolla (Tax); Kal Kaliszewski | A-034 | Later (BOM tax lookup) |

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
| BR-11 | Legacy pricing data is messy (0 written for blank, repeated request numbers, no ERF↔BPR link, no SF id) | High / Low (MVP) | Imported read-only history; 0 estimates = unknown; match by Legacy ERF # and customer name; the search page as fallback (B-15 revised) | — | Cory McGahan |
| BR-12 | Ranger scope creeps into the MVP | Medium / Medium | Ranger assist is P1 and advisory only | New AI asks before Nov 13 | Darren |
| BR-13 | **Audit exception: GHSA-xcx6-jx8p-x3h5** (High; `@azure/msal-node` < 7.1.0 can leak parameters in the authorization code flow, `acquireTokenByCode`). Pulled in by `@azure/identity`, which up to 4.15.0-beta.1 still requires msal-node 6.x. | Low / Low | Not exploitable here: the API uses only `ManagedIdentityCredential` and `ClientSecretCredential` (Graph, Blob), never the auth code flow; browser sign-in uses `msal-browser`. Ignored by that one id in `package.json` → `pnpm.auditConfig.ignoreGhsas` (added 2026-10-24), so every other advisory still fails CI. Forcing msal-node 7 under identity was rejected: an untested major version on the managed-identity login. | An `@azure/identity` release that allows msal-node ≥ 7.1: upgrade and **remove the exception** | Ben |
| BR-14 | **Fabric mirroring limits bite** (no `jsonb`, DDL needs stop/start, `FORCE`d RLS vs the mirroring role, private endpoint needs a gateway) | Medium / Medium | B-27 spike on test first; `_json` text companions + CI guard; deploy-time stop/start; count tie-out per table; fallback = app-written export (open mirroring) | Spike shows missing rows or columns; a deploy leaves the mirror not `Running` | Ben |
| BR-15 | **Fabric prerequisites late** (workspace, running capacity, tenant settings, VNet data gateway, Burstable → GP approval) | Medium / Medium | Ask at MF with the exact list (B-27 prompt "Preconditions"); test mirror needs no gateway | Nothing provisioned by Nov 2 | Brennan Paul / Oliver Kade |
| BR-16 | **Commercial figures exposed in Fabric** (Postgres RLS and redaction don't carry over) | Medium / High | Workspace limited to D&A + Admin; column security for commercial fields; curated layer only for readers; tested both ways in B-27 | Anyone outside the commercial groups can query a commercial column | Brennan Paul |

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
- `Pricing Application Exports.xlsx` (Cory McGahan, October 2026; approved): ERF 8,535 × 99, BPR 26,560 × 62, SPR 12,189 × 91. Imported by an Admin, never committed (`.gitignore` refuses `*.xlsx` other than `*.synthetic.xlsx` fixtures).
- Meeting recordings/transcripts (.mp4): not machine-readable here.
