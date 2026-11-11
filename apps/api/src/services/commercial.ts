import {
  COMMERCIAL_PROBLEM_CODES,
  type AdditionalApprovalView,
  type CapitalFlagBody,
  type CapitalTermsBody,
  type CapitalTermsView,
  type CommercialDetail,
  type EngineeringTermsBody,
  type G4SignoffBody,
  type TermsExceptionDecisionBody,
  type TermsExceptionView,
  type EscalationBody,
  type EscalationResponse,
  type QuoteDetail,
  type ReviewSummary,
  type ReviewWarning,
  type TermsBody,
} from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import {
  closePendingTermsExceptions,
  decideTermsException,
  getLatestTermsException,
  getQuoteByNumber,
  getSetting,
  insertActivityEvent,
  insertG4Signoff,
  insertTermsException,
  listG4Signoffs,
  listUsersByIds,
  listValueList,
  loadQuoteState,
  loadWorkflowConfigInput,
  updateQuote,
  type Quote,
} from '@ccq/db/repos';
import {
  CAPITAL_NOTICE_SEED,
  CAPITAL_TERMS_REQUIRED_SEED,
  ESCALATION_ROUTES_SEED,
  FINAL_REVIEW_STAGE_KEY,
  G4_ADDITIONAL_APPROVALS_SEED,
  TERMS_SCOPE_PERMISSION,
  asUserId,
  canSign,
  isNonStandardTerms,
  parseAdditionalApprovals,
  parseCapitalTermsRequired,
  planSignoff,
  planTermsExceptionDecision,
  planTermsExceptionDecided,
  planTermsExceptionRequested,
  signoffStatuses,
  type AdditionalApprovals,
  type CapitalTerm,
  type TermsLists,
  type TermsScope,
  G4_CHECKS,
  G4_REQUIRED_CHECKS_SEED,
  ROI_REQUIRED_WHEN_SEED,
  parseRoiRequiredWhen,
  type RoiRequiredWhen,
  LEGAL_REVIEW_TRIGGERS_SEED,
  LEGAL_TRIGGER_LABELS,
  MARKET_DEV_NOTICE_SEED,
  PASS_THROUGH_SEED,
  PROCESS_OWNER_SEED,
  can,
  capitalTermsSegregation,
  capitalTermsSegregationMessage,
  derivedDecisionFields,
  g4CheckWarnings,
  parseCapitalNotice,
  parseG4RequiredChecks,
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
  sectionLock,
  type Actor,
  type CapitalNoticeSetting,
  type DerivedFieldSettings,
  type DomainError,
  type EscalationRoute,
  type G4Check,
  type LegalTrigger,
  type WorkflowConfig,
  type MarketDevNoticeSetting,
  type ProcessOwnerSetting,
  type QuoteState,
  type TermsValues,
} from '@ccq/domain';
import type { FastifyBaseLogger } from 'fastify';

import { deliverPlanned } from './handoff-notifications';
import { assertSectionUnlocked, lockConfig, lockView } from './locks';
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
  const forbidden = errors.filter((e) => e.code === 'NOT_PERMITTED' || e.code === 'SEGREGATION');
  if (forbidden.length > 0) {
    throw new CommercialError(
      403,
      COMMERCIAL_PROBLEM_CODES.notPermitted,
      forbidden.map((e) => e.message).join('; '),
    );
  }
  const closed = errors.find((e) => e.code === 'QUOTE_CLOSED');
  if (closed) throw new CommercialError(409, COMMERCIAL_PROBLEM_CODES.conflict, closed.message);
  // FB-08: nothing pending to decide, or a sign-off already given: the screen is out of date.
  const stale = errors.find(
    (e) => e.code === 'NO_PENDING_EXCEPTION' || e.code === 'ALREADY_SIGNED',
  );
  if (stale) throw new CommercialError(409, COMMERCIAL_PROBLEM_CODES.conflict, stale.message);
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
  /** FB-08 (F-021, F-068): `standard_payment_terms` and `capital_terms_required`. */
  terms: { standardPaymentTerms: string[]; capitalTermsRequired: CapitalTerm[] };
  /**
   * FB-08 (F-082): `g4_additional_approvals`. A malformed value must not silently switch the control
   * off: it is null and the error is kept, so G4 Approve is refused with the message (fail closed).
   */
  additionalApprovals: AdditionalApprovals | null;
  additionalApprovalsError: string | null;
}

/** FB-11's setting, read the same way: a list of codes, [] when malformed (everything non-standard). */
function standardPaymentTerms(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((c): c is string => typeof c === 'string') : [];
}

/** FB-08: a malformed `capital_terms_required` falls back to the seed (all five required). */
function capitalTermsRequired(input: unknown): CapitalTerm[] {
  try {
    return parseCapitalTermsRequired(input);
  } catch {
    return [...CAPITAL_TERMS_REQUIRED_SEED];
  }
}

/**
 * FB-01 (F-069): `g4_required_checks`. A malformed value must not silently stop blocking: it fails
 * closed (both checks block G4 Advance) and the quote still renders.
 */
function g4RequiredChecks(input: unknown): G4Check[] {
  try {
    return parseG4RequiredChecks(input ?? G4_REQUIRED_CHECKS_SEED);
  } catch {
    return [...G4_CHECKS];
  }
}

/**
 * FB-07 (D-001): `roi_required_when`. The admin console validates it, so a malformed value only comes
 * from a hand edit: it falls back to the seed (capital required, $0 CER included) rather than dropping
 * the ROI step or demanding it on every quote.
 */
function roiRequiredWhen(input: unknown): RoiRequiredWhen {
  try {
    return parseRoiRequiredWhen(input);
  } catch {
    return parseRoiRequiredWhen(ROI_REQUIRED_WHEN_SEED);
  }
}

export async function loadCommercialSettings(db: DbOrTx): Promise<CommercialSettings> {
  const [
    legal,
    passThrough,
    capital,
    marketDev,
    routes,
    owner,
    g4Checks,
    roiWhen,
    standardTerms,
    capitalRequired,
    extraApprovals,
  ] = await Promise.all([
    getSetting(db, 'legal_review_triggers'),
    getSetting(db, 'pricing_pass_through'),
    getSetting(db, 'capital_management_notice'),
    getSetting(db, 'market_development_notice'),
    getSetting(db, 'escalation_routes'),
    getSetting(db, 'process_owner'),
    getSetting(db, 'g4_required_checks'),
    getSetting(db, 'roi_required_when'),
    getSetting(db, 'standard_payment_terms'),
    getSetting(db, 'capital_terms_required'),
    getSetting(db, 'g4_additional_approvals'),
  ]);
  let additionalApprovals: AdditionalApprovals | null = null;
  let additionalApprovalsError: string | null = null;
  try {
    additionalApprovals = parseAdditionalApprovals(extraApprovals ?? G4_ADDITIONAL_APPROVALS_SEED);
  } catch (err) {
    additionalApprovalsError = (err as DomainError).message;
  }
  return {
    derived: {
      legalReviewTriggers: parseLegalReviewTriggers(legal ?? LEGAL_REVIEW_TRIGGERS_SEED),
      passThrough: parsePassThrough(passThrough ?? PASS_THROUGH_SEED),
      g4RequiredChecks: g4RequiredChecks(g4Checks),
      roiRequiredWhen: roiRequiredWhen(roiWhen),
    },
    capitalNotice: parseCapitalNotice(capital ?? CAPITAL_NOTICE_SEED),
    marketDev: parseMarketDevNotice(marketDev ?? MARKET_DEV_NOTICE_SEED),
    routes: parseEscalationRoutes(routes ?? ESCALATION_ROUTES_SEED),
    processOwner: parseProcessOwner(owner ?? PROCESS_OWNER_SEED),
    terms: {
      standardPaymentTerms: standardPaymentTerms(standardTerms),
      capitalTermsRequired: capitalTermsRequired(capitalRequired),
    },
    additionalApprovals,
    additionalApprovalsError,
  };
}

/** FB-08: the value lists and settings the terms plan checks codes against. */
async function termsLists(db: DbOrTx, settings: CommercialSettings): Promise<TermsLists> {
  const [funding, payment, tooling, mold] = await Promise.all([
    listValueList(db, 'tooling_funding_model'),
    listValueList(db, 'requested_payment_terms'),
    listValueList(db, 'tooling_payment_terms'),
    listValueList(db, 'mold_ownership'),
  ]);
  return {
    fundingModelCodes: funding.map((v) => v.code),
    fundingNotAnswered: funding
      .filter((v) => (v.meta as { defaultAtIntake?: unknown } | null)?.defaultAtIntake === true)
      .map((v) => v.code),
    paymentTerms: payment.map((v) => ({
      code: v.code,
      freeText: (v.meta as { freeText?: unknown } | null)?.freeText === true,
    })),
    standardPaymentTerms: settings.terms.standardPaymentTerms,
    toolingPaymentCodes: tooling.map((v) => v.code),
    moldOwnershipCodes: mold.map((v) => v.code),
    capitalTermsRequired: settings.terms.capitalTermsRequired,
  };
}

/** The quote's terms as the domain's values. */
function termsValues(q: Quote): TermsValues {
  return {
    toolingFundingModel: q.toolingFundingModel,
    termsToolingCommitment: q.termsToolingCommitment,
    termsMoq: q.termsMoq,
    termsPaymentTermsCode: q.termsPaymentTermsCode,
    termsPaymentTerms: q.termsPaymentTerms,
    termsNonstandard: q.termsNonstandard,
    termsToolingPayment: q.termsToolingPayment,
    termsMilestoneNote: q.termsMilestoneNote,
    termsNotes: q.termsNotes,
    termsCheckedAt: q.termsCheckedAt,
    termsCheckedBy: q.termsCheckedBy,
    legalReviewedOn: q.legalReviewedOn,
    legalReviewerName: q.legalReviewerName,
    legalReviewNote: q.legalReviewNote,
    legalRecordedBy: q.legalRecordedBy,
    termsMoldOwnership: q.termsMoldOwnership,
    termsAmortized: q.termsAmortized,
    termsAmortizationMonths: q.termsAmortizationMonths,
    termsMinSupply: q.termsMinSupply,
    termsAgreementInPlace: q.termsAgreementInPlace,
    termsAgreementMonths: q.termsAgreementMonths,
    termsFinalizedAt: q.termsFinalizedAt,
    termsFinalizedBy: q.termsFinalizedBy,
  };
}

/** FB-08: the people the terms views name. */
async function termsPeople(db: DbOrTx, q: Quote, extra: (string | null | undefined)[] = []) {
  const people = await listUsersByIds(
    db,
    [...new Set([q.termsCheckedBy, q.termsFinalizedBy, ...extra])].filter(
      (id): id is string => !!id,
    ),
  );
  return (id: string | null | undefined) =>
    (id && people.find((p) => p.id === id)?.displayName) || null;
}

/**
 * FB-08 (F-068): the capital terms, for the quote and the review screen. The approver edits and
 * confirms them in Final Review until G4 locks the terms.
 */
function capitalTermsView(
  q: Quote,
  actor: Actor,
  state: QuoteState,
  settings: CommercialSettings,
  locked: boolean,
  name: (id: string | null) => string | null,
  workflow: WorkflowConfig,
): CapitalTermsView {
  // DR-approver-leadership-admin-01: the G4 segregation rules bar the capital terms too.
  const segregation =
    can(actor, 'terms.finalize', state) &&
    capitalTermsSegregationMessage(capitalTermsSegregation(workflow, state, actor));
  return {
    toolingFundingModel: q.toolingFundingModel,
    moldOwnership: q.termsMoldOwnership,
    amortized: q.termsAmortized,
    amortizationMonths: q.termsAmortizationMonths,
    minSupply: q.termsMinSupply,
    agreementInPlace: q.termsAgreementInPlace,
    agreementMonths: q.termsAgreementMonths,
    finalizedAt: iso(q.termsFinalizedAt),
    finalizedByName: name(q.termsFinalizedBy),
    required: [...settings.terms.capitalTermsRequired],
    canFinalize:
      q.status !== 'closed' && !locked && can(actor, 'terms.finalize', state) && !segregation,
    finalizeBlockedReason: segregation || null,
  };
}

/** FB-08 (T-007): the current payment-terms exception, and whether the viewer may decide it. */
async function termsExceptionView(
  db: DbOrTx,
  actor: Actor,
  q: Quote,
  state: QuoteState,
  locked: boolean,
): Promise<TermsExceptionView> {
  if (!q.termsExceptionStatus) return null;
  const request = await getLatestTermsException(db, q.id);
  if (!request) return null;
  const name = await termsPeople(db, q, [request.requestedBy, request.decidedBy]);
  const status = q.termsExceptionStatus as 'pending' | 'approved' | 'rejected';
  return {
    status,
    paymentTermsCode: request.paymentTermsCode,
    paymentTermsDetail: request.paymentTermsDetail,
    requestedByName: name(request.requestedBy),
    requestedAt: request.requestedAt.toISOString(),
    decidedByName: name(request.decidedBy),
    decidedAt: iso(request.decidedAt),
    rationale: request.rationale,
    canDecide:
      status === 'pending' &&
      q.status !== 'closed' &&
      !locked &&
      can(actor, 'terms.exception.decide', state),
  };
}

/** FB-08 (F-082, off until A-035): the extra sign-offs this quote needs, and who may give them. */
async function additionalApprovalsView(
  db: DbOrTx,
  actor: Actor,
  settings: CommercialSettings,
  q: Quote,
  state: QuoteState,
): Promise<AdditionalApprovalView[]> {
  const setting = settings.additionalApprovals;
  if (!setting) return [];
  const recorded = await listG4Signoffs(db, q.id, q.version);
  const statuses = signoffStatuses(setting, state.fields, recorded);
  if (statuses.length === 0) return [];
  const name = await termsPeople(
    db,
    q,
    recorded.map((r) => r.signedBy),
  );
  const open =
    q.status !== 'closed' &&
    q.stageKey === FINAL_REVIEW_STAGE_KEY &&
    can(actor, 'finalReview.signoff', state);
  return statuses.map((st) => {
    const row = recorded.find((r) => r.ruleKey === st.ruleKey && r.signoffKey === st.signoffKey);
    return {
      ruleKey: st.ruleKey,
      ruleLabel: st.ruleLabel,
      signoffKey: st.signoffKey,
      signoffLabel: st.signoffLabel,
      signedByName: row ? name(row.signedBy) : null,
      signedAt: row ? row.signedAt.toISOString() : null,
      note: row?.note ?? null,
      canSign: open && canSign(setting, st, actor),
    };
  });
}

/** FB-08: a value-list label, or the code when the list no longer has it. */
async function labelOf(
  db: DbOrTx,
  listKey: 'requested_payment_terms' | 'tooling_payment_terms' | 'tooling_funding_model',
  code: string | null,
): Promise<string | null> {
  if (!code) return null;
  const list = await listValueList(db, listKey, { activeOnly: false });
  return list.find((v) => v.code === code)?.label ?? code;
}

/**
 * FB-01 (F-069): the Final Review screen's read-only Terms and Legal section and the open checks that
 * do not block (warnings with a link to the Commercial panel). The G4 decision records the same codes.
 */
export async function finalReviewChecks(
  db: DbOrTx,
  settings: CommercialSettings,
  q: Quote,
  state: QuoteState,
  /** FB-08: the viewer, for the approver's capital-terms editor and the exception / sign-off buttons. */
  actor: Actor,
): Promise<{ termsAndLegal: ReviewSummary['termsAndLegal']; warnings: ReviewWarning[] }> {
  const derived = derivedDecisionFields(state.fields, settings.derived);
  const checks = settings.derived.g4RequiredChecks;
  const workflow = await lockConfig(db);
  const locked = sectionLock('commercialTerms', workflow, state).locked;
  const [name, fundingLabel, paymentLabel, toolingLabel, exception, additionalApprovals] =
    await Promise.all([
      termsPeople(db, q),
      labelOf(db, 'tooling_funding_model', q.toolingFundingModel),
      labelOf(db, 'requested_payment_terms', q.termsPaymentTermsCode),
      labelOf(db, 'tooling_payment_terms', q.termsToolingPayment),
      termsExceptionView(db, actor, q, state, locked),
      additionalApprovalsView(db, actor, settings, q, state),
    ]);
  const warnings = g4CheckWarnings({
    checks,
    termsCheckedAt: q.termsCheckedAt,
    legalReviewRequired: derived.legal_review_required,
    legalReviewedOn: q.legalReviewedOn,
    termsExceptionStatus: q.termsExceptionStatus,
    termsFinalizedAt: q.termsFinalizedAt,
  }).map((w) => ({ ...w, link: 'commercial' as const }));
  return {
    termsAndLegal: {
      toolingFundingModel: q.toolingFundingModel,
      toolingFundingModelLabel: fundingLabel,
      termsToolingCommitment: q.termsToolingCommitment,
      termsMoq: q.termsMoq,
      termsPaymentTermsCode: q.termsPaymentTermsCode,
      termsPaymentTermsLabel: paymentLabel,
      termsPaymentTerms: q.termsPaymentTerms,
      termsNonstandard: q.termsNonstandard,
      termsToolingPayment: q.termsToolingPayment,
      termsToolingPaymentLabel: toolingLabel,
      termsMilestoneNote: q.termsMilestoneNote,
      termsNotes: q.termsNotes,
      checkedAt: iso(q.termsCheckedAt),
      checkedByName: name(q.termsCheckedBy),
      capital: capitalTermsView(q, actor, state, settings, locked, name, workflow),
      exception,
      additionalApprovals,
      legal: {
        required: derived.legal_review_required,
        reasons: derived.legal_review_reasons.map((code) => ({
          code,
          label: LEGAL_TRIGGER_LABELS[code as LegalTrigger] ?? code,
        })),
        reviewedOn: q.legalReviewedOn,
        reviewerName: q.legalReviewerName,
        note: q.legalReviewNote,
      },
      requiredChecks: [...checks],
    },
    warnings,
  };
}

/** `QuoteDetail.commercial`. Nothing here is commercial-sensitive (no figures). */
export async function commercialView(
  db: DbOrTx,
  actor: Actor,
  settings: CommercialSettings,
  q: Quote,
  state: QuoteState,
  /** FB-01 (F-001): the workflow config the section locks (and the segregation rules) read. */
  workflow: WorkflowConfig,
): Promise<CommercialDetail> {
  const people = await listUsersByIds(
    db,
    [
      q.capitalLikelySetBy,
      q.termsCheckedBy,
      q.legalRecordedBy,
      q.holdOwnerId,
      q.termsFinalizedBy,
      settings.processOwner.userId,
    ].filter((id): id is string => !!id),
  );
  const name = (id: string | null | undefined) =>
    (id && people.find((p) => p.id === id)?.displayName) || null;
  const derived = derivedDecisionFields(state.fields, settings.derived);
  const open = q.status !== 'closed';
  // FB-01 (F-001): the terms and the capital flag are read-only after G4 Advance.
  const capitalLock = sectionLock('capitalFlag', workflow, state);
  const termsLock = sectionLock('commercialTerms', workflow, state);
  const [exception, additionalApprovals] = await Promise.all([
    termsExceptionView(db, actor, q, state, termsLock.locked),
    additionalApprovalsView(db, actor, settings, q, state),
  ]);
  return {
    capital: {
      likely: q.capitalLikely,
      setByName: name(q.capitalLikelySetBy),
      setAt: iso(q.capitalLikelySetAt),
      noticeSentAt: iso(q.capitalNoticeSentAt),
      canEdit: open && !capitalLock.locked && can(actor, 'capitalFlag.edit', state),
      lock: await lockView(db, workflow, capitalLock),
    },
    terms: {
      toolingFundingModel: q.toolingFundingModel,
      termsToolingCommitment: q.termsToolingCommitment,
      termsMoq: q.termsMoq,
      termsPaymentTermsCode: q.termsPaymentTermsCode,
      termsPaymentTerms: q.termsPaymentTerms,
      paymentTermsNonstandard: isNonStandardTerms(
        q.termsPaymentTermsCode,
        settings.terms.standardPaymentTerms,
      ),
      termsNonstandard: q.termsNonstandard,
      termsToolingPayment: q.termsToolingPayment,
      termsMilestoneNote: q.termsMilestoneNote,
      termsNotes: q.termsNotes,
      checkedAt: iso(q.termsCheckedAt),
      checkedByName: name(q.termsCheckedBy),
      canEdit: open && !termsLock.locked && can(actor, 'terms.edit', state),
      canEditEngineering: open && !termsLock.locked && can(actor, 'terms.engineering.edit', state),
      capital: capitalTermsView(q, actor, state, settings, termsLock.locked, name, workflow),
      exception,
      lock: await lockView(db, workflow, termsLock),
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
    additionalApprovals,
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
      // FB-01 (F-001): first, so every role gets the same answer once G4 is decided.
      await assertSectionUnlocked(tx, 'capitalFlag', state, await lockConfig(tx));
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

  /**
   * PUT /quotes/:qn/terms (`sales`), /terms/engineering (`engineering`) and /terms/capital
   * (`finalize`): the commercial terms, the terms check, the Legal review and the capital terms. FB-08:
   * each route edits only its own fields; a change to the payment terms opens or withdraws the
   * exception request.
   */
  async updateTerms(
    withTx: CommercialWithTx,
    actor: Actor,
    quoteNumber: string,
    body: TermsBody | EngineeringTermsBody | CapitalTermsBody,
    meta: AuditMeta,
    scope: TermsScope = 'sales',
  ): Promise<QuoteDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const { q, state } = await this.load(tx, quoteNumber);
      // FB-01 (F-001): first, so every role gets the same answer once G4 is decided.
      await assertSectionUnlocked(tx, 'commercialTerms', state, await lockConfig(tx));
      const permission = TERMS_SCOPE_PERMISSION[scope];
      if (!can(actor, permission, state)) {
        fail([{ code: 'NOT_PERMITTED', message: `Requires ${permission}` } as DomainError]);
      }
      // DR-approver-leadership-admin-01: whoever may not release the offer (the G4 segregation rules:
      // the quote's KAM, its price approver) may not edit or confirm its capital terms either.
      if (scope === 'finalize') {
        const barred = capitalTermsSegregationMessage(
          capitalTermsSegregation(await lockConfig(tx), state, actor),
        );
        if (barred) fail([{ code: 'SEGREGATION', message: barred } as DomainError]);
      }
      const current = termsValues(q);
      const settings = await loadCommercialSettings(tx);
      const lists = await termsLists(tx, settings);
      const { legal, ...terms } = body as TermsBody & EngineeringTermsBody & CapitalTermsBody;
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
        scope,
        lists,
        exceptionStatus: q.termsExceptionStatus,
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
          payload: {
            fields: plan.changed,
            checkCleared: plan.checkCleared,
            // FB-08 (F-068): the approver confirmed the capital terms, or a change cleared it.
            finalized: plan.changed.includes('termsFinalizedAt') && !!plan.values.termsFinalizedAt,
            finalizeCleared: plan.finalizeCleared,
          },
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
      if (plan.exception) {
        await this.applyException(tx, actor, q, plan.exception, plan.values, lists, meta, now);
      }
      return this.detail(tx, actor, quoteNumber, now);
    });
  }

  /**
   * FB-08 (T-007): non-standard payment terms open a new exception request (an open one is superseded)
   * and the pricing lead is told; standard terms withdraw the open one. Audited and on the timeline.
   */
  private async applyException(
    tx: Tx,
    actor: Actor,
    q: Quote,
    action: 'open' | 'withdraw',
    values: TermsValues,
    lists: TermsLists,
    meta: AuditMeta,
    now: Date,
  ) {
    const closed = await closePendingTermsExceptions(
      tx,
      q.id,
      action === 'open' ? 'superseded' : 'withdrawn',
      now,
    );
    if (action === 'withdraw') {
      await updateQuote(tx, q.id, { termsExceptionStatus: null });
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'terms_exception_withdrawn',
        actorId: actor.userId,
        at: now,
        payload: { paymentTermsCode: values.termsPaymentTermsCode, closedPending: closed },
        createdBy: actor.userId,
      });
      await recordAudit(tx, actor, meta, {
        action: 'update',
        entity: 'quote',
        entityId: q.id,
        quoteId: q.id,
        before: { termsExceptionStatus: q.termsExceptionStatus },
        after: { termsExceptionStatus: null },
        at: now,
      });
      return;
    }
    const code = values.termsPaymentTermsCode!;
    const request = await insertTermsException(tx, {
      quoteId: q.id,
      quoteVersion: q.version,
      paymentTermsCode: code,
      paymentTermsDetail: values.termsPaymentTerms,
      status: 'pending',
      requestedBy: actor.userId,
      requestedAt: now,
      createdBy: actor.userId,
    });
    await updateQuote(tx, q.id, { termsExceptionStatus: 'pending' });
    await insertActivityEvent(tx, {
      quoteId: q.id,
      type: 'terms_exception_requested',
      actorId: actor.userId,
      at: now,
      payload: { paymentTermsCode: code, supersededPending: closed },
      createdBy: actor.userId,
    });
    await recordAudit(tx, actor, meta, {
      action: 'create',
      entity: 'terms_exception_request',
      entityId: request.id,
      quoteId: q.id,
      after: {
        paymentTermsCode: code,
        paymentTermsDetail: values.termsPaymentTerms,
        status: 'pending',
      },
      at: now,
    });
    const option = lists.paymentTerms.find((p) => p.code === code);
    const label =
      (option?.freeText ? values.termsPaymentTerms : null) ??
      (await labelOf(tx, 'requested_payment_terms', code)) ??
      code;
    const [me] = await listUsersByIds(tx, [actor.userId]);
    const who = me?.displayName ?? null;
    await deliverPlanned(
      tx,
      planTermsExceptionRequested(),
      actor.userId,
      () => ({
        title: `${q.quoteNumber}: non-standard payment terms (${label})`,
        body: `${who ?? 'Someone'} entered ${label}, outside the standard payment terms. Approve or reject the exception on the quote's Commercial panel, with a rationale.`,
        payload: { terms: label, ...(who ? { actor: who } : {}) },
      }),
      q.id,
      { log: this.opts.log, at: now },
    );
  }

  /**
   * POST /quotes/:qn/terms/exception/decision (T-007): the pricing lead approves or rejects the pending
   * request, with a rationale. Whoever entered the terms and the KAM are told.
   */
  async decideTermsException(
    withTx: CommercialWithTx,
    actor: Actor,
    quoteNumber: string,
    body: TermsExceptionDecisionBody,
    meta: AuditMeta,
  ): Promise<QuoteDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const { q, state } = await this.load(tx, quoteNumber);
      await assertSectionUnlocked(tx, 'commercialTerms', state, await lockConfig(tx));
      if (!can(actor, 'terms.exception.decide', state)) {
        fail([
          { code: 'NOT_PERMITTED', message: 'Requires terms.exception.decide' } as DomainError,
        ]);
      }
      const plan = planTermsExceptionDecision({
        status: q.termsExceptionStatus,
        decision: body.decision,
        rationale: body.rationale,
        closed: q.status === 'closed',
      });
      if (!plan.ok) fail(plan.errors);
      const pending = await getLatestTermsException(tx, q.id);
      const decided =
        pending &&
        (await decideTermsException(tx, pending.id, {
          status: plan.status,
          decidedBy: actor.userId,
          decidedAt: now,
          rationale: plan.rationale,
        }));
      if (!decided) {
        fail([
          {
            code: 'NO_PENDING_EXCEPTION',
            message: 'There is no pending payment-terms exception',
          } as DomainError,
        ]);
      }
      await updateQuote(tx, q.id, { termsExceptionStatus: plan.status });
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'terms_exception_decided',
        actorId: actor.userId,
        at: now,
        payload: {
          decision: plan.status,
          paymentTermsCode: decided.paymentTermsCode,
          rationale: plan.rationale,
        },
        createdBy: actor.userId,
      });
      await recordAudit(tx, actor, meta, {
        action: 'update',
        entity: 'terms_exception_request',
        entityId: decided.id,
        quoteId: q.id,
        before: { status: 'pending' },
        after: { status: plan.status, rationale: plan.rationale },
        at: now,
      });
      const label =
        decided.paymentTermsDetail ??
        (await labelOf(tx, 'requested_payment_terms', decided.paymentTermsCode)) ??
        decided.paymentTermsCode;
      const [me] = await listUsersByIds(tx, [actor.userId]);
      const who = me?.displayName ?? null;
      const verb = plan.status === 'approved' ? 'approved' : 'rejected';
      await deliverPlanned(
        tx,
        planTermsExceptionDecided(asUserId(decided.requestedBy), {
          kamUserId: asUserId(q.kamUserId),
        }),
        actor.userId,
        () => ({
          title: `${q.quoteNumber}: payment terms ${verb} (${label})`,
          body: `${who ?? 'The pricing lead'} ${verb} the non-standard payment terms (${label}). Rationale: ${plan.rationale}`,
          payload: { terms: label, decision: verb, ...(who ? { actor: who } : {}) },
        }),
        q.id,
        { log: this.opts.log, at: now },
      );
      return this.detail(tx, actor, quoteNumber, now);
    });
  }

  /**
   * POST /quotes/:qn/final-review/signoffs (F-082, off until A-035): an extra Final Review sign-off,
   * in order, for the current quote version.
   */
  async signoff(
    withTx: CommercialWithTx,
    actor: Actor,
    quoteNumber: string,
    body: G4SignoffBody,
    meta: AuditMeta,
  ): Promise<QuoteDetail> {
    const now = this.now();
    return withTx(async (tx) => {
      const { q, state } = await this.load(tx, quoteNumber);
      if (!can(actor, 'finalReview.signoff', state)) {
        fail([{ code: 'NOT_PERMITTED', message: 'Requires finalReview.signoff' } as DomainError]);
      }
      const settings = await loadCommercialSettings(tx);
      if (!settings.additionalApprovals) {
        fail([
          {
            code: 'INVALID_CONFIG',
            message: settings.additionalApprovalsError ?? 'g4_additional_approvals is invalid',
          } as DomainError,
        ]);
      }
      const plan = planSignoff({
        setting: settings.additionalApprovals,
        fields: state.fields,
        recorded: await listG4Signoffs(tx, q.id, q.version),
        stageKey: q.stageKey,
        closed: q.status === 'closed',
        actor,
        ruleKey: body.ruleKey,
        signoffKey: body.signoffKey,
        note: body.note,
      });
      if (!plan.ok) fail(plan.errors);
      const row = await insertG4Signoff(tx, {
        quoteId: q.id,
        quoteVersion: q.version,
        ruleKey: plan.rule.key,
        signoffKey: plan.signoff.key,
        signedBy: actor.userId,
        signedAt: now,
        note: plan.note,
        createdBy: actor.userId,
      });
      await insertActivityEvent(tx, {
        quoteId: q.id,
        type: 'final_review_signoff',
        actorId: actor.userId,
        at: now,
        payload: { rule: plan.rule.label, signoff: plan.signoff.label, note: plan.note },
        createdBy: actor.userId,
      });
      await recordAudit(tx, actor, meta, {
        action: 'create',
        entity: 'g4_signoff',
        entityId: row.id,
        quoteId: q.id,
        after: { ruleKey: plan.rule.key, signoffKey: plan.signoff.key, note: plan.note },
        at: now,
      });
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
