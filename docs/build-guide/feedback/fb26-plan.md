# FB-26 plan: linked re-quote, expiry follow-up for the sales leader, the CER at hand-off

Prompt: `docs/build-guide/prompts/feedback/FB-26-requote-expiry-handoff.md` (N17-30, N17-31, N17-32).
Branch `claude/fb-26-requote-expiry-handoff`. One migration (`00NN_fb26_requote_expiry_handoff.sql`,
numbered after FB-22 and FB-25 land: 0054 if they take 0052 and 0053).

Written before any code, 2026-11-19, while Ben was away: every open question below takes the
conservative choice the prompt names, and is listed under "Waiting on" in the PR.

## A. The linked re-quote (N17-30)

### Data

| Where | What | Why |
|---|---|---|
| `quote.requoted_from_quote_id` | nullable uuid, FK `quote(id)` on delete restrict, **unique** (one linked re-quote per quote). Set in the same transaction that creates the new quote (intake submit) | The link the prompt names. A plain uuid: Fabric-safe, no companion |
| `quote_draft.requote_of_quote_id` | nullable uuid, FK `quote(id)`; partial unique index while the draft is open (`submitted_quote_id is null`) | A re-quote lives as an intake **draft** until the KAM submits it; the draft must carry the link, and two open re-quote drafts of one quote are refused by the database as well as the service |
| `role_permission` | `quote.requote`: KAM (own), SalesLeader | New permission (matrix + migration insert, provisional) |
| `app_setting.linked_requote_allowed_from` | `["closed_expired", "open_lapsed"]`, provisional | Which states a linked re-quote may start from |

Nothing else changes on `quote`: the old quote keeps every value, decision, model and file as quoted.

### Who may start one, and from which states

Domain `packages/domain/src/outcome/requote.ts` → `linkedRequoteEligibility(quote, setting, now)`:

| State of the old quote | Allowed when the setting lists | What the action does |
|---|---|---|
| Closed **"No response / Expired"** (`stage_key = EXPIRED`) | `closed_expired` | Creates the draft |
| **Open at Customer Decision** (status active, not on hold) and its validity date has passed (US Central calendar, the same test the G5 rule uses as `validity_lapsed`; the daily flag can lag a day, so the date decides) | `open_lapsed` | First records **G5 "No response / Expired"** through the normal gate path (`GateService.decide`, same rules, audit, timeline and notices; the reason code and the KAM's note from the dialog), then creates the draft, **in one transaction** |
| Anything else (still valid, lost, awarded, declined, on hold, …) | - | 409 `requote_not_allowed` with the reason |

Also refused: a quote already re-quoted (409 `already_requoted`, naming the new number) or with an open re-quote draft (the existing draft is returned to its owner; anyone else gets 409 `requote_draft_open`).

**Who:** `quote.requote` (KAM on their own quotes, SalesLeader on any they can read). The route declares it; the service checks the quote with `assertCan`; RLS scopes the read.

**Whose draft:** intake drafts are private to their owner (RLS). The person who starts the re-quote owns the draft and submits it. **The new quote keeps the old quote's KAM** (`kam_user_id`), whoever submits, so a SalesLeader can start and submit a re-quote on a KAM's behalf without taking the account. (Conservative reading of "the KAM sees …"; listed under Waiting on.)

The note is required (1 to 1,000 characters): it says why the customer's late "yes" is being re-quoted, and goes on the G5 decision (open case) and on the audit row (both cases).

### What is copied

A new intake draft on the **same Salesforce opportunity**, step 2, built by `requoteDraftData` (domain, pure) from:

| Copied | From |
|---|---|
| Request-level intake fields: market, sub-market, description, quote variants note, RFP link, commercial inputs (requested payment terms, tooling funding, customer share, returnable dunnage, price basis, freight, bid reference), tooling commitment, stocking agreement, request class, concept assumptions, revenue fields, comments for Engineering, ship-to and its override reason, the customer | The old quote's last submitted intake draft (the most complete copy), or the quote's columns when it has none (as a rework does) |
| Every item with its product fields | The old quote's `quote_item` rows, each given a **new key** |
| Each item's drawings | **As links** (FB-19's way): the new item links to the drawings the old item held or linked to. On submit the links become `quote_item_drawing` rows to the old quote's attachments; no bytes are copied or moved |
| The opportunity's display fields | **Re-read live** from Salesforce (`ensureOpportunity`, as a new intake does); the snapshot is refreshed |

| Not copied | Why |
|---|---|
| Engineering (reviews, capacity, plants, pack-out, BOM), pricing record, the Quoting models, commercial terms, gate decisions, overrides, offer letters, the "quote needed by" date, the "separate quote" confirmation | Capacity and costs may have changed; Engineering, Pricing and Final Review review it again |

The draft shows "Re-quote of CCQ-… (expired <date>). Check every value; Engineering and Pricing will review it again." The KAM submits it through G1 as normal. The **one-active-quote warning is not shown** for a linked re-quote (the old quote is closed by then); the `one` mode still refuses a second open quote on the opportunity.

### How both quotes read afterwards

| Quote | Header | Timeline | Elsewhere |
|---|---|---|---|
| Old (closed Expired) | "Re-quoted as CCQ-… on <date>" (link); while only a draft exists: "A re-quote was started on <date>" | `requote_started` (draft created), `requoted_as` (new quote submitted) | The "Start a linked re-quote" action disappears |
| New | "Re-quote of CCQ-…" (link) | `quote_created` carries `requoteOf` | A collapsed, read-only **"From the expired quote"** panel on the Engineering and Quoting tabs |

The panel (`GET /quotes/:qn/requote-source`, `quote.read`) shows, per matching item (by item number), the old quote's engineering solution (plant, process and machine, cavitation, cycle time, the engineer's notes; read through the same view the old Engineering tab uses) and the old quote's price approval status and capital readiness. Nothing on it is editable.

**RLS:** the link's quote **number** is read in system context (number and date only), so a reader who cannot read the old quote still sees "Re-quote of CCQ-…" but the panel says "You can't open CCQ-…" and shows nothing else. Everything else is read under the caller's own RLS.

### Words

The G5 "Re-quote" outcome's help gets "Use while the offer is still valid. After it has expired, start a linked re-quote from the closed quote." appended: seed in `outcome-help.ts` plus a guarded `UPDATE` (only a row still holding the old text and not approved).

## B. Expiry follow-up for the sales leader (N17-31)

1. `app_setting.validity_notice_recipients` (provisional, seed `["kam", "g1_decider"]`). The daily job sends `quote.validity_expiring` and `quote.validity_expired` to each recipient. `g1_decider` = the person who made the quote's **latest G1 Advance** (decided by a person; nobody when G1 was skipped or routed automatically). *Deviation from "the current version":* a G4 or G5 send-back bumps the version without a new G1, so the current version usually has no G1 decision by Customer Decision; the latest G1 Advance is the sales leader who qualified it. The dedupe key is per user, so each person is told once per state.
2. **"Expiring soon" on the Command Center** ("My work"):
   - KAM: the existing "Proposals expiring soon" list (their quotes); the window now reads `validity_warning_days` instead of a fixed 7 (same seed).
   - SalesLeader: a new "Expiring soon" list: quotes at Customer Decision whose validity ends within `validity_warning_days` or has lapsed, soonest first, each with the validity chip and a link; **quotes they qualified (latest G1 Advance)**, or **every such quote** when the SalesLeader has never decided G1. Through `DashboardService` and the dashboards repo, under the caller's RLS.

## C. The CER at hand-off (N17-32)

1. `cer_tool_url`, `cer_template_url` (seed `""`, provisional; Admin → Settings; `""` or an https URL). The hand-off card shows "Open the CER tool ↗" and "CER template ↗" (new tab, `rel="noopener noreferrer"`) when set; when empty an Admin sees "Set the CER links in Admin → Settings", others nothing.
2. Attachment kind **`cer_proof`** ("CER proof": PDF, PNG, JPEG or HEIC), **versioned** like the models; uploaded on the hand-off card by `handoff.edit` holders while the hand-off is editable. New place `handoff` in `attachment_kinds_by_place` (`["cer_proof"]`); refused at intake (not in the intake list) and not offered on the Attachments tab.
3. `handoff_cer_proof_required` (seed **false**, provisional). When true, G6 Advance needs a current `cer_proof` while the CER is Approved: derived field `cer_proof_ok`, added to the G6 Advance rule (seed + guarded `UPDATE`). The CER ID stays required for Approved.
4. The label stays "CER ID (Apex)" until Bailey says whether "CER request number" is the same thing.

## Not in scope (prompt)

Re-pricing an expired quote for a resin-only change; changing `validity_days_default`; auto-closing expired quotes.

## Files owned by others while this runs

`QuoteTimeline.tsx`: only new cases in `describeEvent` (the event-label map), as the prompt allows. `components/attachments/Attachments.tsx`: not edited. FB-22 / FB-23 own `EngineeringTab.tsx`, FB-25 owns the quote page (`$quoteNumber.tsx`): each gets one inserted line rendering a new FB-26 component.
