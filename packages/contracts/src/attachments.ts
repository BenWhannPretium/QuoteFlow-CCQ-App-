import { z } from 'zod';

// ── Attachments (F-13, B-16) ───────────────────────────────────────────────────────────────────────

export const ATTACHMENT_KIND_VALUES = [
  'bottle_drawing',
  'spec',
  'sample_photo',
  'capacity_analysis',
  'other',
  // FB-02 (F-014)
  'bid_file',
  'project_brief',
  'competitor_drawing',
  // FB-07 (F-031, F-074): the Quoting models, versioned (one current record per quote and kind).
  'cost_model',
  'roi_model',
  'price_table',
] as const;
export const AttachmentKindSchema = z.enum(ATTACHMENT_KIND_VALUES);
export type AttachmentKindValue = z.infer<typeof AttachmentKindSchema>;

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKindValue, string> = {
  bottle_drawing: 'Bottle drawing',
  spec: 'Specification',
  sample_photo: 'Sample photo',
  capacity_analysis: 'Capacity analysis',
  other: 'Other',
  bid_file: 'Bid file',
  project_brief: 'Project brief',
  competitor_drawing: 'Competitor / incumbent drawing',
  cost_model: 'Costing model',
  roi_model: 'ROI model',
  price_table: 'Updated price table',
};

/** One file on a quote (or on an intake draft before submit). */
export const Attachment = z.object({
  id: z.uuid(),
  kind: AttachmentKindSchema,
  /** The name the user uploaded (metadata; the stored name is sanitized). */
  fileName: z.string(),
  storedName: z.string().nullable(),
  size: z.number().int(),
  mime: z.string(),
  note: z.string().nullable(),
  uploadedById: z.uuid(),
  uploadedByName: z.string().nullable(),
  /** ISO 8601 UTC. */
  uploadedAt: z.string(),
  /** False for metadata-only rows (the synthetic seed): there are no bytes to download. */
  available: z.boolean(),
  /** sharepoint | blob | local; null when there are no bytes. */
  storage: z.string().nullable(),
  /** SharePoint's own link to the file (opens in SharePoint for people with site access). */
  webUrl: z.string().nullable(),
  /** Whether the caller may remove (soft delete) it now, and if not, why. */
  canRemove: z.boolean(),
  removeBlockedReason: z.string().nullable(),
  /**
   * FB-07 (F-074): versioned kinds (cost_model, roi_model, price_table) only. `version` counts from 1 per
   * quote and kind; `current` flags the latest; an earlier version names the one that replaced it.
   * Null / false for every other kind.
   */
  version: z.number().int().nullable(),
  current: z.boolean(),
  supersededById: z.uuid().nullable(),
  supersededAt: z.string().nullable(),
});
export type Attachment = z.infer<typeof Attachment>;

/** GET /quotes/:qn/attachments and GET /quotes/drafts/:id/attachments. */
export const AttachmentListResponse = z.object({
  items: z.array(Attachment),
  /** The caller may upload here (attachment.upload in scope; the draft owner for a draft). */
  canUpload: z.boolean(),
});
export type AttachmentListResponse = z.infer<typeof AttachmentListResponse>;

/** POST …/attachments (multipart: `kind`, `note?`, `size`, then `file`). */
export const AttachmentUploadResponse = z.object({
  item: Attachment,
  /** Uploading a bottle (or competitor) drawing marks the quote (or draft) as having one. */
  drawingStatus: z.object({ from: z.string().nullable(), to: z.string() }).nullable(),
});
export type AttachmentUploadResponse = z.infer<typeof AttachmentUploadResponse>;

/** The multipart text fields, validated before the file part is read. */
export const AttachmentUploadFields = z.object({
  kind: AttachmentKindSchema,
  note: z.string().trim().max(500).optional(),
  /** The file's size in bytes, sent before the file: SharePoint's upload session needs the total. */
  size: z.coerce.number().int().positive(),
});
export type AttachmentUploadFields = z.infer<typeof AttachmentUploadFields>;

export const AttachmentParams = z.object({ id: z.uuid() });

export const AttachmentDownloadQuery = z.object({
  /** `redirect` (default): 302 to the short-lived URL. `json`: the URL as JSON (the SPA's fetch). */
  format: z.enum(['redirect', 'json']).default('redirect'),
});

export const AttachmentDownloadResponse = z.object({
  url: z.string(),
  /** ISO 8601 UTC: when the link stops working. */
  expiresAt: z.string(),
  fileName: z.string(),
});
export type AttachmentDownloadResponse = z.infer<typeof AttachmentDownloadResponse>;

export const ATTACHMENT_PROBLEM_CODES = {
  notFound: 'not_found',
  /** Type, size, kind, or content that doesn't match the extension (422). */
  rejected: 'attachment_rejected',
  /** The body went past 100 MB or past its declared size (413). */
  tooLarge: 'file_too_large',
  notRemovable: 'not_removable',
  /** A metadata-only row (no bytes stored). */
  fileUnavailable: 'file_unavailable',
  storageUnavailable: 'storage_unavailable',
} as const;
