# QuoteFlow (CCQ App)

QuoteFlow is Pretium Packaging's **Commercial Capital Quoting** web app, replacing the legacy ERF application for new-business quotes that need engineering input and/or capital.
It gives KAMs, Engineering, Pricing, approvers and leadership one governed, audited record per quote, from intake to customer outcome, linked to its Salesforce opportunity.

## Quickstart

Prerequisites: Node 22 (`nvm use`), pnpm 9 (`corepack enable`), Docker.

```bash
cp .env.example .env              # local defaults: AUTH_MODE=dev, synthetic data only
pnpm i
docker compose up -d db           # Postgres 16 on :5432 (add `mailpit` for local email)
pnpm db:migrate && pnpm db:seed
pnpm dev                          # web http://localhost:5173 · api http://localhost:3000 · docs http://localhost:3000/docs
```

| Script                  | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `pnpm dev`              | API (tsx watch) + web (Vite, proxies `/api` to the API)             |
| `pnpm verify`           | lint + typecheck + unit + integration + build (what CI runs)        |
| `pnpm test`             | unit tests (Vitest)                                                 |
| `pnpm test:integration` | API tests against a real Postgres (`ccq_test`, created + migrated)  |
| `pnpm e2e`              | Playwright smoke against the production build (needs a migrated DB) |
| `pnpm db:migrate`       | apply Drizzle migrations to `DATABASE_URL`                          |
| `pnpm db:seed`          | load config seeds + synthetic data                                  |
| `pnpm db:reset`         | drop, re-migrate (refuses in production)                            |

## Repository layout

```
apps/web               React 18 SPA (Vite, TanStack Router + Query, Tailwind, shadcn/ui)
apps/api               Fastify 5 API under /api/v1; serves the SPA in production
packages/domain        pure business logic, no I/O
packages/contracts     zod schemas + DTOs shared by web and api
packages/db            Drizzle schema, migrations, seeds
packages/integrations  Salesforce / pricing / Graph adapters (interface + fake)
packages/config        shared tsconfig, ESLint, Prettier
```

## Documentation

- [`CLAUDE.md`](CLAUDE.md): standing context and non-negotiable rules
- [`docs/build-guide/`](docs/build-guide/README.md): build guide index
  - [Architecture](docs/build-guide/01-architecture.md)
  - [Schedule and meetings](docs/build-guide/02-schedule-and-meetings.md)
  - [Build steps](docs/build-guide/03-build-steps.md)
  - [Decisions and risks](docs/build-guide/04-decisions-and-risks.md)
  - [Per-step prompts](docs/build-guide/prompts/)
