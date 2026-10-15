import { z } from 'zod';

import { PERMISSIONS } from './permissions';
import { ROLES } from './roles';

/** Stage, gate and outcome keys are config-driven strings (they come from DB config), never enums. */
export type StageKey = string;
export type GateKey = string;
export type OutcomeKey = string;

// ── Required-field DSL ──────────────────────────────────────────────────────────────────────────
// { field: 'est_annual_volume', op: 'present' }
// { field: 'capacity_evidence', op: 'minItems', value: 1 }
// { anyOf: [rule, ...] }  { allOf: [rule, ...] }

export type RequiredRule =
  | { field: string; op: 'present' }
  | { field: string; op: 'minItems'; value: number }
  | { field: string; op: 'equals'; value: string | number | boolean }
  | { field: string; op: 'oneOf'; value: (string | number)[] }
  | { field: string; op: 'gte'; value: number }
  | { anyOf: RequiredRule[] }
  | { allOf: RequiredRule[] };

const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const requiredRuleSchema: z.ZodType<RequiredRule> = z.lazy(() =>
  z.union([
    z.object({ field: z.string().min(1), op: z.literal('present') }).strict(),
    z
      .object({
        field: z.string().min(1),
        op: z.literal('minItems'),
        value: z.number().int().min(1),
      })
      .strict(),
    z.object({ field: z.string().min(1), op: z.literal('equals'), value: scalar }).strict(),
    z
      .object({
        field: z.string().min(1),
        op: z.literal('oneOf'),
        value: z.array(z.union([z.string(), z.number()])).min(1),
      })
      .strict(),
    z.object({ field: z.string().min(1), op: z.literal('gte'), value: z.number() }).strict(),
    z.object({ anyOf: z.array(requiredRuleSchema).min(1) }).strict(),
    z.object({ allOf: z.array(requiredRuleSchema).min(1) }).strict(),
  ]),
);

// ── Workflow config ─────────────────────────────────────────────────────────────────────────────

const key = z.string().min(1);
const roleSchema = z.enum(ROLES);
const permissionSchema = z.enum(PERMISSIONS);

export const quoteStatusSchema = z.enum(['active', 'on_hold', 'closed']);

export const stageDefinitionSchema = z
  .object({
    key,
    label: z.string().min(1),
    ownerRole: roleSchema.optional(),
    /** Terminal stages have no gate at exit; reaching one closes the quote. */
    terminal: z.boolean().default(false),
    provisional: z.boolean().default(true),
  })
  .strict();

export const gateDefinitionSchema = z
  .object({
    key,
    stageKey: key,
    label: z.string().min(1),
    /** Permission the actor must hold to decide this gate (e.g. `gate.G4.decide`). */
    deciderPermission: permissionSchema,
    /** A disabled gate can't be used (e.g. G1 when `g1_enabled` is false). */
    enabled: z.boolean().default(true),
    /** Rules applied to every outcome of this gate, in addition to the outcome's own. */
    requiredFields: z.array(requiredRuleSchema).default([]),
    provisional: z.boolean().default(true),
  })
  .strict();

/** Who gets told. `stageOwner` resolves to the owner role of the stage the quote lands in. */
export const notificationTargetSchema = z.union([
  z.object({ role: roleSchema }).strict(),
  z.object({ relation: z.enum(['kam', 'assignedEngineer']) }).strict(),
  z.object({ stageOwner: z.literal(true) }).strict(),
]);

export const outcomeDefinitionSchema = z
  .object({
    gateKey: key,
    key,
    label: z.string().min(1),
    requiresNote: z.boolean().default(false),
    requiresReasonCode: z.boolean().default(false),
    /** Reason-code context that codes for this outcome must belong to (rework, decline, lost…). */
    reasonContext: z.string().min(1).optional(),
    requiredFields: z.array(requiredRuleSchema).default([]),
    notify: z.array(z.object({ type: key, to: notificationTargetSchema }).strict()).default([]),
    provisional: z.boolean().default(true),
  })
  .strict();

/** Routing for one gate/outcome pair (mirrors `transition_rule`). */
export const transitionRuleSchema = z
  .object({
    gateKey: key,
    outcomeKey: key,
    /** [] = stay in the current stage; 1 = fixed target; 2+ = the decider chooses (`targetStageKey`). */
    targetStageKeys: z.array(key).default([]),
    nextStatus: quoteStatusSchema,
    /** Closure type recorded when the quote closes (e.g. awarded, lost, declined, expired, redirected, stopped). */
    closeAs: key.optional(),
    /** Return / rework / requote paths bump the quote version; prior decisions are never mutated. */
    versionBump: z.boolean().default(false),
    provisional: z.boolean().default(true),
  })
  .strict();

export const reasonCodeSchema = z
  .object({
    context: z.string().min(1),
    code: key,
    label: z.string().min(1),
    active: z.boolean().default(true),
    /** Choosing this code requires a note (e.g. Lost / Other). */
    requiresNote: z.boolean().default(false),
    provisional: z.boolean().default(true),
  })
  .strict();

export const workflowConfigSchema = z
  .object({
    stages: z.array(stageDefinitionSchema).min(1),
    gates: z.array(gateDefinitionSchema),
    outcomes: z.array(outcomeDefinitionSchema),
    transitions: z.array(transitionRuleSchema),
    reasonCodes: z.array(reasonCodeSchema).default([]),
    /** Rules like "an Approver can't decide G4 on a quote where they are the KAM". */
    segregation: z
      .array(
        z
          .object({
            id: key,
            gateKeys: z.array(key).min(1),
            /** Omit to apply to every outcome of the listed gates. */
            outcomeKeys: z.array(key).optional(),
            /** The relation that makes the actor ineligible. */
            deny: z.enum(['actor_is_kam', 'actor_is_assigned_engineer']),
            message: z.string().min(1),
            provisional: z.boolean().default(true),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type StageDefinition = z.infer<typeof stageDefinitionSchema>;
export type GateDefinition = z.infer<typeof gateDefinitionSchema>;
export type OutcomeDefinition = z.infer<typeof outcomeDefinitionSchema>;
export type TransitionRule = z.infer<typeof transitionRuleSchema>;
export type ReasonCodeDefinition = z.infer<typeof reasonCodeSchema>;
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;
export type SegregationRule = WorkflowConfig['segregation'][number];

/** Input side (defaults optional): what seeds and DB loaders hand to `parseWorkflowConfig`. */
export type WorkflowConfigInput = z.input<typeof workflowConfigSchema>;
/** Parsed side (defaults applied): what the engine consumes. */
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;
