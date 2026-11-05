import { z } from 'zod';

/** RFC 9457 problem details. Every API error is returned in this shape as application/problem+json. */
export const ProblemDetails = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe('Field-level validation errors (extension member)'),
  })
  .loose();
export type ProblemDetails = z.infer<typeof ProblemDetails>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * FB-01 (F-001): a write to a section whose gate was decided. 409, `type` SECTION_LOCKED_PROBLEM_TYPE,
 * `code` SECTION_LOCKED, plus `lock` (the gate, the decider and when). Only a send-back reopens it.
 */
export const SECTION_LOCKED_PROBLEM_TYPE =
  'https://quoteflow.pretiumpkg.com/problems/section-locked';
export const SECTION_LOCKED_CODE = 'SECTION_LOCKED';

/** FB-01 (F-001): a section's lock as the UI shows it ("Locked after G2 · decided by … on …"). */
export const SectionLockView = z.object({
  locked: z.boolean(),
  /** The gate whose decision locked it (null when unlocked). */
  gate: z.string().nullable(),
  gateLabel: z.string().nullable(),
  outcomeKey: z.string().nullable(),
  decidedById: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
});
export type SectionLockView = z.infer<typeof SectionLockView>;
