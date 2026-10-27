# P1 / P2 backlog (draft)

**Status: DRAFT, 2026-10-27.** Drawn from the deferred items in `03-build-steps.md` (notes, deviations, the post-MVP table), the open decisions in `04-decisions-and-risks.md`, the P1 features the PRD and architecture cite, the UAT known gaps (`docs/uat/README.md`) and the B-21 findings. UAT Sev-3 / Sev-4 defects join at U6 (`docs/uat/README.md` severity rules).

Priorities are proposals for Bailey Schmitt and Darren Miller to confirm. "Owner" is named only where the repo names one; otherwise **TBD**.

## In progress before MVP (not backlog, listed for completeness)

| Item | Why | Source | Owner |
|---|---|---|---|
| Rate limiter keyed on the signed-in user, not the client IP (**in progress**) | One office NAT or one load generator shares 300 req/min today; the B-21 target is 300/min per user | `03` B-21 notes; `tests/load/README.md` "Rate limit" | Ben (being fixed separately) |
| App Insights telemetry, availability test, alert rules, action group | No telemetry or alerts exist; monitoring is health check + Log stream | `06` §6 deviation 5; `infra/README.md` "Not yet in Bicep (B-21)" | Ben |
| Low-privilege database login for the app | The app connects as the Postgres admin login and switches to `ccq_app` per request | `06` §6 deviation 3 | Ben + IT |
| Analytics page "operational, not certified" label | Missing on Analytics (present on Usage and ERF linkage) | `docs/uat/README.md` known gaps | Ben |
| Apply Bicep (what-if, then apply) and build prod | Test was built by CLI; prod not deployed | `03` B-20, B-22 | Ben + IT |

## Backlog

| Item | Why | Source | Priority | Owner |
|---|---|---|---|---|
| Teams digest; SLA and stale-quote alerts | Deferred from B-18; thresholds need a baseline | `03` post-MVP table; D-20 | P1 | TBD (Process Owner sets thresholds) |
| Rules-based engineering routing | MVP is a manual prioritized queue (DEC-26) | `03` post-MVP table; DEC-26; D-19 | P1 | TBD |
| Ranger AI assist: suggested score, missing fields, drawing inference, similar quotes (advisory only) | PRD P1; AI never decides (CLAUDE.md rule 9) | `03` post-MVP table; `01` §6; X-86; D-22 | P1 | Bailey / Zac Cairns (`01` §6) |
| Ranger hand-off (ERF inputs → Ranger) | Future-state deck; parked in B-26 | `03` post-MVP table; B-26 notes | P1 | TBD (D-22; ERF restructure) |
| Guided onboarding walkthrough per role | Quick-starts exist; no in-app walkthrough | `03` post-MVP table | P1 | TBD |
| Per-field "why we ask" explanations (F-19) | Help text already seeded in `intake_field_help` | B-07 prompt; `settings.ts` | P1 | TBD |
| D&A-certified analytics on the Fabric mirror | MVP dashboards are operational only | `03` post-MVP table; `01` §6 | P1 | Brennan Paul |
| Governed proposal templates | Future-state deck; parked | `03` post-MVP table; D-25 | P1 | TBD (Pricing + Legal) |
| Tiered or same-sitting G3 + G4 approvals | Tier hook exists (`g4_tier_rules`, off) | `03` post-MVP table; D-10 | P1 | TBD (D-10 tiers) |
| Gate owners editable in the admin console (`role_permission` as the route-time control) | Today a gate owner change is a code change; needs a security decision | `03` B-19 "not done"; `05` Step 11 | P1 | Ben, after a decision (D-02 / Darren) |
| Revalidate a proposal without a re-quote | Not built; waits on D-12 | `04` B-13 provisional choices | P1 | TBD (Pricing + sales leadership) |
| Pricing-specific queue aging buckets | Pricing borrows engineering's buckets | `04` B-17 questions; `05` §4 | P2 | Gemma Cebolla to decide |
| Engineers read the commercial numbers on their own assigned quotes | Matrix change (`assigned` qualifier), if R2 asks | `03` B-10 notes; `04` B-10 | P2 (decision first) | TBD (R2; data owners) |
| One definition of "age" everywhere (calendar vs business days); holiday calendar | Board/list use calendar days, queue uses business days; no holidays | `03` B-14 notes; B-10 notes | P2 | TBD |
| Region filter on the quote list (analytics drill-down keeps region) | Drill-down drops region and dates | `03` B-17 notes; `04` B-17 | P2 | TBD |
| Daily rescore so "timing" ticks without an event | Score is "as of" its last calculation | `03` B-08 notes | P2 | TBD (if leadership wants it) |
| 7:00 AM digest on business days only | Digest goes on weekends too | `03` B-18 notes; `05` §4 | P2 | Jim Zweifel / sales leader to decide |
| Capital-likely checkbox in the intake wizard | Flag is set on the quote after intake only | `03` B-26 "not built" | P2 | TBD |
| Ship-to from Salesforce `Ship_to_Locations__c` / spec ship-to fields; intake pre-fill from SF fields | Only 1,714 of 6,199 accounts have a shipping address | `03` B-06 notes; D-18 | P2 | Zac Cairns / Graham Parle |
| Show the Salesforce opportunity id on the quote page | Tie-out reads it from ERF linkage | `docs/uat/README.md` known gaps | P2 | TBD |
| Second design pass: dashboard tiles, intake stepper, analytics charts | Only inherited the B-25 tokens | `03` B-25 "not done" | P2 | TBD (after UAT feedback) |
| Licensed Pretium fonts (Value Serif Pro, Basis Grotesque Pro) | Open substitutes self-hosted; licence check needed | `03` B-25 notes | P2 | TBD (licence) |
| Remove the BR-13 audit exception (`@azure/msal-node`) when `@azure/identity` allows msal-node ≥ 7.1 | Ignored advisory GHSA-xcx6-jx8p-x3h5 | `04` BR-13 | P2 | Ben |
| Post-award hand-off view (Nicole Donnelly, Anne DeSmet; `CCQ.PostAward`) | P2 role; no dev persona or matrix coverage yet | `03` post-MVP table; `01` §3.1; D-14 | P2 | TBD (D-14) |
| MCP / API for Copilot and Cowork agents, user-scoped | — | `03` post-MVP table | P2 | TBD (IT agent-identity pattern) |
| Full decision log and corrections ledger (F-21) | Minimal log built in B-19 | `03` post-MVP table | P2 | TBD (Knowledge Steward) |
| Knowledge-base chat over the CCQ record | Future-state deck; parked | `03` post-MVP table; D-22 | P2 | TBD (Knowledge Steward) |
| Visit-to-win analysis | — | `03` post-MVP table | P2 | TBD |
| Salesforce write-back, incl. the new-item flow / Apex | Read-only in MVP | `03` post-MVP table; D-16w | Decide before scale | Darren + Salesforce owner |
| CER integration (CER is a reference ID at G6 today) | Capital-system redesign (Jan) | `03` post-MVP table; D-26 | Decide at scale | TBD (Finance) |
| Migrate legacy ERF records into CCQ; plan for in-flight ERFs at cutover | 3,395 ERFs still "open" in the export | `03` post-MVP table; D-29; D-30 | Decide before scale / before switch-off | Bailey + sales leadership + Pricing |
| Final pricing-app export at switch-off | Re-import is idempotent; nothing deleted | `04` B-15 revised | Before switch-off | Cory McGahan |
| Retention for `CCQ/_removed` and `CCQ/_drafts` files | Soft delete only today | `04` B-16 questions | P2 | IT |
| Prod Fabric mirror via the VNet data gateway, if deferred | D-FB5 fallback = hypercare week 1 | `04` D-FB5; `03` B-27 | Hypercare | Brennan Paul + IT |
