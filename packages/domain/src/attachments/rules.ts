import { DomainError } from '../errors';
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_FILE_TYPES,
  DRAWING_ATTACHMENT_KINDS,
  KIND_FORMATS,
  fileTypeForName,
  isQuotingModelKind,
  sniffMatches,
  type AttachmentFileType,
  type AttachmentKind,
} from './file-types';
import { renderFolderTemplate } from './names';
import { can, hasPermission, type PolicyResource } from '../policy/can';
import { MODEL_UPLOAD_PERMISSION } from '../quoting-steps';
import type { Actor } from '../types/actor';

/**
 * `app_setting.attachment_settings` (D-SP: the SharePoint folder convention is agreed at M7 with
 * Bailey's ERF restructure for Ranger; until then these are provisional seeds). Paths are relative to
 * the document library root; the API never builds a path any other way.
 */
export interface AttachmentSettings {
  /** Where a quote's files live. Placeholder: {quote_number}. */
  quoteFolder: string;
  /** Where an intake draft's files wait until submit (then they move). Placeholder: {draft_id}. */
  draftFolder: string;
  /** Soft delete: removed files move under here, into a folder named after their old one. */
  removedFolder: string;
  /** How long an uploader may remove their own file (Admin always may). */
  uploaderRemoveHours: number;
}

export const ATTACHMENT_SETTINGS_SEED: AttachmentSettings = {
  quoteFolder: 'CCQ/{quote_number}',
  draftFolder: 'CCQ/_drafts/{draft_id}',
  removedFolder: 'CCQ/_removed',
  uploaderRemoveHours: 24,
};

/** Null/undefined → the seed. Each key falls back to the seed when absent; a bad value is an error. */
export function parseAttachmentSettings(input: unknown): AttachmentSettings {
  if (input === undefined || input === null) return { ...ATTACHMENT_SETTINGS_SEED };
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('INVALID_CONFIG', 'attachment_settings must be an object');
  }
  const raw = input as Record<string, unknown>;
  const out: AttachmentSettings = { ...ATTACHMENT_SETTINGS_SEED };
  for (const key of ['quoteFolder', 'draftFolder', 'removedFolder'] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !v.trim()) {
      throw new DomainError('INVALID_CONFIG', `attachment_settings.${key} must be a folder path`);
    }
    out[key] = v.trim();
  }
  const hours = raw.uploaderRemoveHours;
  if (hours !== undefined) {
    if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 0 || hours > 24 * 30) {
      throw new DomainError(
        'INVALID_CONFIG',
        'attachment_settings.uploaderRemoveHours must be a whole number of hours from 0 to 720',
      );
    }
    out.uploaderRemoveHours = hours;
  }
  // Each template must render with its own placeholder (and nothing else).
  renderFolderTemplate(out.quoteFolder, { quote_number: 'CCQ-2026-00001' });
  renderFolderTemplate(out.draftFolder, { draft_id: '00000000-0000-7000-8000-000000000000' });
  renderFolderTemplate(out.removedFolder, {});
  return out;
}

export interface UploadRequest {
  fileName: string;
  /** Declared size in bytes (the multipart `size` field; the stream is held to it). */
  size: number;
  kind: string;
}

const MB = 1024 * 1024;

/** Type, size and kind checks before a byte is stored. Errors carry the multipart field. */
export function checkUploadRequest(req: UploadRequest): {
  errors: DomainError[];
  type: AttachmentFileType | undefined;
} {
  const errors: DomainError[] = [];
  const type = fileTypeForName(req.fileName);
  if (!type) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `This file type is not accepted. Use one of: ${ATTACHMENT_EXTENSIONS.join(', ')}`,
        'file',
      ),
    );
  }
  if (!Number.isInteger(req.size) || req.size <= 0) {
    errors.push(new DomainError('INVALID_VALUE', 'The file is empty', 'file'));
  } else if (req.size > ATTACHMENT_MAX_BYTES) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `The file is ${(req.size / MB).toFixed(1)} MB; the limit is ${ATTACHMENT_MAX_BYTES / MB} MB`,
        'file',
      ),
    );
  }
  // DR-pricing-finance-07: a kind with its own formats (the Quoting models: workbooks only).
  const only = KIND_FORMATS[req.kind as AttachmentKind];
  if (type && only && !only.includes(type.format)) {
    const labels = ATTACHMENT_FILE_TYPES.filter((t) => only.includes(t.format));
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `This file must be ${labels
          .map(
            (t) =>
              `${/^[aeiou]/i.test(t.label) ? 'an' : 'a'} ${t.label} (.${t.extensions.join(', .')})`,
          )
          .join(' or ')}`,
        'file',
      ),
    );
  }
  if (!(ATTACHMENT_KINDS as readonly string[]).includes(req.kind)) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `Kind must be one of ${ATTACHMENT_KINDS.join(', ')}`,
        'kind',
      ),
    );
  }
  return { errors, type };
}

/** The content check: the leading bytes must match the extension's format. */
export function checkFileContent(type: AttachmentFileType, head: Uint8Array): DomainError | null {
  return sniffMatches(type.format, head)
    ? null
    : new DomainError(
        'INVALID_VALUE',
        // DR-engineering-09: "an Excel workbook", not "a Excel workbook".
        `The file's content is not ${/^[aeiou]/i.test(type.label) ? 'an' : 'a'} ${type.label}; check the file and its extension`,
        'file',
      );
}

export function canUploadAttachment(actor: Actor, quote: PolicyResource): boolean {
  return can(actor, 'attachment.upload', quote);
}

export interface RemovableAttachment {
  uploadedBy: string;
  createdAt: Date;
  /** The file is on an intake draft that hasn't been submitted (its owner may always remove it). */
  onOpenDraft: boolean;
  /**
   * FB-07: the file's kind. A Quoting model is uploaded under its step's permission (Finance's ROI under
   * `roi.upload`), so its uploader's window follows that permission, not `attachment.upload`.
   */
  kind?: string;
}

/**
 * Who may remove (soft delete) a file: `attachment.removeAny` (Admin), or the uploader within
 * `uploaderRemoveHours` while they can still upload, or the draft's owner while the draft is open.
 */
export function attachmentRemoval(
  actor: Actor,
  file: RemovableAttachment,
  now: Date,
  settings: Pick<AttachmentSettings, 'uploaderRemoveHours'>,
): { allowed: boolean; reason: string | null } {
  if (hasPermission(actor, 'attachment.removeAny')) return { allowed: true, reason: null };
  if (file.uploadedBy !== actor.userId) {
    return {
      allowed: false,
      reason: 'Only the person who uploaded it, or an Admin, can remove it',
    };
  }
  if (file.onOpenDraft) return { allowed: true, reason: null };
  const uploadPermission =
    file.kind !== undefined && isQuotingModelKind(file.kind)
      ? MODEL_UPLOAD_PERMISSION[file.kind]
      : 'attachment.upload';
  if (!hasPermission(actor, uploadPermission)) {
    return { allowed: false, reason: 'Only an Admin can remove it' };
  }
  const windowMs = settings.uploaderRemoveHours * 3_600_000;
  if (now.getTime() - file.createdAt.getTime() < windowMs) return { allowed: true, reason: null };
  return {
    allowed: false,
    reason: `Uploads can be removed for ${settings.uploaderRemoveHours} hours; ask an Admin`,
  };
}

/**
 * Uploading a bottle drawing (or, FB-02, a competitor / incumbent drawing) marks the quote as having
 * one: the first `drawing_status` code whose value-list meta says `hasDrawing` (HAVE_DRAWING in the
 * seed), unless it already has such a code. Null = no change.
 */
export function drawingStatusAfterUpload(
  kind: string,
  current: string | null,
  hasDrawingCodes: readonly string[],
): string | null {
  if (!(DRAWING_ATTACHMENT_KINDS as readonly string[]).includes(kind)) return null;
  if (hasDrawingCodes.length === 0) return null;
  if (current !== null && hasDrawingCodes.includes(current)) return null;
  return hasDrawingCodes[0]!;
}
