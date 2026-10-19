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
  insertActivityEvent,
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
  updateQuote,
  updateQuoteDraft,
  type Quote,
  type QuoteDraftRow,
} from '@ccq/db/repos';
import {
  availableActions,
  evaluateIntake,
  ENG_QUEUE_STAGE_KEY,
  evaluateTransition,
  parseIntakeConfig,
  parseWorkflowConfig,
  type Actor,
  type IntakeConfig,
  type IntakeEvaluation,
  type WorkflowConfig,
} from '@ccq/domain';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import type { AttachmentService } from './attachments';
import { onEngQueueArrival } from './engineering-arrival';
import { recordIntakeShipToOverride } from './overrideService';
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
export async function loadIntakeConfig(
  db: DbOrTx,
): Promise<IntakeConfig & { freeTextNeckFinishes: string[] }> {
  const [requiredFields, volumePlaceholder, defaultRequestClass, drawing, neck] = await Promise.all(
    [
      getSetting(db, 'intake_required_fields'),
      getSetting(db, 'intake_volume_placeholder'),
      getSetting(db, 'intake_default_request_class'),
      listValueList(db, 'drawing_status'),
      listValueList(db, 'neck_finish'),
    ],
  );
  if (requiredFields === undefined || volumePlaceholder === undefined || !defaultRequestClass) {
    throw new Error('intake settings are not seeded (run pnpm db:seed)');
  }
  const meta = (m: unknown) => (m ?? {}) as Record<string, unknown>;
  return {
    ...parseIntakeConfig({
      requiredFields: requiredFields as never,
      volumePlaceholder: volumePlaceholder ?? {},
      defaultRequestClass: typeof defaultRequestClass === 'string' ? defaultRequestClass : '',
      drawingProvidedCodes: drawing
        .filter((v) => meta(v.meta).hasDrawing === true)
        .map((v) => v.code),
    }),
    freeTextNeckFinishes: neck.filter((v) => meta(v.meta).freeText === true).map((v) => v.code),
  };
}

const blankToNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

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
    const evaluation = evaluateIntake(intakeValues(data, config.freeTextNeckFinishes), config);
    const active =
      row.sfOpportunityId && !row.submittedQuoteId
        ? await getActiveQuoteForOpportunity(tx, row.sfOpportunityId)
        : undefined;
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      step: row.step,
      data,
      evaluation,
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
      const data = { ...(row.data as IntakeDraftData), ...(body.data ?? {}) };
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
      result = await withTx((tx) => this.submitInTx(tx, actor, id, meta));
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

  /** Links the SF Account's customer row, or records a not-yet-established one (DEC-27). */
  private async resolveCustomer(
    tx: Tx,
    actor: Actor,
    data: IntakeDraftData,
    now: Date,
  ): Promise<string> {
    // Mirrored, not created in SF. No account request, no credit check (DEC-27).
    const c = data.customer!;
    if (c.status === 'existing' && c.sfAccountId) {
      const known = await getCustomerBySfAccountId(tx, c.sfAccountId);
      if (known) return known.id;
      return (
        await insertCustomer(tx, {
          sfAccountId: c.sfAccountId,
          name: c.name!,
          status: 'existing',
          defaultShipTo: address(data.shipToDefault),
          source: 'salesforce',
          lastSyncedAt: now,
          createdBy: actor.userId,
        })
      ).id;
    }
    return (
      await insertCustomer(tx, {
        sfAccountId: null,
        name: c.name!,
        status: 'not_yet_established',
        location: blankToNull(c.location),
        contact: {
          name: blankToNull(c.contactName),
          email: blankToNull(c.contactEmail),
          phone: blankToNull(c.contactPhone),
        },
        defaultShipTo: address(data.shipTo),
        source: 'intake',
        createdBy: actor.userId,
      })
    ).id;
  }

  private async submitInTx(
    tx: Tx,
    actor: Actor,
    id: string,
    meta: AuditMeta,
  ): Promise<SubmitIntakeResponse> {
    const now = this.now();
    const draft = await this.ownDraft(tx, actor, id, true);
    const data = draft.data as IntakeDraftData;
    const config = await loadIntakeConfig(tx);
    const values = intakeValues(data, config.freeTextNeckFinishes);
    const evaluation: IntakeEvaluation = evaluateIntake(values, config);
    if (!evaluation.ready) {
      throw new IntakeError(
        422,
        INTAKE_PROBLEM_CODES.incomplete,
        'The intake is missing required information',
        {
          errors: evaluation.blocking.map((b) => ({ path: b.field, message: b.message })),
          blocking: evaluation.blocking,
        },
      );
    }
    const sfOpportunityId = data.sfOpportunityId!;
    const audit = {
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      requestId: meta.requestId ?? null,
    };

    // A rework draft goes back into its own quote (same number); anything else creates a quote.
    const reworkOf = draft.reworkOfQuoteId ? await getQuoteById(tx, draft.reworkOfQuoteId) : null;
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

    const customerId = await this.resolveCustomer(tx, actor, data, now);
    const kam = await findUserById(tx, actor.userId);
    const shipToOverridden =
      Boolean(blankToNull(data.shipToOverrideReason)) && values.ship_to !== null;
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
      resin: data.resin ?? null,
      components: data.components ?? [],
      estAnnualVolume: data.estAnnualVolume ?? null,
      estAnnualVolumeConfirmed: data.estAnnualVolumeConfirmed ?? false,
      estAnnualRevenue: data.estAnnualRevenue ?? null,
      estAnnualRevenueSf: data.estAnnualRevenueSf ?? null,
      expectedCloseDate: data.expectedCloseDate ?? null,
      drawingStatus: data.drawingStatus ?? null,
      neckFinish: values.neck_finish,
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
    if (reworkOf) {
      quote = (await updateQuote(tx, reworkOf.id, fields))!;
      await insertActivityEvent(tx, {
        quoteId: quote.id,
        type: 'quote_resubmitted',
        actorId: actor.userId,
        at: now,
        payload: { draftId: draft.id, version: quote.version, warnings: warningCodes },
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
        before: { submittedAt: null, version: reworkOf.version },
        after: { resubmitted: true, draftId: draft.id, shipToOverridden },
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
          shipToOverridden,
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

    // Routing. The KAM's own submit gate (decider quote.create) is enabled only when G1 is off.
    const workflow = parseWorkflowConfig(await loadWorkflowConfigInput(tx));
    const state = (await loadQuoteState(tx, quote.id))!;
    const submitGate = (gateKey: string) =>
      workflow.gates.find((g) => g.key === gateKey)?.deciderPermission === 'quote.create';
    const action = availableActions(workflow, state, actor).find(
      (a) => submitGate(a.gateKey) && a.targetStageKeys.length === 1,
    );

    let stageKey = 'INTAKE';
    let status: string = quote.status;
    let routedTo =
      workflow.gates.find((g) => g.enabled && g.stageKey === 'INTAKE' && !submitGate(g.key))?.key ??
      'INTAKE';
    if (action) {
      const result = evaluateTransition(
        workflow,
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
      // B-10: the EngLead's arrival alert (in-app; email is B-18).
      if (result.effects.stageHistory.enter?.stageKey === ENG_QUEUE_STAGE_KEY) {
        await onEngQueueArrival(tx, quote, actor.userId);
      }
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
      warnings,
      attachments,
    };
  }
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
    resin: q.resin,
    components: q.components,
    neckFinish: q.neckFinish,
    packagingType: q.packagingType,
    packagingNotes: q.packagingNotes,
    requestClass: q.requestClass,
    estAnnualVolume: q.estAnnualVolume,
    estAnnualVolumeConfirmed: q.estAnnualVolumeConfirmed,
    estAnnualRevenue: q.estAnnualRevenue,
    estAnnualRevenueSf: q.estAnnualRevenueSf,
    expectedCloseDate: q.expectedCloseDate,
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
  const contact = (c.contact ?? {}) as { name?: string; email?: string; phone?: string };
  return {
    status: c.status as 'existing' | 'not_yet_established',
    sfAccountId: c.sfAccountId,
    name: c.name,
    location: c.location,
    contactName: contact.name ?? null,
    contactEmail: contact.email ?? null,
    contactPhone: contact.phone ?? null,
  };
}
