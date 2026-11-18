# FB-26 · After the offer: a linked re-quote for an expired quote, expiry follow-up for the sales leader, the CER at hand-off

**Run with:** Claude Code · **Opus 5.5** · **high** effort · **Wave 2: start when FB-24 has merged** (you create an intake draft and add an attachment kind to its per-place list) · one draft PR · branch `claude/fb-26-requote-expiry-handoff`
**Feedback items:** N17-30, N17-31, N17-32 (`docs/build-guide/feedback/inputs/feedback-2026-11-17.md`) · **Tracker rows it follows:** D-12 (validity; still 30 days provisional), B-13 (outcome, closure, hand-off), FB-19 (items), DEC-12 (every quote linked to a Salesforce opportunity)

**Paste into Claude Code from the repo root.**

---

## Stop check
1. Follow `docs/build-guide/prompts/feedback/FB-21-to-27-ground-rules.md` in full.
2. Confirm FB-24 has merged into `main` (`attachment_kinds_by_place`, the item-first intake). If not, stop and say so.
3. **Plan first.** Commit `docs/build-guide/feedback/fb26-plan.md` before code: the linked re-quote's data, who may start one and from which states, what is copied, and how both quotes read afterwards.
4. **Not in scope:** re-pricing an expired quote for a resin-only change without a full review (open decision 6, Gemma Cebolla's ask, going to Sarah, Faron and Jim); changing `validity_days_default` (open decision 1: an Admin sets 60 if Bailey confirms with Danielle Leu); auto-closing expired quotes (D-12).
5. **Running beside you:** FB-23 (Engineering tab), FB-27 (pipeline list, timeline rendering, attachments panel, analytics wording). Do not edit `QuoteTimeline.tsx` or `components/attachments/Attachments.tsx`: add timeline **events** in the domain and API, and FB-27 (or the existing generic rendering) shows them; if a new event needs a renderer, add it in the timeline's event-label map only, and say so in the PR.

## What the code does today (read 2026-11-18 at `f017ccc`; verify before relying on it)
- **Re-quote today** is a gate outcome on the **same** quote with a version bump: G5 `requote` "Re-quote" and G6 `requote` "Send back to Quoting or Engineering (re-quote)" go to Quoting or Engineering with `versionBump: true` (`packages/domain/src/workflow/seeds/hybrid.ts` ~633-638, ~652-657, ~721-736). Older decisions read "Superseded"; the timeline shows `version_bumped`. **No linked quote exists** (no `parent_quote_id`, clone or link anywhere).
- **Validity:** Approve at G4 sets `validity_until` = issue date + `validity_days_default` (30, provisional, D-12). The daily job `apps/api/src/jobs/validityExpiry.ts` warns the **KAM only** (`quote.validity_expiring`, `validity_warning_days` = 7) and, once lapsed, flags `validity_expired_flagged_at`, writes `validity_expired` on the timeline and tells the KAM (`quote.validity_expired`); it never changes the stage. **An in-app countdown already exists:** `ValidityChip` ("12 days left", "Expired N days ago"; amber, then red) in the customer-decision header and on My proposals (`components/outcome/CustomerDecision.tsx` ~52-84, `routes/proposals.tsx` ~111). G5 "No response / Expired" closes a quote (a note is needed before the validity date).
- **Outcome permissions:** `outcome.record` and `gate.G6.decide` = KAM (own) and SalesLeader (`policy/matrix.ts` ~114, ~141).
- **New quotes** start from a Salesforce opportunity through the intake draft (`apps/api/src/services/intake.ts`); FB-19 made "one active quote per opportunity" a setting, seeded **allowed with a warning**. FB-19's Duplicate copies an item's drawings as links.
- **Hand-off** (`components/outcome/CustomerDecision.tsx` ~271-631, `packages/domain/src/outcome/handoff.ts`): acceptance evidence, CER status (Pending / Approved / Not approved / Not required), CER ID (Apex), CER approved on (both required when Approved), receiving role / team / contact / date, notes, "Hand-off accepted by the receiving team", "Ready for CER development". G6 Advance (`COMMITTED`) needs CER approved or not required and the hand-off completed. **No link to the CER tool, no template, no upload**; the CER is a reference only (`handoff.ts` ~5-13).

## Build

### A. A linked re-quote for an expired quote (N17-30)
Bailey and Ben (WT3b 0:39-0:44), repeated to the room in the Demo (1:34-1:43): once a quote has expired, the customer's late "yes" needs a **new quote with its own record**, linked to the old one, reusing what the KAM entered, and going through Engineering, Pricing and Final Review again (capacity and costs may have changed). The old quote keeps what was quoted and under which assumptions. Within the validity window, today's send-back / re-quote stays as it is.
1. **Data:** `quote.requoted_from_quote_id` (nullable FK to `quote`, unique: one linked re-quote per quote), set when the new quote is created; Fabric-safe; data dictionary.
2. **Who and when** (provisional, setting `linked_requote_allowed_from`): the KAM (own) or a SalesLeader, from a quote that is **closed as "No response / Expired"**, or **open at Customer Decision with its validity lapsed** (flagged). In the second case the same action first records the G5 "No response / Expired" outcome (the normal gate path, audited, with the KAM's note), then creates the new quote, in one transaction. A new permission `quote.requote` (KAM own, SalesLeader), matrix and route inventory.
3. **What is copied:** a new intake **draft** on the same Salesforce opportunity (re-read live, as a new intake does), pre-filled from the old quote's last submitted intake: the request-level fields and every item with its product fields and drawings (as links, FB-19's way). **Not copied:** engineering, capacity, pricing, models, terms, decisions. The KAM sees "Re-quote of CCQ-… (expired <date>). Check every value; Engineering and Pricing will review it again." and submits it through G1 as normal. The one-active-quote warning is not shown for a linked re-quote of a closed quote.
4. **How both read:** the old quote shows "Re-quoted as CCQ-… on <date>" (link) in its header and a timeline event; the new one shows "Re-quote of CCQ-…" (link) and, on its Engineering and Quoting tabs, a collapsed read-only **"From the expired quote"** panel with the old quote's engineering solution per matching item and its price approval status and capital readiness (no editing; respect RLS: a reader who cannot read the old quote sees only its number).
5. **Words:** in the G5 dialog, the "Re-quote" outcome's help says "Use while the offer is still valid. After it has expired, start a linked re-quote from the closed quote." (config: guarded data migration of the help text).

### B. Expiry follow-up for the sales leader (N17-31)
Bailey (WT3b 0:38-0:39): the KAM and "possibly" the sales leader should be told as a quote nears expiry. The countdown exists; add:
1. **Recipients as a setting** `validity_notice_recipients` (provisional, seed `["kam", "g1_decider"]`): the expiring and expired notices also go to the sales leader who qualified the quote (the G1 decider of the current version; no one if G1 was not decided by a person). Update `validityExpiry.ts` and the recipients plan; test both notices.
2. **"Expiring soon" on the Command Center** ("My work") for the KAM (their quotes) and the SalesLeader (quotes they qualified, and all quotes for a SalesLeader with no G1 decisions): quotes at Customer Decision whose validity ends within `validity_warning_days` or has lapsed, soonest first, each with the `ValidityChip` and a link. Through the existing dashboard contract and repo; RLS respected.

### C. The CER at hand-off (N17-32)
Bailey (WT3b 0:45-0:46): "link out to the CER application … give us the template … what is the CER request number … upload a screenshot of the CER tool". Oleg Yarovinski can give the links.
1. Settings `cer_tool_url` and `cer_template_url` (seeded **empty**, provisional, Admin-editable; validated as https URLs). On the hand-off card, when set: "Open the CER tool ↗" and "CER template ↗" (new tab, `rel="noopener noreferrer"`). When empty, Admins see "Set the CER links in Admin → Settings"; others see nothing.
2. A new attachment kind **`cer_proof`** ("CER proof", PDF or image) uploaded on the hand-off card (versioned like other kinds; add it to `attachment_kinds_by_place` for the hand-off only; refused at intake). A setting `handoff_cer_proof_required` (seed **false**, provisional): when true, a CER marked Approved needs a proof file before G6 Advance. The CER ID stays required for Approved (today's rule).
3. The CER ID label reads "CER request number (Apex)" if Bailey's "CER request number" is the same thing: ask, and keep "CER ID (Apex)" until she answers.

## Tests
Domain: who may start a linked re-quote from which state; the copy plan (fields copied and not); the recipients setting; the proof rule. API integration: an expired synthetic three-item quote re-quoted (the old closed with its G5 decision, the new draft pre-filled, both links, audit rows, timeline events); refused for a quote still valid, a quote already re-quoted, another KAM's quote; the expiry job notifying the G1 decider; the hand-off with links and proof. Permission matrix for every role on the new routes. Playwright: a KAM re-quotes an expired quote, edits a value and submits; a SalesLeader sees it under "Expiring soon" first. 1366 × 768 and 390 px, both themes.

## Questions to put to Bailey and Oleg (draft them; send nothing)
1. **Bailey:** may a re-quote also start from a **lost** quote? Should the new quote copy the old engineering solution as a starting point (built: shown read-only, not copied)? Which sales leader should hear about expiring quotes when several exist? Is "CER request number" the Apex CER ID?
2. **Oleg Yarovinski:** the CER tool's URL and the CER template's location.

## Done when
- [ ] `fb26-plan.md` committed first
- [ ] linked re-quote: column, permission, both states, the copy, both quotes' links, the "From the expired quote" panels, the G5 help text
- [ ] expiry notices to the G1 decider (setting); "Expiring soon" on the Command Center
- [ ] CER links (settings, empty), `cer_proof` uploads, the proof setting off
- [ ] tests as listed; `pnpm verify` passes; close-out done (ground rules)
