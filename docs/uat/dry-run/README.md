# AI dry-run UAT reports

Claude Code runs each UAT script against a **local copy** of QuoteFlow (dev sign-in, fake Salesforce,
synthetic data) before the pilot group's UAT (**Nov 13 to Nov 20, 2026**), to find defects and wrong script
steps early. It reports what it saw. **It does not replace business UAT or sign-off.**

- The prompts are in [`docs/build-guide/prompts/uat-dry-run/`](../../build-guide/prompts/uat-dry-run/00-common.md).
- One report per session, named `YYYY-MM-DD-<scope>.md`: `kam-sales-leader`, `engineering`, `pricing-finance`,
  `approver-leadership-admin`, `cross-cutting`.
- Each report has a header (commit, environment, what was not covered), a coverage table for every script
  step, defects (`DR-<scope>-NN`, severity as in [`../README.md`](../README.md)), script corrections and what
  could not be tested.
- Defects are triaged by Ben, Bailey and Tre with the pilot's own reports. Screenshots and traces are not committed.
