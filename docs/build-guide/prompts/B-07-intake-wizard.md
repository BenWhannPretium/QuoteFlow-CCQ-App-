# B-07 · Guided intake wizard (F-03)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md`, `docs/build-guide/01-architecture.md` §4–5, and the B-02 domain engine. Build the KAM intake: the single biggest lever on engineering rework. 25–40% of today's requests need clarification (Jim Zweifel), and the most common gaps are **packaging requirements, neck finish, drawings and real volumes**.

## Principles (from discovery; don't violate them)
- **Sales enters only what Sales can know.** No plant, process type, machine type, net capital, engineer, channel, product class or priority level at intake (REQ-04, X-90). Engineering decides those later.
- **Salesforce is the front door.** Start by picking the SF opportunity, and pre-fill from it. Never make the KAM re-key SF data.
- **No customer-account creation** (DEC-27). The customer is either `existing` (from SF Account) or `not_yet_established` (capture name, location and contact only; no credit check, no account request).
- **The drawing prompt never blocks.** Ask, and say "Quotes without a drawing usually take longer," but allow submit (Danielle Leu).
- **Ship-to auto-populates** from the customer record and can be overridden only with a reason (a governed override via B-09; until B-09 lands, store the reason on the quote and migrate it).
- Volume placeholder guard: if the volume is exactly 1,000,000 or a suspiciously round default, show a soft confirm ("Is this the customer's real annual volume?"). Today the volume is "almost always entered as one million".

## Wizard (`/intake/new`; 4 steps; mobile-first; autosave draft every 5 s and on step change)

**Step 1, Opportunity**
- Searchable picker over `GET /api/v1/salesforce/opportunities?mine=true` with a toggle for "All".
- Each card shows name, account, amount, close date, SF stage and owner.
- When the opportunity already has an active CCQ quote, show it and offer "Open existing" instead. **One active CCQ quote per SF opportunity**; enforce it with a unique partial index.
- If nothing matches: "Create the opportunity in Salesforce first." Show a link and explain why: every quote starts in SF.

**Step 2, Customer & ship-to**
- Customer pre-filled from the SF Account, with a status badge.
- If the SF Account is missing or the KAM marks the customer as new: capture the not-yet-established customer fields.
- Ship-to/fill location is pre-filled from the account default. "Change ship-to" opens a reason field; the original is kept.

**Step 3, Product & volume**
- Request class (value list; default "CCQ"; anything else shows "This may be redirected at qualification").
- Product family, components (multi), market, resin.
- **Neck finish/type**, **packaging requirements** (packaging type + notes).
- Estimated annual volume (units, required).
- Estimated annual revenue (USD; pre-filled from the SF amount if present and editable, with the original kept).
- Expected close date (from SF, editable).
- **Structured description:** container type/size, components and resin assemble a suggested standard description (Sarah's suggestion), plus free text. The format is provisional and lives in config.

**Step 4, Drawing, notes & review**
- Drawing status (value list). The upload control is a placeholder until B-16; store the intent.
- Comments for engineering.
- Full read-only review with "Edit" links per section.
- Missing optional fields show as **amber "Engineering may ask about this"** items, never as errors. Which fields are blocking is config (`intake_required_fields` app setting; seed: SF opportunity, customer, ship-to, product family, resin, est. volume). Danielle and Jim finalize this at M4 ("stop vs enrich", CR-08).
- **Submit** creates the quote via the domain engine (INTAKE draft → submitted):
  - generates `CCQ-YYYY-NNNNN`
  - writes `stage_history`, `activity_event` and `audit_event`
  - triggers priority scoring (B-08 hook; until then the score is null)
  - routes to G1 (if enabled) or the engineering queue

**Field help:** every field has a one-line "why we ask" helper text, stored in config, so the per-field explanations of P1 F-19 come nearly for free.

## API
- `POST /api/v1/quotes/drafts` → `PATCH /api/v1/quotes/drafts/:id` (autosave) → `POST /api/v1/quotes/drafts/:id/submit`
- `GET /api/v1/quotes/drafts?mine=true`
- `DELETE /api/v1/quotes/drafts/:id` (own drafts only)
- Validation with shared zod schemas from `packages/contracts/intake.ts`. Server-side, the domain decides blocking vs warning.
- Permissions: `quote.create`. A draft is visible only to its creator, plus Admin.

## Tests
- Domain: required-field config honoured; placeholder-volume warning; one active quote per opportunity.
- API: create/autosave/submit happy path; permission matrix entries; a second submit for the same opportunity → 409.
- Playwright: a KAM persona completes intake on desktop **and** on a 390px viewport; a submit without a drawing succeeds with the warning shown.

## Acceptance
- [ ] A KAM goes from SF opportunity to submitted CCQ quote in under 3 minutes with fake data
- [ ] No plant/process/machine/capital/engineer/priority inputs anywhere in intake
- [ ] Ship-to change requires a reason and preserves the original
- [ ] Draft autosave and resume work
- [ ] Ready for **R1 (Fri Oct 23)** demo
- [ ] Tick B-07 in `docs/build-guide/03-build-steps.md`, listing the final field set agreed at M4
