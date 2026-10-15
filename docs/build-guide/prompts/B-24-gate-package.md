# B-24 · Gate package and hand-off documentation (Gate 3 design + Gate 4/5 sign-off inputs)

**Paste into Claude Code from the repo root.**

---

Read all of `docs/build-guide/`, `docs/security/`, `docs/uat/` and `docs/runbook.md`. Produce the artifacts the PMO playbook gates need (PRD §7.3). They go to Darren, Bailey, Oliver Kade (IT) and the PMO at **U6 (Fri Nov 13, 10:00)**. Write them as markdown in `docs/gates/`, plus a single combined HTML export (Pretium-styled; use the `pretium-design` skill if available) for sharing.

## Artifacts
1. **Solution design (Gate 3)**, `docs/gates/solution-design.md`:
   - context and scope
   - architecture (from `01-architecture.md`, updated to as-built)
   - data model diagram (generate a Mermaid ER diagram from the Drizzle schema)
   - security model and permission matrix
   - integrations and their owners
   - environments
   - non-functional requirements met (with evidence links)
   - deviations from PRD v1 and why (hybrid stage model, Final Review ≠ outcome, capacity evidence, Azure hosting)
2. **Requirements traceability matrix (Gate 3)**, `docs/gates/rtm.md`: every PRD P0 feature (F-01..F-14) **and** every Op Model MUST requirement marked MVP (CR-05..CR-56 subset) → build step → test(s) → UAT script step → status (met / partial / deferred, with reason). Generate it from a YAML source (`docs/gates/rtm.yaml`) so it stays current.
3. **Development plan / build sign-off (Gate 4)**, `docs/gates/build-signoff.md`: what shipped (the release notes), thin-slice checklist from the PRD Gate 4 row (SSO, guided intake, stages, prioritization, overrides with audit, SF read connector, usage log), known issues and the P1/P2 backlog.
4. **Test plan and results (Gate 5)**, `docs/gates/test-results.md`:
   - test strategy (unit / integration / permission matrix / RLS / e2e / load / a11y)
   - CI run links
   - hardening report summary
   - UAT results per role (from the script sign-off tables)
   - SF and pricing tie-out results
   - defect log summary
5. **UAT sign-off form**, `docs/gates/uat-signoff.md`: a table for each gate-owner candidate (KAM rep, Sales leader, Jim Zweifel / upfront engineering, Gemma Cebolla / Pricing, Final Review approver, Leadership viewer, IT), with pass, conditional pass (conditions listed) or fail, plus the date.
6. **Operational hand-off (Gate 6 prep)**: finalize `docs/runbook.md` and the support model (as agreed at M9), the access-request process, the config ownership (Knowledge Steward or interim) and the hypercare plan (2 weeks, daily check of alerts, feedback triage 3×/week).
7. **Release notes v1.0**, `CHANGELOG.md`: user-facing, per role.
8. **Open decisions status**: refresh `docs/build-guide/04-decisions-and-risks.md` with what was decided, what's still provisional in config, and who owns it.

## Acceptance
- [ ] All 8 artifacts exist, generated where possible, and are linked from `docs/gates/README.md`
- [ ] The RTM shows every P0 as met or with an explicit deferral that has an owner
- [ ] Combined HTML export ready to share at U6
- [ ] Tick B-24 in `docs/build-guide/03-build-steps.md`
