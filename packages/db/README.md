# @ccq/db

Drizzle schema, migrations, row-level security, config seeds and the synthetic data generator (PostgreSQL 16).
Source of truth for the model: `docs/build-guide/01-architecture.md` §5. Generated reference: [`docs/data-dictionary.md`](../../docs/data-dictionary.md).

## Commands (from the repo root)

| Command                             | What it does                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate`                   | Apply pending migrations, then refresh `COMMENT ON` for every table and column                        |
| `pnpm db:seed`                      | Config seeds only (idempotent, all `provisional=true`)                                                |
| `pnpm db:seed --synthetic`          | Config + synthetic data (12 users, 70 customers, 102 SF opportunities, 150 quotes)                    |
| `pnpm db:reset`                     | Drop, migrate, seed config + synthetic. Refuses to run with `NODE_ENV=production`                     |
| `pnpm db:dictionary`                | Regenerate `docs/data-dictionary.md` from the schema comments (a unit test fails if it is stale)      |
| `pnpm db:sf-fixture`                | Regenerate the `SF_MODE=fake` Salesforce fixture from the synthetic data (a unit test fails if stale) |
| `pnpm --filter @ccq/db db:generate` | `drizzle-kit generate` after a schema change                                                          |

## Layout

```
src/schema/       identity.ts · config.ts · workflow.ts · events.ts · integration.ts (+ enums.ts, _doc.ts)
src/repos/        thin typed repositories (no business rules; the domain decides)
src/withRequestContext.ts   SET LOCAL ROLE ccq_app + app.user_id / app.roles / app.scope_type / app.scope_values
src/dictionary/   data dictionary + COMMENT ON generation
migrations/       see order below
seeds/config/     re-seeding refreshes only rows still provisional, unapproved and at version 1 (an admin edit bumps it);
                  workflow (derived from the domain hybrid seed), role_permission (from policy/matrix.ts),
                  value lists, reason codes, app settings, scoring model v1, sf_stage_map
seeds/synthetic/  faker with a fixed seed and a fixed anchor date: identical rows on every run
test/             integration tests against a real Postgres (`<TEST_DATABASE_URL>_db`)
```

## Migration order

| #    | File               | Kind                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0000 | `baseline`         | B-01: pgcrypto                                                                                                                                                                                                                                                                                                                                        |
| 0001 | `extensions`       | hand-written: `pg_trgm` (allow-list it in `azure.extensions` on Flexible Server)                                                                                                                                                                                                                                                                      |
| 0002 | `schema`           | **Drizzle-generated**: every table, FK, CHECK and index                                                                                                                                                                                                                                                                                               |
| 0003 | `quote_number`     | hand-written: `next_quote_number(timestamptz)`                                                                                                                                                                                                                                                                                                        |
| 0004 | `roles_rls`        | hand-written: roles, grants, append-only trigger, RLS helpers and policies                                                                                                                                                                                                                                                                            |
| 0005 | `sf_reader`        | **Drizzle-generated** (B-06): SF snapshot columns, account-name trigram index, `quote.sf_status_flag`                                                                                                                                                                                                                                                 |
| 0006 | `intake`           | **Drizzle-generated + hand-written RLS** (B-07): `quote_draft` (owner/Admin-only RLS), intake columns on `quote`/`customer`, unique partial index `quote_one_active_per_opportunity_uidx`                                                                                                                                                             |
| 0007 | `scoring_rework`   | **Drizzle-generated** (B-08): `quote.priority_breakdown` / `priority_scored_at`, `quote_draft.rework_of_quote_id` + unique partial index (one open rework draft per quote)                                                                                                                                                                            |
| 0008 | `overrides_audit`  | **Drizzle-generated + hand-written data step** (B-09): `override.approval_mode` / `applied_at`, one open override per quote+field, `quote.queue_position_overridden`, `audit_event(at)` index, `audit.read` in the permission CHECKs; B-07's interim ship-to columns become self-applied `override` rows                                              |
| 0015 | `b16_attachments`  | **Drizzle-generated + hand-written RLS** (B-16): `attachment.draft_id` (draft files; `quote_id` null until submit), storage columns (`storage`, `storage_item_id`, `storage_path`, `stored_name`, `sha256`, `note`), soft delete (`removed_at` / `removed_by`), `attachment.removeAny` in the permission CHECKs; draft files follow `quote_draft` RLS |
| 0017 | `b19_admin_config` | **Drizzle-generated** (B-19): `help_text` on `stage_definition` / `gate_definition` / `gate_outcome_definition`, `scoring_model.effective_from` nullable (null = the draft) + `scoring_model_one_draft_uidx` (at most one draft), `user_scope.version`, `audit_event.change_reason`, `config.read` in the permission CHECKs                           |

Column comments are not a migration: they are derived from the schema (`c(column, meaning, owner)`) and
re-applied after every `db:migrate`, so the database and the dictionary never drift.

## Conventions

- **Primary keys:** UUID v7, generated in app code (`src/ids.ts`), never by the database. The one exception is the
  `quote_number_counter` row that `next_quote_number()` creates for a new year.
- **Every column is documented** with `c(builder, meaning, owner?)`; every table with `documented(table, { area, owner, description })`.
  A unit test fails on any undocumented column.
- **CHECK constraints** only for closed sets (statuses, kinds, actions, roles). Anything the business may still change
  (stage keys, reason codes, value-list codes) is config data.
- **FKs** default to `on delete restrict`. Quotes and audit rows are never deleted.

## Roles and RLS

| Role           | Use                  | Privileges                                                                                                                                          |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ccq_app`      | the API at runtime   | CRUD on app tables; **INSERT + SELECT only** on `audit_event`, `activity_event`; EXECUTE `next_quote_number()`; no access to `quote_number_counter` |
| `ccq_migrator` | migrations and seeds | everything; RLS policies let it see all rows                                                                                                        |
| `ccq_readonly` | D&A (later)          | SELECT on everything                                                                                                                                |

The roles are `NOLOGIN`. In Azure, grant membership to the real principals (B-20), e.g.
`GRANT ccq_app TO "<app-service-managed-identity>"`. Never make the runtime login a superuser: superusers bypass RLS.

`quote` and every child table (`stage_history`, `quote_hold`, `gate_decision`, `eng_review`, `capacity_evidence`,
`pricing_record`, `override`, `attachment`, `comment`, `handoff_record`, `activity_event`) have `FORCE ROW LEVEL SECURITY`:

- Admin, Leadership, EngLead, Pricing, Approver and SalesLeader see every quote (MVP).
- KAM and Engineer follow their scope: `all` → all; `owner` → `kam_user_id` (KAM) or `assigned_engineer_id` (Engineer)
  is the user; `region` → `quote.region` in the scope values; `account_list` → the customer's SF account id in the values.
- PostAward sees Awarded quotes only. No request context → no rows.
- Child rows are visible when their quote is (the policy sub-selects `quote`, which is itself under RLS).
- `audit_event`: anyone in a request context may insert; reads are Leadership/Admin or your own rows. A trigger blocks
  UPDATE, DELETE and TRUNCATE for every role, including the owner.
- `notification`: the recipient (or Admin) reads and updates; any request context may create.

Background jobs (the Salesforce sync) run with `withSystemContext`: `ccq_app` with the Admin role and `all` scope
under a fixed system user id, and take a `pg_try_advisory_lock` (`withAdvisoryLock`, keys in `ADVISORY_LOCKS`) so
only one App Service instance runs each job.

```ts
import { contextFromActor, withRequestContext } from '@ccq/db';
import { listQuotes } from '@ccq/db/repos';

const quotes = await withRequestContext(db, contextFromActor(req.actor), (tx) => listQuotes(tx));
```

## Synthetic data

Personas for B-04's dev mode (`x-dev-user: <key>`), all `@example.com`, Entra oids `00000000-0000-4000-8000-0000000000NN`:
`kam`, `kam-owner` (owner scope), `kam-region` (West), `sales-leader`, `eng-lead`, `engineer`, `engineer-owner` (owner scope),
`pricing`, `approver`, `leadership`, `admin`, `multi-role` (SalesLeader + Approver).

The 150 quotes are walked through the real domain engine (`evaluateTransition`) and `persistTransition`, so their
stage history, gate decisions, holds, returns, versions and closures are consistent by construction. A re-run finds
the quotes and skips them; users, customers and opportunities use deterministic ids.
