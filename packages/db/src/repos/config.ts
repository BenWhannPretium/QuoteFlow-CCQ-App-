import type { Permission, Role, ScoringModelInput, WorkflowConfigInput } from '@ccq/domain';
import { and, asc, desc, eq, lte } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { first } from './_util';
import type { ValueListKey } from '../schema/enums';
import {
  appSetting,
  gateDefinition,
  gateOutcomeDefinition,
  reasonCode,
  rolePermission,
  scoringModel,
  segregationRule,
  sfStageMap,
  stageDefinition,
  transitionRule,
  valueList,
} from '../schema/index';

/**
 * The workflow config rows mapped onto the domain DSL. Pass the result to `parseWorkflowConfig`.
 * Pure mapping: the domain validates it.
 */
export async function loadWorkflowConfigInput(db: DbOrTx): Promise<WorkflowConfigInput> {
  const [stages, gates, outcomes, transitions, segregation, reasons] = await Promise.all([
    db.select().from(stageDefinition).orderBy(asc(stageDefinition.sort)),
    db.select().from(gateDefinition).orderBy(asc(gateDefinition.sort)),
    db.select().from(gateOutcomeDefinition).orderBy(asc(gateOutcomeDefinition.sort)),
    db.select().from(transitionRule),
    db.select().from(segregationRule).orderBy(asc(segregationRule.ruleKey)),
    db.select().from(reasonCode).orderBy(asc(reasonCode.context), asc(reasonCode.sort)),
  ]);
  type Input = WorkflowConfigInput;
  return {
    stages: stages.map((s) => ({
      key: s.key,
      label: s.label,
      ...(s.ownerRole ? { ownerRole: s.ownerRole as Role } : {}),
      terminal: s.terminal,
      provisional: s.provisional,
    })),
    gates: gates.map((g) => ({
      key: g.key,
      stageKey: g.stageKey,
      label: g.label,
      deciderPermission: g.deciderPermission as Permission,
      enabled: g.enabled,
      requiredFields: g.requiredFields as Input['gates'][number]['requiredFields'],
      provisional: g.provisional,
    })),
    outcomes: outcomes.map((o) => ({
      gateKey: o.gateKey,
      key: o.key,
      label: o.label,
      requiresNote: o.requiresNote,
      requiresReasonCode: o.requiresReasonCode,
      ...(o.reasonContext ? { reasonContext: o.reasonContext } : {}),
      requiredFields: o.requiredFields as Input['outcomes'][number]['requiredFields'],
      notify: o.notify as Input['outcomes'][number]['notify'],
      provisional: o.provisional,
    })),
    transitions: transitions.map((t) => ({
      gateKey: t.gateKey,
      outcomeKey: t.outcomeKey,
      targetStageKeys: t.targetStageKeys,
      nextStatus: t.nextStatus as 'active' | 'on_hold' | 'closed',
      ...(t.closeAs ? { closeAs: t.closeAs } : {}),
      versionBump: t.versionBump,
      provisional: t.provisional,
    })),
    reasonCodes: reasons.map((r) => ({
      context: r.context,
      code: r.code,
      label: r.label,
      active: r.active,
      requiresNote: r.requiresNote,
      provisional: r.provisional,
    })),
    segregation: segregation.map((r) => ({
      id: r.ruleKey,
      gateKeys: r.gateKeys,
      ...(r.outcomeKeys ? { outcomeKeys: r.outcomeKeys } : {}),
      deny: r.deny as 'actor_is_kam' | 'actor_is_assigned_engineer',
      message: r.message,
      provisional: r.provisional,
    })),
  };
}

export const listValueList = (db: DbOrTx, listKey: ValueListKey, { activeOnly = true } = {}) =>
  db
    .select()
    .from(valueList)
    .where(
      activeOnly
        ? and(eq(valueList.listKey, listKey), eq(valueList.active, true))
        : eq(valueList.listKey, listKey),
    )
    .orderBy(asc(valueList.sort));

/** Every active value-list entry, grouped order (list key, then sort). For the UI config bootstrap. */
export const listActiveValueLists = (db: DbOrTx) =>
  db
    .select()
    .from(valueList)
    .where(eq(valueList.active, true))
    .orderBy(asc(valueList.listKey), asc(valueList.sort), asc(valueList.code));

export const listReasonCodes = (db: DbOrTx, context?: string) =>
  db
    .select()
    .from(reasonCode)
    .where(context ? eq(reasonCode.context, context) : undefined)
    .orderBy(asc(reasonCode.context), asc(reasonCode.sort));

export const listRolePermissions = (db: DbOrTx) => db.select().from(rolePermission);

export const listSfStageMap = (db: DbOrTx) =>
  db.select().from(sfStageMap).orderBy(asc(sfStageMap.sort));

export async function getSetting<T = unknown>(db: DbOrTx, key: string): Promise<T | undefined> {
  const row = first(
    await db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, key)),
  );
  return row ? (row.value as T) : undefined;
}

export const listSettings = (db: DbOrTx) =>
  db.select().from(appSetting).orderBy(asc(appSetting.key));

/** The newest scoring model in effect at `at`. */
export async function getScoringModel(db: DbOrTx, at: Date) {
  return first(
    await db
      .select()
      .from(scoringModel)
      .where(lte(scoringModel.effectiveFrom, at))
      .orderBy(desc(scoringModel.modelVersion))
      .limit(1),
  );
}

export type ScoringModelRow = typeof scoringModel.$inferSelect;

/** Domain scoring model → `scoring_model` row values (attributes and tiers as jsonb). */
export function scoringModelRow(
  model: ScoringModelInput,
  meta: { effectiveFrom: Date; changeReason: string },
) {
  return {
    modelVersion: model.version,
    attributes: model.attributes,
    tierThresholds: { tiers: model.tiers, unknownScore: model.unknownScore ?? 50 },
    effectiveFrom: meta.effectiveFrom,
    changeReason: meta.changeReason,
  };
}

/** `scoring_model` row → the domain DSL. Pass the result to `parseScoringModel` (it validates). */
export function scoringModelInputFromRow(row: ScoringModelRow): ScoringModelInput {
  const tiers = row.tierThresholds as { tiers?: unknown; unknownScore?: unknown };
  return {
    version: row.modelVersion,
    attributes: row.attributes as ScoringModelInput['attributes'],
    tiers: (tiers.tiers ?? []) as ScoringModelInput['tiers'],
    ...(typeof tiers.unknownScore === 'number' ? { unknownScore: tiers.unknownScore } : {}),
    provisional: row.provisional,
  };
}
