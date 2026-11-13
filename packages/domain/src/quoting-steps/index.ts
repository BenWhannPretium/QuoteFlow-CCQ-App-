import { z } from 'zod';

import type { QuotingModelKind } from '../attachments/file-types';
import { DomainError } from '../errors';
import { lockedFor } from '../lead-review';
import { can } from '../policy/can';
import { PRICING_QUEUE_STAGE_KEY } from '../pricing/queue';
import type { Actor } from '../types/actor';
import type { Permission } from '../types/permissions';
import type { QuoteState } from '../types/quote';
import type { Role } from '../types/roles';

/**
 * FB-07 (D-001, decided Nov 9 by Bailey Schmitt, Gemma Cebolla and Stacy Slocum with Oleg Yarovinski
 * present): **costing, then ROI, then price confirmation**, as steps inside Quoting. Not a separate gate
 * and not in parallel.
 *
 *   1. Costing: Pricing uploads the costing model (one workbook: costs and the initial price
 *      assumptions) and attests costing is complete.
 *   2. ROI: Finance builds the ROI from it and uploads the ROI model, only when capital is required
 *      ($0 CER included; `roi_required_when`, provisional). Finance is an input, not an approver.
 *   3. Price approved: the pricing lead confirms the price (G3), optionally uploading an updated price
 *      table when the price changed; otherwise the price in the models stands.
 *
 * Like lead review, these are parts of a stage, not stages: the G3 rules (`hybrid.ts` PRICE_APPROVED)
 * read the derived fields `cost_model_on_file`, `roi_required` and `roi_model_on_file`, so the order is
 * enforced where the price is confirmed. CCQ keeps the files and who uploaded them when; it never holds
 * or edits a figure from them (CLAUDE.md rule 5).
 */

// ── When an ROI is required (config) ─────────────────────────────────────────────────────────────

/**
 * `app_setting.roi_required_when`. The ROI step applies when ANY of these holds: Engineering's latest G2
 * outcome is one of `g2Outcomes`, the quote is flagged capital likely (when `capitalLikely`), or the
 * tooling funding model is one of `fundingModels`.
 */
export interface RoiRequiredWhen {
  g2Outcomes: string[];
  capitalLikely: boolean;
  fundingModels: string[];
}

/**
 * Seed (provisional, D-001): "only when capital is required, $0 CER included". Customer-funded is in
 * the list because the prompt names it; "Shared" is not (an Admin adds it if Finance wants it).
 */
export const ROI_REQUIRED_WHEN_SEED: RoiRequiredWhen = {
  g2Outcomes: ['capital_required'],
  capitalLikely: true,
  fundingModels: ['CUSTOMER_FUNDED', 'ZERO_CER'],
};

const roiRequiredWhenSchema = z
  .object({
    g2Outcomes: z.array(z.string().trim().min(1)).max(20),
    capitalLikely: z.boolean(),
    fundingModels: z.array(z.string().trim().min(1)).max(20),
  })
  .strict();

/** Unset falls back to the seed; anything malformed is invalid config. */
export function parseRoiRequiredWhen(input: unknown): RoiRequiredWhen {
  if (input === undefined || input === null) {
    return {
      g2Outcomes: [...ROI_REQUIRED_WHEN_SEED.g2Outcomes],
      capitalLikely: ROI_REQUIRED_WHEN_SEED.capitalLikely,
      fundingModels: [...ROI_REQUIRED_WHEN_SEED.fundingModels],
    };
  }
  const parsed = roiRequiredWhenSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError(
      'INVALID_CONFIG',
      'roi_required_when must be { g2Outcomes: string[], capitalLikely: boolean, fundingModels: string[] }',
    );
  }
  return {
    g2Outcomes: [...new Set(parsed.data.g2Outcomes)],
    capitalLikely: parsed.data.capitalLikely,
    fundingModels: [...new Set(parsed.data.fundingModels)],
  };
}

export type RoiReasonCode = 'g2_outcome' | 'capital_likely' | 'funding_model';

export interface RoiReason {
  code: RoiReasonCode;
  /** The G2 outcome key or the funding model code that triggered it (null for capital likely). */
  value: string | null;
}

export interface RoiRequirement {
  required: boolean;
  reasons: RoiReason[];
}

/** Whether the quote needs an ROI, and why. `fields` are the quote's decision fields. */
export function roiRequirement(
  fields: QuoteState['fields'],
  setting: RoiRequiredWhen,
): RoiRequirement {
  const reasons: RoiReason[] = [];
  const g2 = typeof fields.g2_outcome === 'string' ? fields.g2_outcome : null;
  if (g2 && setting.g2Outcomes.includes(g2)) reasons.push({ code: 'g2_outcome', value: g2 });
  if (setting.capitalLikely && fields.capital_likely === true) {
    reasons.push({ code: 'capital_likely', value: null });
  }
  const funding =
    typeof fields.tooling_funding_model === 'string' ? fields.tooling_funding_model : null;
  if (funding && setting.fundingModels.includes(funding)) {
    reasons.push({ code: 'funding_model', value: funding });
  }
  return { required: reasons.length > 0, reasons };
}

/** Labels the API resolves for the reason text (outcome and funding-model labels are config). */
export interface RoiReasonLabels {
  g2Outcome?: (key: string) => string;
  fundingModel?: (code: string) => string;
}

/** "Engineering: Advance – capital required" / "Capital flagged likely" / "Funding: $0 CER …". */
export function roiReasonText(reason: RoiReason, labels: RoiReasonLabels = {}): string {
  switch (reason.code) {
    case 'g2_outcome':
      return `Engineering’s decision: ${labels.g2Outcome?.(reason.value ?? '') ?? reason.value}`;
    case 'capital_likely':
      return 'Capital is flagged likely';
    case 'funding_model':
      return `Tooling funding: ${labels.fundingModel?.(reason.value ?? '') ?? reason.value}`;
  }
}

/** Why no ROI is needed, in words (shown on the ROI step instead of an upload). */
export const ROI_NOT_REQUIRED_TEXT =
  'Not required: a payback model is needed only when capital is required ($0 CER included). Engineering did not say capital is required, capital is not flagged likely, and the funding model does not call for one.';

// ── Who uploads which model ──────────────────────────────────────────────────────────────────────

/** The permission behind each step's upload (the matrix decides the roles). */
export const MODEL_UPLOAD_PERMISSION: Record<QuotingModelKind, Permission> = {
  // Step 1: Pricing (the assigned pricer or the pricing lead).
  cost_model: 'quoting.edit',
  // Step 2: Finance (and the matrix's fallbacks).
  roi_model: 'roi.upload',
  // Step 3: the pricing lead, who confirms the price.
  price_table: 'gate.G3.submit',
};

/** The roles told that a quote is ready for its ROI (the ROI owner; the fallbacks are not paged). */
export const ROI_OWNER_ROLES: readonly Role[] = ['Finance'];

export type ModelQuote = Pick<
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

export interface ModelUploadContext {
  /** A current costing model is on file. */
  costModelOnFile: boolean;
  /** The quote was in Quoting with costing attested before FB-07 (migration 0031): no model needed. */
  costModelGrandfathered: boolean;
  roiRequired: boolean;
}

export type ModelUploadPlan = { ok: true } | { ok: false; errors: DomainError[] };

const MODEL_NOUN: Record<QuotingModelKind, string> = {
  cost_model: 'costing model',
  roi_model: 'payback model',
  price_table: 'updated price table',
};

/**
 * May the actor upload (or replace) this Quoting model now? Every refusal is listed; the API maps
 * NOT_PERMITTED → 403, the state codes → 409. The pricing section's G3 lock (FB-01) is checked by the
 * API (`409 SECTION_LOCKED`), like every other section write.
 */
export function planModelUpload(
  kind: QuotingModelKind,
  actor: Actor,
  quote: ModelQuote,
  ctx: ModelUploadContext,
): ModelUploadPlan {
  const noun = MODEL_NOUN[kind];
  if (!can(actor, MODEL_UPLOAD_PERMISSION[kind], quote)) {
    const who =
      kind === 'cost_model'
        ? 'Pricing'
        : kind === 'roi_model'
          ? 'Finance (or the pricing lead)'
          : 'the pricing lead';
    return {
      ok: false,
      errors: [new DomainError('NOT_PERMITTED', `Only ${who} uploads the ${noun}`)],
    };
  }
  if (quote.status === 'closed') {
    return { ok: false, errors: [new DomainError('QUOTE_CLOSED', 'The quote is closed')] };
  }
  if (quote.stageKey !== PRICING_QUEUE_STAGE_KEY) {
    return {
      ok: false,
      errors: [
        new DomainError(
          'WRONG_STAGE',
          `The ${noun} is uploaded while the quote is in Quoting (it is in ${quote.stageKey})`,
        ),
      ],
    };
  }
  const errors: DomainError[] = [];
  // Lead review: once the pricer has submitted, only the pricing lead changes the pricer's part.
  if (kind === 'cost_model' && lockedFor('pricing', actor, quote)) {
    errors.push(
      new DomainError(
        'LOCKED_FOR_REVIEW',
        'Submitted to the pricing lead: only the lead changes the costing model until it is sent back',
      ),
    );
  }
  if (kind === 'roi_model') {
    if (!ctx.roiRequired) {
      errors.push(
        new DomainError(
          'ROI_NOT_REQUIRED',
          'This quote does not need a payback model (capital is not required), so there is nothing to upload',
        ),
      );
    } else if (!ctx.costModelOnFile && !ctx.costModelGrandfathered) {
      errors.push(
        new DomainError(
          'COSTING_FIRST',
          'Costing comes first: Pricing uploads the costing model, then Finance builds the payback model from it',
        ),
      );
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

// ── The three steps as the Quoting tab shows them ────────────────────────────────────────────────

export interface ModelFileRef {
  id: string;
  version: number;
  fileName: string;
  uploadedById: string;
  uploadedAt: Date;
}

export type StepStatus =
  /** Finished: who and when are on the step. */
  | 'done'
  /** This step is next: its owner can act. */
  | 'waiting'
  /** An earlier step has to finish first. */
  | 'blocked'
  /** ROI only: capital is not required. */
  | 'not_required';

export interface QuotingStepsInput {
  costModel: ModelFileRef | null;
  roiModel: ModelFileRef | null;
  priceTable: ModelFileRef | null;
  costingCompleted: boolean;
  costingAttestedBy: string | null;
  costingAttestedAt: Date | null;
  costModelGrandfathered: boolean;
  roi: RoiRequirement;
  /** G3 decided with an advancing outcome on this stay (the pricing section's lock), or null. */
  priceConfirmed: { by: string | null; at: Date | null } | null;
}

export interface QuotingSteps {
  costing: {
    status: StepStatus;
    model: ModelFileRef | null;
    attested: boolean;
    attestedBy: string | null;
    attestedAt: Date | null;
    /** Grandfathered (in Quoting before FB-07) and no model uploaded: shown as "no model on file". */
    noModelOnFile: boolean;
  };
  roi: {
    status: StepStatus;
    required: boolean;
    reasons: RoiReason[];
    model: ModelFileRef | null;
    /** The ROI was uploaded before the current costing model: Finance may need to rebuild it. */
    olderThanCostModel: boolean;
  };
  price: {
    status: StepStatus;
    confirmedBy: string | null;
    confirmedAt: Date | null;
    priceTable: ModelFileRef | null;
  };
  /** The step waiting on someone, or `done` once the price is approved. */
  current: 'costing' | 'roi' | 'price' | 'done';
}

/** The state of each step. Pure; the API adds who may act (`planModelUpload`) and the names. */
export function quotingSteps(input: QuotingStepsInput): QuotingSteps {
  const modelOk = input.costModel !== null || input.costModelGrandfathered;
  const costingDone = modelOk && input.costingCompleted;
  const roiDone = !input.roi.required || input.roiModel !== null;
  const priceDone = input.priceConfirmed !== null;

  const costingStatus: StepStatus = costingDone || priceDone ? 'done' : 'waiting';
  const roiStatus: StepStatus = !input.roi.required
    ? 'not_required'
    : input.roiModel
      ? 'done'
      : costingDone
        ? 'waiting'
        : 'blocked';
  const priceStatus: StepStatus = priceDone
    ? 'done'
    : costingDone && roiDone
      ? 'waiting'
      : 'blocked';

  return {
    costing: {
      status: costingStatus,
      model: input.costModel,
      attested: input.costingCompleted,
      attestedBy: input.costingAttestedBy,
      attestedAt: input.costingAttestedAt,
      noModelOnFile: input.costModelGrandfathered && input.costModel === null,
    },
    roi: {
      status: roiStatus,
      required: input.roi.required,
      reasons: input.roi.reasons,
      model: input.roiModel,
      olderThanCostModel:
        input.roiModel !== null &&
        input.costModel !== null &&
        input.roiModel.uploadedAt.getTime() < input.costModel.uploadedAt.getTime(),
    },
    price: {
      status: priceStatus,
      confirmedBy: input.priceConfirmed?.by ?? null,
      confirmedAt: input.priceConfirmed?.at ?? null,
      priceTable: input.priceTable,
    },
    current: priceDone ? 'done' : !costingDone ? 'costing' : !roiDone ? 'roi' : 'price',
  };
}

// ── Versions ─────────────────────────────────────────────────────────────────────────────────────

/**
 * FB-07 (F-074): a new upload of a versioned kind becomes the current record; the one it replaces is
 * superseded (kept and downloadable). Version numbers count from 1 per quote and kind.
 */
export function nextModelVersion(
  versions: readonly { id: string; version: number | null; current: boolean }[],
): { version: number; supersedes: string | null } {
  const max = versions.reduce((m, v) => Math.max(m, v.version ?? 0), 0);
  return { version: max + 1, supersedes: versions.find((v) => v.current)?.id ?? null };
}

/**
 * Removing the current version (a wrong file, within the uploader's window) makes the newest remaining
 * version current again. Returns that version's id, or null when none is left.
 */
export function versionRestoredOnRemoval(
  removedId: string,
  versions: readonly { id: string; version: number | null; removed: boolean; current: boolean }[],
): string | null {
  const removed = versions.find((v) => v.id === removedId);
  if (!removed?.current) return null;
  const remaining = versions
    .filter((v) => v.id !== removedId && !v.removed)
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  return remaining[0]?.id ?? null;
}
