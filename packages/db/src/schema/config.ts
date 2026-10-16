import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';

import { c, documented, inList } from './_doc';
import {
  CLOSURE_OWNER_DEFAULTS,
  QUOTE_STATUSES,
  REASON_CONTEXTS,
  ROLES,
  SEGREGATION_DENY,
  VALUE_LIST_KEYS,
  PERMISSIONS,
} from './enums';
import { baseColumns, configColumns, timestamptz } from './identity';

const STEWARD = 'Admin / Knowledge Steward';

export const valueList = documented(
  pgTable(
    'value_list',
    {
      ...baseColumns(),
      ...configColumns(),
      listKey: c(
        text('list_key').notNull(),
        'Which list the entry belongs to (resin, market, plant, …).',
      ),
      code: c(text('code').notNull(), 'Stable code stored on quotes.'),
      label: c(text('label').notNull(), 'Display label.'),
      sort: c(integer('sort').notNull().default(0), 'Display order within the list.'),
      active: c(
        boolean('active').notNull().default(true),
        'Inactive entries stay valid on old quotes but are not offered.',
      ),
      meta: c(
        jsonb('meta').notNull().default({}),
        'Extra attributes, e.g. {"freeText": true} when picking the entry lets the user type a value.',
      ),
    },
    (t) => [
      unique('value_list_list_key_code_uq').on(t.listKey, t.code),
      check('value_list_list_key_check', inList(t.listKey, VALUE_LIST_KEYS)),
    ],
  ),
  {
    area: 'config',
    owner: STEWARD,
    description:
      'Pick-list values for intake and engineering fields. Seeded from ERF Template Rev D (2026-03-17).',
  },
);

export const stageDefinition = documented(
  pgTable(
    'stage_definition',
    {
      ...baseColumns(),
      ...configColumns(),
      key: c(text('key').notNull().unique(), 'Stage key used on quotes (INTAKE, ENG_REVIEW, …).'),
      label: c(text('label').notNull(), 'Display label; editable without code changes.'),
      ownerRole: c(
        text('owner_role'),
        'Role that owns work in the stage; null for terminal stages.',
      ),
      terminal: c(
        boolean('terminal').notNull().default(false),
        'Terminal stages have no exit gate.',
      ),
      sort: c(integer('sort').notNull().default(0), 'Board column order.'),
    },
    (t) => [check('stage_definition_owner_role_check', inList(t.ownerRole, ROLES))],
  ),
  {
    area: 'config',
    owner: STEWARD,
    description: 'Workflow stages (architecture §4.1), seeded from the domain hybrid model.',
  },
);

export const gateDefinition = documented(
  pgTable(
    'gate_definition',
    {
      ...baseColumns(),
      ...configColumns(),
      key: c(text('key').notNull().unique(), 'Gate key (G1…G5, SUBMIT).'),
      stageKey: c(
        text('stage_key')
          .notNull()
          .references(() => stageDefinition.key, { onDelete: 'restrict', onUpdate: 'cascade' }),
        'Stage the gate sits at the exit of.',
      ),
      label: c(text('label').notNull(), 'Display label.'),
      deciderPermission: c(
        text('decider_permission').notNull(),
        'Permission the decider must hold.',
      ),
      enabled: c(
        boolean('enabled').notNull().default(true),
        'A disabled gate cannot be used (e.g. G1 when g1_enabled=false).',
      ),
      requiredFields: c(
        jsonb('required_fields').notNull().default([]),
        'Required-field rules applied to every outcome (domain DSL).',
      ),
      sort: c(integer('sort').notNull().default(0), 'Display order.'),
    },
    (t) => [
      check('gate_definition_decider_permission_check', inList(t.deciderPermission, PERMISSIONS)),
    ],
  ),
  { area: 'config', owner: STEWARD, description: 'Gates at stage exits and who decides them.' },
);

export const gateOutcomeDefinition = documented(
  pgTable(
    'gate_outcome_definition',
    {
      ...baseColumns(),
      ...configColumns(),
      gateKey: c(
        text('gate_key')
          .notNull()
          .references(() => gateDefinition.key, { onDelete: 'restrict', onUpdate: 'cascade' }),
        'Gate the outcome belongs to.',
      ),
      key: c(text('key').notNull(), 'Outcome key, unique within the gate (advance, hold, …).'),
      label: c(text('label').notNull(), 'Display label (button text).'),
      requiresNote: c(boolean('requires_note').notNull().default(false), 'A note is mandatory.'),
      requiresReasonCode: c(
        boolean('requires_reason_code').notNull().default(false),
        'A reason code is mandatory.',
      ),
      reasonContext: c(
        text('reason_context'),
        'reason_code.context the chosen code must belong to.',
      ),
      requiredFields: c(
        jsonb('required_fields').notNull().default([]),
        'Required-field rules for this outcome.',
      ),
      notify: c(jsonb('notify').notNull().default([]), 'Notifications to plan: [{type, to}].'),
      sort: c(integer('sort').notNull().default(0), 'Display order within the gate.'),
    },
    (t) => [
      unique('gate_outcome_definition_gate_key_key_uq').on(t.gateKey, t.key),
      check(
        'gate_outcome_definition_reason_context_check',
        inList(t.reasonContext, REASON_CONTEXTS),
      ),
    ],
  ),
  {
    area: 'config',
    owner: STEWARD,
    description: 'The choices available at each gate and their constraints.',
  },
);

export const transitionRule = documented(
  pgTable(
    'transition_rule',
    {
      ...baseColumns(),
      ...configColumns(),
      gateKey: c(text('gate_key').notNull(), 'Gate of the outcome being routed.'),
      outcomeKey: c(text('outcome_key').notNull(), 'Outcome being routed.'),
      targetStageKeys: c(
        text('target_stage_keys').array().notNull().default([]),
        'Empty = stay in stage (hold); one = fixed target; several = decider chooses.',
      ),
      nextStatus: c(text('next_status').notNull(), 'Quote status after the transition.'),
      closeAs: c(
        text('close_as'),
        'Closure type recorded when the quote closes (awarded, lost, …).',
      ),
      versionBump: c(
        boolean('version_bump').notNull().default(false),
        'Return / rework / re-quote bumps quote.version.',
      ),
      closureOwner: c(
        text('closure_owner').notNull().default('decider'),
        'B-13 (CR-39): default closure owner when the transition closes the quote: kam (customer outcome) | decider (internal no-go).',
      ),
    },
    (t) => [
      unique('transition_rule_gate_outcome_uq').on(t.gateKey, t.outcomeKey),
      foreignKey({
        name: 'transition_rule_outcome_fk',
        columns: [t.gateKey, t.outcomeKey],
        foreignColumns: [gateOutcomeDefinition.gateKey, gateOutcomeDefinition.key],
      })
        .onDelete('restrict')
        .onUpdate('cascade'),
      check('transition_rule_next_status_check', inList(t.nextStatus, QUOTE_STATUSES)),
      check('transition_rule_closure_owner_check', inList(t.closureOwner, CLOSURE_OWNER_DEFAULTS)),
    ],
  ),
  { area: 'config', owner: STEWARD, description: 'Routing for each gate/outcome pair.' },
);

export const segregationRule = documented(
  pgTable(
    'segregation_rule',
    {
      ...baseColumns(),
      ...configColumns(),
      ruleKey: c(
        text('rule_key').notNull().unique(),
        'Stable rule id (e.g. g4-kam-cannot-approve-own).',
      ),
      gateKeys: c(text('gate_keys').array().notNull(), 'Gates the rule applies to.'),
      outcomeKeys: c(
        text('outcome_keys').array(),
        'Outcomes it applies to; null = all outcomes of the gates.',
      ),
      deny: c(
        text('deny').notNull(),
        'Relation that bars the actor: actor_is_kam | actor_is_assigned_engineer.',
      ),
      message: c(text('message').notNull(), 'Error shown to the barred actor.'),
    },
    (t) => [check('segregation_rule_deny_check', inList(t.deny, SEGREGATION_DENY))],
  ),
  {
    area: 'config',
    owner: STEWARD,
    description: 'Segregation-of-duties rules (e.g. a KAM cannot approve their own quote).',
  },
);

export const reasonCode = documented(
  pgTable(
    'reason_code',
    {
      ...baseColumns(),
      ...configColumns(),
      context: c(
        text('context').notNull(),
        'Where the code is used: rework, redirect, stop, decline, lost, …',
      ),
      code: c(text('code').notNull(), 'Stable code stored on decisions.'),
      label: c(text('label').notNull(), 'Display label.'),
      active: c(boolean('active').notNull().default(true), 'Inactive codes cannot be chosen.'),
      requiresNote: c(
        boolean('requires_note').notNull().default(false),
        'Choosing the code needs a note (e.g. Lost / Other).',
      ),
      sort: c(integer('sort').notNull().default(0), 'Display order within the context.'),
    },
    (t) => [
      unique('reason_code_context_code_uq').on(t.context, t.code),
      check('reason_code_context_check', inList(t.context, REASON_CONTEXTS)),
    ],
  ),
  {
    area: 'config',
    owner: 'Sales leadership + Process Owner (D-15)',
    description: 'Reason codes per decision context.',
  },
);

export const scoringModel = documented(
  pgTable('scoring_model', {
    ...baseColumns(),
    ...configColumns(),
    modelVersion: c(
      integer('model_version').notNull().unique(),
      'Scoring model version stamped on quotes.',
    ),
    attributes: c(
      jsonb('attributes').notNull(),
      'Attributes (domain scoring DSL): [{key, label, weight, input, bands | map, inverse, unknownScore, unknownExplanation}]. Weights sum to 1.',
    ),
    tierThresholds: c(
      jsonb('tier_thresholds').notNull(),
      '{tiers: [{key, label, min}], unknownScore}: tiers on the 0–100 score and the neutral score for unknown inputs.',
    ),
    effectiveFrom: c(
      timestamptz('effective_from').notNull(),
      'When the model starts applying to new scores.',
    ),
    changeReason: c(text('change_reason').notNull(), 'Why this version exists.'),
  }),
  {
    area: 'config',
    owner: 'Jim Zweifel + sales leadership (D-19)',
    description:
      'Versioned priority-scoring model (F-05, B-08). Advisory only: it orders queues and informs G1.',
  },
);

export const appSetting = documented(
  pgTable('app_setting', {
    ...baseColumns(),
    ...configColumns(),
    key: c(text('key').notNull().unique(), 'Setting key (validity_days_default, g1_enabled, …).'),
    value: c(jsonb('value'), 'Setting value as JSON; JSON null means "not set yet".'),
    description: c(
      text('description').notNull(),
      'What the setting controls and which decision it waits on.',
    ),
  }),
  {
    area: 'config',
    owner: STEWARD,
    description: 'Typed key/value settings for open business decisions.',
  },
);

export const sfStageMap = documented(
  pgTable('sf_stage_map', {
    ...baseColumns(),
    ...configColumns(),
    sfStage: c(
      text('sf_stage').notNull().unique(),
      'Salesforce Opportunity StageName.',
      'Salesforce (read-only)',
    ),
    ccqStageHint: c(
      text('ccq_stage_hint').references(() => stageDefinition.key, {
        onDelete: 'set null',
        onUpdate: 'cascade',
      }),
      'CCQ stage this SF stage usually corresponds to; used to flag mismatches.',
    ),
    sort: c(integer('sort').notNull().default(0), 'SF pipeline order.'),
  }),
  {
    area: 'config',
    owner: STEWARD,
    description: 'Salesforce stage → CCQ stage hint, for side-by-side reporting (§4.2).',
  },
);
