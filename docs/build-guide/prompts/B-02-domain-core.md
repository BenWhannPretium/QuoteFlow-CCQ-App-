# B-02 · Domain core: stage/gate engine, permission policy, redaction, quote numbers

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` and `docs/build-guide/01-architecture.md` §3 (roles, scope, sensitivity, permission matrix) and §4 (workflow model) carefully. You will implement `packages/domain`: **pure TypeScript with no I/O** (no DB, no HTTP, no `Date.now()` without an injected clock). Propose the module structure and type definitions first, then implement with tests.

## Why
This package holds CCQ's business rules. The API and UI only call it. Most of these rules are **not yet approved by the business**, so the engine must be driven by configuration objects that are passed in. In production that config comes from DB tables seeded in B-03.

## Modules to build

### 1. `types/`
Branded IDs (`QuoteId`, `UserId`), `Role` (the 8 roles + `PostAward`), `Permission` (string union from the matrix), and `StageKey`, `GateKey` and `OutcomeKey` (as config-driven strings, not enums). Also define:
- `WorkflowConfig`: stages[], gates[], outcomes[], transitions[]
- `QuoteState`: the fields the engine needs (stageKey, status, version, kamUserId, assignedEngineerId, field values for required-field checks, holds)
- `Actor`: userId, roles[], scope

### 2. `workflow/` (the stage/gate engine)
- `evaluateTransition(config, quote, actor, request: { gateKey, outcomeKey, note?, reasonCode?, payload? }, now)` returns `{ ok: true, effects } | { ok: false, errors: DomainError[] }`.
- Validation order (return **all** errors, not just the first):
  1. Current stage is the gate's stage.
  2. Actor holds the gate's decider permission.
  3. Segregation rules, e.g. an `Approver` cannot decide G4 on a quote where they are the KAM. Make this a rule list in config.
  4. Required fields for this gate/outcome are present. Rules are declared in config as a small JSON DSL: `{ field: 'est_annual_volume', op: 'present' }`, `{ anyOf: [...] }`, `{ field: 'capacity_evidence', op: 'minItems', value: 1 }`.
  5. `requiresNote` / `requiresReasonCode`, and the reason code is valid for this context.
- `effects` = `{ nextStageKey, nextStatus ('active'|'on_hold'|'closed'), closeAs?, versionBump: boolean, stageHistory: { exit, enter }, gateDecisionRecord, activityEvents[], notifications[] (type + recipient role/user) }`. The service layer later persists these atomically.
- Return/rework/requote paths go **back to a target stage defined in config** and set `versionBump: true`. Prior decisions are never mutated.
- Hold accounting: entering `on_hold` starts a hold interval and leaving it closes the interval. Expose `computeTimeInStage(history, holds, now)` that excludes holds (CR-57).
- `availableActions(config, quote, actor)` lists the gate/outcome options the actor may take now, so the UI renders buttons from the domain, not ad-hoc.

### 3. `workflow/seeds/hybrid.ts`
The seeded **hybrid** model exactly as in architecture §4.1:
- **Stages:** INTAKE, ENG_REVIEW, QUOTING, FINAL_REVIEW, CUSTOMER_DECISION, AWARDED, CLOSED_LOST, DECLINED, EXPIRED, REDIRECTED.
- **Gates and outcomes:**
  - **G1** (SalesLeader): Advance / Hold / Rework→INTAKE draft / Redirect / Stop. Can be disabled with `g1Enabled=false`; then submit goes straight to ENG_REVIEW.
  - **G2** (EngLead): Proceed / Proceed with risk (note required) / Capital required / Hold / Rework→INTAKE / Stop.
  - **G3** (Pricing): Submit to Final Review / Hold / Rework→ENG_REVIEW / Stop.
  - **G4** (Approver): Approve→CUSTOMER_DECISION / Decline (note + reason)→DECLINED / Return→(QUOTING or ENG_REVIEW, chosen).
  - **G5** (KAM or SalesLeader): Awarded / Lost (reason) / Expired / On hold (review date) / Re-quote→chosen stage.

  Mark every item `provisional: true`.
- Also export a `prd5` preset (Intake → Engineering Review → Quoting → Final Review → Awarded/Closed Lost) to prove the engine is config-driven. Tests must pass with **both** presets.

### 4. `policy/`
- `matrix.ts`: the permission matrix from architecture §3.4 as data.
- `can(actor, permission, resource?)`: checks role permission **and** data scope. Scope types are `all | region | owner | account_list`. For `owner`, the resource's `kamUserId` must equal the actor; for `region`, the resource region must be in the scope values.
- `assertCan()` throws a typed `ForbiddenError`.
- `redact(entity, actor)`: removes fields tagged `commercial` (registry in `policy/sensitivity.ts`: prelim_capital_usd, pricing_record.*, capacity numbers, any `price*`/`margin*`) for roles without `quote.read.commercialFields`. Works on nested objects and arrays.
- `canSeeOverrideLog(actor)`

### 5. `quote-number/`
`formatQuoteNumber(year, seq)` returns `CCQ-2026-00001`, plus a parser and validator.

### 6. `errors/`
`DomainError` with a `code` (e.g. `WRONG_STAGE`, `NOT_PERMITTED`, `MISSING_FIELD`, `NOTE_REQUIRED`, `REASON_REQUIRED`, `INVALID_REASON`, `SEGREGATION`), a human `message` and an optional `field`.

## Tests (Vitest, ≥ 95% line coverage on `packages/domain`)
- Table-driven tests: every gate × outcome × role (allowed and denied), for both presets.
- Return and requote bump the version and land on the configured stage.
- Hold intervals are excluded from time-in-stage.
- Segregation: a KAM who is also an Approver cannot approve their own quote.
- Redaction removes nested commercial fields for KAM/Engineer, and keeps them for Pricing/Leadership.
- Scope: an owner-scoped KAM can't read another KAM's quote; an all-scoped KAM can.

## Out of scope
Persistence, HTTP and UI. Don't add dependencies other than `zod` (for config validation).

## Acceptance
- [ ] `pnpm --filter @ccq/domain test -- --coverage` ≥ 95% lines
- [ ] No imports of `fs`, `http`, `pg`, `fastify` or `react` anywhere in the package (add an ESLint `no-restricted-imports` rule to enforce it)
- [ ] README in `packages/domain` explaining the config DSL with one example
- [ ] Tick B-02 in `docs/build-guide/03-build-steps.md`
