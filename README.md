# QuoteFlow (CCQ App)

> Checked against the build on 2026-11-17 (pre-release audit): the `verify`, `test:integration`, `e2e` and `db:reset` rows corrected to what the scripts do; `infra`, `scripts`, `tests` and `docs` added to the layout.

QuoteFlow is Pretium Packaging's **Commercial Capital Quoting** web app, replacing the legacy ERF application for new-business quotes that need engineering input and/or capital.
It gives KAMs, Engineering, Pricing, approvers and leadership one governed, audited record per quote, from intake to customer outcome, linked to its Salesforce opportunity.

## Quickstart

Prerequisites: Node 22 (`nvm use`), pnpm 9 (`corepack enable`), Docker.

```bash
cp .env.example .env              # local defaults: AUTH_MODE=dev, synthetic data only
pnpm i
docker compose up -d db           # Postgres 16 on :5432 (add `mailpit` and set MAIL_MODE=smtp for local email, inbox on :8025)
pnpm db:migrate && pnpm db:seed --synthetic
pnpm dev                          # web http://localhost:5173 · api http://localhost:3000 · docs http://localhost:3000/docs
```

| Script                  | What it does                                                                    |
| ----------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`              | API (node --watch + tsx) + web (Vite, proxies `/api` to the API)                |
| `pnpm verify`           | lint + typecheck + unit + integration + build (CI runs these, then Playwright)  |
| `pnpm test`             | unit tests (Vitest)                                                             |
| `pnpm test:integration` | API and database tests against a real Postgres (`ccq_test`, created + migrated) |
| `pnpm e2e`              | every Playwright spec against the production build (see the note below)         |
| `pnpm db:migrate`       | apply Drizzle migrations to `DATABASE_URL`                                      |
| `pnpm db:seed`          | load config seeds (add `--synthetic` for the synthetic data set)                |
| `pnpm db:reset`         | drop, re-migrate, re-seed config + synthetic data (refuses in production)       |
| `pnpm db:demo`          | drop, re-migrate, seed config + the 12 demo quotes (one per stage)              |

`pnpm e2e` builds first, then needs a migrated, config-seeded database (`pnpm db:migrate && pnpm db:seed`) and Chromium (`pnpm --filter @ccq/web exec playwright install chromium`). `pnpm db:reset --no-synthetic` re-seeds the config only.

## Repository layout

```
apps/web               React 18 SPA (Vite, TanStack Router + Query, Tailwind, shadcn/ui)
apps/api               Fastify 5 API under /api/v1; serves the SPA in production
packages/domain        pure business logic, no I/O
packages/contracts     zod schemas + DTOs shared by web and api
packages/db            Drizzle schema, migrations, seeds
packages/integrations  Salesforce / pricing-history export / Graph (SharePoint, mail) / Fabric mirror adapters (interface + fake)
packages/config        shared tsconfig, ESLint, Prettier
infra                  Bicep for the Azure test and prod environments (see infra/README.md)
scripts                packaging for App Service, Fabric mirroring stop/start
tests/load             k6 load test (pnpm load)
docs                   build guide, gate package, security route inventory, UAT pack, walkthrough
```

## Documentation

- [`CLAUDE.md`](CLAUDE.md): standing context and non-negotiable rules
- [`.env.example`](.env.example): every environment variable with its meaning; `apps/api/src/config.ts` validates them at start-up and refuses an invalid value
- [`infra/README.md`](infra/README.md): the Azure environments; [`docs/gate/runbook.md`](docs/gate/runbook.md): operations
- [`docs/build-guide/`](docs/build-guide/README.md): build guide index
  - [Architecture](docs/build-guide/01-architecture.md)
  - [Schedule and meetings](docs/build-guide/02-schedule-and-meetings.md)
  - [Build steps](docs/build-guide/03-build-steps.md)
  - [Decisions and risks](docs/build-guide/04-decisions-and-risks.md)
  - [Per-step prompts](docs/build-guide/prompts/)
