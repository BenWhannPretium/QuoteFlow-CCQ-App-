# B-06 · Salesforce read connector (F-10)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` and `docs/build-guide/01-architecture.md` §6 (Salesforce row). Every CCQ quote starts from a Salesforce Opportunity (DEC-12, "there's no world where this doesn't live in Salesforce"). Build a **read-only** connector. Never write to Salesforce.

## Facts from discovery (use them)
- Org: Salesforce Unlimited Edition, `pretiumpkg.my.salesforce.com`. Start against the **UAT org** with the integration user `integration@pretiumpkg.com.uat`, as Rachel Dew recommended for the MCP work. Production comes later (B-22).
- **Objects:** `Opportunity`, `Account`, and the custom **Opportunity Product Specification** object (API name TBD at M3). Data was "backfilled by migration; some fields are more complete than others".
- **Opportunity stages in use:** Qualifying, Quoting, Negotiating, Final Review, Verbal Award, PO(s) in hand, Closed Won – Product Shipping, Closed Lost.
- Fields for **ERF number** and **quote source** exist but are "used inconsistently". Capture them; don't trust them.
- Opportunity names are inconsistent free text, for example `"Berlin CHI / Puckered Pickle / 1 gallon HDPE Natural 110-400"`. Search must be fuzzy.
- Amounts can be placeholders (one record is $0.31) or blank. Flag values under $100 as suspect.

## Build

### 1. `packages/integrations/salesforce/`
- `SalesforceReader` interface:
  - `searchOpportunities({ q, ownerEmail?, openOnly, limit })`
  - `getOpportunity(id)`
  - `getAccount(id)`
  - `listChangedOpportunities(since)`
  - `getProductSpecs(opportunityId)`
- Map everything into `contracts` DTOs: `SfOpportunity`, `SfAccount` (including a ship-to address that maps to a structured `{ line1, city, state, postal, country }`), and `SfProductSpec`.
- **Field mapping lives in one file**, `salesforce/fieldMap.ts`, with TODO markers for the custom fields Zac and Graham confirm at M3: ERF number, quote source, Opportunity Product Specification fields and ship-to source.
- `JsforceSalesforceReader` uses `jsforce` v3 with the **OAuth 2.0 JWT bearer flow**:
  - connected app consumer key
  - private key (PEM) loaded from Key Vault or the `SF_PRIVATE_KEY` env in local dev
  - integration username
  - login URL `test.salesforce.com` for UAT and `login.salesforce.com` for prod

  Use SOQL with explicit field lists, `queryMore` pagination, retry/backoff on `REQUEST_LIMIT_EXCEEDED` and 5xx, and a 20 s timeout.
- `FakeSalesforceReader` serves the synthetic fixture from B-03 and supports search. It's used when `SF_MODE=fake`, the default for local and CI.

### 2. Sync job (`apps/api/src/jobs/sfSync.ts`)
- Runs every 15 min in-process. Guard it with `pg_try_advisory_lock` so only one instance runs.
- Delta by `SystemModstamp > last successful run`, then upsert into `sf_opportunity_snapshot` (keeping the `raw` jsonb) and `customer` (status `existing`, plus `default_ship_to`).
- Writes `integration_run` with counts (fetched, inserted, updated, errors).
- On failure, alert the owners only: write an admin notification and log an error. Never block the UI.
- If a CCQ-linked opportunity is deleted or closed in SF, flag it on the quote (`sf_status_flag`). Don't delete anything.

### 3. API routes (permission `quote.create` for search, `quote.read` for details)
- `GET /api/v1/salesforce/opportunities?q=&mine=true&openOnly=true`: searches local snapshots first (trigram on name and account), then falls back to a live SF search if there are fewer than 5 hits. `mine=true` filters on the KAM's email/alias matched to the SF owner.
- `GET /api/v1/salesforce/opportunities/:id`: snapshot + live refresh (cache 60 s), including account, ship-to, ERF number, quote source, SF stage and product specs.
- `POST /api/v1/admin/salesforce/sync` (config.manage): trigger the sync now.
- `GET /api/v1/admin/integrations`: recent `integration_run`s.

### 4. Linkage report
`GET /api/v1/admin/reports/erf-linkage` lists, for CCQ quotes, the SF opportunity, SF ERF number and CCQ `erf_number`, with a mismatch flag. This supports the PRD success measure "% of SF opportunities linked to an ERF number".

### 5. Register all routes in the permission-matrix test registry.

## Tests
- Unit-test the field mapper with fixture SOQL responses, including nulls, placeholder amounts and missing accounts.
- Integration-test the sync job against the fake reader: idempotent, delta works, advisory lock prevents double runs.
- A contract test, skipped unless `SF_LIVE_TEST=1`, hits the UAT org read-only and asserts the field map resolves.

## Security
- The integration user should be **read-only** via a permission set (Rachel Dew). Assert in code that no write methods (`create`, `update`, `upsert`, `destroy`) are referenced. Add an ESLint rule or a test that greps for them.
- Never log record contents. Log ids and counts only.

## Acceptance
- [ ] Local: intake search returns fake opportunities. With UAT creds: real UAT opportunities.
- [ ] Sync runs every 15 min and the admin page shows runs
- [ ] ERF linkage report renders
- [ ] Tick B-06 in `docs/build-guide/03-build-steps.md`, noting which custom-field API names were confirmed at M3
