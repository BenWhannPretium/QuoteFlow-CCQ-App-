# Requirements traceability matrix (draft)

**Status: DRAFT, 2026-10-27.**

> **Read this first.** PRD v1 and the Operating Model are on SharePoint, not in the repo. This matrix is **derived from the requirement ids the repo already cites** (build guide, prompts, code comments, tests). It is not a copy of the PRD. **Bailey Schmitt must reconcile it against PRD v1** (F-01..F-17 and the Op Model MUST list, "CR-05..CR-56 subset" per the B-24 prompt) before Gate 3. Requirement wording here is paraphrased from the repo. Where the repo cites an id without saying what it means, the row says so.
>
> The UAT script step column the B-24 prompt asks for is not filled yet: the UAT scripts (`docs/uat/scripts/*.md`) don't cite requirement ids. Owner: Bailey (map at script review, by Fri Nov 6).

**Status values:** **built** = code and tests in the repo, rules fixed. **provisional config** = built, but the business values are seeded `provisional` and wait on an open decision. **open decision** = waits on a business decision; nothing to build yet, or a default ships. **partial** = some of it built, the rest open. **not started**.

Paths are relative to the repo root. Test names are files; `*.int.test.ts` run against real Postgres in CI, `*.spec.ts` are Playwright.

---

## 1. PRD v1 features (F-xx)

| Req | Requirement (as the repo states it) | Build step(s) | Where implemented | Tests that prove it | Status |
|---|---|---|---|---|---|
| F-01 | SSO with Microsoft Entra ID; no local accounts | B-04 | `apps/api/src/auth/`, `apps/api/src/plugins/auth.ts`, `apps/web/src/auth/` | `apps/api/src/auth/entra.test.ts`, `apps/api/src/plugins/auth.test.ts`, `apps/api/test/auth.int.test.ts`, `apps/web/e2e/smoke.spec.ts` | built (Entra sign-in verified on test 2026-10-21, `03` B-04) |
| F-02 | Role landing page / dashboards | B-05, B-17, B-26 (A5) | `apps/web/src/landing/`, `apps/api/src/services/dashboards.ts`, `apps/api/src/services/analytics-engineering.ts` | `apps/web/e2e/shell.spec.ts`, `apps/web/e2e/dashboards.spec.ts`, `apps/api/test/analytics.int.test.ts` | built |
| F-03 | Guided intake (Sales-knowable fields only) | B-07 | `packages/domain/src/intake/`, `packages/contracts/src/intake.ts`, `apps/api/src/services/intake.ts`, `apps/web/src/intake/` | `packages/domain/src/intake/intake.test.ts`, `apps/api/test/intake.int.test.ts`, `apps/web/e2e/intake.spec.ts` | provisional config (field set and blocking fields, D-05) |
| F-04 | Configurable stages and gates | B-02, B-03, B-10–B-13, B-26 | `packages/domain/src/workflow/` (seed `seeds/hybrid.ts`), `apps/api/src/services/gateService.ts` | `packages/domain/src/workflow/evaluate.test.ts`, `rules.test.ts`, `available-actions.test.ts`, `validate-config.test.ts`, `seeds/seeds.test.ts`, `apps/api/test/gates.int.test.ts` | provisional config (stage model D-03; labels and rules seeded provisional) |
| F-05 | Prioritization engine (weighted score, tiers, advisory) | B-08 | `packages/domain/src/scoring/`, `apps/api/src/services/scoring.ts` | `packages/domain/src/scoring/scoring.test.ts`, `apps/api/test/gates.int.test.ts`, `apps/web/e2e/g1.spec.ts` | provisional config (attributes and weights, D-19) |
| F-06 | Governed overrides (justification, approval, revert, original kept) | B-09, B-26 (A2) | `packages/domain/src/overrides/`, `apps/api/src/services/overrideService.ts` | `packages/domain/src/overrides/overrides.test.ts`, `apps/api/test/overrides.int.test.ts`, `apps/web/e2e/overrides.spec.ts` | provisional config (who approves, D-OA) |
| F-07 | Board, list, approvals and prioritization views; CSV export | B-14 (also B-10 queue) | `packages/domain/src/pipeline/`, `packages/db/src/repos/pipeline.ts`, `apps/api/src/services/pipeline.ts` | `packages/domain/src/pipeline/pipeline.test.ts`, `apps/api/test/pipeline.int.test.ts`, `apps/api/test/perf/pipeline.perf.test.ts`, `apps/web/e2e/pipeline.spec.ts`, `apps/web/e2e/board-perf.spec.ts` | built |
| F-08 | Activity timeline | B-09 | `packages/domain/src/timeline/`, `packages/domain/src/comments/`, `apps/api/src/services/timeline.ts` | `packages/domain/src/timeline/timeline.test.ts`, `packages/domain/src/comments/comments.test.ts`, `apps/api/test/timeline.int.test.ts` | built |
| F-09 | Role and data scope, enforced on the server and in SQL | B-04, B-21 | `packages/domain/src/policy/` (`matrix.ts`, `redact.ts`), RLS in `packages/db/migrations/` | `packages/domain/src/policy/can.test.ts`, `redact.test.ts`, `apps/api/test/permissions/matrix.int.test.ts` (115 routes × roles), `apps/api/src/routes/v1/routeMatrix.test.ts`, `packages/db/test/rls.int.test.ts`, `packages/db/test/opportunity-rls.int.test.ts` | partial (matrix done 2026-10-26; B-21 RLS and redaction suites still open) |
| F-10 | Salesforce read (opportunity picker, delta sync) | B-06 | `packages/integrations/src/salesforce/`, `apps/api/src/jobs/sfSync.ts`, `apps/api/src/services/salesforce.ts` | `fieldMap.test.ts`, `readonly.test.ts`, `mapper.test.ts`, `soql.test.ts`, `jsforce.test.ts`, `fake.test.ts` (all in `packages/integrations/src/salesforce/`), `apps/api/test/salesforce.int.test.ts`, `apps/api/test/sfSync.int.test.ts`; `contract.live.test.ts` (skipped unless `SF_LIVE_TEST=1`) | built (live on the production org 2026-10-24; field meanings TBD with Zac Cairns / Graham Parle) |
| F-11 | Pricing read | B-15 (revised 2026-10-22: imported export, no live connection) | `packages/integrations/src/pricing/`, `apps/api/src/services/pricing-history.ts` | `packages/integrations/src/pricing/historyMapper.test.ts`, `exportReader.test.ts`, `apps/api/test/pricing-history.int.test.ts`, `apps/web/e2e/pricing.spec.ts`, `apps/web/e2e/admin-integrations.spec.ts` | partial (built; not yet imported in test or prod; sensitivity to confirm with Gemma Cebolla) |
| F-12 | Usage audit log | B-09 | `apps/api/src/plugins/audit.ts`, `apps/api/src/services/auditAdmin.ts` | `apps/api/src/plugins/audit.test.ts`, `apps/api/src/services/auditAdmin.test.ts`, `apps/api/test/audit.int.test.ts`, `packages/db/test/rls.int.test.ts` (append-only) | built |
| F-13 | Attachments (SharePoint) | B-16 | `packages/integrations/src/graph/`, `packages/domain/src/attachments/`, `apps/api/src/services/attachments.ts` | `packages/integrations/src/graph/filestore.test.ts`, `packages/domain/src/attachments/attachments.test.ts`, `apps/api/test/attachments.int.test.ts`, `apps/api/test/attachments.stream.int.test.ts`, `apps/web/e2e/attachments.spec.ts`; `sharepoint.live.test.ts` not yet run | partial (built; SharePoint not connected, test uses Blob; M7) |
| F-14 | Mobile (390 px) | B-05, B-21 | `apps/web/src/shell/`, responsive components | `apps/web/e2e/mobile.spec.ts`, `apps/web/e2e/dashboards.mobile.spec.ts`, `apps/web/e2e/final-review.spec.ts` (390 × 844), `intake.spec.ts` (390 × 844) | partial (built per screen; B-21 mobile pass open) |
| F-15 | Notifications (P1; the eng-lead arrival alert is P0 per X-91) | B-18 | `packages/domain/src/notifications/`, `packages/integrations/src/mail/`, `apps/api/src/services/notificationService.ts`, `apps/api/src/jobs/notificationDispatch.ts` | `packages/domain/src/notifications/notifications.test.ts`, `packages/integrations/src/mail/mail.test.ts`, `apps/api/src/emails/render.test.ts`, `apps/api/test/notifications.int.test.ts`, `apps/web/e2e/notifications.spec.ts` | partial (in-app live; email not live until M7) |
| F-16 | Final Review (P1, delivered as a P0 decision record) | B-12 | `packages/domain/src/final-review/`, `apps/api/src/services/final-review.ts` | `packages/domain/src/final-review/final-review.test.ts`, `apps/api/test/final-review.int.test.ts`, `apps/web/e2e/final-review.spec.ts` | provisional config (approver D-10; tiers off) |
| F-17 | Analytics (P1, basic in MVP) | B-17, B-26 (A5) | `packages/db/sql/analytics/*.sql`, `packages/db/src/repos/analytics.ts`, `apps/api/src/services/analytics.ts` | `packages/db/test/analytics.int.test.ts`, `apps/api/test/analytics.int.test.ts`, `apps/web/e2e/dashboards.spec.ts` | partial (built; definitions not validated with D&A, M6) |
| F-19 | Per-field "why we ask" explanations (P1) | B-07 (config only) | `app_setting.intake_field_help` (`packages/db/seeds/config/settings.ts`) | none specific | partial (help text seeded; the P1 feature is not built) |
| F-21 | Decision log (full log P2; minimal in MVP) | B-19 | `apps/api/src/services/adminConfig.ts`, `apps/web/src/routes/admin/decision-log.tsx` | `apps/api/test/admin-config.int.test.ts`, `apps/web/e2e/admin-config.spec.ts` | partial (minimal log built; full log and corrections ledger P2) |

Not found in the repo: F-18 and F-20. **TBD (Bailey):** confirm whether they exist in PRD v1 and whether they are MVP.

## 2. Operating Model requirements (CR-xx)

| Req | Requirement (as the repo states it) | Build step(s) | Where implemented | Tests that prove it | Status |
|---|---|---|---|---|---|
| CR-05 | **Meaning not in repo.** Cited only as the start of the range "CR-05..CR-56 subset" (B-24 prompt). | — | — | — | not placed (Bailey) |
| CR-08 | Intake "stop vs enrich": which missing fields block submit | B-07 | `app_setting.intake_required_fields`, `packages/domain/src/intake/intake.ts` | `packages/domain/src/intake/intake.test.ts`, `apps/api/test/intake.int.test.ts` | provisional config (D-05) |
| CR-10 | G1 qualification record | B-08 | `packages/domain/src/workflow/` (G1 rules), `apps/api/src/services/gateService.ts` | `packages/domain/src/workflow/g1.test.ts`, `apps/api/test/gates.int.test.ts`, `apps/web/e2e/g1.spec.ts` | provisional config (decider D-06) |
| CR-11 | **Meaning not in repo.** Cited with CR-10 in the B-08 heading (prioritization + G1). | B-08 | as CR-10 / F-05 | as CR-10 / F-05 | not placed (Bailey) |
| CR-14 / CR-15 | Engineering queue and aging | B-10 | `packages/domain/src/engineering/`, `apps/api/src/services/engineering.ts` | `packages/domain/src/engineering/engineering.test.ts`, `apps/api/test/engineering.int.test.ts`, `apps/web/e2e/engineering.spec.ts` | provisional config (aging buckets `eng_queue_aging_days`; no SLA, D-20) |
| CR-18 | **Meaning not in repo.** Cited in the B-10 prompt heading (CR-14/15/18/19). | B-10 | — | — | not placed (Bailey) |
| CR-19 | Capacity evidence at Engineering Review (no OEE default) | B-10, B-26 (B5 sign-off) | `packages/domain/src/engineering/review.ts`, `capacity_evidence` table | `packages/domain/src/engineering/engineering.test.ts`, `apps/api/test/engineering.int.test.ts`, `apps/web/e2e/engineering.spec.ts` | provisional config (sign-off owner D-07) |
| CR-25 | Costing attestation (costing stays in Excel) | B-11, B-26 (B6) | `packages/domain/src/pricing/`, `apps/web/src/components/pricing/QuotingTab.tsx` | `packages/domain/src/pricing/pricing.test.ts`, `apps/api/test/pricing.int.test.ts` | built (required before G3 since B-26) |
| CR-26 | Price approval recorded as a decision, no price figures | B-11 | `packages/domain/src/pricing/`, `apps/api/src/services/pricing.ts` | `apps/api/test/pricing.int.test.ts` (a `price` key is a 400), `apps/web/e2e/pricing.spec.ts` | built |
| CR-29 | Final Review (G4) separate from the customer outcome | B-12 | `packages/domain/src/final-review/` | `apps/api/test/final-review.int.test.ts` ("never Awarded/Lost"), `packages/domain/src/final-review/final-review.test.ts` | built |
| CR-37 | Validity date and countdown; nothing auto-closes | B-13 | `packages/domain/src/final-review/` (dates), `apps/api/src/jobs/validityExpiry.ts` | `packages/domain/src/outcome/outcome.test.ts`, `apps/api/test/outcome.int.test.ts` | provisional config (30 days, D-12) |
| CR-38 | Re-quote is versioned; earlier decisions and pricing records never edited | B-11, B-13 | `apps/api/src/services/quotes.ts`, `apps/api/src/services/pricing-view.ts` | `apps/api/test/outcome.int.test.ts` (byte-for-byte), `apps/api/test/final-review.int.test.ts`, `apps/api/test/pricing.int.test.ts` | built |
| CR-39 | Closure needs outcome + reason + owner + date; expired ≠ lost | B-13 | `packages/domain/src/outcome/closure.ts`, DB CHECK `quote_closure_complete_check` | `packages/domain/src/outcome/outcome.test.ts` (terminal-path sweep), `apps/api/test/outcome.int.test.ts` | built (rule); reason codes provisional (D-15) |
| CR-40 | Internal no-gos close with a reason and the deciding role | B-13 | `packages/domain/src/outcome/closure.ts`, `packages/domain/src/types/workflow-config.ts` | `packages/domain/src/outcome/outcome.test.ts`, `apps/api/test/outcome.int.test.ts` | built |
| CR-41 / CR-42 | Minimal hand-off record | B-13, B-26 (Stage 6) | `packages/domain/src/outcome/handoff.ts`, `handoff_record` table | `apps/api/test/outcome.int.test.ts`, `apps/web/e2e/outcome.spec.ts` | provisional config (fields to confirm at R3; D-26) |
| CR-47 | MVP data dictionary | B-03 | `docs/data-dictionary.md` (generated, `pnpm db:dictionary`) | `packages/db/src/dictionary/dictionary.test.ts` (fails when stale) | partial (generated; owners/definitions not agreed with D&A, M6) |
| CR-51 | Configurable rules (no code change) | B-03, B-19 | `packages/domain/src/config-admin/`, `apps/api/src/services/adminConfig.ts`, `apps/web/src/admin/` | `packages/domain/src/config-admin/config-admin.test.ts`, `apps/api/test/admin-config.int.test.ts`, `apps/web/e2e/admin-config.spec.ts` | partial (all prompt screens built; **gate owners still in code**, `03` B-19) |
| CR-55 | Time in stage | B-10, B-17 | `packages/domain/src/workflow/` (`computeTimeInStage`, `summarizeStageTimes`), `packages/db/sql/analytics/` | `packages/domain/src/workflow/time-in-stage.test.ts`, `packages/db/test/analytics.int.test.ts` | built |
| CR-56 | **Meaning not in repo.** Cited in the B-17 heading (CR-55/56/57) and as the end of the range in the B-24 prompt. | B-17 | — | — | not placed (Bailey) |
| CR-57 | Hold time excluded from cycle time | B-03 (`quote_hold`), B-17 | `quote_hold` table, `packages/db/sql/analytics/`, `packages/db/sql/fabric/00_functions.sql` | `packages/db/test/analytics.int.test.ts`, `apps/api/test/outcome.int.test.ts` ("hold time is excluded") | built |

## 3. Evidence-base decisions (DEC-xx)

| Req | Decision | Build step(s) | Where implemented | Tests | Status |
|---|---|---|---|---|---|
| DEC-12 | Every quote starts from a Salesforce opportunity; one active quote per opportunity | B-06, B-07 | intake picker; unique index `quote_one_active_per_opportunity_uidx` | `apps/api/test/intake.int.test.ts` (409 `active_quote_exists`), `apps/api/test/salesforce.int.test.ts` | built |
| DEC-19 | Pricing is a required gate (cited with DEC-20) | B-11 | G3 seed rules, `packages/domain/src/pricing/` | `apps/api/test/pricing.int.test.ts` ("only Pricing decides G3") | built; pass-through threshold off (D-24) |
| DEC-20 | All pricing decisions go through Pricing | B-11 | as DEC-19 | as DEC-19 | built; **needs re-confirmation** (decided by Kathleen Gogola, who has left; `04` §1) |
| DEC-23 | Pricing method out of scope; Pricing has the final say | B-11 | no price figure in any column, body or input | `apps/api/test/pricing.int.test.ts`, `apps/web/e2e/pricing.spec.ts` | built |
| DEC-24 / DEC-25 | Darren Miller is build sponsor; pilot has precedence with extra hours authorized | — | governance, not software | — | n/a |
| DEC-26 | MVP routing = manual prioritized queue to the upfront eng lead; rules-based routing is P1 | B-10 | `packages/domain/src/engineering/` (sort, assign) | `apps/api/test/engineering.int.test.ts` | built (rules-based routing in `backlog.md`) |
| DEC-27 | No customer-account creation at intake; existing vs not yet established | B-07 | intake step 2, `customer.status` (`existing` \| `not_yet_established`, `packages/db/src/schema/enums.ts`) | `apps/api/test/intake.int.test.ts` (not-yet-established customer) | built |

## 4. Locked build decisions (L-x)

| Req | Decision | Build step(s) | Where implemented | Tests | Status |
|---|---|---|---|---|---|
| L-1 | Host on Azure | B-20 | `infra/`, `.github/workflows/deploy.yml`, `06` runbook | deploy smoke step in `.github/workflows/deploy.yml` (health reports the new commit with `db: up`) | partial (test running; Bicep not applied; prod not deployed) |
| L-3 | Configurable stage/gate engine, hybrid seed | B-02, B-19 | `packages/domain/src/workflow/` | `validate-config.test.ts`, `seeds/seeds.test.ts` (PRD-5 alternative), `apps/api/test/admin-config.int.test.ts` | built |
| L-4 | MVP = UAT-ready on approved data by Nov 13 | B-22–B-24 | — | UAT U1–U5 | not started |
| L-5 | One read-only Salesforce integration user | B-06 | `packages/integrations/src/salesforce/` (client credentials) | `apps/api/src/config.test.ts`, `packages/integrations/src/salesforce/jsforce.test.ts` | built |
| L-6 | CCQ scopes Salesforce data; commercial SF fields never read | B-06 | RLS on `sf_opportunity_snapshot` (migration 0021), `visibleOpportunityIds` | `packages/db/test/opportunity-rls.int.test.ts`, `apps/api/test/salesforce.int.test.ts` (L-6 block), `packages/integrations/src/salesforce/fieldMap.test.ts` | built |
| L-7 | Keep every opportunity, closed history included | B-06 | `apps/api/src/jobs/sfSync.ts` | `apps/api/test/sfSync.int.test.ts` | built |
| L-8 | All new QuoteFlow data stored in Fabric (mirroring) | B-27 | migration 0022, `packages/db/src/fabric.ts`, `packages/db/sql/fabric/`, `scripts/fabric-mirroring.sh`, `apps/api/src/jobs/fabricMirrorCheck.ts` | `packages/db/src/schema/fabricCompat.test.ts`, `packages/db/src/fabricTwins.test.ts`, `packages/db/test/fabric.int.test.ts`, `packages/integrations/src/fabric/mirroring.test.ts`, `apps/api/test/fabricMirrorCheck.int.test.ts` | partial (code side built; no mirror running; D-FB2–D-FB5) |

## 5. Open business decisions that shape requirements (D-xx)

Each is shipped as provisional config unless marked. Source: `04-decisions-and-risks.md` §2.

| Req | Question | Config / code it controls | Owner | Status |
|---|---|---|---|---|
| D-02 | Process Owner / Knowledge Steward | `process_owner`; Admin = interim | Sarah Brennan | open decision |
| D-03 | Stage-gate model (PRD 5 vs Op Model 6) | workflow config (hybrid seed) | Oleg Yarovinski; CCQ Steering | provisional config |
| D-05 | Minimum intake set, stop vs enrich | `intake_required_fields` | Jim Zweifel + sales leadership | provisional config |
| D-06 | G1 decider; value/volume screens | `gate.G1.decide` (code matrix); `min_opportunity_value_warning_usd`, `min_volume_warning_by_process` | Sales leadership | provisional config |
| D-07 | Capacity owner for the G2 sign-off | `capacity.signoff` (code matrix, EngLead) | **TBD** (no row in `04`; cited in `matrix.ts`) | provisional config |
| D-08 | No OEE default | code (`packages/domain/src/engineering/review.ts`) | — | built (decided) |
| D-10 | Final Review approver(s) and tiers | `SG-CCQ-Approver` membership; `g4_tier_rules` (null) | Sarah Brennan via Bailey's D-pack | open decision |
| D-11 | What "capital ready" means before Final Review | G3 rules, `capital_readiness` | **TBD** (no row in `04`) | open decision |
| D-12 | Validity default; revalidation | `validity_days_default` (30), `validity_warning_days` (7) | Pricing + sales leadership | provisional config |
| D-14 | Post-award hand-off view (P2) | — | **TBD** | open decision (P2) |
| D-15 | Outcome taxonomy, reason codes, closure owner | `reason_code` rows, `transition_rule.closure_owner` | Sales leadership + Process Owner | provisional config |
| D-16w | Salesforce write-back | none in MVP | Darren + SF owner | decided for MVP (none) |
| D-17 | Support model | — | Darren + Oliver Kade | see `runbook.md` §8 (contradiction noted in README) |
| D-18 | Customer / ship-to source | SF Account | Zac Cairns + Graham Parle | provisional config |
| D-19 | Scoring attributes and weights | `scoring_model` v1 | Jim Zweifel + sales leadership | provisional config |
| D-20 | SLA targets | aging buckets only | Process Owner | open decision (after pilot) |
| D-22 | Ranger / knowledge-base AI (cited as a blocker in `03` backlog) | — | **TBD** | open decision (P1/P2) |
| D-23 | Production-data approval | — | Oliver Kade + Brennan Paul | reported approved; written record TBD |
| D-24 | Pricing pass-through threshold | `pricing_pass_through.maxAnnualRevenueUsd` (null = off) | Pricing lead + sales leadership | provisional config |
| D-25 | Legal review triggers at G4 | `legal_review_triggers` (all on) | Legal + sales leadership | provisional config |
| D-26 | CER matrix and Stage 6 owners | `gate.G6.decide` (KAM own, SalesLeader) | Finance + sales leadership | provisional config |
| D-27 | Capital-likely recipients; Market Development threshold | `capital_management_notice`, `market_development_notice` (off) | Capital Mgmt + Market Development | provisional config |
| D-28 | Escalation routes; Process Owner | `escalation_routes`, `process_owner` (null) | Sarah Brennan + Bailey | provisional config |
| D-29 | Migrate legacy ERFs or lookup only | Legacy ERF # field | Bailey + Pricing | provisional (lookup only) |
| D-30 | In-flight legacy ERFs at cutover | imported as history only | Bailey + sales leadership + Pricing | open decision |
| D-FB1 | Mirroring meets L-8 | — | Brennan Paul | decided 2026-10-26 (written source TBD) |
| D-FB2–D-FB5 | Tables mirrored; test off Burstable; workspace and security; prod mirror in the MVP bar | — | Brennan Paul (+ Oliver Kade for D-FB3, Darren for D-FB5) | open decision (MF) |
| D-H2 | Production exposure pattern | — | Oliver Kade | open decision (M8) |
| D-K1 | KAMs see peers' priority scores | `kam_can_see_peer_scores` (true) | Darren / Sarah | provisional config |
| D-OA | Who approves overrides | `overridable_fields` | Bailey with Darren | provisional config |
| D-SP | SharePoint site and folder | `attachment_settings`, `SP_*` | IT M365 admin + Bailey | open decision (M7) |

## 6. Other ids the code cites

| Id | What the repo says | Where | Tests | Status |
|---|---|---|---|---|
| REQ-04 | No plant, process, machine, capital, engineer, channel, product class or priority at intake (with X-90) | `packages/domain/src/intake/intake.ts`, `packages/contracts/src/intake.ts` | `packages/domain/src/intake/intake.test.ts` | built |
| REQ-05 | Neck finish/type and packaging requirements at intake | intake step 3 | `apps/api/test/intake.int.test.ts` | provisional config (D-05) |
| REQ-06 / REQ-41 | G1 qualify decision and redirect paths for stock / price inquiry | G1 Redirect outcome | `packages/domain/src/workflow/g1.test.ts` | provisional config |
| S-01 / S-02 | End-to-end cycle time intake → G4 | `packages/db/sql/analytics/40_quote_cycle.sql` (+ Fabric twin) | `packages/db/test/analytics.int.test.ts` | built (definition to confirm with D&A) |
| S-03 | First-pass intake completeness | `packages/db/sql/analytics/50_intake_first_pass.sql` | `packages/db/test/analytics.int.test.ts` | built (definition to confirm) |
| S-04 | G1 qualification yield | `apps/api/src/routes/v1/analytics.ts` (`g1-yield`) | `apps/api/test/analytics.int.test.ts` | built |
| S-06 / S-07 | Win rate always shown with capture rate | `apps/web/src/analytics/RatePair.tsx`, `packages/contracts/src/analytics.ts` | `packages/db/test/analytics.int.test.ts` | built |
| S-08 | Gate compliance | `packages/db/sql/analytics/60_gate_compliance.sql` | `packages/db/test/analytics.int.test.ts` | built |
| S-10 | Adoption (weekly active users by role) | `packages/db/sql/analytics/90_activity.sql`, `/analytics/adoption` (`audit.read`) | `packages/db/test/analytics.int.test.ts`, `apps/api/test/analytics.int.test.ts` | built |

Ids such as X-xx (evidence references), DF-xx (discovery findings) and R-xx (Op Model risks) are cited for context in code comments; they are not requirements and are left out.
