## Summary

<!-- What changed and why, in a few lines. -->

## Linked build step

<!-- e.g. B-04 · docs/build-guide/prompts/B-04-auth-rbac.md. Tick its checklist in docs/build-guide/03-build-steps.md. -->

- Build step:
- Acceptance items covered:

## Test evidence

<!-- Paste command output or link the CI run. Routes need allowed + denied permission-matrix tests. -->

- [ ] `pnpm verify` passes locally
- [ ] New/changed domain rules have unit tests
- [ ] New/changed routes have permission-matrix tests (allowed and denied per role)
- [ ] UI changes have a Playwright happy path

## Screenshots

<!-- UI changes: before/after, desktop and 390 px mobile. Synthetic or masked data only. -->

## Checklist

- [ ] No secrets, tokens or real customer data committed
- [ ] No open business decision hard-coded (config table + `provisional: true` instead)
- [ ] `docs/build-guide/` updated if behaviour or a decision changed
