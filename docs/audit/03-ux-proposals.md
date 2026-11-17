# 03: Experience and simplification proposals (Part C)

Pre-release audit, 2026-11-17. This file was written as proposals only. **Ben approved all eighteen on 2026-11-17, plus the first two items under "Considered and not proposed", and they are now built** on the same branch. Each proposal below keeps its original text and ends with what was built. The next section is the record.

## What was built (2026-11-17)

Each item has its own commits (`feat(ux): UX-0NN …`), unit tests for its rules and Playwright coverage in `apps/web/e2e/ux-*.spec.ts`. Screenshots are in `docs/audit/screens/UX-*.png`. The UAT scripts and quick-starts were updated for every changed label (`docs/uat/`).

| Item | Built | Commits |
|---|---|---|
| UX-001 | Engineering and Quoting stay on the page while another tab is shown, so typed values survive. Submit to lead and every decision button wait for a save ("Save your changes first."). Leaving the quote, or switching items on a multi-item quote, asks first. A failed background refresh keeps the page and what is typed. | `a559fe6`, `834460c`, `2f8c77c`, `f99f1e5` |
| UX-002 | A line under the stage tracker says who the quote waits on and what is next, from one read-only field (`nextStep`) worked out on the server. When it is the reader's move it says so and links to the place. Includes the production scheduler's capacity part and a lead who works the quote themselves. | `d463e19`, `a83f660` |
| UX-003 | No decision button on a quote that is back with the KAM: "Back with the KAM for rework since <time>. Nothing to decide until it is resubmitted." The button stays wherever one outcome is still possible. | `a724e6d` |
| UX-004 (a), (b) | A quote on hold is not offered Hold again; the refusal for the two-tab case reads "Record a decision to end the hold."; the button for the other decisions reads "Send back or stop". **(c) is not built**: who may change a hold's review date in place is a business decision. | `d76632a`, `f8454fd` |
| UX-005 | Stage lists on the Command Center show the customer after the quote number, and the opportunity name on wide screens. | `6c9c8a7` |
| UX-006 | The Gate decisions card shows "Reason: Missing information", not the stored key. A code retired since the decision keeps its label (one optional read-only field per decision). | `568affa`, `52607ea` |
| UX-007 | The timeline names the removed item and says when its engineering work was discarded. | `b46b233` |
| UX-008 | "Start review" is called that in the toast and the timeline too ("review started"). | `1f0b3cb` |
| UX-009 | The pricing queue says pricers submit to the pricing lead, who approves the price. | `a6885f9` |
| UX-010 | Under Open warnings, when something blocks the release the screen says what and where to fix it; "none of them blocks it" shows only when nothing does. | `4c7596b` |
| UX-011 | Every time on the quote page, the lock line, the intake draft list and "Draft saved" is US Central with the zone named. | `7acb381`, `0cf8c0e`, `64e7418` |
| UX-012 | A quote opens on the tab of its stage for someone who works that stage, otherwise on Overview. The address always names the tab, and a named tab wins for everyone. The Offer letter card is absent until Final Review approves. A payment-terms exception notice opens the Commercial panel. | `e2eff12`, `effe119` |
| UX-013 | Plain words for the rework banner, stage entries, priority, the Salesforce link, the stage totals, the capture hint, the gate on each decision, the lock line and a closed quote's outcome. | `56c1d03`, `8ed8837`, `64e7418` |
| UX-014 | A quote that cannot be opened says why it might be, offers the Pipeline and gives a support reference, without revealing whether the quote exists. | `5342181` |
| UX-015 | The stage tracker shows "Engineering & Capacity" in full on a desktop. | `3aac17c` |
| UX-016 | "Check again" on the no-access page asks for a fresh token and looks again. | `b02afb7` |
| UX-017 | A refused intake figure is named on its field; the queue searches wait until typing stops; the dead "cannot see the saved figure" hints are gone. | `f915702`, `d0b4d04` |
| UX-018 | A pass over 46 pages and their menus, popovers and dialogs as eleven roles: axe at every impact level (WCAG 2.0 to 2.2 A and AA, light and dark), a Tab and Shift+Tab walk of every page, reflow at 320 px, reduced motion. Fixed: keyboard focus hidden under the sticky header and the phone's bottom bars; unnamed popovers and buttons; file inputs with no visible focus; focus lost after a cancelled board move, an intake step change and "Check again"; board announcements; targets under 24 px; sideways scroll at 320 px on the Pipeline list and Admin workflow; step changes and "Save your changes first." now announced. **Not done:** a real screen reader, voice control, forced colors, real browser zoom, Safari and Firefox, touch devices. **Found and left:** the comment box's combobox role (needs a screen reader to change safely); Save buttons lose focus while saving (one decision for the shared button); modal menus hide the page from assistive technology; some information only in a hover title. | `90e8fa5`, `0fc7eeb`, `30dbd77`, `2727160` |
| First-run orientation | A dismissible "Welcome to QuoteFlow" card on the Command Center with the role's three main jobs and its quick-start link. Dismissal is remembered per person in the browser. | `42f4e6d` |
| Collapsed score breakdown | In the decision dialog the breakdown is closed by default; its summary line keeps the score in view and opens it. | `82481e6` |

**Not built, and why.**

- **UX-004 (c)**, changing a hold's review date in place: needs a decision on who may do it.
- **Saved views on more lists.** The first "considered" item said saved views already exist on the queues. That was wrong: the Pipeline (List, Prioritization, Board) has them; the engineering and pricing queues, Approvals, My proposals, Pricing history and the admin logs do not. Bulk actions do exist on both queues. Adding saved views to the queues is a feature with its own data, so it is listed here and not built.
- **Three small gaps left on purpose.** On Final Review the Open warnings box is not shown when there are no warnings, so a blocker with no warning beside it is named only in Terms and Legal and in the decision dialog. The decision dialog does not itself say that the quote is on hold (the page behind it does). A stored intake figure too large for its column is not flagged in the wizard; submitting it is refused without naming the field.
- **The term "gone dark"** remains in the metric's own definition, which names and explains it. The hints beside the numbers no longer use it.

**Found by review after the first build, and fixed.** Two defects in UX-001 were reported by the review on the pull request and fixed before merge: a save by someone else (another tab, or the lead) counted as the reader's own unsaved change (`2f8c77c`), and the Quoting cards could stay "unsaved" over a difference the server ignores (`f99f1e5`). Both have a Playwright test that fails without the fix.

---

## The proposals as written

## One-page summary

**How this was done.** The app was run locally and inert (dev sign-in, fake Salesforce, local files, no mail, the synthetic data set) and opened cold as each of eleven roles: KAM, sales leader, engineer, engineering lead, production scheduler, pricer, pricing lead, Finance, approver, leadership, Admin. For each role a script visited the Command Center, every page in that role's navigation, a quote at that role's stage with each tab, and the decision dialog where one was offered, at desktop width and at 390 px, capturing the text on screen, disabled controls, console errors and a screenshot. Twelve of the screenshots are in `docs/audit/screens/`. Two independent code reviews of the web app and a step-by-step check of the UAT scripts against the UI source added the items marked "from the source".

**What that does and does not cover.** It is a structured cold read of every screen, not a usability study with people. **Not done:** a keyboard-only pass, a screen-reader pass, a full WCAG 2.2 AA review, 200% zoom and reduced-motion checks, and attempts at the multi-step jobs end to end by hand. The 390 px pass found no page with horizontal overflow among those visited. The script counted one to three controls per page with no accessible name by its own rough test; that needs a proper look (UX-018).

**The overall picture.** The app is in good shape for a first-time user: the Command Center says what is waiting on you, the wording is plain, error and no-access pages say why and offer a way back, and the decision dialog explains each choice. The friction is in three places:

1. **The quote page does not say whose move it is.** A lead who opens a quote in their own stage sees the offer letter and the commercial terms first (UX-002, UX-003, UX-012).
2. **Typed work can be lost or sent stale** on the Engineering and Quoting tabs (UX-001).
3. **Small wording slips** where the screen says something the workflow no longer does, or shows a system word (UX-004 to UX-011).

**If you only do five:** UX-001, UX-002, UX-003, UX-005, UX-006.

Sorted by impact over effort. Impact: H / M / L and how many roles. Effort: S (hours), M (a day or two), L (more).

---

## UX-001. Unsaved Engineering and Quoting edits are lost when you look at another tab

- **Problem:** An engineer types the solution or capacity numbers, switches to Attachments to check a drawing, and comes back to an empty form. A pricer does the same on Quoting. Separately, "Submit to lead" and the decision button do not know a card has unsaved edits: change a saved field, press Submit, and the old values are submitted and then locked. There is no warning on leaving the page either. Roles: Engineer, EngLead, ProductionScheduler, Pricing, PricingLead. Screen: quote page, Engineering and Quoting tabs (`screens/engineer-quote_ENG_REVIEW_tab_Engineering-desktop.png`).
- **Evidence:** From the source. `apps/web/src/routes/quotes/$quoteNumber.tsx` renders the Engineering and Quoting tab contents only while selected; the forms keep their state in the component (`EngineeringTab.tsx`, `QuotingTab.tsx`), so leaving the tab discards it. `LeadReviewPanel.tsx` submits without looking at the cards. No `beforeunload` or route blocker exists in `apps/web/src`.
- **Proposal:** Keep both tabs mounted while hidden, so typed values survive a tab switch. Have each card report "unsaved changes"; while any card is unsaved, disable Submit to lead and the decision button with the line "Save your changes first", and ask before leaving the page.
- **Impact:** H, five roles. **Effort:** M.
- **Risk:** Both tabs would load their data when the quote opens (two more requests). Hidden content must stay out of the tab order and out of the accessibility checks.
- **Changes behavior?** UI state only: no workflow, data or permission change.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built, with three gaps closed afterwards (decision buttons, a failed refresh, switching items).

## UX-002. Say whose move it is, at the top of every quote

- **Problem:** A quote page shows where the quote is (the stage tracker) but not who has to act or what the next step is. An engineering lead opening a quote in Engineering & Capacity sees, first, "Offer letter: not available yet" and then Commercial terms; the thing they came to do is on another tab. Roles: all. Screen: quote page (`screens/eng-lead-quote_ENG_REVIEW-desktop.png`).
- **Evidence:** Walkthrough, engineering lead, quote in Engineering & Capacity: the Overview tab opens on the Offer letter card; no line names the assignee, the lead, or the next step. The same data already drives the Command Center ("anything waiting on you") and the lead-review panel.
- **Proposal:** One line under the stage tracker on every quote: "Waiting on: <role or person>. Next: <the next step in plain words>." For example "Waiting on: Engineering (assigned to V. Carroll). Next: complete the solution and capacity, then submit to the lead." When it is the reader's own move, make it a button to the right tab. On hold: "On hold until <date>, owner <name>: <reason>."
- **Impact:** H, all roles. **Effort:** M.
- **Risk:** The sentence must come from the server's own facts (`availableActions`, assignee, hold, lead-review state) so it can never disagree with what the server will accept.
- **Changes behavior?** Copy and layout; one new read-only field on the quote response.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built. The production scheduler and a lead who is the assignee have their own wording.

## UX-003. Do not offer a decision on a quote that is not waiting for it

- **Problem:** A sales leader opens a quote that is back with the KAM for rework and sees the "Qualify quote" button. The dialog opens, shows the full score, then says "Missing before it can move on: The intake, submitted by the KAM". The honest answer is that there is nothing to decide yet. Roles: SalesLeader; the same pattern can occur at other gates. Screen: quote page, decision dialog (`screens/sales-leader-quote_INTAKE_decision_dialog-desktop.png`).
- **Evidence:** Walkthrough, sales leader, a quote returned for rework at G1.
- **Proposal:** When the gate's own precondition is not met (here: the intake has not been resubmitted), replace the button with a line: "Back with the KAM for rework since <date>. Nothing to decide until it is resubmitted."
- **Impact:** M, one to three roles. **Effort:** S.
- **Risk:** Must read the server's `missing` list, not guess from the stage.
- **Changes behavior?** Layout only.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-004. Do not offer "Hold" on a quote that is already on hold

- **Problem:** On an on-hold quote the dialog offers Hold; choosing it returns "This quote is already on hold. Resume it before putting it on hold again." Nothing in the app is called Resume: a hold ends only when another decision is recorded. A lead who wants to move the review date cannot. Roles: every decider.
- **Evidence:** From the source. `packages/domain/src/workflow/available-actions.ts` does not filter what `evaluate.ts` refuses (`ALREADY_ON_HOLD`).
- **Proposal:** (a) Leave Hold out of the choices while the quote is on hold. (b) Reword the 409 for the two-tab case: "This quote is already on hold. Record a decision to end the hold." (c) Optional, larger: let the hold owner change the review date in place.
- **Impact:** M, all deciders. **Effort:** S for (a) and (b); M for (c).
- **Risk:** (a) changes what the quote response offers (`availableActions`).
- **Changes behavior?** (a) and (b): what is offered and one message. (c): workflow.
- **Needs a business decision?** (c) only.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built: (a) and (b). (c) waits for a business decision.

## UX-005. Show the customer beside the quote number on the Command Center

- **Problem:** "My open quotes by stage" lists `CCQ-2026-00111 · 55 d` and nothing else. A KAM knows a quote by its customer and product, not its number, and has to open each one to find the one they want. Roles: KAM, SalesLeader and the stage lists of the other roles. Screen: Command Center (`screens/kam-home-desktop.png`).
- **Evidence:** Walkthrough, KAM home: 23 quote numbers across five stages, none with a customer name. The "Proposals expiring soon" list on the same page does show the customer.
- **Proposal:** Show the customer name (and on wide screens the opportunity name) after the number, as the expiring-proposals list already does.
- **Impact:** H for KAMs, M overall. **Effort:** S.
- **Risk:** Long names on a 390 px screen: truncate with the full name on focus.
- **Changes behavior?** Layout only (the customer is already in the dashboard data or one field away).
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-006. Reason codes shown as system words

- **Problem:** The Gate decisions card on the quote page prints the stored reason key in brackets, for example "(missing_information)", where the label "Missing information" is meant. Roles: all. Screen: quote page, Overview.
- **Evidence:** From the source, found while checking the UAT scripts: `apps/web/src/routes/quotes/$quoteNumber.tsx` line 498.
- **Proposal:** Show the reason code's label from the configuration, as the timeline and the rework banner already do.
- **Impact:** M, all roles. **Effort:** S.
- **Risk:** A retired code must still show its label (the config keeps inactive codes for this).
- **Changes behavior?** Copy only.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built, including the label of a code retired since the decision.

## UX-007. The timeline does not say which item was removed

- **Problem:** Removing an item from a multi-item quote leaves "Quote item removed" on the timeline, with no item number, no name and no word on whether engineering work was discarded. The UAT script tells the tester to look for exactly that. Roles: KAM, Engineering.
- **Evidence:** From the source. `apps/api/src/services/intake-items.ts` records the item number, label and `workDiscarded`; `apps/web/src/components/QuoteTimeline.tsx` has no case for `quote_item_removed`.
- **Proposal:** Render "Item 2 (24 oz bottle) removed" and, when work was discarded, "its engineering work was discarded".
- **Impact:** M, two roles. **Effort:** S.
- **Risk:** None beyond wording.
- **Changes behavior?** Copy only; the data is already stored.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-008. One action, one name: "Start review"

- **Problem:** The engineering queue's button is "Start review". Its toast says "<quote> accepted" (or "Could not accept"), the timeline says "Engineering review accepted", and the tab says "Review started". A new user cannot tell that these are the same thing.
- **Evidence:** From the source: `apps/web/src/routes/queue/engineering.tsx` lines 427 to 431, `QuoteTimeline.tsx` line 285.
- **Proposal:** Use "Review started" in the toast and the timeline.
- **Impact:** L to M, Engineering roles. **Effort:** S.
- **Risk:** The timeline label changes for past events too (it is rendered, not stored).
- **Changes behavior?** Copy only.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-009. The pricing queue tells pricers to submit to Final Review

- **Problem:** The pricing queue's description still says "then submit to Final Review". Since the lead-review decision (L-9) a pricer submits to the pricing lead, who alone decides G3.
- **Evidence:** From the source: `apps/web/src/routes/queue/pricing.tsx` line 97.
- **Proposal:** "…then submit to the pricing lead, who approves the price."
- **Impact:** M, Pricing and PricingLead. **Effort:** S.
- **Risk:** None.
- **Changes behavior?** Copy only.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-010. Final Review says "none of them blocks it" under a blocker

- **Problem:** The Open warnings footer on the review screen says none of the warnings blocks the release, and can sit directly under "you cannot approve it".
- **Evidence:** From the source: `apps/web/src/components/final-review/ReviewScreen.tsx` line 275 and `packages/domain/src/final-review/warnings.ts` line 88.
- **Proposal:** Show the footer only when nothing blocks; when something does, say which item and where to fix it.
- **Impact:** M, Approver. **Effort:** S.
- **Risk:** None.
- **Changes behavior?** Copy and a condition.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-011. One clock on the quote page

- **Problem:** The same decision shows two different times on one page for anyone outside US Central: the rework banner, the gate decisions card, the intake summary and the section-lock line use the browser's local time and format ("10/11/2026, 2:00:00 PM"), everything else uses US Central with the zone named ("Oct 5, 2026, 9:00 PM CDT").
- **Evidence:** Walkthrough (KAM quote page) and the source: `$quoteNumber.tsx` lines 342, 456, 510; `routes/intake/new.tsx` line 205; `components/SectionLockLine.tsx` line 6.
- **Proposal:** Use the shared `absoluteTime` everywhere.
- **Impact:** M, all roles. **Effort:** S.
- **Risk:** None.
- **Changes behavior?** Copy only.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-012. Open the quote on the reader's own work

- **Problem:** Every role lands on the Overview tab, whose first cards are the Offer letter (empty until Final Review) and Commercial terms. An engineer's work is on the Engineering tab, a pricer's on Quoting.
- **Evidence:** Walkthrough: engineer, engineering lead, production scheduler, pricer, pricing lead and Finance all opened a quote in their own stage on the Overview tab (`screens/eng-lead-quote_ENG_REVIEW-desktop.png`).
- **Proposal:** Open on the tab of the quote's current stage when the reader holds a role that works that stage; hide the Offer letter card until Final Review has approved (the Attachments tab already holds past letters). Smaller alternative: keep Overview first and rely on UX-002's button.
- **Impact:** M, six roles. **Effort:** S to M.
- **Risk:** Deep links to a quote would open on different tabs for different roles; keep `?tab=` in the address so a shared link is exact.
- **Changes behavior?** Layout and default navigation.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-013. Plain words for five pieces of jargon

- **Problem and evidence (walkthrough, KAM and sales-leader screens):**
  - "**$459.1K SF amount**" on the stage totals: "SF" is not explained.
  - "13 recorded, **5 gone dark**, 0 still waiting" in the outcome capture card.
  - "Returned for rework at **G1**: Missing information": gate numbers are internal.
  - "Intake: 38 d · **2 visits** · now" under Time in stage.
  - A bare number beside the tier ("**66** HIGH · Why?") and a bare Salesforce id ("006SYN…") in the quote header, neither labelled.
- **Proposal:** "Salesforce opportunity amount"; "5 past validity with no outcome recorded"; "Returned by the sales leader at Qualify"; "entered this stage twice"; "Priority 66 · High"; the Salesforce id as a labelled link ("Salesforce opportunity") and only when the Salesforce URL is configured.
- **Impact:** M, all roles. **Effort:** S.
- **Risk:** The gate names come from configuration; use the configured gate label, not a hard-coded word.
- **Changes behavior?** Copy only.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built, and extended to the gate numbers and raw keys found afterwards.

## UX-014. A quote you cannot open should say why it might be

- **Problem:** A wrong or out-of-scope quote number shows "Not found. No quote CCQ-2026-99999. Reference: /api/v1/quotes/CCQ-2026-99999". The API path means nothing to a user, and the page does not say the quote may exist outside their scope or offer a way back.
- **Evidence:** Walkthrough, KAM, `/quotes/CCQ-2026-99999` (`screens/kam-missing_quote-desktop.png`).
- **Proposal:** "We could not find CCQ-2026-99999, or it is outside what your role can see. Check the number, or search from the Pipeline." with a button to the Pipeline, and the request reference in small print for support.
- **Impact:** L, all roles. **Effort:** S.
- **Risk:** Must not reveal whether the quote exists (the wording above does not).
- **Changes behavior?** Copy only.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-015. The stage tracker cuts off "Engineering & Capacity"

- **Problem:** At desktop width the tracker shows "ENGINEERING & CAPAC…".
- **Evidence:** Walkthrough (`screens/eng-lead-quote_ENG_REVIEW-desktop.png`).
- **Proposal:** Let the label wrap to two lines, or shorten the tracker label through the stage's configured short label.
- **Impact:** L, all roles. **Effort:** S.
- **Risk:** None.
- **Changes behavior?** Layout only.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-016. A way back in for someone who has just been given a role

- **Problem:** "No QuoteFlow access yet" now offers Sign out (added in this audit), which signs the person out of Microsoft entirely. After IT adds them to a group they need a fresh token, and a plain reload keeps the old one for up to an hour.
- **Evidence:** From the source: the API reads roles from the token; the client forces a token refresh only after a 401, not a 403.
- **Proposal:** Add "Check again", which fetches a new token and retries, and say "If IT has just added you, press Check again."
- **Impact:** L, every new user once. **Effort:** S.
- **Risk:** None.
- **Changes behavior?** One button.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-017. Small form frictions

- **Problem and evidence (from the source):**
  - An intake figure beyond the allowed range fails the autosave with "Request body is invalid" and no field marked (`useIntakeDraft.ts` line 120).
  - The engineering and pricing queue search boxes send a request on every keystroke (`routes/queue/engineering.tsx` lines 104 to 108, `pricing.tsx` line 66); the Final Review queue waits 300 ms.
  - Dead text remains from before every role could read the figures: "Your role cannot see the saved figure" (`EngineeringTab.tsx` line 1322).
- **Proposal:** Mark the field the server names; debounce the two searches; remove the dead text.
- **Impact:** L. **Effort:** S.
- **Risk:** None.
- **Changes behavior?** Copy and timing only.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built.

## UX-018. A proper accessibility pass

- **Problem:** The full WCAG 2.2 AA review asked for was not done in this audit. The walkthrough script flagged one to three controls per page with no accessible name by a rough test, and the existing axe checks cover "serious" violations on the main screens only.
- **Proposal:** A dedicated pass: keyboard-only through each role's main job, focus order and focus return in dialogs, focus not obscured by the sticky header, target size, status messages announced, 200% zoom and reflow, reduced motion, and no information by color alone (the amber and red validity states, the on-hold chip). Fix what it finds as separate approved items.
- **Impact:** M. **Effort:** M.
- **Risk:** None.
- **Changes behavior?** None by itself.
- **Needs a business decision?** No.
- `Approve: [x]` Approved by Ben, 2026-11-17. Built as one pass with its fixes; what it did not cover is listed under "What was built".

---

## Considered and not proposed

- **Saved filters, bulk actions and a first-run tour.** Saved views and bulk assignment already exist on the queues; each role's Command Center already links its one-page quick-start. Nothing in the walkthrough argued for more before the pilot. *2026-11-17: asked for by Ben. The first-run card is built. The sentence about saved views was wrong (see "What was built"): the Pipeline has them, the queues do not.*
- **Collapsing the score breakdown in the decision dialog.** It pushes the choices below the fold on a laptop, but it is the evidence the decider is asked to look at; UX-002 and UX-003 remove the cases where it gets in the way. *2026-11-17: asked for by Ben and built. The summary line with the score stays visible and opens the breakdown.*
- **Anything that would hide a figure from a role, write to Salesforce, or fix an open business rule in code.** Out of bounds (CLAUDE.md rules 2, 4, 5).
