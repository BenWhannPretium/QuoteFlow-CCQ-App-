# B-20 · Azure infrastructure as code + continuous delivery

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` and `01-architecture.md` §1, §7 and §8. Write Bicep and GitHub Actions so IT can review exactly what's being deployed (M2) and the test environment can be stood up by Oct 23.

## Inputs from IT (M1/M2)
- Subscription ID; resource groups `rg-ccq-test` and `rg-ccq-prod`; region (default `centralus` unless IT says otherwise).
- Naming and tagging standards (ask IT; default tags: `app=quoteflow`, `owner=embedded-intelligence`, `env`, `costCenter=<ask>`).
- Network: whether IT wants a new VNet or a spoke in an existing hub (likely); the private DNS zones; and the **exposure pattern** (D-H2):
  - **Option 1:** App Service public endpoint with built-in Entra auth + Conditional Access
  - **Option 2:** private endpoint published through Entra Application Proxy / Private Access (no VPN, works on phones)

  Parameterize both.
- The Entra app IDs from B-04 and the GitHub OIDC federated credential (an app registration or user-assigned managed identity for deploy, with Contributor on the RG).

## Bicep (`infra/`)
- `main.bicep` with params per env (`infra/params/test.bicepparam`, `prod.bicepparam`), and modules:
  - `network.bicep`: VNet (or existing-spoke reference), subnets for App Service integration and private endpoints, private DNS zones (postgres, keyvault)
  - `appservice.bicep`:
    - Linux plan (test B2 or P0v3; prod P1v3), web app with Node 22, `alwaysOn`, HTTPS-only, TLS 1.2+, FTP disabled, HTTP/2
    - VNet integration
    - **system-assigned managed identity**
    - health check path `/api/v1/health`
    - a **staging slot** in prod
    - app settings as Key Vault references only
    - optional built-in auth (Easy Auth) block for Option 1
  - `postgres.bicep`:
    - Flexible Server v16 (test B1ms; prod D2ds_v5)
    - private access (VNet) or private endpoint
    - **Entra authentication enabled**, with the web app identity added as an Entra admin or role (post-deploy script)
    - backups 7 days on test and 35 on prod, PITR
    - `require_secure_transport=on`
    - databases `ccq`
  - `keyvault.bicep`: RBAC mode, private endpoint, soft delete + purge protection; the web app identity gets Key Vault Secrets User. Secrets (values set out-of-band): `SF-PRIVATE-KEY`, `SF-CONSUMER-KEY`, `PRICING-CONNECTION`, `GRAPH-CLIENT-SECRET` (only if not using managed identity).
  - `monitoring.bicep`:
    - Log Analytics + workspace-based Application Insights
    - availability test on `/api/v1/health`
    - alert rules: 5xx rate, availability < 99% over 15 min, failed integration_run (via log query), all routed to an **action group with owner emails** (Ben + IT on-call TBD at M9)
- Outputs: web app name and URL, Postgres FQDN, Key Vault URI.
- Add `infra/README.md`: what each resource is, its estimated monthly cost per env (give a rough estimate table and label it as an estimate), and how to deploy (`az deployment group create …`).

## Database migrations on deploy
- A `migrate` step in the pipeline connects to Postgres using the deploy identity (Entra token) via a temporary firewall/runner path agreed with IT (e.g. a self-hosted runner in the VNet, or running migrations from the app at startup behind a `MIGRATE_ON_START` flag with an advisory lock).
- **Prefer migrate-on-start with the advisory lock for MVP** (simplest with a private DB). Document the trade-off.
- DB roles `ccq_app` / `ccq_migrator` from B-03 are mapped to Entra identities.

## GitHub Actions
- `deploy.yml`:
  - on push to `main` → build once (pnpm, turbo) → upload artifact → deploy to **test** (`azure/login` with OIDC → `azure/webapps-deploy`) → smoke test (`/api/v1/health`, plus a Playwright smoke against the test URL using a test account or dev persona disabled) → summary
  - **prod:** `workflow_dispatch` with an environment protection rule (required reviewers: Ben + an IT approver) → deploy to the **staging slot** → smoke test → **slot swap** → post-swap health check → automatic swap-back on failure
- `infra.yml`: `what-if` on PRs touching `infra/` (posts the diff as a PR comment); manual apply per env.
- No long-lived Azure secrets in GitHub; OIDC only.

## Acceptance
- [ ] `az deployment group what-if` is clean for test; IT reviewed it at M2
- [ ] Test environment deployed and reachable with Entra sign-in; `/api/v1/health` shows db up
- [ ] Merge to `main` auto-deploys to test with a smoke test
- [ ] Prod pipeline with approval + slot swap is defined (used in B-22)
- [ ] Tick B-20 in `docs/build-guide/03-build-steps.md`, recording the exposure option IT chose
