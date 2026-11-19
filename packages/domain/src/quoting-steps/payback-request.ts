import { DomainError } from '../errors';
import { lockedFor } from '../lead-review';
import { can } from '../policy/can';
import { PRICING_QUEUE_STAGE_KEY } from '../pricing/queue';
import type { Actor } from '../types/actor';
import type { QuoteState } from '../types/quote';

/**
 * FB-21 Part B (N17-21, N17-22; decided by Ben, 2026-11-18): a payback model is NOT needed for every
 * quote. The pricer (on a quote assigned to them) or the pricing lead asks Finance for one; Finance is
 * told; when Finance uploads the payback model after the request, whoever asked is told, and the pricing
 * lead(s) as before. G3 needs the payback model only while a request is open (not withdrawn), and the
 * request is satisfied once a payback model is uploaded at or after it.
 *
 * One request per pricing record (one record per quote version). A new request replaces a withdrawn or
 * fulfilled one; the earlier ones stay on the timeline and in the audit log.
 */
export interface PaybackRequest {
  requestedBy: string | null;
  requestedAt: Date | null;
  /** Optional, shown to Finance. */
  note: string | null;
  withdrawnAt: Date | null;
  withdrawnBy: string | null;
  withdrawReason: string | null;
}

export const EMPTY_PAYBACK_REQUEST: PaybackRequest = {
  requestedBy: null,
  requestedAt: null,
  note: null,
  withdrawnAt: null,
  withdrawnBy: null,
  withdrawReason: null,
};

export const PAYBACK_NOTE_MAX = 500;
export const PAYBACK_WITHDRAW_REASON_MAX = 200;

/**
 * - `none`: nobody asked Finance on this version.
 * - `open`: asked, and no payback model has been uploaded since.
 * - `received`: Finance uploaded a payback model at or after the request.
 * - `withdrawn`: the request was withdrawn before Finance uploaded.
 */
export type PaybackRequestStatus = 'none' | 'open' | 'received' | 'withdrawn';

export function paybackRequestStatus(
  request: PaybackRequest,
  roiModelUploadedAt: Date | null,
): PaybackRequestStatus {
  if (!request.requestedAt) return 'none';
  if (request.withdrawnAt) return 'withdrawn';
  return roiModelUploadedAt && roiModelUploadedAt.getTime() >= request.requestedAt.getTime()
    ? 'received'
    : 'open';
}

/** G3 needs a payback model: someone asked and did not withdraw (it may already be received). */
export const paybackNeeded = (status: PaybackRequestStatus): boolean =>
  status === 'open' || status === 'received';

const dateOf = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};
const textOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * The request as the quote's decision fields hold it (`pricing_record.payback_*`, snake_case, from the
 * current version's record) and when the current payback model was uploaded (`roi_model_uploaded_at`).
 */
export function paybackFromFields(fields: Readonly<Record<string, unknown>>): {
  request: PaybackRequest;
  roiModelUploadedAt: Date | null;
  status: PaybackRequestStatus;
} {
  const r = (fields.pricing_record ?? null) as Record<string, unknown> | null;
  const request: PaybackRequest = r
    ? {
        requestedBy: textOf(r.payback_requested_by),
        requestedAt: dateOf(r.payback_requested_at),
        note: textOf(r.payback_request_note),
        withdrawnAt: dateOf(r.payback_request_withdrawn_at),
        withdrawnBy: textOf(r.payback_request_withdrawn_by),
        withdrawReason: textOf(r.payback_request_withdraw_reason),
      }
    : EMPTY_PAYBACK_REQUEST;
  const roiModelUploadedAt = dateOf(fields.roi_model_uploaded_at);
  return { request, roiModelUploadedAt, status: paybackRequestStatus(request, roiModelUploadedAt) };
}

export type PaybackQuote = Pick<
  QuoteState,
  | 'stageKey'
  | 'status'
  | 'kamUserId'
  | 'assignedEngineerId'
  | 'assignedPricerId'
  | 'pricingSubmittedAt'
  | 'region'
  | 'accountId'
>;

export interface PaybackContext {
  /** A current costing model is on file (or the quote is grandfathered without one). */
  costingReady: boolean;
  roiModelUploadedAt: Date | null;
}

export type PaybackPlan = { ok: true; next: PaybackRequest } | { ok: false; errors: DomainError[] };

/** The codes the API answers with 409 (the state, not the input, is wrong). */
export const PAYBACK_CONFLICT_CODES = new Set([
  'QUOTE_CLOSED',
  'WRONG_STAGE',
  'LOCKED_FOR_REVIEW',
  'COSTING_FIRST',
  'REQUEST_OPEN',
  'NO_OPEN_REQUEST',
]);

function guard(actor: Actor, quote: PaybackQuote): DomainError[] {
  // The matrix: PricingLead on any quote; Pricing only on a quote assigned to them as pricer.
  if (!can(actor, 'payback.request', quote)) {
    return [
      new DomainError(
        'NOT_PERMITTED',
        'Only the pricing lead, or the pricer assigned to this quote, asks Finance for a payback model',
      ),
    ];
  }
  if (quote.status === 'closed') return [new DomainError('QUOTE_CLOSED', 'The quote is closed')];
  if (quote.stageKey !== PRICING_QUEUE_STAGE_KEY) {
    return [
      new DomainError(
        'WRONG_STAGE',
        `A payback model is asked for while the quote is in Quoting (it is in ${quote.stageKey})`,
      ),
    ];
  }
  // Lead review: once the pricer has submitted, only the pricing lead changes the pricer's part.
  if (lockedFor('pricing', actor, quote)) {
    return [
      new DomainError(
        'LOCKED_FOR_REVIEW',
        'Submitted to the pricing lead: only the lead asks Finance until it is sent back',
      ),
    ];
  }
  return [];
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Ask Finance for a payback model. Needs the costing model on file (Finance builds from it); one open
 * request at a time. The pricing section's G3 lock is checked by the API, like every Quoting write.
 */
export function planPaybackRequest(
  actor: Actor,
  quote: PaybackQuote,
  current: PaybackRequest,
  ctx: PaybackContext,
  input: { note?: string | null | undefined },
  now: Date,
): PaybackPlan {
  const errors = guard(actor, quote);
  if (errors.length > 0) return { ok: false, errors };
  if (!ctx.costingReady) {
    errors.push(
      new DomainError(
        'COSTING_FIRST',
        'Upload the costing model first: Finance builds the payback model from it',
      ),
    );
  }
  if (paybackRequestStatus(current, ctx.roiModelUploadedAt) === 'open') {
    errors.push(
      new DomainError(
        'REQUEST_OPEN',
        'Finance has already been asked for a payback model on this quote; withdraw that request first',
      ),
    );
  }
  const note = clean(input.note);
  if (note && note.length > PAYBACK_NOTE_MAX) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `The note is ${note.length} characters; the limit is ${PAYBACK_NOTE_MAX}`,
        'note',
      ),
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    next: {
      requestedBy: actor.userId,
      requestedAt: now,
      note,
      withdrawnAt: null,
      withdrawnBy: null,
      withdrawReason: null,
    },
  };
}

/** Withdraw the open request (Finance is told, so they stop work). A short reason is required. */
export function planPaybackWithdraw(
  actor: Actor,
  quote: PaybackQuote,
  current: PaybackRequest,
  ctx: Pick<PaybackContext, 'roiModelUploadedAt'>,
  input: { reason?: string | null | undefined },
  now: Date,
): PaybackPlan {
  const errors = guard(actor, quote);
  if (errors.length > 0) return { ok: false, errors };
  if (paybackRequestStatus(current, ctx.roiModelUploadedAt) !== 'open') {
    errors.push(
      new DomainError(
        'NO_OPEN_REQUEST',
        'There is no open payback request to withdraw (none was made, it was withdrawn, or Finance has uploaded the model)',
      ),
    );
  }
  const reason = clean(input.reason);
  if (!reason) {
    errors.push(new DomainError('INVALID_VALUE', 'Say why the request is withdrawn', 'reason'));
  } else if (reason.length > PAYBACK_WITHDRAW_REASON_MAX) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `The reason is ${reason.length} characters; the limit is ${PAYBACK_WITHDRAW_REASON_MAX}`,
        'reason',
      ),
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    next: { ...current, withdrawnAt: now, withdrawnBy: actor.userId, withdrawReason: reason },
  };
}

/** "Finance's payback model may be useful here: <reasons>" (app_setting `roi_required_when`, a hint). */
export function paybackHintText(reasons: readonly string[]): string | null {
  return reasons.length > 0
    ? `Finance’s payback model may be useful here: ${reasons.join('; ')}`
    : null;
}
