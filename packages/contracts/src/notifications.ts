import { z } from 'zod';

// ── Notifications (B-18): the in-app feed and per-user email preferences ─────────────────────────

export const NotificationItem = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  quoteNumber: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

/** GET /api/v1/notifications. Newest first; `cursor` is the previous page's `nextCursor`. */
export const NotificationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
  /** `true` = unread only. */
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuery>;

export const NotificationListResponse = z.object({
  /** Unread in-app notifications in total (the bell badge), not just on this page. */
  unread: z.number().int(),
  items: z.array(NotificationItem),
  nextCursor: z.string().nullable(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponse>;

export const NotificationIdParams = z.object({ id: z.uuid() });

export const MarkNotificationsReadResponse = z.object({ marked: z.number().int() });
export type MarkNotificationsReadResponse = z.infer<typeof MarkNotificationsReadResponse>;

export const MarkNotificationReadResponse = z.object({ unread: z.number().int() });
export type MarkNotificationReadResponse = z.infer<typeof MarkNotificationReadResponse>;

/** One notification type the user can opt out of email for. In-app cannot be switched off. */
export const EmailPreference = z.object({
  type: z.string(),
  label: z.string(),
  description: z.string(),
  /** `daily_digest` = one email at 7:00 AM Central, not one per item. */
  delivery: z.enum(['immediate', 'daily_digest']),
  enabled: z.boolean(),
});
export type EmailPreference = z.infer<typeof EmailPreference>;

/** GET /api/v1/me/preferences. */
export const PreferencesResponse = z.object({
  email: z.array(EmailPreference),
  /** False when the app sends no email at all (in-app only), so the page can say so. */
  emailAvailable: z.boolean(),
});
export type PreferencesResponse = z.infer<typeof PreferencesResponse>;

/** PUT /api/v1/me/preferences. Only the types sent change; an unknown type is a 422. */
export const UpdatePreferencesBody = z
  .object({ email: z.record(z.string().max(80), z.boolean()) })
  .strict();
export type UpdatePreferencesBody = z.infer<typeof UpdatePreferencesBody>;

export const NOTIFICATION_PROBLEM_CODES = {
  notFound: 'not_found',
  badCursor: 'bad_cursor',
  unknownType: 'unknown_notification_type',
} as const;
