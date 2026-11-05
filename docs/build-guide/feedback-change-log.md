# QuoteFlow user-feedback change log

One row per feedback item a build step changed (FB-01 onward; see `03-build-steps.md` → "User feedback updates"). This file is the record in the repo. The same rows go to `QuoteFlow Change Log.csv` next to the Feedback Tracker in SharePoint (`PMO › General › Projects › FY26 - Commercial Capital Quoting › 3. Design › Quote Flow`), which feeds the tracker's **Change Log** tab. The procedure is in `03-build-steps.md` → "Change-log procedure".

- **Date:** the date the PR was opened (US Central).
- **Type:** `Build change` for code, `Tracker update` for a change to the tracker or the plan only.
- **Feedback IDs:** tracker IDs (F-, T-, V-, D-, Q-, A-). The tracker is the source of what was asked.
- **Rationale:** why the change was made this way: the feedback, who raised it, the decision it follows, and anything we chose not to do.
- **Status:** `In PR` → `Merged` (the next close-out updates rows whose PRs have merged) → `Verified in UAT` (after the linked T- test passes).

| Date | Type | Step | Change (what was built) | Feedback IDs | Raised by | Rationale | Status | PR / commit |
|---|---|---|---|---|---|---|---|---|
| 2026-11-05 | Tracker update | FB-00 | Added the user-feedback build plan (FB-01 to FB-10), its prompts, the readiness split (build now / build with provisional config / wait for a decision) and this change log | All Build Backlog rows | Feedback sessions Oct 26 to Nov 3; MVP User Feedback Review Nov 5 | The Nov 5 review agreed that Ben starts the clear MVP items and holds the ones blocked by open decisions. The plan groups items by the code they touch so each PR stays coherent and the number of CI waits stays low | In PR | this PR |
