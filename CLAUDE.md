# QuoteFlow (CCQ App): standing context for Claude Code

Read this file at the start of every session. It is the project's persistent memory.

## What this app is

QuoteFlow is Pretium Packaging's **Commercial Capital Quoting (CCQ)** web app. It replaces the legacy
ERF application for **new business** quotes that need engineering input and/or capital.

The app gives KAMs, upfront Engineering, Pricing, Final Review approvers and leadership one governed place to:
- run intake
- set priority
- route work to engineering
- quote
- approve
- record the outcome of commercial capital opportunities

Sources of truth for requirements (read the relevant one before building a feature):
- `docs/build-guide/README.md`: build guide index, decisions already made, timeline.
- `docs/build-guide/01-architecture.md`: architecture, data model, security model. **Follow it.**
- `docs/build-guide/03-build-steps.md`: the ordered build steps and acceptance criteria.
- `docs/build-guide/04-decisions-and-risks.md`: open business decisions. **Never hard-code an open decision.**
- PRD v1: SharePoint `Artificial Intelligence/Embedded Intelligence/QuoteFlow (CCQ App)/CCQ Transformation Web App - PRD v1 (Populated).docx`.

## Locked decisions (2026-10-15)

| Decision | Choice |
|---|---|
| Hosting | **Azure**: App Service (Linux, Node 22) + Azure Database for PostgreSQL Flexible Server + Key Vault + Application Insights, inside the Pretium tenant |
| Identity | Microsoft Entra ID only (MSAL in the browser, JWT validation in the API). No local accounts. |
| Stage model | **Configurable**, data-driven stage/gate engine seeded with the "hybrid" model (PRD v1 stages + G1 qualify, capacity evidence, Final Review separate from customer outcome, reason-coded outcomes) |
| Build method | Code-first, Claude Code, Git (GitHub), CI on every push |
| Data landing (L-8, 2026-10-24) | **All new data QuoteFlow creates is stored in Pretium's Fabric tenant** (Oleg Yarovinski + Brennan Paul). Met by Fabric mirroring of the CCQ Postgres database; Postgres stays the app's store. See `01-architecture.md` §6.1, B-27 |
| MVP bar for 2026-11-13 | Deployed to Azure, Entra-secured, Salesforce read live on **approved** data, all P0 features passing UAT with gate-owner candidates |

## Stack (do not swap without updating the architecture doc)

- **Monorepo:** pnpm workspaces + Turborepo. Node 22 LTS. TypeScript `strict` everywhere.
- **`apps/web`:** React 18, Vite, TanStack Router, TanStack Query, react-hook-form + zod, Tailwind CSS, shadcn/ui, dnd-kit (kanban), Recharts. Uses MSAL React.
- **`apps/api`:** Fastify 5, `fastify-type-provider-zod`, `@fastify/swagger`, `jose` for Entra JWT validation, `pino` logging, OpenTelemetry → App Insights. In production it also serves the built SPA.
- **`packages/domain`:** pure TypeScript business logic with **no I/O**: the stage/gate engine, the scoring engine, overrides, the permission policy and validation. It must be 100% unit-testable.
- **`packages/db`:** Drizzle ORM, drizzle-kit migrations, seed scripts. PostgreSQL 16.
- **`packages/contracts`:** zod schemas and DTO types shared by web and api.
- **`packages/integrations`:** Salesforce (jsforce), Microsoft Graph (SharePoint, mail), and the pricing-history export reader (B-15: the retired pricing app's .xlsx export, imported by an Admin; no live connection). Each connector sits behind an interface with a fake implementation for tests and local dev.
- **Tests:**
  - Vitest for unit and integration tests.
  - Integration tests use a real Postgres (docker compose locally, service container in CI).
  - Playwright for end-to-end tests.
- **Infra:** Bicep in `infra/`. GitHub Actions in `.github/workflows/` (OIDC to Azure, no stored cloud secrets).

## Non-negotiable rules

1. **Authorization is enforced on the server.**
   - Every API route declares the permission it needs. The check goes through `packages/domain/src/policy`.
   - Data scope is also enforced in SQL (Postgres row-level security, RLS) as a second layer.
   - The UI may hide things, but it is never the control.
2. **Field-level sensitivity.** Pricing, margin and capital figures are returned only to the roles in the policy matrix:
   - Pricing and the Pricing lead
   - Engineering leads
   - Approver
   - Leadership
   - Admin

   Strip these fields from responses for every other role. Don't just hide them in the UI.
3. **Everything is audited.** Every view of a quote, stage change, gate decision, override, upload and export writes an append-only `audit_event`. Never update or delete audit rows.
4. **No hard-coded business rules that are still open.** All of the following live in config tables, with seed values:
   - stage names
   - gate owners
   - thresholds
   - reason codes
   - validity days
   - scoring weights and tiers
   - value lists

   Seed values must be marked `provisional: true` until the owner approves them (see `04-decisions-and-risks.md`).
5. **Read-only toward systems of record.**
   - No write-back to Salesforce or the pricing application in MVP.
   - No editing of pricing figures in CCQ.
   - Costing stays in Excel and the pricing app.
6. **Salesforce is the front door.** Every CCQ quote is linked to a Salesforce Opportunity (DEC-12). The CCQ quote number is generated by CCQ (`CCQ-YYYY-NNNNN`) and carried everywhere.
7. **No customer-account creation at intake** (DEC-27). Customers are flagged as `existing` or `not_yet_established`.
8. **Use sample or masked data until IT and D&A approve production data.** Never commit real customer data, secrets or tokens. `.env` files are git-ignored. Locally, use the synthetic data generator.
9. **AI never decides.** Any assist feature (Ranger, P1) is advisory, with a human decision recorded.
10. **Keep the schema mirror-safe for Fabric** (L-8). Fabric mirroring copies only an allowlist of types. It drops `json`/`jsonb`, **arrays**, `inet`, `interval`, range, `tsvector` and geometric columns, and an unbounded `numeric` loses its decimals. So:
    - A new `jsonb` or array column gets a `<column>_json text` companion: register it in `packages/db/src/fabric.ts`, then add the column, the `zz_fabric_json` trigger argument and a backfill in the migration. Companions stay out of the Drizzle schema. Append-only tables use a side table (`audit_event_fabric`).
    - Give every `numeric` a precision of 38 or less. Don't use the other types; use `text`.
    - Don't partition tables. Don't `TRUNCATE` app tables.
    - Every analytics view needs a T-SQL twin in `packages/db/sql/fabric/`.
    - The guard tests (`fabricCompat.test.ts`, `fabricTwins.test.ts`, `test/fabric.int.test.ts`) enforce all of this in CI.
11. Keep `docs/build-guide/` current. When a step finishes, tick its acceptance checklist in `03-build-steps.md` and note any deviations.

## Conventions

- **Naming:**
  - Domain terms follow the glossary in `01-architecture.md`.
  - Use "ERF" (never "ERS").
  - Stage 6 is **Commit & Hand Off** (G6). "Closed – Won" (`AWARDED`) is reached only from G6; G5 Awarded records the customer's acceptance.
  - SPR is historical only and gets no stage.
  - NPI/NPD means **pre-award** upfront engineering unless the text says post-award.
- **IDs:** UUID v7 primary keys. Business keys: `quote_number`, `sf_opportunity_id`. `erf_number` is a **legacy ERF reference for the transition only** (B-26); BPR is retired and gets no field.
- **Time:** store UTC `timestamptz`. Display in the user's locale; Pretium HQ is US Central.
- **API:** REST under `/api/v1`. Errors are RFC 9457 problem+json. Every route has a zod schema and appears in OpenAPI.
- **Commits:** Conventional Commits (`feat(intake): …`). Small PRs. CI must pass: lint, typecheck, unit, integration, build.
- **Tests come with every feature:**
  - domain rules → unit tests
  - routes → permission-matrix tests (allowed **and** denied for each role)
  - UI → at least one Playwright happy path per stage

## Local dev quickstart (once B-01 is done)

```bash
pnpm i
docker compose up -d db
pnpm db:migrate && pnpm db:seed --synthetic   # synthetic data only
pnpm dev                          # web on :5173, api on :3000
```

`AUTH_MODE=dev` enables a role switcher with fake users. It must be impossible to enable it in production: the API refuses to boot if `AUTH_MODE=dev` and `NODE_ENV=production`.
