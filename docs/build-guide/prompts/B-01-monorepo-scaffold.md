# B-01 · Monorepo scaffold, tooling, CI

**Paste into Claude Code from the repo root.**

---

You are setting up the foundation of QuoteFlow (the CCQ app). Read `CLAUDE.md` and `docs/build-guide/01-architecture.md` (§2 repo layout, §8 delivery) first. Then propose a short plan and implement it.

## Goal
A pnpm + Turborepo monorepo where `pnpm dev` runs a React SPA and a Fastify API against a local Postgres, and `pnpm verify` (lint, typecheck, unit, integration, build) runs in GitHub Actions on every PR.

## Requirements
1. **Workspace:**
   - Use `pnpm-workspace.yaml` with `apps/*` and `packages/*`.
   - Set up `turbo.json` pipelines for `dev`, `build`, `lint`, `typecheck`, `test`, `test:integration` and `e2e`.
   - Pin Node 22 (`.nvmrc`, `engines`) and `packageManager: pnpm@9`.
2. **Shared config:** add `packages/config/` with a base `tsconfig` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), an ESLint flat config (typescript-eslint, import order, no-floating-promises) and Prettier. Root scripts:
   - `dev`
   - `build`
   - `lint`
   - `typecheck`
   - `test`
   - `test:integration`
   - `e2e`
   - `verify` (lint + typecheck + test + test:integration + build)
   - `db:migrate`
   - `db:seed`
   - `db:reset`
3. **`apps/api`:**
   - Fastify 5 + TypeScript (tsx for dev, tsup for build) and `fastify-type-provider-zod`.
   - Plugins: `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/sensible`, `@fastify/swagger` + swagger-ui (dev only).
   - pino logger with a redaction list (`req.headers.authorization`, `*.price*`, `*.token*`).
   - Problem+json error handler (RFC 9457).
   - `GET /api/v1/health` returning `{ status, version (git sha from env), db: 'up'|'down', time }`.
   - Config is loaded with zod from env (`packages/contracts` or `apps/api/src/config.ts`): `DATABASE_URL`, `AUTH_MODE` (`entra|dev`), `ENTRA_TENANT_ID`, `ENTRA_API_AUDIENCE`, `APP_BASE_URL`, `NODE_ENV`.
   - **Refuse to boot** if `AUTH_MODE=dev` and `NODE_ENV=production`.
   - In production, serve `apps/web/dist` as static files with an SPA fallback.
4. **`apps/web`:**
   - Vite + React 18 + TypeScript.
   - TanStack Router (file-based routes) + TanStack Query.
   - Tailwind CSS + shadcn/ui initialized (no theme yet; that's B-05).
   - A home route that calls `/api/v1/health` and shows the result.
   - Vite proxies `/api` to the API in dev.
5. **`packages/domain`, `packages/contracts`, `packages/db`, `packages/integrations`:** create them as empty but buildable packages, each with an `index.ts`, a Vitest config and one placeholder test.
   - `packages/db` uses Drizzle ORM + drizzle-kit, with a `drizzle.config.ts` reading `DATABASE_URL`, an empty schema file and migrate/seed scripts wired to the root scripts.
6. **Local DB:** `docker-compose.yml` with `postgres:16`, a named volume, healthcheck and port 5432, plus `mailpit` for local email (used in B-18). Add `.env.example` with every variable documented; `.env*` is git-ignored except `.env.example`.
7. **Testing:**
   - Vitest workspace.
   - Integration tests in `apps/api/test` use `fastify.inject` against a real Postgres. In CI, use a Postgres service container; locally, use docker compose with a separate `ccq_test` database created by a global setup that runs migrations.
   - Playwright config in `apps/web/e2e` with one smoke test (home page shows health "up").
8. **CI** (`.github/workflows/ci.yml`):
   - on `pull_request` and `push` to `main`
   - pnpm cache, then install → lint → typecheck → unit → integration (Postgres 16 service) → build → Playwright smoke (start the api with the built web)
   - `pnpm audit --audit-level=high`
   - gitleaks
9. **Repo hygiene:**
   - `.editorconfig`, `.gitattributes`, `.gitignore`
   - PR template (summary, linked build step, test evidence, screenshots)
   - CODEOWNERS (Ben)
   - Update the root `README.md`: what QuoteFlow is (2 lines), quickstart, links to `docs/build-guide/`.

## Out of scope
Auth, domain logic, schema tables, styling. Those are later steps; leave clear TODO markers only where the later step will plug in.

## Acceptance checklist (verify each, and show the command output)
- [ ] `pnpm i && docker compose up -d db && pnpm dev` opens the web app showing health `db: up`
- [ ] `pnpm verify` passes locally
- [ ] Boot with `AUTH_MODE=dev NODE_ENV=production` exits non-zero with a clear message
- [ ] CI workflow passes on a PR
- [ ] Tick B-01 in `docs/build-guide/03-build-steps.md`

Commit in small Conventional Commits on branch `feat/b01-scaffold`.
