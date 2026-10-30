# @ccq/domain

CCQ's business rules as **pure TypeScript with no I/O**: no DB, HTTP, filesystem or clock. The API and UI only call it.
Callers pass `now` in, and lint blocks `Date.now()`, `new Date()` and imports of `fs`, `http`, `pg`, `fastify`, `react` and `drizzle-orm`.

Most rules here are **not yet approved by the business**, so the workflow is driven by a config object (in production, rows
from the DB tables seeded in B-03). Every seeded item is `provisional: true`.

| Module          | What it does                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `workflow/`     | `evaluateTransition`, `availableActions`, `computeTimeInStage`, config parsing and validation, seeds |
| `policy/`       | permission matrix as data, `can` / `assertCan` (role + data scope), `redact`, `canSeeOverrideLog`    |
| `quote-number/` | `formatQuoteNumber(2026, 1)` → `CCQ-2026-00001`, parser and validator                                |
| `errors/`       | `DomainError` (`code`, `message`, optional `field`) and `ForbiddenError`                             |
| `scoring/`      | advisory priority: `parseScoringModel`, `score`, `redactScore`, qualification warnings (B-08)        |

## Using the engine

```ts
import { evaluateTransition, hybridConfig } from '@ccq/domain';

const result = evaluateTransition(
  hybridConfig,
  quote,
  actor,
  { gateKey: 'G4', outcomeKey: 'decline', note: '…', reasonCode: 'margin_below_floor' },
  new Date() /* the service owns the clock */,
);
if (!result.ok) return problem(result.errors); // ALL failures, not just the first
await persistAtomically(result.effects); // gate_decision, stage_history, holds, activity_event, notifications
```

Checks run in this order and **every** failure is returned:

1. the quote is in the gate's stage (and not closed, and the gate is enabled)
2. the actor holds the gate's decider permission, within their data scope
3. no segregation rule bars the actor (e.g. an Approver who is the quote's KAM)
4. required fields are present
5. note / reason code / target stage constraints hold

`effects` is what the service layer persists in one transaction: `nextStageKey`, `nextStatus`, `closeAs`, `versionBump` / `nextVersion`,
`stageHistory { exit, enter }`, `hold { start | end | none }`, `gateDecisionRecord`, `activityEvents[]`, `notifications[]`.
Prior gate decisions are never mutated: a return, rework or re-quote lands on its configured stage and bumps the version.

`availableActions(config, quote, actor)` lists what the actor may do now, so the UI renders buttons from the domain.

## The config DSL

`WorkflowConfig` = `stages[]`, `gates[]`, `outcomes[]`, `transitions[]`, plus `reasonCodes[]` and `segregation[]`.
It is validated with zod and checked for consistency by `parseWorkflowConfig` (throws `INVALID_CONFIG`).

- **stage**: `key`, `label`, `ownerRole`, `terminal`
- **gate**: sits at the exit of one stage. `deciderPermission` is a permission name from the matrix, and `enabled` switches the gate off.
- **outcome**: one choice at a gate. It carries the _constraints_: `requiresNote`, `requiresReasonCode`, `reasonContext`, `requiredFields`, `notify`.
- **transition**: the _routing_ for a gate/outcome pair. `targetStageKeys` is `[]` to stay in the stage (Hold), one stage for a fixed target,
  or several for the decider to choose (`targetStageKey`). It also sets `nextStatus` (`active | on_hold | closed`), `closeAs` and `versionBump`.
- **required-field rules**, checked against the quote's `fields` overlaid with the decision's `payload`:

  | Rule                                                       | Meaning                                                                   |
  | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
  | `{ field: 'est_annual_volume', op: 'present' }`            | not null, blank, NaN or an empty array (`0` and `false` count as present) |
  | `{ field: 'capacity_evidence', op: 'minItems', value: 1 }` | an array with at least N items                                            |
  | `{ field, op: 'equals' \| 'oneOf' \| 'gte', value }`       | exact match, one of a list, number at least N                             |
  | `{ anyOf: [rule, …] }` / `{ allOf: [rule, …] }`            | combinators, nestable                                                     |

  Field names may be dotted (`pricing_record.price_approved_by`).

- **segregation rule**: `{ id, gateKeys, outcomeKeys?, deny: 'actor_is_kam' | 'actor_is_assigned_engineer', message }`.

### Example

```ts
const config = parseWorkflowConfig({
  stages: [
    { key: 'ENG_REVIEW', label: 'Engineering Review', ownerRole: 'EngLead' },
    { key: 'QUOTING', label: 'Quoting', ownerRole: 'Pricing' },
    { key: 'INTAKE', label: 'Intake', ownerRole: 'KAM' },
  ],
  gates: [
    {
      key: 'G2',
      stageKey: 'ENG_REVIEW',
      label: 'Feasible solution?',
      deciderPermission: 'gate.G2.decide',
    },
  ],
  outcomes: [
    {
      gateKey: 'G2',
      key: 'proceed',
      label: 'Proceed',
      requiredFields: [
        { field: 'process_type', op: 'present' },
        {
          anyOf: [
            { field: 'est_annual_volume', op: 'present' },
            { field: 'est_annual_revenue', op: 'present' },
          ],
        },
        { field: 'capacity_evidence', op: 'minItems', value: 1 },
      ],
      notify: [{ type: 'quote.ready_for_quoting', to: { role: 'Pricing' } }],
    },
    { gateKey: 'G2', key: 'rework', label: 'Rework', requiresNote: true, reasonContext: 'rework' },
  ],
  transitions: [
    { gateKey: 'G2', outcomeKey: 'proceed', targetStageKeys: ['QUOTING'], nextStatus: 'active' },
    {
      gateKey: 'G2',
      outcomeKey: 'rework',
      targetStageKeys: ['INTAKE'],
      nextStatus: 'active',
      versionBump: true,
    },
  ],
  reasonCodes: [{ context: 'rework', code: 'missing_information', label: 'Missing information' }],
});
```

## Presets

- `hybridConfig` / `buildHybridConfig({ g1Enabled })`: architecture §4.1 (ten stages, gates G1–G5). With `g1Enabled: false`, G1 is switched off and the
  `SUBMIT` gate takes over, so a submit goes straight to ENG_REVIEW.
- `prd5Config`: PRD v1's five stages, to prove the engine is config-driven. Tests run against both.

Assumptions baked into the hybrid seed (all provisional, listed in `04-decisions-and-risks.md` terms):

- G1 Stop closes the quote as `DECLINED` (`closeAs: 'declined'`); a G2/G3 Stop closes it as `CLOSED_LOST` (`closeAs: 'stopped'`).
- G1 needs `submitted_at`: a quote sent back by Rework waits for its KAM to resubmit. G1 Hold needs a reason and `review_date`;
  Rework needs a reason and a note; Stop needs a reason and a note.
- G2 "Capital required" proceeds to QUOTING and requires `prelim_capital_usd`.
- A quote on hold stays in its stage, and the next gate decision resumes it. Entering `on_hold` opens a hold interval, and leaving it closes the interval.
- Reason codes are required only for closing outcomes and G4 Decline; the codes themselves are placeholders until D-15.

## Scoring (B-08, advisory)

The score orders queues and informs G1; a person decides. Everything business-specific is a `ScoringModel` (the
`scoring_model` row), validated by `parseScoringModel` (weights must sum to 1):

```ts
const model = parseScoringModel(row); // { version, attributes[], tiers[], unknownScore }
const result = score(model, facts, now); // { total (0–100, 1 dp), tier, tierLabel, modelVersion, breakdown[], unknowns[] }
```

- An attribute has a `key`, `label`, `weight` and an `input`. If `input` names a resolver in `INPUT_RESOLVERS` (`map`,
  `days_to_close`), that resolver produces the value; otherwise it is a numeric fact path (`quote.est_annual_revenue`,
  `eng_review.prelim_capital_usd`). Numbers go through `bands: [min, max, points]` (min inclusive, max exclusive,
  `null` = open). `map: { by, values, default }` looks up a code (`by` may join facts with `+`). `inverse` flips the points.
- An unknown input scores `unknownScore` and is listed in `unknowns` with `unknownExplanation`
  ("Capital exposure unknown until Engineering Review").
- **A new kind of input** is one entry in `INPUT_RESOLVERS`. A new attribute _set_ is config only (the tests load the
  10/14 prototype set as v2).
- `redactScore(result, actor)` hides the raw value of commercial inputs (e.g. capital) from roles without commercial access.
  `canSeePriorityScore` applies `kam_can_see_peer_scores`.
- `qualificationWarnings(settings, facts)` produces the D-06 minimum value/volume warnings (never a block).
  `exceptionNoteErrors` asks for a strategic exception note on the configured `gate:outcome` pairs.

## Policy

`PERMISSION_MATRIX` (architecture §3.4) is data. A grant is `true` or qualified: `own` (the quote's KAM), `assigned` (the assigned engineer),
`fields` (e.g. EngLead may approve only `priority_tier` and `queue_position` overrides) or `stages` (PostAward reads Awarded only).
`can(actor, permission, resource?)` requires a role grant **and** data scope (`all | region | owner | account_list`).
Without a `resource`, only the role is checked and qualified grants do not apply.

`redact(entity, actor)` removes fields tagged `commercial` (`policy/sensitivity.ts`) from nested objects and arrays for roles without
`quote.read.commercialFields`. Since 2026-10-30 every role holds that permission (no role is hidden from data it can enter), so
it strips nothing in practice; it stays for a future restriction. It matches keys in snake_case, so DB rows and camelCase DTOs are both covered.

## Tests

```bash
pnpm --filter @ccq/domain test -- --coverage   # fails below 95% lines
```
