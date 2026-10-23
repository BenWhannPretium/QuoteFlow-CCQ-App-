import {
  COMMERCIAL_PROBLEM_CODES,
  type CapitalFlagBody,
  type CommercialDetail,
  type EscalationBody,
  type EscalationResponse,
  type QuoteDetail,
  type TermsBody,
} from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import {
  getQuoteByNumber,
  getSetting,
  insertActivityEvent,
  listUsersByIds,
  listValueList,
  loadQuoteState,
  loadWorkflowConfigInput,
  updateQuote,
  type Quote,
} from '@ccq/db/repos';
import {
  CAPITAL_NOTICE_SEED,
  ESCALATION_ROUTES_SEED,
  LEGAL_REVIEW_TRIGGERS_SEED,
  LEGAL_TRIGGER_LABELS,
  MARKET_DEV_NOTICE_SEED,
  PASS_THROUGH_SEED,
  PROCESS_OWNER_SEED,
  can,
  derivedDecisionFields,
  parseCapitalNotice,
  parseEscalationRoutes,
  parseLegalReviewTriggers,
  parseMarketDevNotice,
  parsePassThrough,
  parseProcessOwner,
  parseWorkflowConfig,
  planCapitalNotice,
  planEscalation,
  planMarketDevNotice,
  planTerms,
  type Actor,
  type CapitalNoticeSetting,
  type DerivedFieldSettings,
  type DomainError,
  type EscalationRoute,
  type LegalTrigger,
  type MarketDevNoticeSetting,
  type ProcessOwnerSetting,
  type QuoteState,
  type TermsValues,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { persistNotifications } from './notificationService';
import { ServiceProblem, problemErrors } from './problem';
import type { QuoteReadService } from './quotes';
import { recordAudit, type AuditMeta } from '../plugins/audit';

/**
 * B-26 (CCQ demo 10/20 and the future-state process deck): the quote's commercial terms and Legal
 * review (slides 12-13), the early "capital likely" flag with its Capital Management notice (slide 9),
 * the Market Development notice (slide 10) and escalations to configured recipients and the CCQ
 * Process Owner (slides 8, 10-12). The rules are the domain's (`commercial/`); every setting is config.
 */

export type CommercialWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export class CommercialError extends ServiceProblem {
  override name = 'CommercialError';
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function fail(errors: readonly DomainError[]): never {
  const forbidden = errors.filter((e) => e.code === 'NOT_PERMITTED');
  if (forbidden.length > 0) {
    throw new CommercialError(
      403,
      COMMERCIAL_PROBLEM_CODES.notPermitted,
      forbidden.map((e) => e.message).join('; '),
    );
  }
  const closed = errors.find((e) => e.code === 'QUOTE_CLOSED');
  if (closed) throw new CommercialError(409, COMMERCIAL_PROBLEM_CODES.conflict, closed.message);
  throw new CommercialError(422, COMMERCIAL_PROBLEM_CODES.rejected, 'The change was not accepted', {
    errors: problemErrors(errors),
  });
}

/** The B-26 settings, each falling back to its seed. */
export interface CommercialSettings {
  derived: DerivedFieldSettings;
  capitalNotice: CapitalNoticeSetting;
  marketDev: MarketDevNoticeSetting;
  routes: EscalationRoute[];
  processOwner: ProcessOwnerSetting;
}

export async function loadCommercialSettings(db: DbOrTx): Promise<CommercialSettings> {
  const [legal, passThrough, capital, marketDev, routes, owner] = await Promise.all([
    getSetting(db, 'legal_review_triggers'),
    getSetting(db, 'pricing_pass_through'),
    getSetting(db, 'capital_management_notice'),
    getSetting(db, 'market_development_notice'),
    getSetting(db, 'escalation_routes'),
    getSetting(db, 'process_owner'),
  ]);
  return {
    derived: {
      legalReviewTriggers: parseLegalReviewTriggers(legal ?? LEGAL_REVIEW_TRIGGERS_SEED),
      passThrough: parsePassThrough(passThrough ?? PASS_THROUGH_SEED),
    },
    capitalNotice: parseCapitalNotice(capital ?? CAPITAL_NOTICE_SEED),
    marketDev: parseMarketDevNotice(marketDev ?? MARKET_DEV_NOTICE_SEED),
    routes: parseEscalationRoutes(routes ?? ESCALATION_ROUTES_SEED),
    processOwner: parseProcessOwner(owner ?? PROCESS_OWNER_SEED),
  };
}

/** The quote's terms as the domain's values. */
function termsValues(q: Quote): TermsValues {
  return {
    toolingFundingModel: q.toolingFundingModel,
    termsToolingCommitment: q.termsToolingCommitment,
    termsMoq: q.termsMoq,
    termsPaymentTerms: q.termsPaymentTerms,
    termsNonstandard: q.termsNonstandard,
    termsNotes: q.termsNotes,
    termsCheckedAt: q.termsCheckedAt,
    termsCheckedBy: q.termsCheckedBy,
    legalReviewedOn: q.legalReviewedOn,
    legalReviewerName: q.legalReviewerName,
    legalReviewNote: q.legalReviewNote,
    legalRecordedBy: q.legalRecordedBy,
  };
}

/** `QuoteDetail.commercial`. Nothing here is commercial-sensitive (no figures). */
export async function commercialView(
  db: DbOrTx,
  actor: Actor,
  settings: CommercialSettings,
  q: Quote,
  state: QuoteState,
): Promise<CommercialDetail> {
  const people = await listUsersByIds(
    db,
    [
      q.capitalLikelySetBy,
      q.termsCheckedBy,
      q.legalRecordedBy,
      q.holdOwnerId,
      settings.processOwner.userId,
    ].filter((id): id is string => !!id),
  );
  const name = (id: string | null | undefined) =>
    (id && people.find((p) => p.id === id)?.displayName) || null;
  const derived = derivedDecisionFields(state.fields, settings.derived);
  const open = q.status !== 'closed';
  return {
    capital: {
      likely: q.capitalLikely,
      setByName: name(q.capitalLikelySetBy),
      setAt: iso(q.capitalLikelySetAt),
      noticeSentAt: iso(q.capitalNoticeSentAt),
      canEdit: open && can(actor, 'capitalFlag.edit', state),
    },
    terms: {
      toolingFundingModel: q.toolingFundingModel,
      termsToolingCommitment: q.termsToolingCommitment,
      termsMoq: q.termsMoq,
      termsPaymentTerms: q.termsPaymentTerms,
      termsNonstandard: q.termsNonstandard,
      termsNotes: q.termsNotes,
      checkedAt: iso(q.termsCheckedAt),
      checkedByName: name(q.termsCheckedBy),
      canEdit: open && can(actor, 'terms.edit', state),
    },
    legal: {
      required: derived.legal_review_required,
      reasons: derived.legal_review_reasons.map((code) => ({
        code,
        label: LEGAL_TRIGGER_LABELS[code as LegalTrigger] ?? code,
      })),
      reviewedOn: q.legalReviewedOn,
      reviewerName: q.legalReviewerName,
      note: q.legalReviewNote,
      recordedByName: name(q.legalRecordedBy),
    },
    passThroughEligible: derived.pass_through_eligible,
    hold: { ownerId: q.holdOwnerId, ownerName: name(q.holdOwnerId) },
    escalation: {
      canEscalate: open && can(actor, 'quote.escalate', state),
      routes: settings.routes.map((r) => ({
        code: r.code,
        label: r.label,
        description: r.description,
      })),
      processOwner: {
        name: name(settings.processOwner.userId),
        label: settings.processOwner.label,
      },
    },
  };
}

/** Capital Management's early notice, once per quote, when the flag is (first) set. */
async function sendCapitalNotice(
  tx: DbOrTx,
  settings: CommercialSettings,
  q: Quote,
  actorId: string,
  now: Date,
  log?: FastifyBaseLogger,
): Promise<boolean> {
  const planned = planCapitalNotice(settings.capitalNotice, {
    capitalLikely: true,
    capitalNoticeSentAt: q.capitalNoticeSentAt,
  });
  if (planned.length === 0) return false;
  await persistNotifications(
    tx,
    planned,
    {
      quoteId: q.id,
      title: `${q.quoteNumber} is flagged "capital likely"`,
      body: 'Early notice for Capital Management (awareness, not approval): significant capital is likely on this quote.',
      excludeUserId: actorId,
    },
    log,
  );
  await updateQuote(tx, q.id, { capitalNoticeSentAt: now });
  return true;
}

/**
 * B-26: Market Development hears once when a quote at or above the configured value threshold enters
 * Engineering Review (it was qualified). Called from the engineering-queue arrival; a no-op while the
 * threshold is not set.
 */
export async function onMarketDevCheck(
  tx: DbOrTx,
  quote: { id: string; quoteNumber: string },
  actorId: string,
  now: Date,
  log?: FastifyBaseLogger,
): Promise<void> {
  const settings = parseMarketDevNotice(
    (await getSetting(tx, 'market_development_notice')) ?? MARKET_DEV_NOTICE_SEED,
  );
  const q = await getQuoteByNumber(tx, quote.quoteNumber);
  if (!q) return;
  const planned = planMarketDevNotice(settings, {
    estAnnualRevenue: q.estAnnualRevenue,
    marketDevNoticeSentAt: q.marketDevNoticeSentAt,
  });
  if (planned.length === 0) return;
  await persistNotifications(
    tx,
    planned,
    {
      quoteId: q.id,
      title: `${q.quoteNumber} is above the Market Development threshold`,
      body: 'A qualified opportunity above the value threshold has entered engineering.',
      excludeUserId: actorId,
    },
    log,
  );
  await updateQuote(tx, q.id, { marketDevNoticeSentAt: now });
}

export interface CommercialServiceOptions {
  quotes: QuoteReadService;
  log?: FastifyBaseLogger;
  now?: () => Date;
}

export class CommercialService {
  private readonly now: () => Date;

  constructor(private readonly opts: CommercialServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  private async load(tx: Tx, quoteNumber: string) {
    const q = await getQuoteByNumber(tx, quoteNumber);
    if (!q) {
      throw new CommercialError(404, COMMERCIAL_PROBLEM_CODES.notFound, `No quote ${quoteNumber}`);
    }
    return { q, state: (await loadQuoteState(tx, q.id))! };
  }

  private async detail(tx: Tx, actor: Actor, quoteNumber: string, now: Date): Promise<QuoteDetail> {
    const workflow = parseWorkflowConfig(await loadWorkflowConfigInput(tx));
    const ctx = await this.opts.quotes.context(tx, actor, now);
    return (await this.opts.quotes.detail(tx, workflow, ctx, quoteNumber))!;
  }

  /**
   * PUT /quotes/:qn/capital-flag: Sales or upfront Engineering flags (or clears) "capital likely". The
   * first time it is set, Capital Management is told (awareness, not approval).
   */
  async setCapitalFlag(
    withTx: CommercialWithTx,
    actor: Actor,
    quoteNumber: string,
    body: CapitalFlagBody,
    meta: AuditMeta,
  ): Promise<QuoteDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const { q, state } = await this.load(tx, quoteNumber);
      if (!can(actor, 'capitalFlag.edit', state)) {
        fail([{ code: 'NOT_PERMITTED', message: 'Requires capitalFlag.edit' } as DomainError]);
      }
      if (q.status === 'closed') {
        fail([{ code: 'QUOTE_CLOSED', message: 'The quote is closed' } as DomainError]);
      }
      if (q.capitalLikely !== body.capitalLikely) {
        await updateQuote(tx, q.id, {
          capitalLikely: body.capitalLikely,
          capitalLikelySetBy: actor.userId,
          capitalLikelySetAt: now,
        });
        await insertActivityEvent(tx, {
          quoteId: q.id,
          type: 'capital_flag_changed',
          actorId: actor.userId,
          at: now,
          payload: { capitalLikely: body.capitalLikely },
          createdBy: actor.userId,
        });
        await recordAudit(tx, actor, meta, {
          action: 'update',
          entity: 'quote',
          entityId: q.id,
          quoteId: q.id,
          before: { capitalLikely: q.capitalLikely },
          after: { capitalLikely: body.capitalLikely },
          at: now,
        });
        if (body.capitalLikely) {
          const settings = await loadCommercialSettings(tx);
          await sendCapitalNotice(tx, settings, q, actor.userId, now, this.opts.log);
        }
      }
      return this.detail(tx, actor, quoteNumber, now);
    });
  }

  /** PUT /quotes/:qn/terms: the commercial terms, the terms check and the Legal review. */
  async updateTerms(
    withTx: CommercialWithTx,
    actor: Actor,
    quoteNumber: string,
    body: TermsBody,
    meta: AuditMeta,
  ): Promise<QuoteDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const { q, state } = await this.load(tx, quoteNumber);
      if (!can(actor, 'terms.edit', state)) {
        fail([{ code: 'NOT_PERMITTED', message: 'Requires terms.edit' } as DomainError]);
      }
      const current = termsValues(q);
      const fundingModelCodes = (await listValueList(tx, 'tooling_funding_model')).map(
        (v) => v.code,
      );
      const { legal, ...terms } = body;
      const plan = planTerms({
        current,
        edit: {
          ...terms,
          ...(legal === undefined
            ? {}
            : {
                legal: legal && {
                  reviewedOn: legal.reviewedOn,
                  reviewerName: legal.reviewerName,
                  note: legal.note ?? null,
                },
              }),
        },
        fundingModelCodes,
        actorId: actor.userId,
        now,
        closed: q.status === 'closed',
      });
      if (!plan.ok) fail(plan.errors);
      if (plan.changed.length > 0) {
        await updateQuote(tx, q.id, plan.values);
        // Timeline payloads go to every reader: field names only.
        await insertActivityEvent(tx, {
          quoteId: q.id,
          type: 'terms_updated',
          actorId: actor.userId,
          at: now,
          payload: { fields: plan.changed, checkCleared: plan.checkCleared },
          createdBy: actor.userId,
        });
        const pick = (v: TermsValues) =>
          Object.fromEntries(
            plan.changed.map((k) => [
              k,
              v[k] instanceof Date ? (v[k] as Date).toISOString() : v[k],
            ]),
          );
        await recordAudit(tx, actor, meta, {
          action: 'update',
          entity: 'quote',
          entityId: q.id,
          quoteId: q.id,
          before: pick(current),
          after: pick(plan.values),
          at: now,
        });
      }
      return this.detail(tx, actor, quoteNumber, now);
    });
  }

  /**
   * POST /quotes/:qn/escalations: raise a concern of a configured type. It is recorded on the timeline
   * and audit log and goes to the route's recipients (roles, named users, the Process Owner). It never
   * changes the quote.
   */
  async escalate(
    withTx: CommercialWithTx,
    actor: Actor,
    quoteNumber: string,
    body: EscalationBody,
    meta: AuditMeta,
  ): Promise<EscalationResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const { q, state } = await this.load(tx, quoteNumber);
      if (!can(actor, 'quote.escalate', state)) {
        fail([{ code: 'NOT_PERMITTED', message: 'Requires quote.escalate' } as DomainError]);
      }
      const settings = await loadCommercialSettings(tx);
      const plan = planEscalation({
        routes: settings.routes,
        processOwner: settings.processOwner,
        code: body.code,
        note: body.note,
        closed: q.status === 'closed',
      });
      if (!plan.ok) fail(plan.errors);
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'escalated',
        actorId: actor.userId,
        at: now,
        payload: { code: plan.route.code, label: plan.route.label, note: plan.note },
        createdBy: actor.userId,
      });
      await recordAudit(tx, actor, meta, {
        action: 'create',
        entity: 'escalation',
        entityId: null,
        quoteId: q.id,
        after: { code: plan.route.code, note: plan.note },
        at: now,
      });
      const notified = await persistNotifications(
        tx,
        plan.notifications,
        {
          quoteId: q.id,
          title: `${q.quoteNumber}: ${plan.route.label}`,
          body: `Escalated: ${plan.note}`,
          excludeUserId: actor.userId,
          payload: { code: plan.route.code },
        },
        this.opts.log,
      );
      return { code: plan.route.code, label: plan.route.label, notified };
    });
  }
}
