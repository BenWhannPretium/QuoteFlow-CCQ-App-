import { z } from 'zod';

// ── Usage audit log (F-12, B-09): admin viewer, CSV export, adoption report ──────────────────────

/** Mirrors `audit_event.action` (packages/db AUDIT_ACTIONS; a unit test keeps them equal). */
export const AUDIT_ACTION_VALUES = [
  'view',
  'create',
  'update',
  'stage_change',
  'gate_decision',
  'override_requested',
  'override_approved',
  'override_rejected',
  'override_applied',
  'override_reverted',
  'upload',
  'download',
  'export',
  'config_change',
  'sign_in',
] as const;
export const AuditAction = z.enum(AUDIT_ACTION_VALUES);
export type AuditAction = z.infer<typeof AuditAction>;

/** GET /api/v1/admin/audit (audit.read: Leadership + Admin). `to` is inclusive (a whole day). */
export const AuditQuery = z.object({
  actorId: z.uuid().optional(),
  quoteNumber: z
    .string()
    .regex(/^CCQ-\d{4}-\d{5}$/)
    .optional(),
  action: AuditAction.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export const AuditEventDto = z.object({
  id: z.uuid(),
  at: z.string(),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  actorUpn: z.string().nullable(),
  actorRoles: z.array(z.string()),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  quoteId: z.uuid().nullable(),
  quoteNumber: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditEventDto = z.infer<typeof AuditEventDto>;

export const AuditListResponse = z.object({
  items: z.array(AuditEventDto),
  nextCursor: z.string().nullable(),
});
export type AuditListResponse = z.infer<typeof AuditListResponse>;

/** The CSV export takes the viewer's filters (no paging; capped). */
export const AuditExportQuery = AuditQuery.omit({ cursor: true, limit: true });
export type AuditExportQuery = z.infer<typeof AuditExportQuery>;

/** GET /api/v1/admin/reports/usage: adoption measured from the audit log (PRD 8.2). */
export const UsageReportQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type UsageReportQuery = z.infer<typeof UsageReportQuery>;

export const UsageReportResponse = z.object({
  /** Inclusive calendar days in `timeZone`. */
  from: z.string(),
  to: z.string(),
  timeZone: z.string(),
  dailyActiveUsers: z.array(z.object({ day: z.string(), role: z.string(), users: z.number() })),
  quotesViewed: z.array(z.object({ day: z.string(), quotes: z.number(), views: z.number() })),
  actionsByType: z.array(z.object({ action: z.string(), count: z.number() })),
  totals: z.object({
    activeUsers: z.number(),
    quotesViewed: z.number(),
    views: z.number(),
    events: z.number(),
  }),
});
export type UsageReportResponse = z.infer<typeof UsageReportResponse>;

export const AUDIT_PROBLEM_CODES = { badCursor: 'bad_cursor', badRange: 'bad_range' } as const;
