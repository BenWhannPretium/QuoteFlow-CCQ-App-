# B-21 · Security, access and quality hardening (pre-UAT)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` (all non-negotiable rules) and `01-architecture.md` §3, §7 and §9. Goal: walk into UAT (Nov 9) and the IT security check (U4, Nov 11) with evidence, not assurances. Produce a short `docs/security/hardening-report.md` as the output. It feeds the Gate 3/5 packages.

## 1. Authorization completeness
- Generate a **route inventory** from Fastify (method, url, declared permission, public?) into `docs/security/route-inventory.md`. Fail CI if any route is missing from the permission-matrix test registry.
- The permission-matrix suite runs **every route × every role** (allowed → non-403; denied → 403) plus scope variants (owner-scoped KAM vs another KAM's quote; Engineer on an unassigned quote).
- Redaction suite: for every quote-returning route and the CSV export, assert that commercial fields are absent for KAM/Engineer and present for Pricing/EngLead/Approver/Leadership/Admin.
- RLS suite: raw SQL in the request context can't cross scope; `audit_event` is append-only.

## 2. Input and output safety
- Every route has zod schemas (body/query/params/response). Add a test that iterates the route inventory and asserts the schemas exist.
- **Headers:** helmet with a strict CSP (`default-src 'self'`; connect-src self + `login.microsoftonline.com`; frame-ancestors none), HSTS, Referrer-Policy, Permissions-Policy. Test the headers.
- **Rate limits:** 300 req/min per user; 20/min on export and upload routes. 429 is problem+json.
- **Uploads:** magic-byte check, size cap, filename sanitization (from B-16). Add tests with a disguised executable.
- Comments are sanitized (no HTML injection); markdown is rendered safely.

## 3. Secrets and supply chain
- gitleaks across the full history; `pnpm audit --audit-level=high` clean (or documented exceptions); Dependabot/Renovate config; lockfile integrity.
- Confirm no secrets in app settings (Key Vault references only) by checking the Bicep.

## 4. Privacy and logging
- The pino redaction list covers authorization headers, tokens, price/margin/capital fields, and file contents.
- Grep the test logs for currency patterns or emails in log output → zero.
- Audit retention: document ≥ 7 years and confirm with IT/Legal (open). Add a DB comment.

## 5. Accessibility and mobile
- `@axe-core/playwright` on landing, intake (every step), quote detail (every tab), queue, board, approvals and analytics: no serious/critical violations.
- 390×844 run of the core flows (intake submit, approve, record outcome): no horizontal scroll, and tap targets ≥ 44px.

## 6. Performance and resilience
- k6 script (`tests/load/`): 50 virtual users mixing list, detail, queue and decision calls against **test** for 10 minutes. Targets: p95 < 400 ms, error rate < 0.5%. Record the results.
- Salesforce/pricing/Graph down → the app still works (fallback states shown) and `integration_run` errors appear, as proven by tests with fault-injecting fakes.
- Health endpoint deep check (DB + config cache); App Insights availability alert verified once by stopping the app in test.

## 7. Runbook draft (`docs/runbook.md`) for M9 / IT hand-off
- Architecture summary.
- How to deploy, roll back (slot swap back) and restore the DB (PITR steps).
- Rotate the SF key; add a user (Entra group); change config (admin console).
- Common alerts and their first response; contacts (Ben, IT on-call TBD, Rachel Dew for SF, Cory McGahan for pricing data).

## Acceptance
- [ ] `docs/security/hardening-report.md`: a checklist with links to test runs, k6 results and axe results
- [ ] Route inventory complete; all suites green in CI
- [ ] Runbook draft ready for **M9 (Nov 2)**
- [ ] Tick B-21 in `docs/build-guide/03-build-steps.md`
