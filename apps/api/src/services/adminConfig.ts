import {
  ADMIN_CONFIG_PROBLEM_CODES as CODES,
  type UpdateUserScopeBody,
  type ActivateScoringDraftBody,
  type ActivateScoringResponse,
  type AdminReasonCodesResponse,
  type AdminScoringResponse,
  type AdminScoringVersion,
  type AdminSettingsResponse,
  type AdminUser,
  type AdminUsersResponse,
  type AdminValueListsResponse,
  type AdminWorkflowResponse,
  type Approval,
  type ConnectorHealthResponse,
  type CreateReasonCodeBody,
  type CreateScoringDraftBody,
  type CreateValueListEntryBody,
  type DecisionLogEntry,
  type DecisionLogQuery,
  type DecisionLogResponse,
  type ReorderBody,
  type ScoringModelBody,
  type ScoringPreviewResponse,
  type UpdateGateBody,
  type UpdateOutcomeBody,
  type UpdateReasonCodeBody,
  type UpdateScoringDraftBody,
  type UpdateSettingBody,
  type UpdateStageBody,
  type UpdateValueListEntryBody,
} from '@ccq/contracts';
import {
  contextFromActor,
  REASON_CONTEXTS,
  VALUE_LIST_KEYS,
  withRequestContext,
  type Database,
  type Tx,
  type ValueListKey,
} from '@ccq/db';
import { schema } from '@ccq/db';
import {
  countSubmittedOpenQuotesInStage,
  deleteScoringDraft,
  findById,
  findGateByKey,
  findScoringDraft,
  findSettingByKey,
  findUserById,
  findUserScopeRow,
  getScoringModel,
  getSetting,
  insertReasonCode,
  insertScoringModel,
  insertValueListEntry,
  integrationHealth,
  listAllReasonCodes,
  listAllValueLists,
  listGateRows,
  listOutcomeRows,
  listScoringModels,
  listSettings,
  listStageRows,
  listUsersByIds,
  listUsersForAdmin,
  loadScoringFactsMany,
  loadWorkflowConfigInput,
  nextScoringModelVersion,
  nextSort,
  openQuotesUsingValue,
  openQuoteIds,
  recentQuotesForPreview,
  scoringModelInputFromRow,
  scoringModelRow,
  searchAuditEvents,
  updateVersioned,
  writeUserScope,
  type ReasonCodeRow,
  type ScoringModelVersionRow,
  type ValueListRow,
  type VersionedUpdate,
} from '@ccq/db/repos';
import {
  configDiff,
  DomainError,
  fieldsReferenced,
  INPUT_RESOLVERS,
  INTAKE_FIELDS,
  parseScoringModel,
  parseSettingValue,
  parseWorkflowConfig,
  previewScoringChange,
  requiredRuleSchema,
  SETTING_GROUPS,
  settingSpec,
  type Actor,
  type RequiredRule,
  type ScoringModel,
} from '@ccq/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { csvCell, dayIn, REPORT_TIME_ZONE, startOfDay } from './auditAdmin';
import { decodeCursor, page } from './cursor';
import { ServiceProblem } from './problem';
import type { ScoringService } from './scoring';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type AdminWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** How many of the newest quotes the scoring preview scores. */
export const SCORING_PREVIEW_QUOTES = 50;
/** Open quotes rescored per transaction after a model activation. */
const RESCORE_BATCH = 25;
export const DECISION_LOG_EXPORT_MAX_ROWS = 10_000;
const DAY_MS = 86_400_000;

/** The `before`/`after` snapshot of a config row: its editable fields plus `ref`, a readable name. */
type Snapshot = Record<string, unknown> & { ref: string };

const ENTITY_LABEL: Record<string, string> = {
  value_list: 'Value list',
  reason_code: 'Reason code',
  stage_definition: 'Stage',
  gate_definition: 'Gate',
  gate_outcome_definition: 'Gate outcome',
  app_setting: 'Setting',
  scoring_model: 'Scoring model',
  user_scope: 'User scope',
};

export interface AdminConfigServiceOptions {
  scoring: ScoringService;
  /** For the background rescore (its own transactions, after the activation commits). */
  database?: Database | undefined;
  log: { info(obj: object, msg: string): void; error(obj: object, msg: string): void };
  now?: () => Date;
  /** After every committed change: drop the server's public-config cache. */
  onConfigChange?: () => void;
  /** After a scope change: drop cached identities so the new scope applies. */
  onScopeChange?: () => void;
  /** Connector modes for the health panel (SF_MODE, pricing = import, FILESTORE_MODE, MAIL_MODE). */
  connectorModes: Record<string, string>;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * The admin configuration console (B-19, CR-51; the F-21 decision log's source). Reads for
 * config.read, writes for config.manage (the routes check; `assertCanWrite` is not needed here).
 *
 * Every write, in one transaction:
 * 1. loads the row and checks the caller's `version` (stale → 409);
 * 2. validates the new value with zod and the domain config validators (→ 422), including the whole
 *    workflow config after a workflow or reason-code change (`parseWorkflowConfig`);
 * 3. updates the row, bumping `version` (and approval, when asked);
 * 4. writes `audit_event action='config_change'` with before/after and the change reason.
 * After the commit it invalidates the server's public-config cache (the web client invalidates its
 * `config/public` query on success).
 */
export class AdminConfigService {
  private readonly now: () => Date;
  readonly rescore: ScoringRescoreJob;

  constructor(private readonly opts: AdminConfigServiceOptions) {
    this.now = opts.now ?? (() => new Date());
    this.rescore = new ScoringRescoreJob(opts.scoring, opts.database, opts.log, this.now);
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────────

  private async approvals(
    tx: Tx,
    rows: { provisional: boolean; approvedBy: string | null; approvedAt: Date | null }[],
  ) {
    const ids = [...new Set(rows.map((r) => r.approvedBy).filter((v): v is string => !!v))];
    const users = ids.length ? await listUsersByIds(tx, ids) : [];
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    return (r: (typeof rows)[number]): Approval => ({
      provisional: r.provisional,
      approvedBy: r.approvedBy,
      approvedByName: r.approvedBy ? (names.get(r.approvedBy) ?? null) : null,
      approvedAt: iso(r.approvedAt),
    });
  }

  /** `approved: true` → approved by the caller now; false → back to provisional; omitted → unchanged. */
  private approvalPatch(actor: Actor, approved: boolean | undefined, at: Date) {
    if (approved === undefined) return {};
    return approved
      ? { provisional: false, approvedBy: actor.userId, approvedAt: at }
      : { provisional: true, approvedBy: null, approvedAt: null };
  }

  private static approvalSnapshot(r: { provisional: boolean; approvedBy: string | null }) {
    return { provisional: r.provisional, approvedBy: r.approvedBy };
  }

  private static checkVersion(row: { version: number } | undefined, version: number, what: string) {
    if (!row) throw new ServiceProblem(404, 'not_found', `${what} not found`);
    if (row.version !== version) {
      throw new ServiceProblem(
        409,
        CODES.stale,
        `${what} was changed by someone else (now version ${row.version}). Reload and re-apply your change.`,
        { currentVersion: row.version },
      );
    }
  }

  private static unwrap<T>(result: VersionedUpdate<T>, what: string): T {
    if (result.ok) return result.row;
    if (result.reason === 'missing')
      throw new ServiceProblem(404, 'not_found', `${what} not found`);
    throw new ServiceProblem(
      409,
      CODES.stale,
      `${what} was changed by someone else. Reload and re-apply your change.`,
    );
  }

  private static invalid(err: unknown): never {
    if (err instanceof DomainError) {
      throw new ServiceProblem(422, CODES.invalid, err.message, {
        errors: [{ path: '/', message: err.message }],
      });
    }
    throw err;
  }

  private static parseRules(rules: unknown[], where: string): RequiredRule[] {
    const parsed = z.array(requiredRuleSchema).safeParse(rules);
    if (!parsed.success) {
      throw new ServiceProblem(
        422,
        CODES.invalid,
        `${where}: the required-field rules are invalid`,
        {
          errors: parsed.error.issues.map((i) => ({
            path: `/requiredFields/${i.path.join('/')}`,
            message: i.message,
          })),
        },
      );
    }
    return parsed.data;
  }

  /** The whole workflow config must still parse after a change (inside the change's transaction). */
  private static async assertWorkflowValid(tx: Tx) {
    try {
      parseWorkflowConfig(await loadWorkflowConfigInput(tx));
    } catch (err) {
      AdminConfigService.invalid(err);
    }
  }

  private async audit(
    tx: Tx,
    actor: Actor,
    meta: AuditMeta,
    entry: {
      entity: string;
      entityId: string;
      before: Snapshot | null;
      after: Snapshot | null;
      changeReason: string;
      at: Date;
    },
  ) {
    await recordAudit(tx, actor, meta, { action: 'config_change', ...entry });
  }

  /** Run a write; on commit, invalidate caches. */
  private async write<T>(withTx: AdminWithTx, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const out = await withTx(fn);
    this.opts.onConfigChange?.();
    return out;
  }

  // ── Value lists ────────────────────────────────────────────────────────────────────────────

  private static valueSnapshot(r: ValueListRow): Snapshot {
    return {
      ref: `${r.listKey}/${r.code}`,
      label: r.label,
      sort: r.sort,
      active: r.active,
      ...AdminConfigService.approvalSnapshot(r),
    };
  }

  async valueLists(withTx: AdminWithTx): Promise<AdminValueListsResponse> {
    return withTx(async (tx) => {
      const rows = await listAllValueLists(tx);
      const approval = await this.approvals(tx, rows);
      return {
        listKeys: [...VALUE_LIST_KEYS],
        items: rows.map((r) => ({
          id: r.id,
          version: r.version,
          updatedAt: r.updatedAt.toISOString(),
          listKey: r.listKey,
          code: r.code,
          label: r.label,
          sort: r.sort,
          active: r.active,
          meta: (r.meta ?? {}) as Record<string, unknown>,
          approval: approval(r),
        })),
      };
    });
  }

  async createValueListEntry(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    body: CreateValueListEntryBody,
  ) {
    if (!(VALUE_LIST_KEYS as readonly string[]).includes(body.listKey)) {
      throw new ServiceProblem(422, CODES.invalid, `Unknown value list ${body.listKey}`);
    }
    const at = this.now();
    return this.write(withTx, async (tx) => {
      const exists = (await listAllValueLists(tx)).some(
        (r) => r.listKey === body.listKey && r.code === body.code,
      );
      if (exists) {
        throw new ServiceProblem(
          409,
          CODES.duplicate,
          `${body.listKey} already has the code ${body.code}. Rename or reactivate it instead.`,
        );
      }
      const row = await insertValueListEntry(tx, {
        listKey: body.listKey,
        code: body.code,
        label: body.label,
        sort: await nextSort(tx, schema.valueList, eq(schema.valueList.listKey, body.listKey)),
        provisional: true,
        createdBy: actor.userId,
      });
      await this.audit(tx, actor, meta, {
        entity: 'value_list',
        entityId: row.id,
        before: null,
        after: AdminConfigService.valueSnapshot(row),
        changeReason: body.changeReason,
        at,
      });
      return { id: row.id };
    });
  }

  async updateValueListEntry(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    id: string,
    body: UpdateValueListEntryBody,
  ) {
    const at = this.now();
    return this.write(withTx, async (tx) => {
      const before = await findById(tx, schema.valueList, id);
      AdminConfigService.checkVersion(before, body.version, 'The value');
      if (before!.active && body.active === false && !body.confirmInUse) {
        const usage = await openQuotesUsingValue(tx, before!.listKey as ValueListKey, before!.code);
        if (usage.count > 0) {
          throw new ServiceProblem(
            409,
            CODES.inUse,
            `${usage.count} open quote(s) use ${before!.label}. They keep the value; it just stops being offered. Confirm to deactivate.`,
            usage,
          );
        }
      }
      const row = AdminConfigService.unwrap(
        await updateVersioned(tx, schema.valueList, id, body.version, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...this.approvalPatch(actor, body.approved, at),
        }),
        'The value',
      );
      await this.audit(tx, actor, meta, {
        entity: 'value_list',
        entityId: id,
        before: AdminConfigService.valueSnapshot(before!),
        after: AdminConfigService.valueSnapshot(row),
        changeReason: body.changeReason,
        at,
      });
      return { id, version: row.version };
    });
  }

  /** New display order for one list or reason context. Every row must be listed at its current version. */
  private async reorder<
    R extends { id: string; version: number; sort: number },
    T extends typeof schema.valueList | typeof schema.reasonCode,
  >(
    tx: Tx,
    actor: Actor,
    meta: AuditMeta,
    table: T,
    group: { entity: string; ref: string; rows: R[] },
    body: ReorderBody,
    at: Date,
  ) {
    const ids = body.items.map((i) => i.id);
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== group.rows.length ||
      !group.rows.every((r) => ids.includes(r.id))
    ) {
      throw new ServiceProblem(
        409,
        CODES.stale,
        `The ${group.ref} list changed since you loaded it (entries added or removed). Reload and reorder again.`,
      );
    }
    const byId = new Map(group.rows.map((r) => [r.id, r]));
    for (const item of body.items) {
      AdminConfigService.checkVersion(byId.get(item.id), item.version, 'An entry');
    }
    const before = [...group.rows].sort((a, b) => a.sort - b.sort).map((r) => r.id);
    let i = 0;
    for (const item of body.items) {
      i += 10;
      if (byId.get(item.id)!.sort === i) continue;
      AdminConfigService.unwrap(
        await updateVersioned(tx, table, item.id, item.version, { sort: i } as never),
        'An entry',
      );
    }
    const codeOf = (id: string) => (byId.get(id) as unknown as { code: string }).code;
    await this.audit(tx, actor, meta, {
      entity: group.entity,
      entityId: group.ref,
      before: { ref: `${group.ref} (order)`, order: before.map(codeOf) },
      after: { ref: `${group.ref} (order)`, order: ids.map(codeOf) },
      changeReason: body.changeReason,
      at,
    });
  }

  async reorderValueList(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    listKey: string,
    body: ReorderBody,
  ) {
    const at = this.now();
    return this.write(withTx, async (tx) => {
      const rows = (await listAllValueLists(tx)).filter((r) => r.listKey === listKey);
      if (rows.length === 0) throw new ServiceProblem(404, 'not_found', `No list ${listKey}`);
      await this.reorder(
        tx,
        actor,
        meta,
        schema.valueList,
        { entity: 'value_list', ref: listKey, rows },
        body,
        at,
      );
      return { ok: true as const };
    });
  }

  // ── Reason codes ───────────────────────────────────────────────────────────────────────────

  private static reasonSnapshot(r: ReasonCodeRow): Snapshot {
    return {
      ref: `${r.context}/${r.code}`,
      label: r.label,
      sort: r.sort,
      active: r.active,
      requiresNote: r.requiresNote,
      ...AdminConfigService.approvalSnapshot(r),
    };
  }

  async reasonCodes(withTx: AdminWithTx): Promise<AdminReasonCodesResponse> {
    return withTx(async (tx) => {
      const rows = await listAllReasonCodes(tx);
      const approval = await this.approvals(tx, rows);
      return {
        contexts: [...REASON_CONTEXTS],
        items: rows.map((r) => ({
          id: r.id,
          version: r.version,
          updatedAt: r.updatedAt.toISOString(),
          context: r.context,
          code: r.code,
          label: r.label,
          sort: r.sort,
          active: r.active,
          requiresNote: r.requiresNote,
          approval: approval(r),
        })),
      };
    });
  }

  async createReasonCode(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    body: CreateReasonCodeBody,
  ) {
    if (!(REASON_CONTEXTS as readonly string[]).includes(body.context)) {
      throw new ServiceProblem(422, CODES.invalid, `Unknown reason context ${body.context}`);
    }
    const at = this.now();
    return this.write(withTx, async (tx) => {
      const exists = (await listAllReasonCodes(tx)).some(
        (r) => r.context === body.context && r.code === body.code,
      );
      if (exists) {
        throw new ServiceProblem(
          409,
          CODES.duplicate,
          `${body.context} already has the code ${body.code}. Rename or reactivate it instead.`,
        );
      }
      const row = await insertReasonCode(tx, {
        context: body.context,
        code: body.code,
        label: body.label,
        requiresNote: body.requiresNote ?? false,
        sort: await nextSort(tx, schema.reasonCode, eq(schema.reasonCode.context, body.context)),
        provisional: true,
        createdBy: actor.userId,
      });
      await this.audit(tx, actor, meta, {
        entity: 'reason_code',
        entityId: row.id,
        before: null,
        after: AdminConfigService.reasonSnapshot(row),
        changeReason: body.changeReason,
        at,
      });
      return { id: row.id };
    });
  }

  async updateReasonCode(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    id: string,
    body: UpdateReasonCodeBody,
  ) {
    const at = this.now();
    return this.write(withTx, async (tx) => {
      const before = await findById(tx, schema.reasonCode, id);
      AdminConfigService.checkVersion(before, body.version, 'The reason code');
      const row = AdminConfigService.unwrap(
        await updateVersioned(tx, schema.reasonCode, id, body.version, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.requiresNote !== undefined ? { requiresNote: body.requiresNote } : {}),
          ...this.approvalPatch(actor, body.approved, at),
        }),
        'The reason code',
      );
      // E.g. deactivating the last active code an outcome requires breaks the workflow: refuse.
      await AdminConfigService.assertWorkflowValid(tx);
      await this.audit(tx, actor, meta, {
        entity: 'reason_code',
        entityId: id,
        before: AdminConfigService.reasonSnapshot(before!),
        after: AdminConfigService.reasonSnapshot(row),
        changeReason: body.changeReason,
        at,
      });
      return { id, version: row.version };
    });
  }

  async reorderReasonCodes(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    context: string,
    body: ReorderBody,
  ) {
    const at = this.now();
    return this.write(withTx, async (tx) => {
      const rows = (await listAllReasonCodes(tx)).filter((r) => r.context === context);
      if (rows.length === 0) throw new ServiceProblem(404, 'not_found', `No context ${context}`);
      await this.reorder(
        tx,
        actor,
        meta,
        schema.reasonCode,
        { entity: 'reason_code', ref: context, rows },
        body,
        at,
      );
      return { ok: true as const };
    });
  }

  // ── Workflow labels and rules ──────────────────────────────────────────────────────────────

  async workflow(withTx: AdminWithTx): Promise<AdminWorkflowResponse> {
    return withTx(async (tx) => {
      const [stages, gates, outcomes, g1] = await Promise.all([
        listStageRows(tx),
        listGateRows(tx),
        listOutcomeRows(tx),
        findSettingByKey(tx, 'g1_enabled'),
      ]);
      const approval = await this.approvals(tx, [...stages, ...gates, ...outcomes]);
      const used = [...gates, ...outcomes].flatMap((r) =>
        (r.requiredFields as RequiredRule[]).flatMap(fieldsReferenced),
      );
      const base = (r: { id: string; version: number; updatedAt: Date }) => ({
        id: r.id,
        version: r.version,
        updatedAt: r.updatedAt.toISOString(),
      });
      return {
        stages: stages.map((s) => ({
          ...base(s),
          key: s.key,
          label: s.label,
          helpText: s.helpText,
          ownerRole: s.ownerRole,
          terminal: s.terminal,
          sort: s.sort,
          approval: approval(s),
        })),
        gates: gates.map((g) => ({
          ...base(g),
          key: g.key,
          stageKey: g.stageKey,
          label: g.label,
          helpText: g.helpText,
          deciderPermission: g.deciderPermission,
          enabled: g.enabled,
          requiredFields: g.requiredFields as unknown[],
          sort: g.sort,
          approval: approval(g),
        })),
        outcomes: outcomes.map((o) => ({
          ...base(o),
          gateKey: o.gateKey,
          key: o.key,
          label: o.label,
          helpText: o.helpText,
          requiresNote: o.requiresNote,
          requiresReasonCode: o.requiresReasonCode,
          reasonContext: o.reasonContext,
          requiredFields: o.requiredFields as unknown[],
          sort: o.sort,
          approval: approval(o),
        })),
        ruleFields: [...new Set([...used, ...INTAKE_FIELDS])].sort(),
        g1Enabled: g1 ? { value: g1.value === true, version: g1.version, id: g1.id } : null,
      };
    });
  }

  private static workflowSnapshot(
    ref: string,
    r: {
      label: string;
      helpText: string | null;
      provisional: boolean;
      approvedBy: string | null;
      requiresNote?: boolean;
      requiresReasonCode?: boolean;
      requiredFields?: unknown;
    },
  ): Snapshot {
    return {
      ref,
      label: r.label,
      helpText: r.helpText,
      ...(r.requiresNote !== undefined ? { requiresNote: r.requiresNote } : {}),
      ...(r.requiresReasonCode !== undefined ? { requiresReasonCode: r.requiresReasonCode } : {}),
      ...(r.requiredFields !== undefined ? { requiredFields: r.requiredFields } : {}),
      ...AdminConfigService.approvalSnapshot(r),
    };
  }

  async updateStage(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    key: string,
    body: UpdateStageBody,
  ) {
    const at = this.now();
    return this.write(withTx, async (tx) => {
      const before = (await listStageRows(tx)).find((s) => s.key === key);
      AdminConfigService.checkVersion(before, body.version, `Stage ${key}`);
      const row = AdminConfigService.unwrap(
        await updateVersioned(tx, schema.stageDefinition, before!.id, body.version, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.helpText !== undefined ? { helpText: body.helpText || null } : {}),
          ...this.approvalPatch(actor, body.approved, at),
        }),
        `Stage ${key}`,
      );
      await this.audit(tx, actor, meta, {
        entity: 'stage_definition',
        entityId: before!.id,
        before: AdminConfigService.workflowSnapshot(key, before!),
        after: AdminConfigService.workflowSnapshot(key, row),
        changeReason: body.changeReason,
        at,
      });
      return { id: row.id, version: row.version };
    });
  }

  async updateGate(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    key: string,
    body: UpdateGateBody,
  ) {
    const at = this.now();
    const rules =
      body.requiredFields !== undefined
        ? AdminConfigService.parseRules(body.requiredFields, `Gate ${key}`)
        : undefined;
    return this.write(withTx, async (tx) => {
      const before = await findGateByKey(tx, key);
      AdminConfigService.checkVersion(before, body.version, `Gate ${key}`);
      const row = AdminConfigService.unwrap(
        await updateVersioned(tx, schema.gateDefinition, before!.id, body.version, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.helpText !== undefined ? { helpText: body.helpText || null } : {}),
          ...(rules !== undefined ? { requiredFields: rules } : {}),
          ...this.approvalPatch(actor, body.approved, at),
        }),
        `Gate ${key}`,
      );
      await AdminConfigService.assertWorkflowValid(tx);
      await this.audit(tx, actor, meta, {
        entity: 'gate_definition',
        entityId: before!.id,
        before: AdminConfigService.workflowSnapshot(key, before!),
        after: AdminConfigService.workflowSnapshot(key, row),
        changeReason: body.changeReason,
        at,
      });
      return { id: row.id, version: row.version };
    });
  }

  async updateOutcome(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    gateKey: string,
    key: string,
    body: UpdateOutcomeBody,
  ) {
    const at = this.now();
    const ref = `${gateKey}/${key}`;
    const rules =
      body.requiredFields !== undefined
        ? AdminConfigService.parseRules(body.requiredFields, `Outcome ${ref}`)
        : undefined;
    return this.write(withTx, async (tx) => {
      const before = (await listOutcomeRows(tx)).find(
        (o) => o.gateKey === gateKey && o.key === key,
      );
      AdminConfigService.checkVersion(before, body.version, `Outcome ${ref}`);
      const row = AdminConfigService.unwrap(
        await updateVersioned(tx, schema.gateOutcomeDefinition, before!.id, body.version, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.helpText !== undefined ? { helpText: body.helpText || null } : {}),
          ...(body.requiresNote !== undefined ? { requiresNote: body.requiresNote } : {}),
          ...(body.requiresReasonCode !== undefined
            ? { requiresReasonCode: body.requiresReasonCode }
            : {}),
          ...(rules !== undefined ? { requiredFields: rules } : {}),
          ...this.approvalPatch(actor, body.approved, at),
        }),
        `Outcome ${ref}`,
      );
      // E.g. a closing outcome must keep requiring a reason code (B-13): the domain validator says no.
      await AdminConfigService.assertWorkflowValid(tx);
      await this.audit(tx, actor, meta, {
        entity: 'gate_outcome_definition',
        entityId: before!.id,
        before: AdminConfigService.workflowSnapshot(ref, before!),
        after: AdminConfigService.workflowSnapshot(ref, row),
        changeReason: body.changeReason,
        at,
      });
      return { id: row.id, version: row.version };
    });
  }

  // ── App settings ───────────────────────────────────────────────────────────────────────────

  async settings(withTx: AdminWithTx): Promise<AdminSettingsResponse> {
    return withTx(async (tx) => {
      const rows = await listSettings(tx);
      const approval = await this.approvals(tx, rows);
      return {
        groups: [...SETTING_GROUPS],
        items: rows.map((r) => {
          const s = settingSpec(r.key);
          return {
            id: r.id,
            version: r.version,
            updatedAt: r.updatedAt.toISOString(),
            key: r.key,
            value: r.value ?? null,
            description: r.description,
            group: s.group,
            label: s.label,
            editor: s.editor,
            ...(s.options ? { options: [...s.options] } : {}),
            nullable: s.nullable ?? false,
            approval: approval(r),
          };
        }),
      };
    });
  }

  async updateSetting(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    key: string,
    body: UpdateSettingBody,
  ) {
    const at = this.now();
    let value: unknown;
    if (body.value !== undefined) {
      try {
        value = parseSettingValue(key, body.value);
      } catch (err) {
        AdminConfigService.invalid(err);
      }
    }
    return this.write(withTx, async (tx) => {
      const before = await findSettingByKey(tx, key);
      AdminConfigService.checkVersion(before, body.version, `Setting ${key}`);
      const snap = (r: { value: unknown; provisional: boolean; approvedBy: string | null }) => ({
        ref: key,
        value: r.value ?? null,
        ...AdminConfigService.approvalSnapshot(r),
      });
      if (key === 'g1_enabled' && value !== undefined && value !== before!.value) {
        await this.syncG1Gates(tx, value === true, body.confirm === true);
      }
      const row = AdminConfigService.unwrap(
        await updateVersioned(tx, schema.appSetting, before!.id, body.version, {
          ...(value !== undefined ? { value } : {}),
          ...this.approvalPatch(actor, body.approved, at),
        }),
        `Setting ${key}`,
      );
      await this.audit(tx, actor, meta, {
        entity: 'app_setting',
        entityId: before!.id,
        before: snap(before!),
        after: snap(row),
        changeReason: body.changeReason,
        at,
      });
      return { id: row.id, version: row.version };
    });
  }

  /**
   * `g1_enabled` drives two gates on INTAKE: G1 (qualify) when on, SUBMIT (straight to Engineering)
   * when off. Both rows exist in the seed, so the toggle flips `enabled` only: no stage or transition
   * changes. Quotes already waiting at G1 would be stranded, so turning it off asks for confirmation.
   */
  private async syncG1Gates(tx: Tx, enabled: boolean, confirmed: boolean) {
    const [g1, submit] = await Promise.all([findGateByKey(tx, 'G1'), findGateByKey(tx, 'SUBMIT')]);
    if (!g1 || !submit) {
      throw new ServiceProblem(
        422,
        CODES.invalid,
        'g1_enabled needs both the G1 and SUBMIT gates in the workflow config',
      );
    }
    if (!enabled && !confirmed) {
      const waiting = await countSubmittedOpenQuotesInStage(tx, g1.stageKey);
      if (waiting > 0) {
        throw new ServiceProblem(
          409,
          CODES.confirmRequired,
          `${waiting} submitted quote(s) are waiting at G1. With G1 off nobody can decide them until it is turned back on. Confirm to continue.`,
          { waiting },
        );
      }
    }
    await updateVersioned(tx, schema.gateDefinition, g1.id, g1.version, { enabled });
    await updateVersioned(tx, schema.gateDefinition, submit.id, submit.version, {
      enabled: !enabled,
    });
    await AdminConfigService.assertWorkflowValid(tx);
  }

  // ── Scoring model ──────────────────────────────────────────────────────────────────────────

  private static modelBody(row: ScoringModelVersionRow): ScoringModelBody {
    const input = scoringModelInputFromRow(row);
    return {
      attributes: input.attributes,
      tiers: input.tiers,
      unknownScore: input.unknownScore ?? 50,
    };
  }

  private static scoringSnapshot(row: ScoringModelVersionRow): Snapshot {
    const body = AdminConfigService.modelBody(row);
    const attributes = body.attributes as { key: string; weight: number }[];
    return {
      ref: `v${row.modelVersion}`,
      effectiveFrom: iso(row.effectiveFrom),
      weights: Object.fromEntries(attributes.map((a) => [a.key, a.weight])),
      attributes: body.attributes,
      tiers: body.tiers,
      unknownScore: body.unknownScore,
      ...AdminConfigService.approvalSnapshot(row),
    };
  }

  private parseModel(version: number, body: ScoringModelBody): ScoringModel {
    try {
      return parseScoringModel({ version, provisional: true, ...body });
    } catch (err) {
      AdminConfigService.invalid(err);
    }
  }

  async scoring(withTx: AdminWithTx): Promise<AdminScoringResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const rows = await listScoringModels(tx);
      const approval = await this.approvals(tx, rows);
      const creators = await listUsersByIds(tx, [
        ...new Set(rows.map((r) => r.createdBy).filter((v): v is string => !!v)),
      ]);
      const names = new Map(creators.map((u) => [u.id, u.displayName]));
      const active = rows.find((r) => r.effectiveFrom && r.effectiveFrom <= now);
      return {
        versions: rows.map((r) => this.versionDto(r, active, approval, names, now)),
        inputs: Object.keys(INPUT_RESOLVERS).sort(),
      };
    });
  }

  private versionDto(
    r: ScoringModelVersionRow,
    active: ScoringModelVersionRow | undefined,
    approval: (r: ScoringModelVersionRow) => Approval,
    names: Map<string, string>,
    now: Date,
  ): AdminScoringVersion {
    const status = !r.effectiveFrom
      ? 'draft'
      : r.effectiveFrom > now
        ? 'scheduled'
        : r.id === active?.id
          ? 'active'
          : 'superseded';
    return {
      id: r.id,
      version: r.version,
      updatedAt: r.updatedAt.toISOString(),
      modelVersion: r.modelVersion,
      status,
      effectiveFrom: iso(r.effectiveFrom),
      changeReason: r.changeReason,
      createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
      model: AdminConfigService.modelBody(r),
      approval: approval(r),
    };
  }

  /** "Create new version": clone the active model into the (single) draft. */
  async createScoringDraft(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    body: CreateScoringDraftBody,
  ) {
    const at = this.now();
    return this.write(withTx, async (tx) => {
      if (await findScoringDraft(tx)) {
        throw new ServiceProblem(
          409,
          CODES.draftExists,
          'A draft version already exists. Edit it, activate it or discard it first.',
        );
      }
      const active = await getScoringModel(tx, at);
      if (!active) throw new ServiceProblem(422, CODES.invalid, 'There is no active model to copy');
      const modelVersion = await nextScoringModelVersion(tx);
      const source = scoringModelInputFromRow(active);
      const row = await insertScoringModel(tx, {
        ...scoringModelRow(
          { ...source, version: modelVersion },
          { effectiveFrom: at, changeReason: body.changeReason },
        ),
        effectiveFrom: null,
        provisional: true,
        createdBy: actor.userId,
      });
      await this.audit(tx, actor, meta, {
        entity: 'scoring_model',
        entityId: row.id,
        before: null,
        after: {
          ...AdminConfigService.scoringSnapshot(row),
          copiedFrom: `v${active.modelVersion}`,
        },
        changeReason: body.changeReason,
        at,
      });
      return { id: row.id, modelVersion };
    });
  }

  async updateScoringDraft(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    body: UpdateScoringDraftBody,
  ) {
    const at = this.now();
    return this.write(withTx, async (tx) => {
      const before = await findScoringDraft(tx);
      if (!before) throw new ServiceProblem(404, CODES.noDraft, 'There is no draft version');
      AdminConfigService.checkVersion(before, body.version, 'The draft');
      const model = this.parseModel(before.modelVersion, body.model);
      const fields = scoringModelRow(model, { effectiveFrom: at, changeReason: '' });
      const row = AdminConfigService.unwrap(
        await updateVersioned(tx, schema.scoringModel, before.id, body.version, {
          attributes: fields.attributes,
          tierThresholds: fields.tierThresholds,
        }),
        'The draft',
      );
      await this.audit(tx, actor, meta, {
        entity: 'scoring_model',
        entityId: row.id,
        before: AdminConfigService.scoringSnapshot(before),
        after: AdminConfigService.scoringSnapshot(row),
        changeReason: body.changeReason,
        at,
      });
      return { id: row.id, version: row.version };
    });
  }

  async discardScoringDraft(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    body: { version: number; changeReason: string },
  ) {
    const at = this.now();
    return this.write(withTx, async (tx) => {
      const before = await findScoringDraft(tx);
      if (!before) throw new ServiceProblem(404, CODES.noDraft, 'There is no draft version');
      AdminConfigService.checkVersion(before, body.version, 'The draft');
      if (!(await deleteScoringDraft(tx, before.id, body.version))) {
        throw new ServiceProblem(409, CODES.stale, 'The draft changed. Reload and try again.');
      }
      await this.audit(tx, actor, meta, {
        entity: 'scoring_model',
        entityId: before.id,
        before: AdminConfigService.scoringSnapshot(before),
        after: null,
        changeReason: body.changeReason,
        at,
      });
      return { ok: true as const };
    });
  }

  /**
   * Scores the newest quotes under the active model and `body` (unsaved edits), compares tiers and
   * ranks. Writes nothing.
   */
  async previewScoring(
    withTx: AdminWithTx,
    body: ScoringModelBody,
  ): Promise<ScoringPreviewResponse> {
    const now = this.now();
    const draft = this.parseModel(1, body);
    return withTx(async (tx) => {
      const [activeRow, recent] = await Promise.all([
        getScoringModel(tx, now),
        recentQuotesForPreview(tx, SCORING_PREVIEW_QUOTES),
      ]);
      const current = activeRow
        ? (() => {
            try {
              return parseScoringModel(scoringModelInputFromRow(activeRow));
            } catch {
              return null;
            }
          })()
        : null;
      const facts = await loadScoringFactsMany(
        tx,
        recent.map((q) => q.id),
      );
      const preview = previewScoringChange(
        current,
        draft,
        recent.map((q) => ({ id: q.id, facts: facts.get(q.id) ?? {} })),
        now,
      );
      const byId = new Map(recent.map((q) => [q.id, q]));
      return {
        activeVersion: activeRow?.modelVersion ?? null,
        rows: preview.rows.map((r) => {
          const q = byId.get(r.quoteId)!;
          return {
            quoteNumber: q.quoteNumber,
            stageKey: q.stageKey,
            status: q.status,
            before: r.before,
            after: r.after,
            tierChanged: r.tierChanged,
            rankDelta: r.rankDelta,
          };
        }),
        summary: preview.summary,
      };
    });
  }

  /**
   * Activate the draft: `effective_from = now`, so it scores from now on. Then (after the commit) a
   * background job rescores OPEN quotes only, one `priority_tier_changed` activity event per changed
   * tier. Closed quotes, gate-decision evidence and old versions are never touched.
   */
  async activateScoringDraft(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    body: ActivateScoringDraftBody,
  ): Promise<ActivateScoringResponse> {
    const at = this.now();
    const { response, quoteIds } = await this.write(withTx, async (tx) => {
      const before = await findScoringDraft(tx);
      if (!before) throw new ServiceProblem(404, CODES.noDraft, 'There is no draft version');
      AdminConfigService.checkVersion(before, body.version, 'The draft');
      this.parseModel(before.modelVersion, AdminConfigService.modelBody(before));
      const row = AdminConfigService.unwrap(
        await updateVersioned(tx, schema.scoringModel, before.id, body.version, {
          effectiveFrom: at,
          changeReason: body.changeReason,
        }),
        'The draft',
      );
      const ids = await openQuoteIds(tx);
      await this.audit(tx, actor, meta, {
        entity: 'scoring_model',
        entityId: row.id,
        before: AdminConfigService.scoringSnapshot(before),
        after: { ...AdminConfigService.scoringSnapshot(row), rescoreQueued: ids.length },
        changeReason: body.changeReason,
        at,
      });
      const approval = await this.approvals(tx, [row]);
      return {
        response: {
          version: this.versionDto(row, row, approval, new Map(), at),
          rescoreQueued: ids.length,
        },
        quoteIds: ids,
      };
    });
    this.rescore.queue(actor, meta, {
      quoteIds,
      modelVersion: response.version.modelVersion,
      changeReason: body.changeReason,
    });
    return response;
  }

  // ── Users and scope ────────────────────────────────────────────────────────────────────────

  async users(withTx: AdminWithTx): Promise<AdminUsersResponse> {
    return withTx(async (tx) => {
      const [rows, defaultScope, roleChangeUrl] = await Promise.all([
        listUsersForAdmin(tx),
        getSetting(tx, 'default_scope_type'),
        getSetting<string | null>(tx, 'role_change_request_url'),
      ]);
      const fallback = defaultScope === 'owner' ? 'owner' : 'all';
      return {
        items: rows.map((u): AdminUser => ({
          id: u.id,
          displayName: u.displayName,
          upn: u.upn,
          email: u.email,
          region: u.region,
          active: u.active,
          lastSeenAt: iso(u.lastSeenAt),
          roles: u.roles,
          scope: {
            type: (u.scopeType ?? fallback) as AdminUser['scope']['type'],
            values: u.scopeValues ?? [],
          },
          scopeExplicit: u.scopeType !== null,
          scopeVersion: u.scopeVersion,
        })),
        roleChangeUrl: roleChangeUrl ?? '',
      };
    });
  }

  async updateUserScope(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    userId: string,
    body: z.output<typeof UpdateUserScopeBody>,
  ) {
    const at = this.now();
    const values = body.type === 'region' || body.type === 'account_list' ? body.values : [];
    await this.write(withTx, async (tx) => {
      const user = await findUserById(tx, userId);
      if (!user) throw new ServiceProblem(404, 'not_found', 'User not found');
      const before = await findUserScopeRow(tx, userId);
      if ((before?.version ?? null) !== body.version) {
        throw new ServiceProblem(
          409,
          CODES.stale,
          `${user.displayName}'s scope was changed by someone else. Reload and re-apply your change.`,
          { currentVersion: before?.version ?? null },
        );
      }
      const result = await writeUserScope(
        tx,
        userId,
        body.version,
        { scopeType: body.type, values },
        actor.userId,
      );
      if (result === 'stale') {
        throw new ServiceProblem(409, CODES.stale, 'The scope changed. Reload and try again.');
      }
      const ref = `${user.displayName} (${user.upn})`;
      await this.audit(tx, actor, meta, {
        entity: 'user_scope',
        entityId: userId,
        before: before ? { ref, type: before.scopeType, values: before.values } : null,
        after: { ref, type: body.type, values },
        changeReason: body.changeReason,
        at,
      });
    });
    this.opts.onScopeChange?.();
    return { ok: true as const };
  }

  // ── Connector health ───────────────────────────────────────────────────────────────────────

  async connectorHealth(withTx: AdminWithTx): Promise<ConnectorHealthResponse> {
    const rows = await withTx((tx) => integrationHealth(tx));
    const bySource = new Map(rows.map((r) => [r.source, r]));
    const date = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
    return {
      items: Object.entries(this.opts.connectorModes).map(([source, mode]) => {
        const r = bySource.get(source);
        const health = !r
          ? 'unknown'
          : r.status === 'failed'
            ? 'down'
            : r.status === 'partial' || r.failures_24h > 0
              ? 'degraded'
              : 'ok';
        return {
          source,
          mode,
          health,
          lastRunAt: r ? date(r.started_at) : null,
          lastStatus: r?.status ?? null,
          lastSuccessAt: r ? date(r.last_success_at) : null,
          failures24h: r?.failures_24h ?? 0,
          lastError: r?.error ?? null,
        };
      }),
    };
  }

  // ── Decision log (minimal F-21) ────────────────────────────────────────────────────────────

  private static entry(r: Awaited<ReturnType<typeof searchAuditEvents>>[number]): DecisionLogEntry {
    const e = r.event;
    const before = (e.before ?? null) as Snapshot | null;
    const after = (e.after ?? null) as Snapshot | null;
    const strip = (s: Snapshot | null) => {
      if (!s) return null;
      const { ref: _ref, ...rest } = s;
      return rest;
    };
    const ref = after?.ref ?? before?.ref ?? e.entityId ?? '';
    // A row without an entity id is a system follow-up (the rescore summary), not a created row.
    const what = !e.entityId ? '' : !before ? ' (created)' : !after ? ' (removed)' : '';
    return {
      id: e.id,
      at: e.at.toISOString(),
      actorName: r.actorName ?? null,
      actorUpn: r.actorUpn ?? null,
      entity: e.entity,
      entityId: e.entityId,
      subject: `${ENTITY_LABEL[e.entity] ?? e.entity}: ${ref}${what}`,
      changeReason: e.changeReason,
      // Created / removed rows diff against {} so each field is listed.
      changes: configDiff(strip(before) ?? {}, strip(after) ?? {}),
    };
  }

  private search(
    tx: Tx,
    q: DecisionLogQuery,
    extra: { before?: { at: Date; id: string }; limit: number },
  ) {
    const addDay = (day: string) =>
      new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    return searchAuditEvents(tx, {
      action: 'config_change',
      entity: q.entity,
      from: q.from ? startOfDay(q.from, REPORT_TIME_ZONE) : undefined,
      to: q.to ? startOfDay(addDay(q.to), REPORT_TIME_ZONE) : undefined,
      ...extra,
    });
  }

  async decisionLog(withTx: AdminWithTx, q: DecisionLogQuery): Promise<DecisionLogResponse> {
    const before = q.cursor ? decodeCursor(q.cursor) : undefined;
    if (before === null) throw new ServiceProblem(400, 'bad_cursor', 'The cursor is not valid');
    return withTx(async (tx) => {
      const rows = await this.search(tx, q, { ...(before ? { before } : {}), limit: q.limit + 1 });
      const { items, nextCursor } = page(rows, q.limit, (r) => ({
        at: r.event.at,
        id: r.event.id,
      }));
      return { items: items.map((r) => AdminConfigService.entry(r)), nextCursor };
    });
  }

  /** The decision log as CSV (one row per change; capped). The export is audited. */
  async decisionLogCsv(
    withTx: AdminWithTx,
    actor: Actor,
    meta: AuditMeta,
    q: DecisionLogQuery,
  ): Promise<{ csv: string; truncated: boolean; fileName: string }> {
    const at = this.now();
    return withTx(async (tx) => {
      const rows = await this.search(tx, q, { limit: DECISION_LOG_EXPORT_MAX_ROWS + 1 });
      const truncated = rows.length > DECISION_LOG_EXPORT_MAX_ROWS;
      const entries = rows
        .slice(0, DECISION_LOG_EXPORT_MAX_ROWS)
        .map((r) => AdminConfigService.entry(r));
      const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
      const header = ['When (UTC)', 'Who', 'Email', 'What', 'Why', 'Changes'];
      const lines = [
        header.join(','),
        ...entries.map((e) =>
          [
            e.at,
            e.actorName,
            e.actorUpn,
            e.subject,
            e.changeReason,
            e.changes
              .map((c) => `${c.path || '(value)'}: ${fmt(c.before)} → ${fmt(c.after)}`)
              .join('; '),
          ]
            .map(csvCell)
            .join(','),
        ),
      ];
      await recordAudit(tx, actor, meta, {
        at,
        action: 'export',
        entity: 'decision_log',
        after: { format: 'csv', filters: q, rows: entries.length, truncated },
      });
      return {
        csv: `${lines.join('\r\n')}\r\n`,
        truncated,
        fileName: `ccq-decision-log-${dayIn(at, REPORT_TIME_ZONE)}.csv`,
      };
    });
  }
}

/**
 * Background rescore after a scoring model activation: open quotes in batches, each batch its own
 * transaction as the activating admin (RLS: Admin sees every quote). Recalculation stores the new score
 * and writes a `priority_tier_changed` activity event when the computed tier moves. A summary
 * `config_change` row records how many quotes were rescored and how many tiers changed.
 */
export class ScoringRescoreJob {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly scoring: ScoringService,
    private readonly database: Database | undefined,
    private readonly log: AdminConfigServiceOptions['log'],
    private readonly now: () => Date,
  ) {}

  queue(
    actor: Actor,
    meta: AuditMeta,
    job: { quoteIds: string[]; modelVersion: number; changeReason: string },
  ): void {
    const database = this.database;
    if (!database) return;
    const run = this.run(database, actor, meta, job).catch((err: unknown) => {
      this.log.error({ err, modelVersion: job.modelVersion }, 'scoring rescore failed');
    });
    this.pending.add(run);
    void run.finally(() => this.pending.delete(run));
  }

  private async run(
    database: Database,
    actor: Actor,
    meta: AuditMeta,
    job: { quoteIds: string[]; modelVersion: number; changeReason: string },
  ) {
    let rescored = 0;
    let tierChanges = 0;
    let failed = 0;
    for (let i = 0; i < job.quoteIds.length; i += RESCORE_BATCH) {
      const batch = job.quoteIds.slice(i, i + RESCORE_BATCH);
      try {
        await withRequestContext(database, contextFromActor(actor), async (tx) => {
          for (const id of batch) {
            const result = await this.scoring.recalculate(
              tx,
              id,
              actor.userId,
              this.now(),
              'model_change',
            );
            if (result) {
              rescored += 1;
              if (result.tierChanged) tierChanges += 1;
            }
          }
        });
      } catch (err) {
        failed += batch.length;
        this.log.error({ err, modelVersion: job.modelVersion }, 'scoring rescore batch failed');
      }
    }
    await withRequestContext(database, contextFromActor(actor), (tx) =>
      recordAudit(tx, actor, meta, {
        at: this.now(),
        action: 'config_change',
        entity: 'scoring_model',
        entityId: null,
        before: null,
        after: {
          ref: `v${job.modelVersion} rescore`,
          rescored,
          tierChanges,
          failed,
        },
        changeReason: job.changeReason,
      }),
    );
    this.log.info(
      { modelVersion: job.modelVersion, rescored, tierChanges, failed },
      'open quotes rescored',
    );
  }

  /** Wait for queued rescores (tests, shutdown). */
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
}
