import { buildHybridConfig } from '@ccq/domain';
import type { WorkflowConfig } from '@ccq/domain';

import { upsertConfig } from './_upsert';
import type { DbOrTx } from '../../src/client';
import {
  gateDefinition,
  gateOutcomeDefinition,
  reasonCode,
  segregationRule,
  stageDefinition,
  transitionRule,
} from '../../src/schema/index';

/**
 * The hybrid workflow, derived from the domain seed (`packages/domain/src/workflow/seeds/hybrid.ts`),
 * which is the single source. This only reshapes it into rows.
 */
export function workflowRows(config: WorkflowConfig = buildHybridConfig({ g1Enabled: true })) {
  return {
    stages: config.stages.map((s, i) => ({
      key: s.key,
      label: s.label,
      ownerRole: s.ownerRole ?? null,
      terminal: s.terminal,
      sort: (i + 1) * 10,
      provisional: s.provisional,
    })),
    gates: config.gates.map((g, i) => ({
      key: g.key,
      stageKey: g.stageKey,
      label: g.label,
      deciderPermission: g.deciderPermission,
      enabled: g.enabled,
      requiredFields: g.requiredFields,
      sort: (i + 1) * 10,
      provisional: g.provisional,
    })),
    outcomes: config.outcomes.map((o, i) => ({
      gateKey: o.gateKey,
      key: o.key,
      label: o.label,
      requiresNote: o.requiresNote,
      requiresReasonCode: o.requiresReasonCode,
      reasonContext: o.reasonContext ?? null,
      requiredFields: o.requiredFields,
      notify: o.notify,
      sort: (i + 1) * 10,
      provisional: o.provisional,
    })),
    transitions: config.transitions.map((t) => ({
      gateKey: t.gateKey,
      outcomeKey: t.outcomeKey,
      targetStageKeys: t.targetStageKeys,
      nextStatus: t.nextStatus,
      closeAs: t.closeAs ?? null,
      versionBump: t.versionBump,
      provisional: t.provisional,
    })),
    segregation: config.segregation.map((r) => ({
      ruleKey: r.id,
      gateKeys: r.gateKeys,
      outcomeKeys: r.outcomeKeys ?? null,
      deny: r.deny,
      message: r.message,
      provisional: r.provisional,
    })),
    reasonCodes: config.reasonCodes.map((r, i) => ({
      context: r.context,
      code: r.code,
      label: r.label,
      active: r.active,
      requiresNote: r.requiresNote,
      sort: (i + 1) * 10,
      provisional: r.provisional,
    })),
  };
}

export async function seedWorkflow(db: DbOrTx, g1Enabled = true): Promise<void> {
  const rows = workflowRows(buildHybridConfig({ g1Enabled }));
  await upsertConfig(db, stageDefinition, rows.stages, ['key']);
  await upsertConfig(db, gateDefinition, rows.gates, ['key']);
  await upsertConfig(db, gateOutcomeDefinition, rows.outcomes, ['gateKey', 'key']);
  await upsertConfig(db, transitionRule, rows.transitions, ['gateKey', 'outcomeKey']);
  await upsertConfig(db, segregationRule, rows.segregation, ['ruleKey']);
  await upsertConfig(db, reasonCode, rows.reasonCodes, ['context', 'code']);
}
