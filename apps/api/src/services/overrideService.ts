import type {
  CreateOverrideBody,
  OverrideDto,
  OverrideLogQuery,
  OverrideLogResponse,
  OverrideStatus,
} from '@ccq/contracts';
import { OVERRIDE_PROBLEM_CODES } from '@ccq/contracts';
import type { Tx } from '@ccq/db';
import {
  findUserById,
  getOverrideForUpdate,
  getOverrideWithContext,
  getQuoteByNumber,
  getQuoteForUpdate,
  hasOpenOverride,
  insertActivityEvent,
  insertOverride,
  latestOtherAppliedOverride,
  listOverridesWithContext,
  updateOverride,
  updateQuote,
  type OverrideRow,
  type Quote,
} from '@ccq/db/repos';
import {
  describeOverrideValue,
  findOverridableField,
  planOverrideDecision,
  planOverrideRequest,
  planOverrideRevert,
  type Actor,
  type DomainError,
  type OverrideAuditAction,
  type OverrideSettings,
  type PlannedNotification,
  type PlanResult,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { decodeCursor, page } from './cursor';
import { persistNotifications } from './notifications';
import {
  currentFieldValue,
  loadOverrideSettings,
  OVERRIDE_FIELD_COLUMNS,
  overrideDto,
  overrideRecordOf,
  overrideVisible,
  policyQuoteOf,
  type OverrideViewContext,
} from './overrides-view';
import { problemErrors, ServiceProblem } from './problem';
import type { QuoteReadService } from './quotes';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type OverrideWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** Domain codes → HTTP: you may not (403), conflicts with current state (409), bad input (422). */
const FORBIDDEN = new Set(['NOT_PERMITTED', 'SEGREGATION']);
const CONFLICT = new Set(['STALE_VALUE', 'OVERRIDE_PENDING', 'INVALID_STATE']);

function throwPlanErrors(errors: readonly DomainError[]): never {
  const forbidden = errors.filter((e) => FORBIDDEN.has(e.code));
  if (forbidden.length > 0) {
    throw new ServiceProblem(
      403,
      OVERRIDE_PROBLEM_CODES.notPermitted,
      forbidden.map((e) => e.message).join('; '),
    );
  }
  const conflict = errors.find((e) => CONFLICT.has(e.code));
  if (conflict) {
    throw new ServiceProblem(409, OVERRIDE_PROBLEM_CODES.conflict, conflict.message, {
      errors: problemErrors([conflict]),
    });
  }
  throw new ServiceProblem(422, OVERRIDE_PROBLEM_CODES.rejected, 'The override was not accepted', {
    errors: problemErrors(errors),
  });
}

function unwrap<T>(result: PlanResult<T>): T {
  if (!result.ok) throwPlanErrors(result.errors);
  return result.plan;
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';

export interface OverrideServiceOptions {
  quotes: QuoteReadService;
  log?: FastifyBaseLogger;
  now?: () => Date;
}

interface WriteContext {
  tx: Tx;
  actor: Actor;
  meta: AuditMeta;
  at: Date;
  settings: OverrideSettings;
}

/** The activity payload of an override event (what the timeline shows). */
function eventPayload(
  o: Pick<OverrideRow, 'id' | 'field' | 'justification' | 'approvalMode'>,
  settings: OverrideSettings,
  from: unknown,
  to: unknown,
  extra: Record<string, unknown> = {},
) {
  return {
    overrideId: o.id,
    field: o.field,
    fieldLabel: findOverridableField(settings, o.field)?.label ?? o.field,
    from: from ?? null,
    to: to ?? null,
    fromDisplay: describeOverrideValue(o.field, from),
    toDisplay: describeOverrideValue(o.field, to),
    justification: o.justification,
    approvalMode: o.approvalMode,
    ...extra,
  };
}

/**
 * Write an applied override's value onto the quote (sets the field and its `*_overridden` flag), plus
 * the activity event and audit rows. Shared by approve, self-apply and the intake ship-to (B-07).
 */
async function applyOverride(
  w: WriteContext,
  quote: Quote,
  o: OverrideRow,
  audits: readonly OverrideAuditAction[],
  extra: Record<string, unknown> = {},
) {
  const columns = OVERRIDE_FIELD_COLUMNS[o.field]!;
  const before = currentFieldValue(quote, o.field);
  await updateQuote(w.tx, quote.id, columns.write(o.requestedValue, true, o.justification, quote));
  await insertActivityEvent(w.tx, {
    quoteId: quote.id,
    type: 'override_applied',
    actorId: w.actor.userId,
    at: w.at,
    payload: eventPayload(o, w.settings, before, o.requestedValue, extra),
    createdBy: w.actor.userId,
  });
  await auditOverride(w, quote.id, o, audits, before, o.requestedValue);
}

async function auditOverride(
  w: WriteContext,
  quoteId: string,
  o: Pick<OverrideRow, 'id' | 'field' | 'justification'>,
  actions: readonly OverrideAuditAction[],
  before: unknown,
  after: unknown,
  extra: Record<string, unknown> = {},
) {
  for (const action of actions) {
    const writesValue = action === 'override_applied' || action === 'override_reverted';
    await recordAudit(w.tx, w.actor, w.meta, {
      at: w.at,
      action,
      entity: 'override',
      entityId: o.id,
      quoteId,
      before: { field: o.field, ...(writesValue ? { value: before ?? null } : {}) },
      after: {
        field: o.field,
        status: action.replace('override_', ''),
        ...(writesValue ? { value: after ?? null } : { requestedValue: after ?? null }),
        justification: o.justification,
        ...extra,
      },
    });
  }
}

/**
 * Record a self-applied override that another flow already wrote to the quote: the intake's ship-to
 * (B-07 asked for a reason when the ship-to differs from the account default). One `override` row
 * (applied, self), an `override_applied` activity event and the audit rows.
 */
export async function recordIntakeShipToOverride(
  tx: Tx,
  actor: Actor,
  meta: AuditMeta,
  quoteId: string,
  original: unknown,
  requested: unknown,
  justification: string,
  at: Date,
) {
  const settings = await loadOverrideSettings(tx);
  const w: WriteContext = { tx, actor, meta, at, settings };
  const o = await insertOverride(tx, {
    quoteId,
    field: 'ship_to',
    originalValue: original ?? null,
    requestedValue: requested ?? {},
    justification,
    requestedBy: actor.userId,
    status: 'applied',
    approvalMode: 'self',
    decidedBy: actor.userId,
    decidedAt: at,
    appliedAt: at,
    createdAt: at,
    createdBy: actor.userId,
  });
  await insertActivityEvent(tx, {
    quoteId,
    type: 'override_applied',
    actorId: actor.userId,
    at,
    payload: eventPayload(o, settings, original, requested, { source: 'intake' }),
    createdBy: actor.userId,
  });
  await auditOverride(
    w,
    quoteId,
    o,
    ['override_requested', 'override_applied'],
    original,
    requested,
    {
      source: 'intake',
    },
  );
  return o;
}

/**
 * Governed overrides (F-06, B-09): request → approve / reject → applied → one-click revert, for any
 * field in `overridable_fields`. The domain plans every step (who may, justification, value, 409 on a
 * stale value); this service locks the rows, persists the plan in ONE transaction with its activity
 * event, audit rows (before/after) and in-app notifications, and returns the updated override.
 */
export class OverrideService {
  private readonly now: () => Date;

  constructor(private readonly opts: OverrideServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  private async viewContext(
    tx: Tx,
    actor: Actor,
    at: Date,
  ): Promise<OverrideViewContext & { tierKeys: string[] }> {
    const ctx = await this.opts.quotes.context(tx, actor, at);
    return {
      actor,
      settings: ctx.overrides,
      kamCanSeePeerScores: ctx.kamCanSeePeerScores,
      tierKeys: ctx.model?.tiers.map((t) => t.key) ?? [],
    };
  }

  private async dto(tx: Tx, view: OverrideViewContext, id: string): Promise<OverrideDto> {
    return overrideDto((await getOverrideWithContext(tx, id))!, view);
  }

  private async notify(
    tx: Tx,
    planned: readonly PlannedNotification[],
    actor: Actor,
    o: OverrideRow,
    quote: Quote,
    title: string,
  ) {
    if (planned.length === 0) return;
    const who = (await findUserById(tx, actor.userId))?.displayName ?? 'Someone';
    await persistNotifications(
      tx,
      planned,
      {
        quoteId: quote.id,
        title: `${title}: ${quote.quoteNumber}`,
        body: `${who}: ${describeOverrideValue(o.field, o.originalValue)} → ${describeOverrideValue(o.field, o.requestedValue)}. ${o.justification}`,
        excludeUserId: actor.userId,
      },
      this.opts.log,
    );
  }

  async request(
    withTx: OverrideWithTx,
    actor: Actor,
    quoteNumber: string,
    body: CreateOverrideBody,
    meta: AuditMeta,
  ): Promise<OverrideDto> {
    const at = this.now();
    try {
      return await withTx(async (tx) => {
        const found = await getQuoteByNumber(tx, quoteNumber);
        if (!found) {
          throw new ServiceProblem(404, OVERRIDE_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
        }
        const quote = (await getQuoteForUpdate(tx, found.id))!;
        const view = await this.viewContext(tx, actor, at);
        if (!overrideVisible(view, body.field, quote.kamUserId)) {
          throw new ServiceProblem(403, OVERRIDE_PROBLEM_CODES.notPermitted, 'Not permitted');
        }
        const plan = unwrap(
          planOverrideRequest(
            view.settings,
            actor,
            await policyQuoteOf(tx, quote),
            body,
            currentFieldValue(quote, body.field),
            { tierKeys: view.tierKeys },
            { openRequestExists: await hasOpenOverride(tx, quote.id, body.field) },
          ),
        );
        const o = await insertOverride(tx, {
          quoteId: quote.id,
          field: plan.field,
          originalValue: plan.originalValue,
          requestedValue: plan.requestedValue,
          justification: plan.justification,
          requestedBy: actor.userId,
          status: plan.status,
          approvalMode: plan.approvalMode,
          ...(plan.apply ? { decidedBy: actor.userId, decidedAt: at, appliedAt: at } : {}),
          createdAt: at,
          createdBy: actor.userId,
        });
        const w: WriteContext = { tx, actor, meta, at, settings: view.settings };
        if (plan.apply) {
          await applyOverride(w, quote, o, plan.audits);
        } else {
          await insertActivityEvent(tx, {
            quoteId: quote.id,
            type: plan.activityType,
            actorId: actor.userId,
            at,
            payload: eventPayload(o, view.settings, plan.originalValue, plan.requestedValue),
            createdBy: actor.userId,
          });
          await auditOverride(w, quote.id, o, plan.audits, plan.originalValue, plan.requestedValue);
        }
        await this.notify(tx, plan.notifications, actor, o, quote, 'Override to approve');
        return this.dto(tx, view, o.id);
      });
    } catch (err) {
      // Two requests raced past the pending check: the partial unique index caught the second.
      if (isUniqueViolation(err)) {
        throw new ServiceProblem(
          409,
          OVERRIDE_PROBLEM_CODES.conflict,
          'An override on this field is already waiting for a decision',
        );
      }
      throw err;
    }
  }

  /** Lock the override and its quote, or 404 when either is not visible to the caller (RLS). */
  private async locked(tx: Tx, id: string) {
    const o = await getOverrideForUpdate(tx, id);
    if (!o) throw new ServiceProblem(404, OVERRIDE_PROBLEM_CODES.notFound, `No override ${id}`);
    const quote = (await getQuoteForUpdate(tx, o.quoteId))!;
    return { o, quote };
  }

  async decide(
    withTx: OverrideWithTx,
    actor: Actor,
    id: string,
    decision: 'approve' | 'reject',
    note: string | undefined,
    meta: AuditMeta,
  ): Promise<OverrideDto> {
    const at = this.now();
    return withTx(async (tx) => {
      const { o, quote } = await this.locked(tx, id);
      const view = await this.viewContext(tx, actor, at);
      if (!overrideVisible(view, o.field, quote.kamUserId)) {
        throw new ServiceProblem(404, OVERRIDE_PROBLEM_CODES.notFound, `No override ${id}`);
      }
      const plan = unwrap(
        planOverrideDecision(
          view.settings,
          actor,
          await policyQuoteOf(tx, quote),
          overrideRecordOf(o),
          decision,
          currentFieldValue(quote, o.field),
          note,
        ),
      );
      const updated = (await updateOverride(tx, o.id, {
        status: plan.status,
        decidedBy: actor.userId,
        decidedAt: at,
        decisionNote: plan.note,
        ...(plan.apply ? { appliedAt: at } : {}),
      }))!;
      const w: WriteContext = { tx, actor, meta, at, settings: view.settings };
      if (plan.apply) {
        await applyOverride(w, quote, updated, plan.audits, { note: plan.note });
      } else {
        await insertActivityEvent(tx, {
          quoteId: quote.id,
          type: plan.activityType,
          actorId: actor.userId,
          at,
          payload: eventPayload(o, view.settings, o.originalValue, o.requestedValue, {
            note: plan.note,
          }),
          createdBy: actor.userId,
        });
        await auditOverride(w, quote.id, o, plan.audits, o.originalValue, o.requestedValue, {
          note: plan.note,
        });
      }
      await this.notify(
        tx,
        plan.notifications,
        actor,
        o,
        quote,
        decision === 'approve' ? 'Override approved' : 'Override rejected',
      );
      return this.dto(tx, view, o.id);
    });
  }

  async revert(
    withTx: OverrideWithTx,
    actor: Actor,
    id: string,
    meta: AuditMeta,
  ): Promise<OverrideDto> {
    const at = this.now();
    return withTx(async (tx) => {
      const { o, quote } = await this.locked(tx, id);
      const view = await this.viewContext(tx, actor, at);
      if (!overrideVisible(view, o.field, quote.kamUserId)) {
        throw new ServiceProblem(404, OVERRIDE_PROBLEM_CODES.notFound, `No override ${id}`);
      }
      const current = currentFieldValue(quote, o.field);
      const plan = unwrap(
        planOverrideRevert(
          view.settings,
          actor,
          await policyQuoteOf(tx, quote),
          overrideRecordOf(o),
          current,
        ),
      );
      // An earlier applied override on the same field still holds after this one is undone.
      const still = await latestOtherAppliedOverride(tx, quote.id, o.field, o.id);
      await updateQuote(
        tx,
        quote.id,
        OVERRIDE_FIELD_COLUMNS[o.field]!.write(
          plan.restoreValue,
          still !== undefined,
          still?.justification ?? null,
          quote,
        ),
      );
      await updateOverride(tx, o.id, {
        status: plan.status,
        revertedBy: actor.userId,
        revertedAt: at,
      });
      await insertActivityEvent(tx, {
        quoteId: quote.id,
        type: plan.activityType,
        actorId: actor.userId,
        at,
        payload: eventPayload(o, view.settings, current, plan.restoreValue),
        createdBy: actor.userId,
      });
      const w: WriteContext = { tx, actor, meta, at, settings: view.settings };
      await auditOverride(w, quote.id, o, plan.audits, current, plan.restoreValue);
      await this.notify(tx, plan.notifications, actor, o, quote, 'Override reverted');
      return this.dto(tx, view, o.id);
    });
  }

  /** Every override on one quote (in scope), newest first. */
  async listForQuote(withTx: OverrideWithTx, actor: Actor, quoteNumber: string) {
    const at = this.now();
    return withTx(async (tx) => {
      const quote = await getQuoteByNumber(tx, quoteNumber);
      if (!quote) {
        throw new ServiceProblem(404, OVERRIDE_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
      }
      const view = await this.viewContext(tx, actor, at);
      const rows = await listOverridesWithContext(tx, { quoteId: quote.id, limit: 200 });
      return {
        items: rows
          .filter((r) => overrideVisible(view, r.override.field, r.kamUserId))
          .map((r) => overrideDto(r, view)),
      };
    });
  }

  /**
   * The approver inbox: open requests the caller may decide (`status=requested`, the default), or for
   * another status the overrides the caller requested or decided.
   */
  async inbox(withTx: OverrideWithTx, actor: Actor, status: OverrideStatus) {
    const at = this.now();
    return withTx(async (tx) => {
      const view = await this.viewContext(tx, actor, at);
      const rows = await listOverridesWithContext(tx, { statuses: [status], limit: 200 });
      const items = rows
        .filter((r) => overrideVisible(view, r.override.field, r.kamUserId))
        .map((r) => overrideDto(r, view))
        .filter((d) =>
          status === 'requested'
            ? d.canDecide
            : d.requestedBy === actor.userId || d.decidedBy === actor.userId,
        );
      return { items };
    });
  }

  /** The override log (overrideLog.read: Leadership + Admin), newest first, keyset-paged. */
  async log(
    withTx: OverrideWithTx,
    actor: Actor,
    query: OverrideLogQuery,
  ): Promise<OverrideLogResponse> {
    const at = this.now();
    const before = query.cursor ? decodeCursor(query.cursor) : undefined;
    if (before === null) {
      throw new ServiceProblem(400, 'bad_cursor', 'The cursor is not valid');
    }
    return withTx(async (tx) => {
      const view = await this.viewContext(tx, actor, at);
      const rows = await listOverridesWithContext(tx, {
        ...(query.status ? { statuses: [query.status] } : {}),
        ...(query.field ? { field: query.field } : {}),
        ...(before ? { before } : {}),
        limit: query.limit + 1,
      });
      const { items, nextCursor } = page(rows, query.limit, (r) => ({
        at: r.override.createdAt,
        id: r.override.id,
      }));
      return { items: items.map((r) => overrideDto(r, view)), nextCursor };
    });
  }
}
