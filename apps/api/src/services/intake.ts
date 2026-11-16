import type {
  ActiveQuoteRef,
  IntakeDraft,
  IntakeDraftData,
  IntakeDraftListResponse,
  IntakeIssue,
  ReturnedQuoteSummary,
  SubmitIntakeResponse,
} from '@ccq/contracts';
import {
  draftItems,
  INTAKE_PROBLEM_CODES,
  intakeAddress as address,
  intakeValues,
  normalizeDraftData,
} from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import { schema, uuidv7 } from '@ccq/db';
import {
  deleteOpenQuoteDraft,
  findUserById,
  getActiveQuoteForOpportunity,
  getCustomerBySfAccountId,
  getLatestSubmittedDraft,
  getOpenReworkDraft,
  getQuoteById,
  getQuoteByNumber,
  getQuoteDraft,
  getQuoteDraftForUpdate,
  getSetting,
  getSfOpportunity,
  insertActivityEvent,
  insertAuditEvent,
  insertCustomer,
  insertQuote,
  insertQuoteDraft,
  listGateDecisionsWithNames,
  listOpenQuoteDrafts,
  listOpenQuotesOnOpportunity,
  lockOpportunityForSubmit,
  listReturnedQuotes,
  listActiveValueLists,
  listValueList,
  loadQuoteState,
  loadWorkflowConfigInput,
  persistTransition,
  resumeQuoteAtStage,
  updateQuote,
  updateQuoteDraft,
  type Quote,
  type QuoteDraftRow,
} from '@ccq/db/repos';
import {
  activeQuoteWarning,
  asksScopeChange,
  availableActions,
  decideActiveQuotes,
  evaluateIntake,
  intakeListValueIssues,
  parseOpportunityActiveQuoteMessage,
  parseOpportunityActiveQuotes,
  type OpportunityActiveQuotesMode,
  inapplicableIntakeFields,
  subMarketAfterMarketChange,
  ENG_QUEUE_STAGE_KEY,
  evaluateTransition,
  isSharedFunding,
  planResubmitRoute,
  PRICING_QUEUE_STAGE_KEY,
  INTAKE_LIST_FIELDS,
  INTAKE_SETTING_KEYS,
  intakeConfigFromSources,
  parseVolumeRouting,
  parseWorkflowConfig,
  routeByVolumeBand,
  workflowForRoute,
  type Actor,
  type IntakeConfig,
  type IntakeEvaluation,
  type WorkflowConfig,
} from '@ccq/domain';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import type { AttachmentService } from './attachments';
import { onEngQueueArrival } from './engineering-arrival';
import {
  changedDraftData,
  draftItemsFromQuote,
  drawingCheck,
  itemsProblem,
  keptFromValues,
  mergeDraftPatch,
  quoteMirrorColumns,
  storedItemColumns,
  syncQuoteItems,
} from './intake-items';
import { deliverDecisionNotifications, deliverResumeNotifications } from './handoff-notifications';
import { recordIntakeShipToOverride } from './overrideService';
import { onPricingArrival } from './pricing-view';
import { onQualifyArrival } from './qualify-arrival';
import type { ScoringService } from './scoring';
import type { AuditMeta } from '../plugins/audit';

/**
 * Intake drafts and submit (B-07). The domain decides blocking vs warning (`evaluateIntake`) and the
 * routing (`availableActions` / `evaluateTransition`); this service only assembles and persists.
 */

export type IntakeWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
type WithTx = IntakeWithTx;

export type { AuditMeta } from '../plugins/audit';

/** A failure the route turns into problem+json. */
export class IntakeError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'IntakeError';
  }
}

const notFound = () =>
  new IntakeError(404, INTAKE_PROBLEM_CODES.notFound, 'No intake draft with this id');

/** FB-12: active `sub_market` entries → { code: parent market code } (value-list meta `market`). */
function subMarketMap(entries: { code: string; meta: unknown }[]): Record<string, string> {
  return Object.fromEntries(
    entries.flatMap((e) => {
      const market = meta(e.meta).market;
      return typeof market === 'string' ? [[e.code, market] as const] : [];
    }),
  );
}

/**
 * Reads the intake config from app settings and the ACTIVE value lists. FB-15 (W13-01): built by the
 * domain's `intakeConfigFromSources`, the same function the wizard uses, so the two cannot disagree on
 * what blocks a submit. Throws if a required setting is missing.
 */
export async function loadIntakeConfig(db: DbOrTx): Promise<IntakeConfig> {
  const [values, activeLists] = await Promise.all([
    Promise.all(INTAKE_SETTING_KEYS.map((key) => getSetting(db, key))),
    listActiveValueLists(db),
  ]);
  const settings = Object.fromEntries(
    INTAKE_SETTING_KEYS.map((key, i) => [key, values[i]] as const).filter(
      ([, v]) => v !== undefined,
    ),
  );
  if (
    settings.intake_required_fields === undefined ||
    settings.intake_volume_placeholder === undefined ||
    !settings.intake_default_request_class ||
    settings.intake_allowed_request_classes === undefined ||
    !settings.intake_redirect_message
  ) {
    throw new Error('intake settings are not seeded (run pnpm db:seed)');
  }
  const lists: Record<string, { code: string; meta: unknown }[]> = {};
  for (const v of activeLists as { listKey: string; code: string; meta: unknown }[]) {
    (lists[v.listKey] ??= []).push({ code: v.code, meta: v.meta });
  }
  return intakeConfigFromSources({ settings, lists });
}

const meta = (m: unknown) => (m ?? {}) as Record<string, unknown>;

const blankToNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** numeric(10,2): stored to the cent. */
const round2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

const activeRef = (
  row: { quoteNumber: string; stageKey: string; status: string } | undefined,
): ActiveQuoteRef | null =>
  row ? { quoteNumber: row.quoteNumber, stageKey: row.stageKey, status: row.status } : null;

function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  while (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export interface IntakeServiceOptions {
  now?: () => Date;
  /** B-08: scores the quote on submit / resubmit (advisory). Null leaves the score empty. */
  scoring?: ScoringService | null;
  /**
   * Makes sure the opportunity is in the local snapshot (the quote's FK) before submit, e.g. after
   * a live SF search. Returns false when neither the snapshot nor SF knows the id.
   */
  ensureOpportunity: (withTx: WithTx, sfOpportunityId: string) => Promise<boolean>;
  /**
   * B-16: a draft's files go with it. Submit claims them for the quote (same transaction) and moves
   * their bytes to the quote folder after the commit; deleting a draft removes them (soft).
   */
  attachments?: Pick<AttachmentService, 'claimDraftFiles' | 'removeDraftFiles' | 'settle'>;
  log?: FastifyBaseLogger;
  /**
   * FB-19 (W13-33): a read in system context (every quote, whoever owns it), used ONLY to find the active
   * quotes on an opportunity (their number and KAM). Without it the read runs under the caller's RLS.
   */
  systemTx?: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

export class IntakeService {
  private readonly now: () => Date;

  constructor(private readonly opts: IntakeServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * DR-cross-cutting-02: a rework keeps the values its quote already holds, so a code retired since the
   * quote was made stays readable and resubmittable; only a new write of a retired code is refused.
   */
  private async keptValues(tx: DbOrTx, row: QuoteDraftRow): Promise<Record<string, unknown>> {
    if (!row.reworkOfQuoteId) return {};
    const q = await getQuoteById(tx, row.reworkOfQuoteId);
    if (!q) return {};
    // FB-19: the codes the quote and every one of its items hold.
    return keptFromValues(
      intakeValues({ ...dataFromQuote(q), items: await draftItemsFromQuote(tx, q.id) }),
    );
  }

  /**
   * FB-19 (W13-33): the active quotes on the opportunity, whoever owns them (number and KAM only), read
   * in system context so another KAM's quote counts. With `lock`, the opportunity's submit lock is
   * taken first (held until the transaction ends), so two submits cannot both find none.
   */
  private async openQuotes(tx: DbOrTx, sfOpportunityId: string, lock = false) {
    if (lock) await lockOpportunityForSubmit(tx, sfOpportunityId);
    const read = (db: DbOrTx) => listOpenQuotesOnOpportunity(db, sfOpportunityId);
    const rows = this.opts.systemTx ? await this.opts.systemTx(read) : await read(tx);
    return rows.map((r) => ({ quoteNumber: r.quoteNumber, kamName: r.kamName ?? null }));
  }

  /** FB-19 (W13-33): the setting and the warning's words. */
  private async openQuoteSettings(
    tx: DbOrTx,
  ): Promise<{ mode: OpportunityActiveQuotesMode; template: string }> {
    const [mode, template] = await Promise.all([
      getSetting(tx, 'opportunity_active_quotes'),
      getSetting(tx, 'opportunity_active_quote_message'),
    ]);
    return {
      mode: parseOpportunityActiveQuotes(mode),
      template: parseOpportunityActiveQuoteMessage(template),
    };
  }

  /** DR-cross-cutting-02: refuse a NEW write of a code that is not an active value-list entry (422). */
  private async assertListValues(
    tx: DbOrTx,
    row: QuoteDraftRow | null,
    written: IntakeDraftData,
    itemNumbers?: number[],
  ): Promise<void> {
    const issues = intakeListValueIssues(
      intakeValues(written),
      await loadIntakeConfig(tx),
      row ? await this.keptValues(tx, row) : {},
    );
    if (issues.length === 0) return;
    // FB-19: `itemNumbers` maps a position in `written.items` to the item's number in the draft.
    const itemNo = (i: { item?: number }) =>
      i.item === undefined ? undefined : (itemNumbers?.[i.item - 1] ?? i.item);
    throw new IntakeError(422, INTAKE_PROBLEM_CODES.invalidListValue, issues[0]!.message, {
      errors: issues.map((i) => ({
        path: camelField(i.field),
        message: i.message,
        ...(itemNo(i) !== undefined ? { item: itemNo(i) } : {}),
      })),
    });
  }

  private async toDto(tx: DbOrTx, row: QuoteDraftRow): Promise<IntakeDraft> {
    const config = await loadIntakeConfig(tx);
    // FB-19: a draft saved before FB-19 is read with its product fields as item 1.
    const data = normalizeDraftData(row.data as IntakeDraftData, uuidv7);
    const kept = await this.keptValues(tx, row);
    const drawings = await drawingCheck(tx, row);
    const evaluation = evaluateIntake(intakeValues(data, drawings.has), config, this.now(), kept);
    const opp = !row.reworkOfQuoteId && !row.submittedQuoteId ? row.sfOpportunityId : null;
    const active = opp ? await getActiveQuoteForOpportunity(tx, opp) : undefined;
    // FB-19 (W13-33): every active quote on the opportunity (number and KAM only) and the warning.
    const openQuotes = opp ? await this.openQuotes(tx, opp) : [];
    const openSettings = await this.openQuoteSettings(tx);
    // FB-02 (T-009): the SF close date is read from the latest sync, never stored on the draft.
    const opportunity = row.sfOpportunityId
      ? await getSfOpportunity(tx, row.sfOpportunityId)
      : undefined;
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      step: row.step,
      data,
      evaluation,
      sfCloseDate: opportunity?.closeDate ?? null,
      activeQuote: row.reworkOfQuoteId ? null : activeRef(active),
      openQuotes,
      openQuoteWarning: activeQuoteWarning(openSettings.template, openQuotes),
      openQuotesMode: openSettings.mode,
      rework: row.reworkOfQuoteId ? await this.reworkInfo(tx, row.reworkOfQuoteId) : null,
      keptListValues: keptListCodes(kept),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The draft, or 404 (RLS already hides other users' drafts from everyone but Admin). */
  private async ownDraft(tx: DbOrTx, actor: Actor, id: string, forUpdate = false) {
    const row = forUpdate ? await getQuoteDraftForUpdate(tx, id) : await getQuoteDraft(tx, id);
    if (!row) throw notFound();
    if (row.ownerUserId !== actor.userId) {
      throw new IntakeError(
        403,
        INTAKE_PROBLEM_CODES.notOwner,
        'Only the KAM who started this draft can change it',
      );
    }
    if (row.submittedQuoteId) {
      throw new IntakeError(
        409,
        INTAKE_PROBLEM_CODES.alreadySubmitted,
        'This draft has already been submitted',
      );
    }
    return row;
  }

  async create(
    withTx: WithTx,
    actor: Actor,
    body: { data: IntakeDraftData; step: number },
    meta: AuditMeta,
  ): Promise<IntakeDraft> {
    return withTx(async (tx) => {
      // FB-19: stored with the product fields in `items` (an older client's top-level ones are item 1).
      const data = normalizeDraftData(body.data, uuidv7);
      await this.assertItems(tx, data);
      await this.assertListValues(tx, null, data);
      const row = await insertQuoteDraft(tx, {
        ownerUserId: actor.userId,
        sfOpportunityId: data.sfOpportunityId ?? null,
        step: body.step,
        data,
        createdBy: actor.userId,
      });
      await insertAuditEvent(tx, {
        at: this.now(),
        actorId: actor.userId,
        actorRoles: [...actor.roles],
        action: 'create',
        entity: 'quote_draft',
        entityId: row.id,
        after: { sfOpportunityId: row.sfOpportunityId },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: meta.requestId ?? null,
        createdBy: actor.userId,
      });
      return this.toDto(tx, row);
    });
  }

  /** FB-19: at most `quote_items_max` items, each key once (422 `invalid_items`). */
  private async assertItems(tx: DbOrTx, data: IntakeDraftData): Promise<void> {
    const problem = itemsProblem(data, await loadIntakeConfig(tx));
    if (problem)
      throw new IntakeError(problem.status, problem.code, problem.message, problem.extra);
  }

  async get(withTx: WithTx, id: string): Promise<IntakeDraft> {
    return withTx(async (tx) => {
      const row = await getQuoteDraft(tx, id);
      if (!row) throw notFound();
      return this.toDto(tx, row);
    });
  }

  async list(withTx: WithTx, actor: Actor, mine: boolean): Promise<IntakeDraftListResponse> {
    // Only Admin may list other people's drafts (RLS enforces it too).
    const own = mine || !actor.roles.includes('Admin');
    return withTx(async (tx) => {
      const rows = await listOpenQuoteDrafts(tx, own ? actor.userId : undefined);
      const items = rows.map((r) => {
        const data = r.data as IntakeDraftData;
        return {
          id: r.id,
          ownerUserId: r.ownerUserId,
          step: r.step,
          sfOpportunityId: r.sfOpportunityId,
          sfOpportunityName: data.sfOpportunityName ?? null,
          customerName: data.customer?.name ?? null,
          updatedAt: r.updatedAt.toISOString(),
        };
      });
      const returned: ReturnedQuoteSummary[] = [];
      for (const r of await listReturnedQuotes(tx, actor.userId)) {
        const info = await this.reworkInfo(tx, r.quote.id);
        if (!info) continue;
        const draft = await getOpenReworkDraft(tx, r.quote.id);
        returned.push({
          quoteNumber: r.quote.quoteNumber,
          opportunityName: r.opportunityName ?? null,
          customerName: r.customerName ?? null,
          gateKey: info.gateKey,
          reasonLabel: info.reasonLabel,
          note: info.note,
          returnedAt: info.decidedAt,
          draftId: draft?.id ?? null,
          originStageKey: info.originStageKey,
          askScopeChange: info.askScopeChange,
        });
      }
      return { items, returned };
    });
  }

  /** The gate decision that returned a quote to its KAM (the latest one that targeted INTAKE). */
  private async reworkInfo(tx: DbOrTx, quoteId: string): Promise<IntakeDraft['rework']> {
    const [q, decisions, workflow] = await Promise.all([
      getQuoteById(tx, quoteId),
      listGateDecisionsWithNames(tx, quoteId),
      loadWorkflowConfigInput(tx).then(parseWorkflowConfig),
    ]);
    const d = decisions.find((x) => x.decision.targetStageKey === 'INTAKE');
    if (!q || !d) return null;
    return {
      quoteNumber: q.quoteNumber,
      gateKey: d.decision.gateKey,
      reasonLabel: reasonLabel(workflow, d.decision) ?? null,
      note: d.decision.note,
      decidedAt: d.decision.decidedAt.toISOString(),
      decidedByName: d.decidedByName ?? null,
      // FB-01 (F-030): where it came from, and whether the KAM is asked about the scope on submit.
      originStageKey: q.reworkOriginStageKey,
      askScopeChange: asksScopeChange(reworkOfQuote(q)),
    };
  }

  /**
   * A KAM starts fixing a quote returned at a gate (Rework): opens (or reopens) a rework draft pre-filled
   * from the last submitted intake and the quote. Submitting it updates the same quote and number.
   */
  async startRework(
    withTx: WithTx,
    actor: Actor,
    quoteNumber: string,
    meta: AuditMeta,
  ): Promise<IntakeDraft> {
    return withTx(async (tx) => {
      const q = await getQuoteByNumber(tx, quoteNumber);
      if (!q) throw new IntakeError(404, INTAKE_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
      assertReturnedTo(q, actor);
      const open = await getOpenReworkDraft(tx, q.id);
      if (open) return this.toDto(tx, open);

      const last = await getLatestSubmittedDraft(tx, q.id);
      // The last submitted intake is the most complete copy (it has the customer and SF display fields);
      // a quote with no draft (e.g. synthetic data) is rebuilt from its columns and customer row.
      const base: IntakeDraftData = last
        ? (last.data as IntakeDraftData)
        : { ...dataFromQuote(q), customer: await customerForDraft(tx, q.customerId) };
      // FB-19: the items are the quote's own (`quote_item`, keyed by their ids), not the last draft's.
      const data = normalizeDraftData(
        { ...base, items: await draftItemsFromQuote(tx, q.id) },
        uuidv7,
      );
      const row = await insertQuoteDraft(tx, {
        ownerUserId: actor.userId,
        sfOpportunityId: q.sfOpportunityId,
        step: 2,
        data,
        reworkOfQuoteId: q.id,
        createdBy: actor.userId,
      });
      await insertAuditEvent(tx, {
        at: this.now(),
        actorId: actor.userId,
        actorRoles: [...actor.roles],
        action: 'create',
        entity: 'quote_draft',
        entityId: row.id,
        quoteId: q.id,
        after: { reworkOfQuoteId: q.id, quoteNumber },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: meta.requestId ?? null,
        createdBy: actor.userId,
      });
      return this.toDto(tx, row);
    });
  }

  /** Autosave: top-level keys in `data` replace the stored ones. Not audited (every 5 s). */
  async patch(
    withTx: WithTx,
    actor: Actor,
    id: string,
    body: {
      data?: IntakeDraftData | undefined;
      step?: number | undefined;
      expectedUpdatedAt?: string | undefined;
    },
  ): Promise<IntakeDraft> {
    return withTx(async (tx) => {
      const row = await this.ownDraft(tx, actor, id, true);
      // DR-kam-sales-leader-05: refuse a save made from an older copy (another tab saved since), so it
      // cannot silently overwrite. The draft row is locked (ownDraft forUpdate), so this is race-free.
      if (
        body.expectedUpdatedAt !== undefined &&
        new Date(body.expectedUpdatedAt).getTime() !== row.updatedAt.getTime()
      ) {
        throw new IntakeError(
          409,
          INTAKE_PROBLEM_CODES.draftChanged,
          'This draft was changed in another tab or window. Reload it to see the latest, then make your change again.',
        );
      }
      const before = normalizeDraftData(row.data as IntakeDraftData, uuidv7);
      // FB-19: `items` is replaced as a whole; an older client's top-level product field changes item 1.
      const data = mergeDraftPatch(before, body.data ?? {});
      await this.assertItems(tx, data);
      // DR-cross-cutting-02: only what this save changes is a new write (FB-19: per item and field).
      const { changed, itemNumbers } = changedDraftData(before, data, body.data ?? {});
      await this.assertListValues(tx, row, changed, itemNumbers);
      // FB-12 (F-073): a market change must not leave the old market's sub-market behind.
      if (
        data.subMarket &&
        body.data &&
        'market' in body.data &&
        (body.data.market ?? null) !== (before.market ?? null)
      ) {
        const kept = subMarketAfterMarketChange(
          data.subMarket,
          data.market,
          subMarketMap(await listValueList(tx, 'sub_market')),
        );
        if (kept === null) delete data.subMarket;
      }
      const updated = await updateQuoteDraft(tx, id, {
        data,
        sfOpportunityId: data.sfOpportunityId ?? null,
        ...(body.step !== undefined ? { step: body.step } : {}),
      });
      return this.toDto(tx, updated!);
    });
  }

  async remove(withTx: WithTx, actor: Actor, id: string, meta: AuditMeta): Promise<void> {
    await withTx(async (tx) => {
      await this.ownDraft(tx, actor, id, true);
      await this.opts.attachments?.removeDraftFiles(tx, actor, id, meta);
      if (!(await deleteOpenQuoteDraft(tx, id))) throw notFound();
      await insertAuditEvent(tx, {
        at: this.now(),
        actorId: actor.userId,
        actorRoles: [...actor.roles],
        action: 'update',
        entity: 'quote_draft',
        entityId: id,
        after: { deleted: true },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: meta.requestId ?? null,
        createdBy: actor.userId,
      });
    });
  }

  /**
   * Draft → quote in INTAKE (submitted), in one transaction: CCQ-YYYY-NNNNN, customer link, stage
   * history, activity and audit, priority score (B-08 hook), then routing: the KAM's own submit gate
   * when G1 is disabled (straight to the engineering queue), otherwise it waits for G1.
   */
  async submit(
    withTx: WithTx,
    actor: Actor,
    id: string,
    meta: AuditMeta,
    /** FB-01 (F-030): the KAM's answer to "Did the scope change?" (asked after a G3 send-back). */
    scopeChanged?: boolean,
  ): Promise<SubmitIntakeResponse> {
    // The opportunity must be in the snapshot (FK). A live-search pick is copied in first.
    const peek = await withTx((tx) => this.ownDraft(tx, actor, id));
    const oppId = (peek.data as IntakeDraftData).sfOpportunityId;
    if (oppId && !(await this.opts.ensureOpportunity(withTx, oppId))) {
      throw new IntakeError(
        422,
        INTAKE_PROBLEM_CODES.incomplete,
        'Salesforce has no opportunity with this id',
        {
          errors: [
            { path: '/data/sfOpportunityId', message: 'Opportunity not found in Salesforce' },
          ],
        },
      );
    }

    let result: SubmitIntakeResponse;
    try {
      result = await withTx((tx) => this.submitInTx(tx, actor, id, meta, scopeChanged));
    } catch (err) {
      if (pgCode(err) === '23505') {
        // Lost the race with another submit for the same opportunity (unique partial index).
        throw new IntakeError(
          409,
          INTAKE_PROBLEM_CODES.activeQuoteExists,
          'This Salesforce opportunity already has an active CCQ quote',
        );
      }
      throw err;
    }
    // The draft's files move to the quote folder now; a failure is retried on the next list.
    if (this.opts.attachments && result.attachments > 0) {
      await this.opts.attachments.settle(withTx, result.quoteId).catch((err: unknown) => {
        this.opts.log?.warn({ err }, 'moving intake files to the quote folder failed');
      });
    }
    return result;
  }

  /**
   * FB-02 (F-007, D-011): the customer is always the opportunity's Salesforce Account. Links its
   * customer row (or mirrors it from the draft's SF copy), and records the KAM's one answer, "Not yet a
   * Pretium customer (no ERP account)" (DEC-27), as the customer's status: it drives the new_customer
   * Legal review trigger. A changed status is audited. Nothing is created in Salesforce or the ERP.
   */
  private async resolveCustomer(
    tx: Tx,
    actor: Actor,
    data: IntakeDraftData,
    now: Date,
    audit: { ip: string | null; userAgent: string | null; requestId: string | null },
    quoteId: string | null,
  ): Promise<string> {
    const c = data.customer!;
    const sfAccountId = c.sfAccountId!;
    const status = c.status;
    const known = await getCustomerBySfAccountId(tx, sfAccountId);
    if (!known) {
      return (
        await insertCustomer(tx, {
          sfAccountId,
          name: c.name!,
          status,
          defaultShipTo: address(data.shipToDefault),
          source: 'salesforce',
          lastSyncedAt: now,
          createdBy: actor.userId,
        })
      ).id;
    }
    if (known.status !== status) {
      await tx
        .update(schema.customer)
        .set({ status, updatedAt: now })
        .where(eq(schema.customer.id, known.id));
      await insertAuditEvent(tx, {
        at: now,
        actorId: actor.userId,
        actorRoles: [...actor.roles],
        action: 'update',
        entity: 'customer',
        entityId: known.id,
        quoteId,
        before: { status: known.status },
        after: { status, source: 'intake' },
        ...audit,
        createdBy: actor.userId,
      });
    }
    return known.id;
  }

  private async submitInTx(
    tx: Tx,
    actor: Actor,
    id: string,
    meta: AuditMeta,
    scopeChanged: boolean | undefined,
  ): Promise<SubmitIntakeResponse> {
    const now = this.now();
    const draft = await this.ownDraft(tx, actor, id, true);
    // FB-19: the product fields are per item (a draft saved before FB-19 is one item).
    const data = normalizeDraftData(draft.data as IntakeDraftData, uuidv7);
    const config = await loadIntakeConfig(tx);
    await this.assertItems(tx, data);
    const drawings = await drawingCheck(tx, draft);
    const values = intakeValues(data, drawings.has);
    const evaluation: IntakeEvaluation = evaluateIntake(
      values,
      config,
      now,
      await this.keptValues(tx, draft),
    );
    if (!evaluation.ready) {
      throw incompleteError(evaluation);
    }
    const sfOpportunityId = data.sfOpportunityId!;
    const audit = {
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      requestId: meta.requestId ?? null,
    };

    // A rework draft goes back into its own quote (same number); anything else creates a quote.
    const reworkOf = draft.reworkOfQuoteId ? await getQuoteById(tx, draft.reworkOfQuoteId) : null;
    const workflow = parseWorkflowConfig(await loadWorkflowConfigInput(tx));
    // FB-01 (F-030): a rework that resumes at its origin (G3 "Rework (back to KAM)") goes straight back
    // there unless the KAM says the scope changed. The domain decides; the answer is required.
    const route = planResubmitRoute(
      workflow,
      reworkOf ? reworkOfQuote(reworkOf) : null,
      scopeChanged,
    );
    if (!route.ok) {
      throw new IntakeError(422, INTAKE_PROBLEM_CODES.incomplete, route.errors[0]!.message, {
        errors: route.errors.map((e) => ({ path: `/${e.field ?? ''}`, message: e.message })),
      });
    }
    const asked = reworkOf ? asksScopeChange(reworkOfQuote(reworkOf)) : false;
    /** FB-19 (W13-33): the open quotes a confirmed separate quote was started beside (for the audit). */
    let separateFrom: string[] = [];
    if (reworkOf) {
      assertReturnedTo(reworkOf, actor);
      if (reworkOf.sfOpportunityId !== sfOpportunityId) {
        throw new IntakeError(
          422,
          INTAKE_PROBLEM_CODES.incomplete,
          'A reworked quote stays on its Salesforce opportunity',
          { errors: [{ path: '/data/sfOpportunityId', message: 'Keep the original opportunity' }] },
        );
      }
    } else {
      // FB-19 (W13-33): one active quote per opportunity is a setting. The check runs in system context
      // (another KAM's quote counts) under the opportunity's submit lock, so two submits cannot race.
      const open = await this.openQuotes(tx, sfOpportunityId, true);
      const settings = await this.openQuoteSettings(tx);
      const decision = decideActiveQuotes(
        settings.mode,
        open.length,
        data.separateQuoteConfirmed === true,
      );
      if (!decision.ok) {
        throw new IntakeError(
          409,
          INTAKE_PROBLEM_CODES.activeQuoteExists,
          decision.reason === 'one'
            ? `This Salesforce opportunity already has an active CCQ quote (${open[0]!.quoteNumber})`
            : activeQuoteWarning(settings.template, open)!,
          {
            quoteNumber: open[0]!.quoteNumber,
            openQuotes: open,
            mode: settings.mode,
          },
        );
      }
      separateFrom = decision.separate ? open.map((o) => o.quoteNumber) : [];
    }

    const customerId = await this.resolveCustomer(
      tx,
      actor,
      data,
      now,
      audit,
      reworkOf?.id ?? null,
    );
    const kam = await findUserById(tx, actor.userId);
    const shipToOverridden =
      Boolean(blankToNull(data.shipToOverrideReason)) && values.ship_to !== null;
    // The request-level fields that no longer apply (freight without a delivered price, …).
    const cleared = new Set(inapplicableIntakeFields(values, config));
    const keep = <T>(field: string, value: T): T | null => (cleared.has(field) ? null : value);
    const toolingFundingModel =
      values.tooling_funding_model ??
      (reworkOf ? reworkOf.toolingFundingModel : await defaultFundingCode(tx));
    // FB-19 (decision 6): each item's stored columns, and the quote's product columns mirror item 1 with
    // the volume summed over every item.
    const itemsData = draftItems(data);
    const { items: _itemValues, ...requestValues } = values;
    const itemRows = itemsData.map((item) => storedItemColumns(item, requestValues, config));
    const fields = {
      customerId,
      description: blankToNull(data.description),
      ...quoteMirrorColumns(itemRows),
      market: data.market ?? null,
      // FB-12 (F-073): evaluateIntake has already checked that it belongs to the market.
      subMarket: values.sub_market,
      estAnnualRevenue: data.estAnnualRevenue ?? null,
      estAnnualRevenueSf: data.estAnnualRevenueSf ?? null,
      // FB-02 (F-009): the need-by dates replace the close date (expected_close_date is no longer written).
      quoteNeededBy: data.quoteNeededBy ?? null,
      quoteVariantsNote: values.quote_variants_note,
      rfpLink: values.rfp_link,
      // FB-11 (D-032): commercial inputs. Freight is kept only for a delivered price; the "Other"
      // description only for Other. The funding answer defaults to the list's default ("Not discussed"),
      // except on a rework of a quote that already has one.
      requestedPaymentTerms: values.requested_payment_terms,
      requestedPaymentTermsOther: keep(
        'requested_payment_terms_other',
        values.requested_payment_terms_other,
      ),
      toolingFundingModel,
      // FB-15 (W13-09): the customer's share, kept only while funding is Shared (checked 0–100 above).
      customerSharePct:
        isSharedFunding(toolingFundingModel, config.sharedFundingCodes) &&
        typeof values.customer_share_pct === 'number'
          ? round2(values.customer_share_pct)
          : null,
      returnableDunnage: values.returnable_dunnage,
      priceBasis: values.price_basis,
      freightType: keep('freight_type', values.freight_type),
      freightSpecialArrangements: keep(
        'freight_special_arrangements',
        values.freight_special_arrangements,
      ),
      bidReference: values.bid_reference,
      // FB-10 (F-066): the platform-minimum warning, kept for G1. A warning only; it never blocked the submit.
      guardrailWarning:
        evaluation.warnings.find((w) => w.code === 'BELOW_PLATFORM_MINIMUM')?.message ?? null,
      requestClass: data.requestClass ?? null,
      commentsForEngineering: blankToNull(data.commentsForEngineering),
      shipTo: values.ship_to,
      shipToOriginal: values.ship_to_default,
      shipToOverridden,
      shipToOverrideReason: shipToOverridden ? blankToNull(data.shipToOverrideReason) : null,
      submittedAt: now,
    };

    const warningCodes = evaluation.warnings.map((w) => `${w.code}:${w.field}`);
    let quote: Quote;
    const resumedAt = route.route === 'origin' ? route.stageKey : null;
    const scopeAnswer = asked ? Boolean(scopeChanged) : null;
    if (reworkOf) {
      // FB-01 (F-030): the rework record is cleared on resubmit, whichever way it routes.
      quote = (await updateQuote(tx, reworkOf.id, {
        ...fields,
        reworkOriginStageKey: null,
        reworkResumeAt: null,
      }))!;
      await insertActivityEvent(tx, {
        quoteId: quote.id,
        type: 'quote_resubmitted',
        actorId: actor.userId,
        at: now,
        payload: {
          draftId: draft.id,
          version: quote.version,
          warnings: warningCodes,
          scopeChanged: scopeAnswer,
          resumedAt,
        },
        createdBy: actor.userId,
      });
      await insertAuditEvent(tx, {
        at: now,
        actorId: actor.userId,
        actorRoles: [...actor.roles],
        action: 'update',
        entity: 'quote',
        entityId: quote.id,
        quoteId: quote.id,
        before: {
          submittedAt: null,
          version: reworkOf.version,
          market: reworkOf.market,
          subMarket: reworkOf.subMarket,
        },
        after: {
          event: 'quote.resubmitted',
          resubmitted: true,
          draftId: draft.id,
          market: quote.market,
          subMarket: quote.subMarket,
          shipToOverridden,
          commercialInputs: commercialInputsAudit(fields),
          scopeChanged: scopeAnswer,
          resumedAt,
          items: itemsData.length,
        },
        ...audit,
        createdBy: actor.userId,
      });
    } else {
      quote = await insertQuote(tx, {
        sfOpportunityId,
        kamUserId: actor.userId,
        region: kam?.region ?? null,
        stageKey: 'INTAKE',
        status: 'active',
        version: 1,
        ...fields,
        createdAt: now,
        createdBy: actor.userId,
      });
      await tx.insert(schema.stageHistory).values({
        quoteId: quote.id,
        stageKey: 'INTAKE',
        enteredAt: now,
        enteredBy: actor.userId,
        quoteVersion: 1,
        createdBy: actor.userId,
      });
      await insertActivityEvent(tx, {
        quoteId: quote.id,
        type: 'quote_created',
        actorId: actor.userId,
        at: now,
        payload: { sfOpportunityId, draftId: draft.id, warnings: warningCodes },
        createdBy: actor.userId,
      });
      await insertAuditEvent(tx, {
        at: now,
        actorId: actor.userId,
        actorRoles: [...actor.roles],
        action: 'create',
        entity: 'quote',
        entityId: quote.id,
        quoteId: quote.id,
        after: {
          quoteNumber: quote.quoteNumber,
          sfOpportunityId,
          stageKey: 'INTAKE',
          draftId: draft.id,
          // FB-12 (F-073): the market and the sub-market that sets the strategic-fit score.
          market: quote.market,
          subMarket: quote.subMarket,
          shipToOverridden,
          commercialInputs: commercialInputsAudit(fields),
          items: itemsData.length,
          // FB-19 (W13-33): started beside these open quotes after the KAM confirmed the warning.
          ...(separateFrom.length > 0 ? { separateFrom } : {}),
        },
        ...audit,
        createdBy: actor.userId,
      });
    }
    if (shipToOverridden) {
      // B-09: a ship-to that differs from the account default is a self-applied, logged override.
      await recordIntakeShipToOverride(
        tx,
        actor,
        meta,
        quote.id,
        values.ship_to_default,
        values.ship_to,
        quote.shipToOverrideReason!,
        now,
      );
    }

    const attachments =
      (await this.opts.attachments?.claimDraftFiles(tx, actor, draft.id, quote.id, now)) ?? 0;
    // FB-19: the quote's items now match the draft (added, changed, renumbered, removed; audited).
    const keyToId = await syncQuoteItems(tx, actor, meta, {
      quoteId: quote.id,
      draftId: draft.id,
      items: itemsData,
      rows: itemRows,
      now,
    });

    // Priority score (B-08): advisory; orders the G1 and engineering queues.
    const scored = this.opts.scoring
      ? await this.opts.scoring.recalculate(
          tx,
          quote.id,
          actor.userId,
          now,
          reworkOf ? 'intake_resubmit' : 'intake_submit',
        )
      : null;

    // The submitted draft keeps what was submitted, its items keyed by the quote item ids.
    await updateQuoteDraft(tx, draft.id, {
      data: {
        ...data,
        items: itemsData.map((i) => ({ ...i, key: keyToId.get(i.key) ?? i.key })),
      },
      submittedQuoteId: quote.id,
      submittedAt: now,
    });

    // FB-01 (F-030): no scope change after a G3 send-back: straight back to Quoting, same pricer and
    // pricing lead; the pricing record reopens for the pricer (a new stay starts a new lead review).
    if (route.route === 'origin') {
      const moved = await resumeQuoteAtStage(
        tx,
        {
          quoteId: quote.id,
          fromStageKey: quote.stageKey,
          toStageKey: route.stageKey,
          version: quote.version,
          actorId: actor.userId,
          at: now,
          scopeChanged: false,
        },
        { actorRoles: actor.roles, ...audit },
      );
      if (route.stageKey === PRICING_QUEUE_STAGE_KEY) {
        await onPricingArrival(
          tx,
          { id: quote.id, quoteNumber: quote.quoteNumber, version: quote.version },
          actor.userId,
        );
      } else if (route.stageKey === ENG_QUEUE_STAGE_KEY) {
        await onEngQueueArrival(tx, quote, actor.userId, this.opts.log);
      }
      // FB-05 (F-079): "back from the KAM, no scope change": the assigned pricer or engineer and the
      // stage's lead are told.
      await deliverResumeNotifications(
        tx,
        {
          quote: { id: quote.id, quoteNumber: quote.quoteNumber },
          actorId: actor.userId,
          state: (await loadQuoteState(tx, quote.id))!,
          originStageKey: route.stageKey,
          workflow,
        },
        this.opts.log,
      );
      return {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        stageKey: moved.stageKey,
        status: moved.status,
        routedTo: moved.stageKey,
        priorityScore: scored?.total ?? null,
        priorityTier: scored?.tier ?? null,
        resubmitted: true,
        scopeChanged: scopeAnswer,
        resumedAt,
        routingReason: null,
        warnings: evaluation.warnings,
        attachments,
      };
    }

    // FB-10 (T-011): with volume-band routing on, the band decides G1 or Engineering for THIS submit
    // (outside the band: the sales leader qualifies; inside: straight to Engineering). Off by default,
    // and then `g1_enabled` alone decides. The stored workflow config is never changed.
    const volumeRoute = routeByVolumeBand(
      parseVolumeRouting(await getSetting(tx, 'g1_volume_routing')),
      {
        quote: {
          est_annual_volume: quote.estAnnualVolume,
          est_annual_revenue: quote.estAnnualRevenue,
        },
      },
    );
    const routed = workflowForRoute(workflow, volumeRoute);
    if (volumeRoute.applies) {
      await insertAuditEvent(tx, {
        at: now,
        actorId: actor.userId,
        actorRoles: [...actor.roles],
        action: 'update',
        entity: 'quote',
        entityId: quote.id,
        quoteId: quote.id,
        before: null,
        after: {
          event: 'quote.volume_routed',
          route: volumeRoute.route,
          inBand: volumeRoute.inBand,
          reason: volumeRoute.reason,
        },
        ...audit,
        createdBy: actor.userId,
      });
    }

    // Routing. The KAM's own submit gate (decider quote.create) is enabled only when G1 is off.
    const state = (await loadQuoteState(tx, quote.id))!;
    const submitGate = (gateKey: string) =>
      routed.gates.find((g) => g.key === gateKey)?.deciderPermission === 'quote.create';
    const action = availableActions(routed, state, actor).find(
      (a) => submitGate(a.gateKey) && a.targetStageKeys.length === 1,
    );

    let stageKey = 'INTAKE';
    let status: string = quote.status;
    const qualifyGate = routed.gates.find(
      (g) => g.enabled && g.stageKey === 'INTAKE' && !submitGate(g.key),
    );
    let routedTo = qualifyGate?.key ?? 'INTAKE';
    if (action) {
      const result = evaluateTransition(
        routed,
        state,
        actor,
        { gateKey: action.gateKey, outcomeKey: action.outcomeKey },
        now,
      );
      if (!result.ok) {
        throw new IntakeError(
          422,
          INTAKE_PROBLEM_CODES.incomplete,
          'The intake cannot be routed yet',
          {
            errors: result.errors.map((e) => ({ path: e.field ?? '/', message: e.message })),
          },
        );
      }
      const moved = await persistTransition(tx, result.effects, {
        actorRoles: actor.roles,
        ...audit,
      });
      stageKey = moved.stageKey;
      status = moved.status;
      routedTo = moved.stageKey;
      if (result.effects.stageHistory.enter?.stageKey === ENG_QUEUE_STAGE_KEY) {
        await onEngQueueArrival(tx, quote, actor.userId, this.opts.log);
      }
      // B-10 / FB-05: the EngLead's arrival alert (in-app + email, B-18), the same notices as G1 Advance.
      await deliverDecisionNotifications(
        tx,
        {
          quote: { id: quote.id, quoteNumber: quote.quoteNumber },
          actorId: actor.userId,
          state,
          effects: result.effects,
          workflow: routed,
          proposal: null,
        },
        this.opts.log,
      );
    } else if (qualifyGate) {
      // B-18: waiting at G1: tell the gate's deciders (in-app now, the 7:00 AM Central digest by email).
      await onQualifyArrival(
        tx,
        quote,
        qualifyGate,
        actor.userId,
        Boolean(reworkOf),
        undefined,
        volumeRoute.reason,
      );
    }

    const warnings: IntakeIssue[] = evaluation.warnings;
    return {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      stageKey,
      status,
      routedTo,
      priorityScore: scored?.total ?? null,
      priorityTier: scored?.tier ?? null,
      resubmitted: Boolean(reworkOf),
      scopeChanged: scopeAnswer,
      resumedAt: null,
      routingReason: volumeRoute.reason,
      warnings,
      attachments,
    };
  }
}

/**
 * 422 for a blocked submit. The problem `code` names the rule when one decides it (FB-02): a request
 * class that isn't CCQ (F-067) whatever else is open, or the drawing-or-minimum-spec rule (F-016)
 * when it is the only thing left; otherwise `intake_incomplete`. `blocking` lists every issue.
 */
/** `product_family` → `productFamily`: the request-body name of a snake_case intake field. */
const camelField = (field: string) => field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function incompleteError(evaluation: IntakeEvaluation): IntakeError {
  const has = (code: string) => evaluation.blocking.some((b) => b.code === code);
  const only = (code: string) => evaluation.blocking.every((b) => b.code === code);
  const [code, title] = has('REQUEST_CLASS_NOT_ALLOWED')
    ? [INTAKE_PROBLEM_CODES.requestClassNotAllowed, 'This request class is not submitted to CCQ']
    : only('DRAWING_OR_MIN_SPEC_REQUIRED')
      ? [
          INTAKE_PROBLEM_CODES.drawingOrMinSpecRequired,
          'Attach a drawing or complete the minimum spec',
        ]
      : [INTAKE_PROBLEM_CODES.incomplete, 'The intake is missing required information'];
  const minSpec = evaluation.blocking.find((b) => b.code === 'DRAWING_OR_MIN_SPEC_REQUIRED');
  return new IntakeError(422, code, title, {
    // FB-12: a sub-market problem is named `subMarket` (the field of the request body).
    errors: evaluation.blocking.map((b) => ({
      path: b.field === 'sub_market' ? 'subMarket' : b.field,
      message: b.message,
    })),
    blocking: evaluation.blocking,
    ...(minSpec?.missing ? { missing: minSpec.missing } : {}),
  });
}

/**
 * FB-15 (W13-01): the list codes a reworked quote already holds, by snake_case field, for the wizard's copy
 * of the server's list check (`listValueIssues` with `keep`).
 */
function keptListCodes(kept: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const field of Object.keys(INTAKE_LIST_FIELDS)) {
    const v = kept[field];
    const codes = (Array.isArray(v) ? v : [v]).filter(
      (c): c is string => typeof c === 'string' && c !== '',
    );
    if (codes.length > 0) out[field] = codes;
  }
  return out;
}

/** FB-01 (F-030): the rework record a gate decision left on the quote. */
function reworkOfQuote(q: Quote) {
  return {
    originStageKey: q.reworkOriginStageKey,
    resumeAt: q.reworkResumeAt as 'origin' | 'intake' | null,
  };
}

/** The quote must be back with this KAM for rework (INTAKE, not submitted, not closed). */
function assertReturnedTo(q: Quote, actor: Actor): void {
  if (q.kamUserId !== actor.userId) {
    throw new IntakeError(403, INTAKE_PROBLEM_CODES.notOwner, "Only the quote's KAM can rework it");
  }
  if (q.stageKey !== 'INTAKE' || q.submittedAt !== null || q.status === 'closed') {
    throw new IntakeError(
      409,
      INTAKE_PROBLEM_CODES.notReturned,
      `${q.quoteNumber} is not waiting for rework`,
    );
  }
}

/** FB-11: the commercial inputs as submitted, for the quote-created and resubmitted audit events. */
function commercialInputsAudit(f: {
  requestedPaymentTerms: string | null;
  requestedPaymentTermsOther: string | null;
  toolingFundingModel: string | null;
  customerSharePct: number | null;
  returnableDunnage: boolean;
  priceBasis: string | null;
  freightType: string | null;
  freightSpecialArrangements: string | null;
  bidReference: string | null;
}) {
  return {
    requestedPaymentTerms: f.requestedPaymentTerms,
    requestedPaymentTermsOther: f.requestedPaymentTermsOther,
    toolingFundingModel: f.toolingFundingModel,
    customerSharePct: f.customerSharePct,
    returnableDunnage: f.returnableDunnage,
    priceBasis: f.priceBasis,
    freightType: f.freightType,
    freightSpecialArrangements: f.freightSpecialArrangements,
    bidReference: f.bidReference,
  };
}

/** FB-11: the `tooling_funding_model` code the wizard preselects (list meta `defaultAtIntake`), or null. */
async function defaultFundingCode(db: DbOrTx): Promise<string | null> {
  const list = await listValueList(db, 'tooling_funding_model');
  return list.find((v) => meta(v.meta).defaultAtIntake === true)?.code ?? null;
}

function reasonLabel(
  workflow: WorkflowConfig,
  d: { gateKey: string; outcomeKey: string; reasonCode: string | null },
): string | null {
  if (!d.reasonCode) return null;
  const context = workflow.outcomes.find(
    (o) => o.gateKey === d.gateKey && o.key === d.outcomeKey,
  )?.reasonContext;
  return (
    workflow.reasonCodes.find((r) => r.code === d.reasonCode && r.context === context)?.label ??
    d.reasonCode
  );
}

/**
 * Intake request fields as stored on the quote, for a rework draft of a quote with no draft of its own.
 * FB-19: the items come from `quote_item` (`draftItemsFromQuote`).
 */
function dataFromQuote(q: Quote): IntakeDraftData {
  return {
    sfOpportunityId: q.sfOpportunityId,
    market: q.market,
    ...(q.subMarket ? { subMarket: q.subMarket } : {}),
    quoteVariantsNote: q.quoteVariantsNote,
    rfpLink: q.rfpLink,
    requestedPaymentTerms: q.requestedPaymentTerms,
    requestedPaymentTermsOther: q.requestedPaymentTermsOther,
    toolingFundingModel: q.toolingFundingModel,
    customerSharePct: q.customerSharePct,
    returnableDunnage: q.returnableDunnage,
    priceBasis: q.priceBasis,
    freightType: q.freightType,
    freightSpecialArrangements: q.freightSpecialArrangements,
    bidReference: q.bidReference,
    requestClass: q.requestClass,
    estAnnualRevenue: q.estAnnualRevenue,
    estAnnualRevenueSf: q.estAnnualRevenueSf,
    quoteNeededBy: q.quoteNeededBy,
    description: q.description,
    commentsForEngineering: q.commentsForEngineering,
    shipTo: (q.shipTo as IntakeDraftData['shipTo']) ?? null,
    shipToDefault: (q.shipToOriginal as IntakeDraftData['shipToDefault']) ?? null,
    shipToOverrideReason: q.shipToOverrideReason,
  };
}

async function customerForDraft(
  tx: DbOrTx,
  customerId: string | null,
): Promise<IntakeDraftData['customer']> {
  if (!customerId) return null;
  const [c] = await tx
    .select()
    .from(schema.customer)
    .where(eq(schema.customer.id, customerId))
    .limit(1);
  if (!c) return null;
  return {
    status: c.status as 'existing' | 'not_yet_established',
    sfAccountId: c.sfAccountId,
    name: c.name,
  };
}
