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
| **D-PR** | Pricing-app read path (SQL replica vs Fabric) + columns + sensitivity labels | Whichever Cory can grant fastest | Cory McGahan, Gemma Cebolla, Brennan Paul | **M5** | Oct 21 | Manual ERF/BPR reference fields |
| **D-SP** | SharePoint site/folder for attachments; `Sites.Selected` grant | `/CCQ/{quote_number}/` on the CCQ site | IT M365 admin + Bailey | **M7** | Oct 27 | Azure Blob behind the same interface |
| **D-03** | Stage-gate model (PRD 5 vs Op Model 6) | Configurable engine, hybrid seed. **Steering can relabel without code.** | Oleg Yarovinski; approver CCQ Steering | Bailey's decision package | Before scale | Hybrid seed |
| **D-16w** | Salesforce write-back | None in MVP | Darren + Salesforce owner | — | Before scale | Read-only |
| **D-20** | SLA / turnaround targets | Set after baseline + pilot | Process Owner | — | After pilot | Aging buckets only, no SLA |
| **D-02** | Process Owner / Knowledge Steward | Commercial-side owner + Rules Steward | Sarah Brennan | — | Before pilot | Admin = Ben/Tre; Bailey approves config |

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
