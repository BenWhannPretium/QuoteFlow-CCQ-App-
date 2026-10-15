# B-03 · Database schema, RLS, config seeds, synthetic data

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md`, `docs/build-guide/01-architecture.md` §3.2 (scope), §5 (data model) and §7 (security), and the domain package from B-02. Implement `packages/db` with Drizzle. Propose the schema files and migration order first.

## Requirements

### 1. Schema
Implement **every table in architecture §5**, using the column names and types listed there:
- UUID v7 PKs (generate in app code)
- `timestamptz`
- `jsonb` where noted
- FKs with sensible `on delete` (mostly restrict)
- check constraints for enums (`quote.status`, `customer.status`, `pricing_record.capital_readiness`, `attachment.kind`, `override.status`, `audit_event.action`)

Split the schema files by area: `identity.ts`, `config.ts`, `workflow.ts`, `events.ts`, `integration.ts`.

### 2. Quote number
SQL function `next_quote_number()` uses a per-year counter table and `SELECT ... FOR UPDATE` to return `CCQ-YYYY-NNNNN`. Concurrency-safe; add a test that runs 50 parallel calls and gets no duplicates.

### 3. Roles and RLS
Write these as a hand-written SQL migration after the Drizzle-generated ones.
- **DB roles:**
  - `ccq_app` (runtime): CRUD on workflow tables, **INSERT + SELECT only** on `audit_event` and `activity_event`
  - `ccq_migrator`
  - `ccq_readonly` (for D&A later)
- The API sets `SET LOCAL app.user_id`, `app.roles` (csv) and `app.scope_type` / `app.scope_values` at the start of each transaction (helper in `packages/db/src/withRequestContext.ts`).
- RLS policies on `quote` and every child table (via `quote_id` join) enforce:
  - Admin, Leadership, EngLead, Pricing, Approver and SalesLeader see all rows (MVP)
  - KAM and Engineer see rows per scope type: `all` → all, `owner` → `kam_user_id = app.user_id` (or `assigned_engineer_id` for Engineer), `region` → `quote.region = any(scope_values)`
- Add `FORCE ROW LEVEL SECURITY`.
- Write integration tests proving that an owner-scoped KAM can't select another KAM's quote even with a raw query in the request context.

### 4. Config seeds (`packages/db/seeds/config/`, idempotent upserts, all `provisional=true`)
- **Workflow:** the hybrid model from `packages/domain/workflow/seeds/hybrid.ts`, written into the stage/gate/outcome/transition tables. The domain seed is the single source and the DB seed derives from it.
- **`role_permission`:** from `packages/domain/policy/matrix.ts`.
- **`value_list`** (from the ERF Template Rev D, 2026-03-17):
  - `process_type`: EBM, RHB, IBM, IMM, IMM Preform, ISBM, Assembly, Other
  - `resin`: HDPE, PET, PP, LDPE, PCR-HDPE, PCR-PET, PETG, PVC, PS, Bio-resin, Other. **Note:** the template has 11 resins; mark this list `provisional` with a TODO to replace it with the exact template list from Danielle Leu at M4.
  - `market`: 8 placeholder markets (Food, Beverage, Nutrition/Supplements, Personal Care, Household Chemical, Pharma/Health, Industrial/Chemical, Pet). TODO: confirm at M4.
  - `product_family`: Bottle, Jar, Closure, Preform, Canister/Tub, Handleware, Other
  - `component`: Container, Closure, Liner, Label, Other
  - `request_class`: CCQ (new business + capital/engineering), Stock / stock-plus, Price inquiry / RFP check, Other capital
  - `drawing_status`: Have drawing, Coming, Sample only, None (quote will take longer)
  - `neck_finish`: a free-text-capable list (e.g. 28-410, 38-400, 89-400, 110-400, 120 DC, Other)
  - `packaging_type`: Bulk, Bagged, Trayed, Palletized-custom, Other
  - `plant`: 3 placeholder codes. TODO: load the ~29 plants from the ERF template at M4.
- **`reason_code`** per context (rework, redirect, stop, decline, lost, expired, hold, requote, override). Lost: Price, Lead time, Capability, Capacity, Customer cancelled, Competitor relationship, Other (note required).
- **`app_setting`:**
  - `validity_days_default=30` (PTF says 30; D-12 open)
  - `g1_enabled=true`
  - `min_opportunity_value_warning_usd=null`
  - `min_volume_warning_by_process={}` (D-06 open; warnings only)
  - `sla_hours_by_stage=null` (D-20)
  - `kam_can_see_peer_scores=true`
- **`scoring_model` v1:** the 7 PRD attributes (revenue, volume, strategic fit, capital exposure, customer risk, product fit, timing) with equal weights, band mappings stubbed and tiers Critical ≥ 80, High 60–79, Standard 40–59, Low < 40. Implemented fully in B-08.
- **`sf_stage_map`:** Qualifying, Quoting, Negotiating, Final Review, Verbal Award, PO(s) in hand, Closed Won – Product Shipping, Closed Lost.

### 5. Synthetic data generator (`packages/db/seeds/synthetic/`, run with `pnpm db:seed --synthetic`)
**No real names or customers.** Use faker with a fixed seed. Generate:
- 102 fake SF opportunity snapshots shaped like the "New Last Week" report:
  - names like `"{Distributor} / {Brand} / 16oz HDPE Boston Round 28-410"`
  - amounts from $1k to $1.4M, skewed around $20k–$200k
  - close dates in the next 2–9 months
  - stages distributed Qualifying 8, Quoting 35, Negotiating 48, Final Review 2, PO(s) in hand 5, Verbal Award 1, Closed Won 1, Closed Lost 2
- ~70 fake customers (some `not_yet_established`)
- 12 fake users across all roles, matching the dev-mode personas used in B-04
- 150 quotes spread across every stage, with consistent history, gate decisions, overrides, a few holds and returns, eng reviews, capacity evidence, pricing records, outcomes and attachments metadata (no files)

`pnpm db:reset` drops, migrates and seeds config + synthetic.

### 6. Repositories
`packages/db/src/repos/` holds thin typed repository functions used by API services. No business logic here: that's the domain's job.

Also generate a data dictionary: `pnpm db:dictionary` writes `docs/data-dictionary.md` from schema comments. Add a Drizzle `comment` to every column with its meaning and owner. This is the starting point for M6 with D&A.

## Acceptance
- [ ] `pnpm db:reset` works from scratch; idempotent seed re-run
- [ ] RLS tests pass; `audit_event` UPDATE/DELETE fail for `ccq_app`
- [ ] Quote-number concurrency test passes
- [ ] `docs/data-dictionary.md` generated
- [ ] Tick B-03 in `docs/build-guide/03-build-steps.md`
