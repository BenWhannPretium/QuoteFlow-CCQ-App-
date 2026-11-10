import type {
  ActiveQuoteRef,
  IntakeDraft,
  IntakeDraftData,
  IntakeDraftListResponse,
  IntakeIssue,
  ReturnedQuoteSummary,
  SubmitIntakeResponse,
} from '@ccq/contracts';
import { INTAKE_PROBLEM_CODES, intakeAddress as address, intakeValues } from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import { schema } from '@ccq/db';
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
  listAttachments,
  listDraftAttachments,
  insertAuditEvent,
  insertCustomer,
  insertQuote,
  insertQuoteDraft,
  listGateDecisionsWithNames,
  listOpenQuoteDrafts,
  listReturnedQuotes,
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
  asksScopeChange,
  availableActions,
  CUSTOM_LIST_FIELDS,
  DRAWING_ATTACHMENT_KINDS,
  evaluateIntake,
  inapplicableIntakeFields,
  subMarketAfterMarketChange,
  ENG_QUEUE_STAGE_KEY,
  evaluateTransition,
  planResubmitRoute,
  PRICING_QUEUE_STAGE_KEY,
  parseIntakeConfig,
  parseIntakeGuardrails,
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

/** Reads the intake config from app settings and value-list meta. Throws if a setting is missing. */
/** FB-12: active `sub_market` entries → { code: parent market code } (value-list meta `market`). */
function subMarketMap(entries: { code: string; meta: unknown }[]): Record<string, string> {
  return Object.fromEntries(
    entries.flatMap((e) => {
      const market = meta(e.meta).market;
      return typeof market === 'string' ? [[e.code, market] as const] : [];
    }),
  );
}

export async function loadIntakeConfig(db: DbOrTx): Promise<IntakeConfig> {
  const [
    requiredFields,
    volumePlaceholder,
    defaultRequestClass,
    allowedRequestClasses,
    redirectMessage,
    variantsNoteMaxLength,
    minSpecFields,
    standardPaymentTerms,
    guardrails,
    drawing,
    components,
    priceBasis,
    subMarkets,
    ...customLists
  ] = await Promise.all([
    getSetting(db, 'intake_required_fields'),
    getSetting(db, 'intake_volume_placeholder'),
    getSetting(db, 'intake_default_request_class'),
    getSetting(db, 'intake_allowed_request_classes'),
    getSetting(db, 'intake_redirect_message'),
    getSetting(db, 'intake_variants_note_max_length'),
    getSetting(db, 'intake_min_spec_fields'),
    getSetting(db, 'standard_payment_terms'),
    getSetting(db, 'intake_guardrails'),
    listValueList(db, 'drawing_status'),
    listValueList(db, 'component'),
    listValueList(db, 'price_basis'),
    listValueList(db, 'sub_market'),
    ...CUSTOM_LIST_FIELDS.map((list) => listValueList(db, list)),
  ]);
  if (
    requiredFields === undefined ||
    volumePlaceholder === undefined ||
    !defaultRequestClass ||
    allowedRequestClasses === undefined ||
    !redirectMessage
  ) {
    throw new Error('intake settings are not seeded (run pnpm db:seed)');
  }
  return parseIntakeConfig({
    requiredFields: requiredFields as never,
    volumePlaceholder: volumePlaceholder ?? {},
    defaultRequestClass: typeof defaultRequestClass === 'string' ? defaultRequestClass : '',
    allowedRequestClasses: allowedRequestClasses as never,
    redirectMessage: typeof redirectMessage === 'string' ? redirectMessage : '',
    ...(typeof variantsNoteMaxLength === 'number' ? { variantsNoteMaxLength } : {}),
    ...(Array.isArray(minSpecFields) ? { minSpecFields: minSpecFields as never } : {}),
    // FB-11 (F-080): a missing setting means no payment terms are flagged (it is seeded, provisional).
    ...(Array.isArray(standardPaymentTerms)
      ? { standardPaymentTerms: standardPaymentTerms as never }
      : {}),
    // FB-10 (F-066): a missing or malformed setting leaves the platform-minimum warning off.
    guardrails: parseIntakeGuardrails(guardrails),
    subMarketMarkets: subMarketMap(subMarkets),
    deliveredPriceBasisCodes: priceBasis
      .filter((v) => meta(v.meta).delivered === true)
      .map((v) => v.code),
    drawingProvidedCodes: drawing
      .filter((v) => meta(v.meta).hasDrawing === true)
      .map((v) => v.code),
    customCodes: Object.fromEntries(
      CUSTOM_LIST_FIELDS.map((list, i) => [
        list,
        customLists[i]!.filter((v) => meta(v.meta).freeText === true).map((v) => v.code),
      ]),
    ),
    componentFollowUps: Object.fromEntries(
      components
        .filter((v) => Array.isArray(meta(v.meta).followUps))
        .map((v) => [v.code, meta(v.meta).followUps as never]),
    ),
  });
}

const meta = (m: unknown) => (m ?? {}) as Record<string, unknown>;

/**
 * FB-02 (F-016): a bottle or competitor drawing is attached to the draft or, for a rework, already on
 * the quote. RLS applies (the caller is the draft's owner).
 */
async function hasDrawingAttachment(db: DbOrTx, draft: QuoteDraftRow): Promise<boolean> {
  const files = [
    ...(await listDraftAttachments(db, draft.id)),
    ...(draft.reworkOfQuoteId ? await listAttachments(db, draft.reworkOfQuoteId) : []),
  ];
  return files.some((f) => (DRAWING_ATTACHMENT_KINDS as readonly string[]).includes(f.kind));
}

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
}

export class IntakeService {
  private readonly now: () => Date;

  constructor(private readonly opts: IntakeServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  private async toDto(tx: DbOrTx, row: QuoteDraftRow): Promise<IntakeDraft> {
    const config = await loadIntakeConfig(tx);
    const data = row.data as IntakeDraftData;
    const evaluation = evaluateIntake(
      intakeValues(data, await hasDrawingAttachment(tx, row)),
      config,
      this.now(),
    );
    const active =
      row.sfOpportunityId && !row.submittedQuoteId
        ? await getActiveQuoteForOpportunity(tx, row.sfOpportunityId)
        : undefined;
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
      rework: row.reworkOfQuoteId ? await this.reworkInfo(tx, row.reworkOfQuoteId) : null,
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
      const row = await insertQuoteDraft(tx, {
        ownerUserId: actor.userId,
        sfOpportunityId: body.data.sfOpportunityId ?? null,
        step: body.step,
        data: body.data,
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
      const data: IntakeDraftData = last
        ? (last.data as IntakeDraftData)
        : { ...dataFromQuote(q), customer: await customerForDraft(tx, q.customerId) };
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
    body: { data?: IntakeDraftData | undefined; step?: number | undefined },
  ): Promise<IntakeDraft> {
    return withTx(async (tx) => {
      const row = await this.ownDraft(tx, actor, id, true);
      const before = row.data as IntakeDraftData;
      const data = { ...before, ...(body.data ?? {}) };
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
    const data = draft.data as IntakeDraftData;
    const config = await loadIntakeConfig(tx);
    const values = intakeValues(data, await hasDrawingAttachment(tx, draft));
    const evaluation: IntakeEvaluation = evaluateIntake(values, config, now);
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
      const existing = await getActiveQuoteForOpportunity(tx, sfOpportunityId);
      if (existing) {
        throw new IntakeError(
          409,
          INTAKE_PROBLEM_CODES.activeQuoteExists,
          `This Salesforce opportunity already has an active CCQ quote (${existing.quoteNumber})`,
          { quoteNumber: existing.quoteNumber },
        );
      }
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
    const cleared = new Set(inapplicableIntakeFields(values, config));
    const keep = <T>(field: string, value: T): T | null => (cleared.has(field) ? null : value);
    const fields = {
      customerId,
      description: blankToNull(data.description),
      structuredDescription: {
        standard: blankToNull(data.standardDescription),
        containerType: data.productFamily ?? null,
        size: blankToNull(data.containerSize),
        resin: data.resin ?? null,
        components: data.components ?? [],
      },
      productFamily: data.productFamily ?? null,
      market: data.market ?? null,
      // FB-12 (F-073): optional; evaluateIntake has already checked that it belongs to the market.
      subMarket: values.sub_market,
      resin: data.resin ?? null,
      components: data.components ?? [],
      estAnnualVolume: data.estAnnualVolume ?? null,
      estAnnualVolumeConfirmed: data.estAnnualVolumeConfirmed ?? false,
      estAnnualRevenue: data.estAnnualRevenue ?? null,
      estAnnualRevenueSf: data.estAnnualRevenueSf ?? null,
      // FB-02 (F-009): the need-by dates replace the close date (expected_close_date is no longer written).
      quoteNeededBy: data.quoteNeededBy ?? null,
      productNeededBy: data.productNeededBy ?? null,
      drawingStatus: data.drawingStatus ?? null,
      // FB-02 (F-010, F-011, F-055, F-023, F-075): product facts. A description of a value that isn't
      // "Custom", or a grade without the checkbox, is cleared. The old neck_finish is no longer written.
      neckDiameter: values.neck_diameter,
      neckDiameterCustom: keep('neck_diameter_custom', values.neck_diameter_custom),
      neckFinishType: values.neck_finish_type,
      neckFinishTypeCustom: keep('neck_finish_type_custom', values.neck_finish_type_custom),
      neckSpecialFeature: values.neck_special_feature,
      neckSpecialFeatureCustom: keep(
        'neck_special_feature_custom',
        values.neck_special_feature_custom,
      ),
      resinCustomerSpecified: values.resin_customer_specified,
      resinGrade: keep('resin_grade', values.resin_grade),
      pcrLevel: values.pcr_level,
      colorType: values.color_type,
      colorDescription: keep('color_description', values.color_description),
      additives: values.additives,
      quoteVariantsNote: values.quote_variants_note,
      // F-013: a component's follow-ups are kept only while the component is picked.
      linerSpec: keep('liner_spec', values.liner_spec),
      labelsPurchasedBy: keep('labels_purchased_by', values.labels_purchased_by),
      decorationType: keep('decoration_type', values.decoration_type),
      decorationPrintColors: keep('decoration_print_colors', values.decoration_print_colors),
      // F-016 dimensions (2 decimals), F-015 mold modification, F-014 RFP link.
      heightMm: round2(values.height_mm),
      widthOrDiameterMm: round2(values.width_or_diameter_mm),
      depthMm: round2(values.depth_mm),
      gramWeightG: round2(values.gram_weight_g),
      modifyExistingMold: values.modify_existing_mold,
      existingMoldRef: keep('existing_mold_ref', values.existing_mold_ref),
      moldChangeDescription: keep('mold_change_description', values.mold_change_description),
      rfpLink: values.rfp_link,
      // FB-11 (D-032): commercial inputs. Freight is kept only for a delivered price; the "Other"
      // description only for Other. The funding answer defaults to the list's default ("Not discussed"),
      // except on a rework of a quote that already has one.
      requestedPaymentTerms: values.requested_payment_terms,
      requestedPaymentTermsOther: keep(
        'requested_payment_terms_other',
        values.requested_payment_terms_other,
      ),
      toolingFundingModel:
        values.tooling_funding_model ??
        (reworkOf ? reworkOf.toolingFundingModel : await defaultFundingCode(tx)),
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
      packagingType: data.packagingType ?? null,
      packagingNotes: blankToNull(data.packagingNotes),
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

    const attachments =
      (await this.opts.attachments?.claimDraftFiles(tx, actor, draft.id, quote.id, now)) ?? 0;
    await updateQuoteDraft(tx, draft.id, { submittedQuoteId: quote.id, submittedAt: now });

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

/** Intake fields as stored on the quote, for a rework draft of a quote with no draft of its own. */
function dataFromQuote(q: Quote): IntakeDraftData {
  const structured = (q.structuredDescription ?? {}) as { standard?: string; size?: string };
  return {
    sfOpportunityId: q.sfOpportunityId,
    productFamily: q.productFamily,
    market: q.market,
    ...(q.subMarket ? { subMarket: q.subMarket } : {}),
    resin: q.resin,
    components: q.components,
    neckDiameter: q.neckDiameter,
    neckDiameterCustom: q.neckDiameterCustom,
    neckFinishType: q.neckFinishType,
    neckFinishTypeCustom: q.neckFinishTypeCustom,
    neckSpecialFeature: q.neckSpecialFeature,
    neckSpecialFeatureCustom: q.neckSpecialFeatureCustom,
    resinCustomerSpecified: q.resinCustomerSpecified,
    resinGrade: q.resinGrade,
    pcrLevel: q.pcrLevel,
    colorType: q.colorType,
    colorDescription: q.colorDescription,
    additives: q.additives,
    quoteVariantsNote: q.quoteVariantsNote,
    linerSpec: q.linerSpec,
    labelsPurchasedBy: q.labelsPurchasedBy,
    decorationType: q.decorationType,
    decorationPrintColors: q.decorationPrintColors,
    heightMm: q.heightMm,
    widthOrDiameterMm: q.widthOrDiameterMm,
    depthMm: q.depthMm,
    gramWeightG: q.gramWeightG,
    modifyExistingMold: q.modifyExistingMold,
    existingMoldRef: q.existingMoldRef,
    moldChangeDescription: q.moldChangeDescription,
    rfpLink: q.rfpLink,
    requestedPaymentTerms: q.requestedPaymentTerms,
    requestedPaymentTermsOther: q.requestedPaymentTermsOther,
    toolingFundingModel: q.toolingFundingModel,
    returnableDunnage: q.returnableDunnage,
    priceBasis: q.priceBasis,
    freightType: q.freightType,
    freightSpecialArrangements: q.freightSpecialArrangements,
    bidReference: q.bidReference,
    packagingType: q.packagingType,
    packagingNotes: q.packagingNotes,
    requestClass: q.requestClass,
    estAnnualVolume: q.estAnnualVolume,
    estAnnualVolumeConfirmed: q.estAnnualVolumeConfirmed,
    estAnnualRevenue: q.estAnnualRevenue,
    estAnnualRevenueSf: q.estAnnualRevenueSf,
    quoteNeededBy: q.quoteNeededBy,
    productNeededBy: q.productNeededBy,
    drawingStatus: q.drawingStatus,
    description: q.description,
    standardDescription: structured.standard ?? null,
    containerSize: structured.size ?? null,
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
