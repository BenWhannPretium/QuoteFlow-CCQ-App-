import { PUBLIC_SETTING_KEYS, PublicConfigResponse } from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import {
  getScoringModel,
  listActiveValueLists,
  listGateRows,
  listOutcomeRows,
  listReasonCodes,
  listSettings,
  listStageRows,
  loadWorkflowConfigInput,
  scoringModelInputFromRow,
} from '@ccq/db/repos';
import { parseScoringModel } from '@ccq/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const publicSettingKeys = new Set<string>(PUBLIC_SETTING_KEYS);

/** Assemble the UI config from the config tables. Labels only: no rules are evaluated here. */
export async function loadPublicConfig(db: DbOrTx, now: Date): Promise<PublicConfigResponse> {
  const [workflow, reasons, values, settings, model, stageRows, gateRows, outcomeRows] =
    await Promise.all([
      loadWorkflowConfigInput(db),
      listReasonCodes(db),
      listActiveValueLists(db),
      listSettings(db),
      getScoringModel(db, now),
      listStageRows(db),
      listGateRows(db),
      listOutcomeRows(db),
    ]);
  const stageHelp = new Map(stageRows.map((r) => [r.key, r.helpText]));
  const gateHelp = new Map(gateRows.map((r) => [r.key, r.helpText]));
  const outcomeHelp = new Map(outcomeRows.map((r) => [`${r.gateKey}/${r.key}`, r.helpText]));

  const valueLists: PublicConfigResponse['valueLists'] = {};
  for (const v of values) {
    (valueLists[v.listKey] ??= []).push({
      code: v.code,
      label: v.label,
      sort: v.sort,
      meta: (v.meta ?? {}) as Record<string, unknown>,
    });
  }

  const tiers = model
    ? parseScoringModel(scoringModelInputFromRow(model))
        .tiers.map((t) => ({ tier: t.key, label: t.label ?? t.key, min: t.min }))
        .sort((a, b) => b.min - a.min)
    : [];

  return {
    // loadWorkflowConfigInput returns rows in sort order; expose that order as `sort`.
    stages: workflow.stages.map((s, i) => ({
      key: s.key,
      label: s.label,
      helpText: stageHelp.get(s.key) ?? null,
      ownerRole: s.ownerRole ?? null,
      terminal: s.terminal ?? false,
      sort: i,
      provisional: s.provisional ?? false,
    })),
    gates: workflow.gates.map((g, i) => ({
      key: g.key,
      stageKey: g.stageKey,
      label: g.label,
      helpText: gateHelp.get(g.key) ?? null,
      deciderPermission: g.deciderPermission,
      enabled: g.enabled ?? true,
      sort: i,
      provisional: g.provisional ?? false,
    })),
    outcomes: workflow.outcomes.map((o, i) => ({
      gateKey: o.gateKey,
      key: o.key,
      label: o.label,
      helpText: outcomeHelp.get(`${o.gateKey}/${o.key}`) ?? null,
      requiresNote: o.requiresNote ?? false,
      requiresReasonCode: o.requiresReasonCode ?? false,
      reasonContext: o.reasonContext ?? null,
      sort: i,
      provisional: o.provisional ?? false,
    })),
    reasonCodes: reasons
      .filter((r) => r.active)
      .map((r) => ({
        context: r.context,
        code: r.code,
        label: r.label,
        requiresNote: r.requiresNote,
        sort: r.sort,
      })),
    valueLists,
    settings: Object.fromEntries(
      settings.filter((s) => publicSettingKeys.has(s.key)).map((s) => [s.key, s.value ?? null]),
    ),
    tiers,
  };
}

/**
 * B-19: a per-instance cache of the public config (no per-user data in it: config tables have no
 * RLS and settings are allow-listed). Admin writes call `invalidate()`; other API instances serve the
 * old value for at most `ttlMs`. Failed loads are not cached.
 */
export class PublicConfigCache {
  private entry: { at: number; value: Promise<PublicConfigResponse> } | null = null;

  constructor(
    readonly ttlMs: number,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  get(load: () => Promise<PublicConfigResponse>): Promise<PublicConfigResponse> {
    if (this.ttlMs <= 0) return load();
    const t = this.clock();
    if (this.entry && t - this.entry.at < this.ttlMs) return this.entry.value;
    const entry = { at: t, value: load() };
    this.entry = entry;
    entry.value.catch(() => {
      if (this.entry === entry) this.entry = null;
    });
    return entry.value;
  }

  invalidate(): void {
    this.entry = null;
  }
}

export const configRoutes: FastifyPluginAsyncZod<{
  now?: () => Date;
  cache: PublicConfigCache;
}> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());
  app.get(
    '/config/public',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['config'],
        summary: 'Stage, gate and outcome labels, value lists, reason codes and UI settings',
        security: [{ bearerAuth: [] }],
        response: { 200: PublicConfigResponse },
      },
    },
    async (req) => opts.cache.get(() => app.withTx(req, (tx) => loadPublicConfig(tx, now()))),
  );
};
