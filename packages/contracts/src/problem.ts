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
