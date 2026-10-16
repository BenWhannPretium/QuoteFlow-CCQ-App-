import { z } from 'zod';

/**
 * KAM intake (B-07, F-03). Sales enters only what Sales can know: there is no plant, process type,
 * machine type, net capital, engineer, channel, product class or priority field (REQ-04, X-90).
 *
 * A draft is a work in progress owned by its creator; it becomes a quote (CCQ-YYYY-NNNNN) on submit.
 * Every field is optional in a draft. Which ones block the submit is decided by the domain from the
 * `intake_required_fields` setting, never by these schemas.
 */

const text = (max: number) => z.string().max(max).nullable().optional();

export const IntakeAddress = z.object({
  line1: text(200),
  city: text(120),
  state: text(80),
  postal: text(20),
  country: text(80),
});
export type IntakeAddress = z.infer<typeof IntakeAddress>;

export const CUSTOMER_STATUSES = ['existing', 'not_yet_established'] as const;

/**
 * `existing`: from the SF Account. `not_yet_established`: name, location and contact only. No credit
 * check and no account request (DEC-27).
 */
export const IntakeCustomer = z.object({
  status: z.enum(CUSTOMER_STATUSES),
  sfAccountId: text(18),
  name: text(200),
  location: text(200),
  contactName: text(120),
  contactEmail: text(200),
  contactPhone: text(40),
});
export type IntakeCustomer = z.infer<typeof IntakeCustomer>;

export const IntakeDraftData = z.object({
  // Step 1: opportunity
  sfOpportunityId: z
    .string()
    .regex(/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/, 'Not a Salesforce id')
    .nullable()
    .optional(),
  /** Display copy of the picked opportunity (name, account, amount…) so a resumed draft renders offline. */
  sfOpportunityName: text(300),

  // Step 2: customer and ship-to
  customer: IntakeCustomer.nullable().optional(),
  shipTo: IntakeAddress.nullable().optional(),
  /** The customer default the ship-to was pre-filled from. Kept when the KAM changes the ship-to. */
  shipToDefault: IntakeAddress.nullable().optional(),
  /** Required when shipTo differs from shipToDefault (a governed override once B-09 lands). */
  shipToOverrideReason: text(1000),

  // Step 3: product and volume (value-list codes)
  requestClass: text(60),
  productFamily: text(60),
  components: z.array(z.string().max(60)).max(20).optional(),
  market: text(60),
  resin: text(60),
  /** neck_finish code; when the code's meta has `freeText`, `neckFinishOther` holds the finish. */
  neckFinish: text(60),
  neckFinishOther: text(120),
  packagingType: text(60),
  packagingNotes: text(2000),
  /** Units per year. */
  estAnnualVolume: z.number().nullable().optional(),
  /** The KAM confirmed a round/placeholder-looking volume is real. */
  estAnnualVolumeConfirmed: z.boolean().optional(),
  /** USD per year; pre-filled from the SF amount, editable. */
  estAnnualRevenue: z.number().nullable().optional(),
  /** The SF amount it was pre-filled from (kept when edited). */
  estAnnualRevenueSf: z.number().nullable().optional(),
  /** YYYY-MM-DD; from SF, editable. */
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .nullable()
    .optional(),
  /** Container size as Sales describes it (e.g. "16 oz"). Feeds the standard description. */
  containerSize: text(60),
  /** Standard description (suggested from the template, editable). */
  standardDescription: text(500),
  /** Free text. */
  description: text(4000),

  // Step 4: drawing and notes
  drawingStatus: text(60),
  commentsForEngineering: text(4000),
});
export type IntakeDraftData = z.infer<typeof IntakeDraftData>;

export const IntakeIssue = z.object({
  code: z.string(),
  /** snake_case field the issue is about (dotted for nested values, comma-separated for alternatives). */
  field: z.string(),
  message: z.string(),
});
export type IntakeIssue = z.infer<typeof IntakeIssue>;

export const IntakeEvaluation = z.object({
  /** Stop the submit. */
  blocking: z.array(IntakeIssue),
  /** Amber "Engineering may ask about this": never stop the submit. */
  warnings: z.array(IntakeIssue),
  ready: z.boolean(),
});
export type IntakeEvaluation = z.infer<typeof IntakeEvaluation>;

/** The active CCQ quote on an SF opportunity (one per opportunity), when the caller can see it. */
export const ActiveQuoteRef = z.object({
  quoteNumber: z.string(),
  stageKey: z.string(),
  status: z.string(),
});
export type ActiveQuoteRef = z.infer<typeof ActiveQuoteRef>;

export const INTAKE_STEPS = [1, 2, 3, 4] as const;

export const IntakeDraft = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  step: z.number().int().min(1).max(4),
  data: IntakeDraftData,
  evaluation: IntakeEvaluation,
  /** Set when the draft's opportunity already has an active quote: offer "Open existing". */
  activeQuote: ActiveQuoteRef.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IntakeDraft = z.infer<typeof IntakeDraft>;

// ── API ──────────────────────────────────────────────────────────────────────────────────────────

/** POST /api/v1/quotes/drafts */
export const CreateIntakeDraftBody = z.object({
  data: IntakeDraftData.default({}),
  step: z.number().int().min(1).max(4).default(1),
});
export type CreateIntakeDraftBody = z.input<typeof CreateIntakeDraftBody>;

/** PATCH /api/v1/quotes/drafts/:id (autosave). Top-level keys in `data` replace the stored ones. */
export const PatchIntakeDraftBody = z.object({
  data: IntakeDraftData.optional(),
  step: z.number().int().min(1).max(4).optional(),
});
export type PatchIntakeDraftBody = z.input<typeof PatchIntakeDraftBody>;

export const IntakeDraftParams = z.object({ id: z.uuid() });

export const IntakeDraftListQuery = z.object({
  /** Admin only: `false` lists every user's open drafts. Everyone else always gets their own. */
  mine: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export const IntakeDraftSummary = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  step: z.number().int(),
  sfOpportunityId: z.string().nullable(),
  sfOpportunityName: z.string().nullable(),
  customerName: z.string().nullable(),
  updatedAt: z.string(),
});
export type IntakeDraftSummary = z.infer<typeof IntakeDraftSummary>;

export const IntakeDraftListResponse = z.object({ items: z.array(IntakeDraftSummary) });
export type IntakeDraftListResponse = z.infer<typeof IntakeDraftListResponse>;

/** POST /api/v1/quotes/drafts/:id/submit */
export const SubmitIntakeResponse = z.object({
  quoteId: z.string(),
  quoteNumber: z.string(),
  stageKey: z.string(),
  status: z.string(),
  /** `G1`: waiting for the qualify decision. `ENG_REVIEW`: straight into the engineering queue. */
  routedTo: z.string(),
  /** Advisory priority score (B-08); null until the scoring engine lands. */
  priorityScore: z.number().nullable(),
  warnings: z.array(IntakeIssue),
});
export type SubmitIntakeResponse = z.infer<typeof SubmitIntakeResponse>;

/** Problem `code`s the intake routes return (problem+json extension member). */
export const INTAKE_PROBLEM_CODES = {
  incomplete: 'intake_incomplete',
  activeQuoteExists: 'active_quote_exists',
  alreadySubmitted: 'draft_already_submitted',
  notFound: 'not_found',
  notOwner: 'not_draft_owner',
} as const;
