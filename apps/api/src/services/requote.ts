import {
  REQUOTE_PROBLEM_CODES,
  normalizeDraftData,
  type IntakeDraftData,
  type RequoteBody,
  type RequoteResponse,
  type RequoteSourceResponse,
  type SfOpportunityDetail,
} from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import { uuidv7 } from '@ccq/db';
import {
  getLatestSubmittedDraft,
  getOpenRequoteDraft,
  getPricingRecord,
  getQuoteByNumber,
  getQuoteLinkInfo,
  getRequoteOf,
  insertActivityEvent,
  insertQuoteDraft,
  listAttachments,
  listEngReviews,
  listUsersByIds,
  listValueList,
  loadQuoteState,
  lockQuoteByNumber,
  type Quote,
} from '@ccq/db/repos';
import {
  CAPITAL_READINESS_LABELS,
  DRAWING_ATTACHMENT_KINDS,
  can,
  linkedRequoteEligibility,
  requoteItems,
  requoteRequestFields,
  type Actor,
  type CapitalReadiness,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { GateError, type GateService } from './gateService';
import { customerForDraft, dataFromQuote } from './intake';
import { draftItemsFromQuote } from './intake-items';
import { pgCode } from './pg-error';
import { ServiceProblem } from './problem';
import { quoteItemSummaries } from './quote-items-view';
import { allowedFrom } from './requote-links';
import type { SfWritebackService } from './sfWriteback';
import { recordAudit, type AuditMeta } from '../plugins/audit';

/**
 * FB-26 (N17-30, Bailey Schmitt and Ben Whann): the linked re-quote of an expired quote. Starting one
 * creates a new intake **draft** on the same Salesforce opportunity, pre-filled from the old quote's last
 * submitted intake (request fields, every item's product fields, the drawings as links), with nothing of
 * Engineering, Pricing, the terms or the decisions. When the old quote is still open at Customer Decision
 * with its validity passed, the same transaction first records G5 "No response / Expired" through the
 * normal gate path. Submitting the draft (IntakeService) creates the new quote with
 * `requoted_from_quote_id`. The domain decides who and when (`linkedRequoteEligibility`).
 */

export type RequoteWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
type SystemTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface RequoteServiceOptions {
  gates: GateService;
  /** The opportunity re-read live from Salesforce (refreshing the snapshot), as a new intake does. */
  readOpportunity: (withTx: RequoteWithTx, id: string) => Promise<SfOpportunityDetail | null>;
  /**
   * A read in system context, used ONLY for what a linked quote's reader may not see under RLS: the other
   * quote's number and date, and the old intake draft (it belongs to whoever submitted it).
   */
  systemTx?: SystemTx;
  log?: FastifyBaseLogger;
  /** FB-29: queues the reopen of an opportunity QuoteFlow closed (in this transaction; never throws). */
  sfWriteback?: SfWritebackService;
  now?: () => Date;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** The old intake as the new draft's data (request fields, items, drawings as links). */
async function requoteDraftData(
  db: DbOrTx,
  q: Quote,
  live: SfOpportunityDetail | null,
): Promise<IntakeDraftData> {
  const last = await getLatestSubmittedDraft(db, q.id);
  const base = (
    last
      ? (last.data as IntakeDraftData)
      : { ...dataFromQuote(q), customer: await customerForDraft(db, q.customerId) }
  ) as Record<string, unknown>;
  const request = requoteRequestFields(base) as IntakeDraftData;
  if (live) {
    request.sfOpportunityName = live.opportunity.name;
    request.sfProductSpecs = live.productSpecs;
    request.sfProductSpecsStatus = live.productSpecsStatus;
    if (live.account) {
      request.customer = {
        status: request.customer?.status ?? 'existing',
        sfAccountId: live.account.id,
        name: live.account.name,
      };
    }
  }
  const [items, files] = await Promise.all([
    draftItemsFromQuote(db, q.id),
    listAttachments(db, q.id),
  ]);
  const drawings = files.filter((f) => DRAWING_ATTACHMENT_KINDS.includes(f.kind as never));
  const copied = requoteItems(
    items.map((item, index) => ({
      key: item.key,
      ownDrawingIds: drawings
        .filter((f) => f.quoteItemId === item.key || (f.quoteItemId === null && index === 0))
        .map((f) => f.id),
      linkedDrawingIds: item.linkedDrawingIds ?? [],
      fields: item,
    })),
    uuidv7,
  );
  return normalizeDraftData(
    { ...request, sfOpportunityId: q.sfOpportunityId, items: copied } as IntakeDraftData,
    uuidv7,
  );
}

export class RequoteService {
  private readonly now: () => Date;

  constructor(private readonly opts: RequoteServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  private sys<T>(withTx: RequoteWithTx, read: (tx: Tx) => Promise<T>): Promise<T> {
    return this.opts.systemTx ? this.opts.systemTx(read) : withTx(read);
  }

  /** POST /quotes/:qn/requote. */
  async start(
    withTx: RequoteWithTx,
    actor: Actor,
    quoteNumber: string,
    body: RequoteBody,
    meta: AuditMeta,
  ): Promise<RequoteResponse> {
    const now = this.now();
    const peek = await withTx((tx) => getQuoteByNumber(tx, quoteNumber));
    if (!peek) throw new ServiceProblem(404, 'not_found', `No quote ${quoteNumber}`);
    // The opportunity is re-read live before the transaction (a slow Salesforce never holds a lock).
    const live = await this.opts
      .readOpportunity(withTx, peek.sfOpportunityId)
      .catch((err: unknown) => {
        this.opts.log?.warn({ err }, 'linked re-quote: the live opportunity read failed');
        return null;
      });
    // The old intake is copied as it was submitted, whoever submitted it (system read).
    const data = await this.sys(withTx, (tx) => requoteDraftData(tx, peek, live));

    try {
      return await withTx(async (tx) => {
        await lockQuoteByNumber(tx, quoteNumber);
        const q = await getQuoteByNumber(tx, quoteNumber);
        if (!q) throw new ServiceProblem(404, 'not_found', `No quote ${quoteNumber}`);
        const state = await loadQuoteState(tx, q.id);
        if (!state || !can(actor, 'quote.requote', state)) {
          throw new ServiceProblem(
            403,
            'forbidden',
            "Only the quote's KAM or a sales leader can start a linked re-quote",
          );
        }
        const child = await this.sys(withTx, (s) => getRequoteOf(s, q.id));
        const open = await this.sys(withTx, (s) => getOpenRequoteDraft(s, q.id));
        if (!child && open) {
          if (open.ownerUserId === actor.userId)
            return { draftId: open.id, recordedExpired: false };
          throw new ServiceProblem(
            409,
            REQUOTE_PROBLEM_CODES.draftOpen,
            `${open.ownerName ?? 'Someone'} has already started a re-quote of ${quoteNumber}`,
          );
        }
        const eligibility = linkedRequoteEligibility(
          {
            stageKey: q.stageKey,
            status: q.status,
            validityUntil: q.validityUntil,
            requotedAsNumber: child?.quoteNumber ?? null,
          },
          await allowedFrom(tx),
          now,
        );
        if (!eligibility.ok) {
          throw new ServiceProblem(409, eligibility.code, eligibility.message, {
            ...(child ? { quoteNumber: child.quoteNumber } : {}),
          });
        }

        // Still open with its validity passed: record the customer outcome first, through the gate.
        const recordedExpired = eligibility.from === 'open_lapsed';
        if (recordedExpired) {
          if (!body.reasonCode) {
            throw new ServiceProblem(
              422,
              'validation_failed',
              'Pick why the offer expired: the quote is closed as "No response / Expired" first',
              { errors: [{ path: '/reasonCode', message: 'Pick a reason', code: 'REQUIRED' }] },
            );
          }
          try {
            await this.opts.gates.decide(
              (fn) => fn(tx),
              actor,
              quoteNumber,
              'G5',
              { outcomeKey: 'expired', reasonCode: body.reasonCode, note: body.note },
              meta,
            );
          } catch (err) {
            if (err instanceof GateError) {
              throw new ServiceProblem(err.status, err.code, err.message, err.extra);
            }
            throw err;
          }
        }

        const draft = await insertQuoteDraft(tx, {
          ownerUserId: actor.userId,
          sfOpportunityId: q.sfOpportunityId,
          step: 2,
          data,
          requoteOfQuoteId: q.id,
          createdBy: actor.userId,
        });
        await insertActivityEvent(tx, {
          quoteId: q.id,
          type: 'requote_started',
          actorId: actor.userId,
          at: now,
          payload: { note: body.note, from: eligibility.from },
          createdBy: actor.userId,
        });
        await recordAudit(tx, actor, meta, {
          action: 'create',
          entity: 'quote_draft',
          entityId: draft.id,
          quoteId: q.id,
          after: {
            event: 'quote.requote_started',
            requoteOfQuoteId: q.id,
            quoteNumber,
            from: eligibility.from,
            note: body.note,
            items: (data.items ?? []).length,
            liveOpportunity: live !== null,
          },
          at: now,
        });
        // FB-29: a pending closing write is superseded, and a close QuoteFlow wrote is reopened.
        await this.opts.sfWriteback?.onRequoteStarted(tx, {
          quote: { id: q.id, quoteNumber, sfOpportunityId: q.sfOpportunityId },
          draftId: draft.id,
          actor,
          meta,
          at: now,
        });
        return { draftId: draft.id, recordedExpired };
      });
    } catch (err) {
      if (pgCode(err) === '23505') {
        // Lost the race with another start for the same quote (one open re-quote draft per quote).
        throw new ServiceProblem(
          409,
          REQUOTE_PROBLEM_CODES.draftOpen,
          `A re-quote of ${quoteNumber} has already been started`,
        );
      }
      throw err;
    }
  }

  /**
   * GET /quotes/:qn/requote-source: the "From the expired quote" panel of a linked re-quote. Read under
   * the caller's RLS; a caller who cannot read the old quote gets its number only.
   */
  async source(
    withTx: RequoteWithTx,
    actor: Actor,
    quoteNumber: string,
  ): Promise<RequoteSourceResponse> {
    const linked = await withTx(async (tx) => {
      const q = await getQuoteByNumber(tx, quoteNumber);
      if (!q) throw new ServiceProblem(404, 'not_found', `No quote ${quoteNumber}`);
      if (!q.requotedFromQuoteId) {
        throw new ServiceProblem(
          404,
          REQUOTE_PROBLEM_CODES.notRequote,
          `${quoteNumber} is not a linked re-quote`,
        );
      }
      return q.requotedFromQuoteId;
    });
    const empty = (number: string): RequoteSourceResponse => ({
      quoteNumber: number,
      readable: false,
      items: [],
      priceApproval: null,
      capitalReadiness: null,
      capitalReadinessLabel: null,
    });
    const result = await withTx(async (tx) => {
      const old = await getQuoteLinkInfo(tx, linked);
      if (!old) return null;
      const oldQuote = (await getQuoteByNumber(tx, old.quoteNumber))!;
      const [summaries, reviews, processes, pricing] = await Promise.all([
        quoteItemSummaries(tx, actor, oldQuote),
        listEngReviews(tx, oldQuote.id),
        listValueList(tx, 'process_type', { activeOnly: false }),
        getPricingRecord(tx, oldQuote.id),
      ]);
      const approver = pricing?.priceApprovedBy
        ? (await listUsersByIds(tx, [pricing.priceApprovedBy]))[0]
        : undefined;
      const readiness = (pricing?.capitalReadiness ?? null) as CapitalReadiness | null;
      return {
        quoteNumber: old.quoteNumber,
        readable: true,
        items: summaries.map((s, index) => {
          const review = s.id
            ? reviews.find((r) => r.quoteItemId === s.id)
            : index === 0
              ? reviews[0]
              : undefined;
          return {
            ...s,
            processTypeLabel: review?.processType
              ? (processes.find((p) => p.code === review.processType)?.label ?? review.processType)
              : null,
            cycleTimeS: review?.cycleTimeS === undefined ? null : Number(review.cycleTimeS) || null,
            toolingNotes: review?.toolingNotes ?? null,
            capacitySignoffStatus: review?.capacitySignoffStatus ?? null,
          };
        }),
        priceApproval: pricing
          ? {
              approvedAt: iso(pricing.priceApprovedAt),
              approvedByName: approver?.displayName ?? null,
            }
          : null,
        capitalReadiness: readiness,
        capitalReadinessLabel: readiness
          ? (CAPITAL_READINESS_LABELS[readiness] ?? readiness)
          : null,
      } satisfies RequoteSourceResponse;
    });
    if (result) return result;
    const number = await this.sys(withTx, (tx) => getQuoteLinkInfo(tx, linked));
    return empty(number?.quoteNumber ?? 'an earlier quote');
  }
}
