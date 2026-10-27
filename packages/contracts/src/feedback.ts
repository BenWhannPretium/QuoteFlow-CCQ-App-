import { z } from 'zod';

// ── B-23 in-app feedback ("Report an issue") and Admin → Feedback triage ──────────────────────────

export const FeedbackType = z.enum(['bug', 'confusing', 'missing', 'idea']);
export const FeedbackStatus = z.enum(['new', 'triaged', 'fixing', 'fixed', 'wont_fix']);
export const FeedbackSeverity = z.number().int().min(1).max(4);

/** ~2 MB of image as base64 (4/3 of the bytes, plus slack). The API checks the decoded size too. */
const SCREENSHOT_BASE64_MAX = 2_800_000;

/** POST /api/v1/feedback. Context fields come from the page; roles and user agent from the request. */
export const CreateFeedbackBody = z.object({
  type: FeedbackType,
  severity: FeedbackSeverity,
  description: z.string().trim().min(5).max(4000),
  /** App path (no query string or hash). */
  route: z
    .string()
    .max(500)
    .regex(/^\/[^?#]*$/, 'an app path starting with /'),
  quoteNumber: z
    .string()
    .regex(/^CCQ-\d{4}-\d{5}$/)
    .nullable()
    .optional(),
  appVersion: z.string().max(100).nullable().optional(),
  viewport: z
    .string()
    .regex(/^\d{1,5}x\d{1,5}$/)
    .nullable()
    .optional(),
  screenshot: z
    .object({
      contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      dataBase64: z
        .string()
        .max(SCREENSHOT_BASE64_MAX)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .nullable()
    .optional(),
});
export type CreateFeedbackBody = z.infer<typeof CreateFeedbackBody>;

export const CreateFeedbackResponse = z.object({ id: z.string() });
export type CreateFeedbackResponse = z.infer<typeof CreateFeedbackResponse>;

export const FeedbackItem = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  reporterId: z.string(),
  reporterName: z.string(),
  reporterRoles: z.string(),
  type: FeedbackType,
  severity: FeedbackSeverity,
  description: z.string(),
  route: z.string(),
  quoteNumber: z.string().nullable(),
  appVersion: z.string().nullable(),
  userAgent: z.string().nullable(),
  viewport: z.string().nullable(),
  hasScreenshot: z.boolean(),
  status: FeedbackStatus,
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  githubIssueUrl: z.string().nullable(),
  triageNote: z.string().nullable(),
  /** Ready-to-paste GitHub issue (the app holds no GitHub token). */
  issueTitle: z.string(),
  issueMarkdown: z.string(),
});
export type FeedbackItem = z.infer<typeof FeedbackItem>;

export const FeedbackListQuery = z.object({ status: FeedbackStatus.optional() });
export type FeedbackListQuery = z.infer<typeof FeedbackListQuery>;

export const FeedbackListResponse = z.object({ items: z.array(FeedbackItem) });
export type FeedbackListResponse = z.infer<typeof FeedbackListResponse>;

export const FeedbackIdParams = z.object({ id: z.uuid() });

/** PATCH /api/v1/admin/feedback/:id. Only the fields sent change; null clears. */
export const UpdateFeedbackBody = z
  .object({
    status: FeedbackStatus.optional(),
    severity: FeedbackSeverity.optional(),
    ownerId: z.uuid().nullable().optional(),
    githubIssueUrl: z
      .url({ protocol: /^https$/, hostname: /^github\.com$/ })
      .max(300)
      .nullable()
      .optional(),
    triageNote: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
export type UpdateFeedbackBody = z.infer<typeof UpdateFeedbackBody>;
