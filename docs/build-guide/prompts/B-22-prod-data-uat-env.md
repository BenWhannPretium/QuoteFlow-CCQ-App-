# B-22 · Production environment, approved data load, UAT readiness

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` rule 8 and `01-architecture.md` §8. **Precondition (don't start without it):** a written production-data approval from IT (Oliver Kade) and D&A (Brennan Paul), recorded at M9 (Nov 2) or by email. Link it in `docs/build-guide/04-decisions-and-risks.md` (D-23). Without it, UAT runs in **test** against the Salesforce **UAT org** and masked data, and the MVP is "UAT-ready on masked data" (escalate to Darren).

## Steps (scripted where possible, so they're repeatable)
1. **Prod infrastructure:** run `deploy.yml` prod with approval. Confirm the slot swap, health, alerts, backups (PITR on) and Key Vault secrets populated by IT/Ben (SF prod key, pricing connection).
2. **Purge synthetic data:** prod never runs the synthetic seed. Add a guard: `db:seed --synthetic` refuses when `NODE_ENV=production`. Seed **config only**.
3. **Config approval pass:** export the current config (value lists, reason codes, settings, scoring v1) to `docs/uat/config-snapshot.md` with each item's provisional/approved status. Bailey reviews it, and anything approved at M4/R1–R3/D-pack gets `provisional=false` + `approved_by`.
4. **Salesforce prod:** Rachel Dew switches the integration user and connected app to production. Run the full initial sync (not delta) and **reconcile**: count of open opportunities vs a Salesforce report filtered the same way, plus a 20-record spot-check of field values (with Zac/Graham). Record the result in `docs/uat/sf-reconciliation.md`.
5. **Pricing reader prod** (if B-15 is live): connectivity + 10 ERF/BPR lookups spot-checked with Pricing.
6. **SharePoint prod folder:** `Sites.Selected` on the prod site; upload/download smoke test.
7. **Users:** Bailey sends the UAT cohort list per role; IT adds them to `SG-CCQ-*`. Each tester signs in once before Nov 9 (Bailey tracks this). Set the `user_scope` defaults.
8. **Monitoring:** the action group includes Ben + the IT on-call named at M9; send a test alert.
9. **Freeze:** tag `v0.9.0-uat`. From here, only Sev-1/2 fixes are merged, via PR with a second reviewer (Tre).

## Deliverables
- `docs/uat/environment.md`: URLs, how to get access, known limitations (P1 items not present), support contact during UAT.
- `docs/uat/sf-reconciliation.md` and `docs/uat/config-snapshot.md`.

## Acceptance
- [ ] Prod running on approved data, with no synthetic data present
- [ ] SF reconciliation within an agreed tolerance (document any variances)
- [ ] All UAT testers can sign in with the correct roles
- [ ] Tick B-22 in `docs/build-guide/03-build-steps.md`
