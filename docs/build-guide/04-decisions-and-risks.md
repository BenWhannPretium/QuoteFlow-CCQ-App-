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
