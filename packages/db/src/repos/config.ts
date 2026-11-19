import {
  sortValueListEntries,
  sortValueListsByKey,
  type OutcomeGroup,
  type Permission,
  type Role,
  type ScoringModelInput,
  type WorkflowConfigInput,
} from '@ccq/domain';
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
      helpText: o.helpText,
      resumeAt: o.resumeAt as 'origin' | 'intake',
      // FB-17 (W13-22, W13-23): switched-off outcomes stay in the config (they label old decisions).
      active: o.active,
      ...(o.outcomeGroup ? { outcomeGroup: o.outcomeGroup as OutcomeGroup } : {}),
      provisional: o.provisional,
    })),
    transitions: transitions.map((t) => ({
      gateKey: t.gateKey,
      outcomeKey: t.outcomeKey,
      targetStageKeys: t.targetStageKeys,
      nextStatus: t.nextStatus as 'active' | 'on_hold' | 'closed',
      ...(t.closeAs ? { closeAs: t.closeAs } : {}),
      versionBump: t.versionBump,
      closureOwner: t.closureOwner as 'kam' | 'decider',
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

/**
 * One value list's entries in display order (FB-24, N17-08): A to Z by label, numeric-aware, "Other" last,
 * unless the list opts out with `meta.keepOrder` (`sortValueListEntries`). Admin's list editor reads the
 * stored order through its own query (`listAllValueLists` in admin-config.ts).
 */
export const listValueList = async (
  db: DbOrTx,
  listKey: ValueListKey,
  { activeOnly = true } = {},
) =>
  sortValueListEntries(
    await db
      .select()
      .from(valueList)
      .where(
        activeOnly
          ? and(eq(valueList.listKey, listKey), eq(valueList.active, true))
          : eq(valueList.listKey, listKey),
      )
      .orderBy(asc(valueList.sort), asc(valueList.code)),
  );

/** Every active value-list entry, grouped by list key, each list in display order (FB-24). For the UI config bootstrap. */
export const listActiveValueLists = async (db: DbOrTx) =>
  sortValueListsByKey(
    await db
      .select()
      .from(valueList)
      .where(eq(valueList.active, true))
      .orderBy(asc(valueList.listKey), asc(valueList.sort), asc(valueList.code)),
  );

/**
 * Inactive entries (retired values), so old quotes can still show their label (FB-09). A label lookup,
 * not a picker: kept in the stored order.
 */
export const listInactiveValueLists = (db: DbOrTx) =>
  db
    .select({ listKey: valueList.listKey, code: valueList.code, label: valueList.label })
    .from(valueList)
    .where(eq(valueList.active, false))
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
