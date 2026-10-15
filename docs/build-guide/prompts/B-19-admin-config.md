# B-19 · Admin configuration console (CR-51; seeds the F-21 decision log)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` rule 4 and `01-architecture.md` §5 (config tables). The Operating Model's build rule is: **"Configure what is pending."** Stage names, gate owners, thresholds, reason codes, validity periods and scoring weights must be editable without a code change. The Knowledge Steward (unassigned) will own this. Until then, Admin is Ben/Tre, and Bailey approves the values.

## Screens (`/admin`, permission `config.manage`; Leadership has read-only access)
1. **Value lists:** add, rename, deactivate (never hard delete) and reorder. Mark an item provisional or approved, with `approved_by` and date.
2. **Reason codes:** per context; same controls.
3. **Workflow labels and rules:**
   - Edit display labels and help text for stages, gates and outcomes.
   - Toggle `requiresNote` / `requiresReasonCode`.
   - Edit gate required-field rules via a guided form that writes the domain DSL; validate with zod before saving.
   - Toggle `g1_enabled`.
   - **Adding or removing stages or transitions isn't in the UI for MVP.** That's a migration plus a domain seed change, to keep it safe.
4. **App settings:**
   - validity days
   - min value/volume warnings
   - aging bucket thresholds
   - KAM peer-score visibility
   - intake required fields
   - backup assigner
   - G4 tier rules (disabled)
   - override approvers per field
5. **Scoring model:** view the active version; **"Create new version"** clones it into a draft editor (weights, bands, maps, tier thresholds).
   - Shows a live **preview on the last 50 quotes**: rank changes and tier changes before/after.
   - A **change reason** is required. Weights must sum to 1.
   - Activating sets `effective_from` and triggers a background rescore of open quotes with an activity event per changed tier.
   - Old versions are kept read-only.
6. **Users and scope:** list `app_user` with roles (read-only; roles come from Entra groups) and editable `user_scope`. Include "Request role change" guidance: a link to the IT ticket form.
7. **Integrations:** recent `integration_run`s, a "Sync Salesforce now" button and connector health.
8. **Decision log (minimal F-21):** a chronological list of all config changes (from `audit_event action='config_change'`) with who, what (diff), why (change reason) and when. Exportable.

## API
`/api/v1/admin/config/*` CRUD endpoints, each:
- validated by zod and the domain config validators
- writing `audit_event action='config_change'` with before/after + `change_reason` (required on every write)
- bumping `version` on the row
- invalidating the server config cache and the client `config/public` query

## Safety
- Optimistic concurrency (a `version` check → 409).
- Can't deactivate a value that's used by open quotes without confirmation; those quotes keep their value.
- Changes to the scoring model never alter historical score snapshots.

## Tests
- Every write needs a change reason and writes an audit entry; 409 on a stale version.
- Scoring-version activation rescores open quotes only.
- Leadership read-only; others 403.

## Acceptance
- [ ] Bailey (as Admin in dev) can change a reason code, a validity default and the weights, with the decision log showing who/why
- [ ] No code change needed for any item listed in CR-51
- [ ] Tick B-19 in `docs/build-guide/03-build-steps.md`

**Cut line:** if behind schedule, ship only screens 4, 7 and 8 and manage the rest via seed migrations.
