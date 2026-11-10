# Session 1: KAM and Sales Leader

Read `00-common.md` first. Scope name for the report and branch: `kam-sales-leader`.

**Scripts:** `docs/uat/scripts/kam.md`, `docs/uat/scripts/sales-leader.md`. **Quick-starts:** `kam.md`, `sales-leader.md`.
**Personas:** `kam`, `kam-owner`, `kam-region`, `sales-leader`, `multi-role`. Use `eng-lead`, `pricing-lead` and
`approver` only to move a quote on when a step needs another role.

## Features to cover

**Intake (KAM)**
- The three-step wizard end to end: choosing the Salesforce opportunity (the customer is the account; there is no new-customer form), destination city and state required, two needed-by dates, neck as three lists, and the minimum spec when there is no drawing (what is required, what is a warning).
- FB-12: Market, then Sub-market (only the chosen market's sub-markets; changing the market clears it); the old five markets are not offered.
- FB-09: resin, PCR and additive "Other" rule (the detail field appears and is required at submit, not at draft save; unpicking clears it); caps of 120, 120, 200 and 500; packaging "Other" asks for the note and the customer's document.
- FB-11: requested payment terms (Net 15 and Net 30 standard; others show "Non-standard: Pricing will review"), customer funding (starts on "Not discussed"; sales-tax hint), returnable dunnage checkbox, delivered or FOB with freight type and special arrangements (switching back to FOB clears them), bid or program reference (60 characters, searchable).
- Draft save and resume; resubmit after a send-back; attachments (drawing formats: PDF, images, DWG, DXF, STEP, IGS, Excel, Word, MSG, EML; rejected: a renamed executable, a file that is too large, a name with odd characters).
- Priority score and tier shown and explained; the breakdown (the strategic-fit line says "Strategic fit (sub-market)" when relevant).

**Sales leader**
- G1 qualify: the queue, the decision dialog, reasons, Market › Sub-market shown.
- Priority override: **only a sales leader**, applies at once, reason required; the KAM cannot; the override is audited and visible.
- With `g1_volume_routing` on and a band set (turn it off again after): a quote outside the band goes to the sales leader, inside goes to Engineering, a quote with no volume goes to the sales leader with a reason.
- With `intake_guardrails` on: the below-platform-minimum warning on the quote and at G1, wording "You can still submit", and it never blocks.

**Outcome and hand-off (KAM, sales leader)**
- "My proposals": cards, validity countdown, Salesforce stage and mismatch flag, "Record outcome" for G5 Awarded, Lost (reason codes, a note where required), Expired; closure owner (only a sales leader can name someone else).
- G6 Commit & Hand Off: "Closed – Won" is reached only from G6.
- The KAM's answer to a pricing send-back ("did the scope change?") and the resubmit loop.

**Pipeline and lists (all roles in scope)**
- Board and list, per-role drag-and-drop (a KAM moves only their own quotes), filters, search by quote number, account and bid reference, CSV export (open it: columns, escaping; a cell that starts with `=`, `+`, `-` or `@` must not run as a formula).

**Scope personas.** `kam-owner` sees only their own quotes; `kam-region` only their region; `kam` all. Check lists, search, direct links to another KAM's quote (should be refused, not leak data), and the API.

**Notifications.** The KAM hears about progress, returns, holds, closures and comments; the actor does not; a mention replaces the comment notice; comment bursts fold into one email.

## Cross-role checks you own

- A quote you submit appears in the sales-leader queue with the right data (and nothing from another KAM).
- After G1 advance, the engineering lead is told; after a return to KAM, you are told with the reason.
- Sections lock after G2, G3 and G4 and reopen on a send-back (KAM script Part H).
