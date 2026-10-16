import type {
  ActiveQuoteRef,
  IntakeDraft,
  IntakeDraftData,
  IntakeDraftSummary,
  IntakeIssue,
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
  getQuoteDraft,
  getQuoteDraftForUpdate,
  getSetting,
  insertActivityEvent,
  insertAuditEvent,
  insertCustomer,
  insertQuote,
  insertQuoteDraft,
  listOpenQuoteDrafts,
  listValueList,
  loadQuoteState,
  loadWorkflowConfigInput,
  persistTransition,
  updateQuote,
  updateQuoteDraft,
  type QuoteDraftRow,
} from '@ccq/db/repos';
import {
  availableActions,
  evaluateIntake,
  evaluateTransition,
  parseIntakeConfig,
  parseWorkflowConfig,
  type Actor,
  type IntakeConfig,
  type IntakeEvaluation,
  type ScoringEngine,
} from '@ccq/domain';

/**
 * Intake drafts and submit (B-07). The domain decides blocking vs warning (`evaluateIntake`) and the
 * routing (`availableActions` / `evaluateTransition`); this service only assembles and persists.
 */

export type IntakeWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
type WithTx = IntakeWithTx;

export interface AuditMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

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
  /** B-08 hook: the scoring engine. Until it lands, the score stays null. */
  scoring?: ScoringEngine | null;
  /**
   * Makes sure the opportunity is in the local snapshot (the quote's FK) before submit, e.g. after
   * a live SF search. Returns false when neither the snapshot nor SF knows the id.
   */
  ensureOpportunity: (withTx: WithTx, sfOpportunityId: string) => Promise<boolean>;
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
      activeQuote: activeRef(active),
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

  async list(withTx: WithTx, actor: Actor, mine: boolean): Promise<IntakeDraftSummary[]> {
    // Only Admin may list other people's drafts (RLS enforces it too).
    const own = mine || !actor.roles.includes('Admin');
    return withTx(async (tx) => {
      const rows = await listOpenQuoteDrafts(tx, own ? actor.userId : undefined);
      return rows.map((r) => {
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

    try {
      return await withTx((tx) => this.submitInTx(tx, actor, id, meta));
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

    const existing = await getActiveQuoteForOpportunity(tx, sfOpportunityId);
    if (existing) {
      throw new IntakeError(
        409,
        INTAKE_PROBLEM_CODES.activeQuoteExists,
        `This Salesforce opportunity already has an active CCQ quote (${existing.quoteNumber})`,
        { quoteNumber: existing.quoteNumber },
      );
    }

    // Customer: link the SF Account's row (mirrored, not created in SF) or record a not-yet-established
    // customer with name, location and contact only. No account request, no credit check (DEC-27).
    const c = data.customer!;
    let customerId: string;
    if (c.status === 'existing' && c.sfAccountId) {
      const known = await getCustomerBySfAccountId(tx, c.sfAccountId);
      customerId =
        known?.id ??
        (
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
    } else {
      customerId = (
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

    const kam = await findUserById(tx, actor.userId);
    const shipToOverridden =
      Boolean(blankToNull(data.shipToOverrideReason)) && values.ship_to !== null;
    const quote = await insertQuote(tx, {
      sfOpportunityId,
      customerId,
      kamUserId: actor.userId,
      region: kam?.region ?? null,
      stageKey: 'INTAKE',
      status: 'active',
      version: 1,
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
    const warningCodes = evaluation.warnings.map((w) => `${w.code}:${w.field}`);
    await insertActivityEvent(tx, {
      quoteId: quote.id,
      type: 'quote_created',
      actorId: actor.userId,
      at: now,
      payload: { sfOpportunityId, draftId: draft.id, warnings: warningCodes },
      createdBy: actor.userId,
    });
    if (shipToOverridden) {
      // Kept on the quote until B-09's override service takes ship-to changes over.
      await insertActivityEvent(tx, {
        quoteId: quote.id,
        type: 'ship_to_overridden',
        actorId: actor.userId,
        at: now,
        payload: {
          original: values.ship_to_default,
          shipTo: values.ship_to,
          reason: quote.shipToOverrideReason,
        },
        createdBy: actor.userId,
      });
    }
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
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      requestId: meta.requestId ?? null,
      createdBy: actor.userId,
    });

    // Priority score (B-08). Advisory only; null until the engine lands.
    let priorityScore: number | null = null;
    if (this.opts.scoring) {
      const result = this.opts.scoring.score({ attributes: values });
      priorityScore = result.score;
      await updateQuote(tx, quote.id, {
        priorityScore: result.score,
        priorityTier: result.tier,
        scoringModelVersion: result.modelVersion,
      });
    }

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
    let status: string = 'active';
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
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: meta.requestId ?? null,
      });
      stageKey = moved.stageKey;
      status = moved.status;
      routedTo = moved.stageKey;
      // TODO(B-10/B-18): deliver result.effects.notifications (EngLead alert on queue arrival).
    }

    const warnings: IntakeIssue[] = evaluation.warnings;
    return {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      stageKey,
      status,
      routedTo,
      priorityScore,
      warnings,
    };
  }
}
