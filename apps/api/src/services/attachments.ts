import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  ATTACHMENT_PROBLEM_CODES,
  AttachmentUploadFields,
  type Attachment,
  type AttachmentDownloadResponse,
  type AttachmentKindValue,
  type AttachmentListResponse,
  type AttachmentUploadResponse,
  type IntakeDraftData,
  type ModelSummaryListResponse,
} from '@ccq/contracts';
import type { DbOrTx, Tx } from '@ccq/db';
import {
  claimDraftAttachments,
  getAttachment,
  getQuoteById,
  getQuoteByNumber,
  getQuoteDraft,
  getQuoteDraftForUpdate,
  getSetting,
  insertActivityEvent,
  insertAttachment,
  insertAttachmentVersion,
  insertModelSummary,
  listAttachments,
  listDraftAttachments,
  listUsersByIds,
  listValueList,
  loadQuoteState,
  restorePreviousVersion,
  updateAttachment,
  updateQuote,
  updateQuoteDraft,
} from '@ccq/db/repos';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_SNIFF_BYTES,
  attachmentRemoval,
  can,
  canUploadAttachment,
  checkFileContent,
  checkUploadRequest,
  derivedDecisionFields,
  drawingStatusAfterUpload,
  isEngineeringKind,
  isQuotingModelKind,
  isVersionedKind,
  planEquipmentBomUpload,
  planCostModelUploaded,
  planModelUpload,
  planRoiUploaded,
  parseAttachmentSettings,
  renderFolderTemplate,
  displayFileName,
  sanitizeFileName,
  type Actor,
  type AttachmentSettings,
  type ModelUploadContext,
  type PlannedHandoff,
  type QuoteState,
  type QuotingModelKind,
} from '@ccq/domain';
import { FileStoreError, type FileStore, type StoredFile } from '@ccq/integrations';
import type { FastifyBaseLogger } from 'fastify';

import { loadCommercialSettings } from './commercial';
import { deliverPlanned } from './handoff-notifications';
import { assertSectionUnlocked } from './locks';
import {
  collectUpTo,
  isSummaryKind,
  loadModelSummarySettings,
  modelSummariesView,
  pipeThrough,
  runModelSummary,
  summaryFieldRows,
} from './model-summary';
import { ServiceProblem, problemErrors } from './problem';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type AttachmentsWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

type AttachmentRow = Awaited<ReturnType<typeof listAttachments>>[number];

/**
 * Where an upload goes: a quote (any stage) or the caller's open intake draft. FB-07: `kind` set on a
 * quote target fixes the kind (the ROI route uploads `roi_model` whatever the form says).
 */
export type UploadTarget = { quoteNumber: string; kind?: QuotingModelKind } | { draftId: string };

/** The multipart file part as the route hands it over (fields sent before the file). */
export interface UploadPart {
  fileName: string;
  fields: Record<string, string | undefined>;
  stream: Readable;
}

export interface AttachmentServiceOptions {
  store: FileStore;
  log: FastifyBaseLogger;
  now?: () => Date;
}

const P = ATTACHMENT_PROBLEM_CODES;
const notFound = (what = 'No such file') => new ServiceProblem(404, P.notFound, what);

/** FB-07: the costing / ROI step facts a model upload is checked against. */
async function modelContext(db: DbOrTx, state: QuoteState): Promise<ModelUploadContext> {
  const settings = await loadCommercialSettings(db);
  const record = state.fields.pricing_record as Record<string, unknown> | null | undefined;
  return {
    costModelOnFile: state.fields.cost_model_on_file === true,
    costModelGrandfathered: record?.cost_model_requirement === 'grandfathered',
    roiRequired: derivedDecisionFields(state.fields, settings.derived).roi_required,
  };
}

/**
 * FB-07 (D-001): may the actor upload this Quoting model now? The pricing section's G3 lock first
 * (FB-01: 409 SECTION_LOCKED for every role that reaches the service), then the step's own rules.
 */
async function authorizeModel(
  db: DbOrTx,
  actor: Actor,
  kind: QuotingModelKind,
  state: QuoteState,
): Promise<ModelUploadContext> {
  await assertSectionUnlocked(db, 'pricing', state);
  const ctx = await modelContext(db, state);
  const plan = planModelUpload(kind, actor, state, ctx);
  if (!plan.ok) {
    const [first] = plan.errors;
    if (first!.code === 'NOT_PERMITTED') throw new ServiceProblem(403, 'forbidden', first!.message);
    throw new ServiceProblem(409, P.conflict, first!.message, {
      errors: problemErrors(plan.errors),
    });
  }
  return ctx;
}

/**
 * FB-06 (F-058): may the actor upload the equipment BOM now? The engineering section's G2 lock first
 * (FB-01: 409 SECTION_LOCKED for every role that reaches the service), then the review's editors only:
 * the EngLead, or the assigned Engineer, in Engineering Review and not submitted to the lead.
 */
async function authorizeEngineeringFile(db: DbOrTx, actor: Actor, state: QuoteState) {
  await assertSectionUnlocked(db, 'engineering', state);
  const plan = planEquipmentBomUpload(actor, state);
  if (!plan.ok) {
    const [first] = plan.errors;
    if (first!.code === 'NOT_PERMITTED') throw new ServiceProblem(403, 'forbidden', first!.message);
    throw new ServiceProblem(409, P.conflict, first!.message, {
      errors: problemErrors(plan.errors),
    });
  }
}

const MODEL_LABEL: Record<QuotingModelKind, string> = {
  cost_model: 'costing model',
  roi_model: 'payback model',
  price_table: 'updated price table',
};

/**
 * Read the first `n` bytes for the content check, then hand back a stream that replays them followed
 * by the rest, hashing everything (SHA-256) as it passes. Nothing beyond `n` is held in memory.
 */
async function peekAndHash(stream: Readable, n: number) {
  const it = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  const first: Buffer[] = [];
  let length = 0;
  let ended = false;
  while (length < n) {
    const r = await it.next();
    if (r.done) {
      ended = true;
      break;
    }
    first.push(r.value);
    length += r.value.length;
  }
  const head = Buffer.concat(first);
  const hash = createHash('sha256');
  const replay = Readable.from(
    (async function* () {
      try {
        if (head.length) {
          hash.update(head);
          yield head;
        }
        while (!ended) {
          const r = await it.next();
          if (r.done) return;
          hash.update(r.value);
          yield r.value;
        }
      } finally {
        await it.return?.();
      }
    })(),
  );
  return { head: head.subarray(0, n), stream: replay, digest: () => hash.digest('hex') };
}

/** Throw away an unread file part so the request completes (the multipart limit caps it). */
function drain(stream: Readable) {
  stream.resume();
}

/**
 * HMAC-signed, short-lived links for `FILESTORE_MODE=local` (development and CI), standing in for
 * SharePoint's pre-authenticated download URL and Blob's SAS. The key is per process.
 */
export class LocalLinkSigner {
  private readonly key = randomBytes(32);

  sign(itemId: string, fileName: string, expiresAt: Date): string {
    const payload = Buffer.from(
      JSON.stringify({ i: itemId, n: fileName, e: expiresAt.getTime() }),
    ).toString('base64url');
    const mac = createHmac('sha256', this.key).update(payload).digest('base64url');
    return `/api/v1/files/local?t=${payload}.${mac}`;
  }

  verify(token: string, now: Date): { itemId: string; fileName: string } | null {
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const expected = createHmac('sha256', this.key).update(payload).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const { i, n, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        i: string;
        n: string;
        e: number;
      };
      return e > now.getTime() ? { itemId: i, fileName: n } : null;
    } catch {
      return null;
    }
  }
}

/**
 * Attachments (F-13, B-16). Bytes stream straight from the request into the FileStore (SharePoint in
 * 5 MB upload-session ranges; never the whole file in memory); the database keeps the metadata, the
 * timeline gets an activity event and every upload, download and removal an audit row.
 *
 * Authorization: quote files follow `quote.read` (RLS, then the domain policy with the quote's
 * scope); uploads need `attachment.upload` on the quote; draft files belong to the draft's owner.
 */
export class AttachmentService {
  private readonly now: () => Date;
  private readonly store: FileStore;

  constructor(private readonly opts: AttachmentServiceOptions) {
    this.now = opts.now ?? (() => new Date());
    this.store = opts.store;
  }

  get storeKind() {
    return this.store.kind;
  }

  private static async settings(db: DbOrTx): Promise<AttachmentSettings> {
    return parseAttachmentSettings(await getSetting(db, 'attachment_settings'));
  }

  private static async hasDrawingCodes(db: DbOrTx): Promise<string[]> {
    return (await listValueList(db, 'drawing_status'))
      .filter((v) => (v.meta as { hasDrawing?: unknown } | null)?.hasDrawing === true)
      .map((v) => v.code);
  }

  /** The quote (RLS) and the domain's read check on its scope; 404 either way, so nothing leaks. */
  private async readableQuote(tx: Tx, actor: Actor, quoteNumber: string) {
    const quote = await getQuoteByNumber(tx, quoteNumber);
    const state = quote ? await loadQuoteState(tx, quote.id) : undefined;
    if (!quote || !state || !can(actor, 'quote.read', state)) {
      throw notFound(`No quote ${quoteNumber}`);
    }
    return { quote, state };
  }

  /** An open draft the caller owns (RLS shows it to its owner and Admin; only the owner writes). */
  private async ownOpenDraft(tx: Tx, actor: Actor, draftId: string, forUpdate = false) {
    const draft = forUpdate
      ? await getQuoteDraftForUpdate(tx, draftId)
      : await getQuoteDraft(tx, draftId);
    if (!draft) throw notFound('No such draft');
    if (draft.ownerUserId !== actor.userId) {
      throw new ServiceProblem(
        403,
        'not_owner',
        'Only the KAM who started this draft can add files',
      );
    }
    if (draft.submittedQuoteId) {
      throw new ServiceProblem(409, 'already_submitted', 'This draft has already been submitted');
    }
    return draft;
  }

  private async dtos(
    tx: Tx,
    actor: Actor,
    rows: AttachmentRow[],
    settings: AttachmentSettings,
    now: Date,
  ): Promise<Attachment[]> {
    const users = new Map(
      (await listUsersByIds(tx, [...new Set(rows.map((r) => r.uploadedBy))])).map(
        (u) => [u.id, u.displayName] as const,
      ),
    );
    return rows.map((r) => {
      const removal = attachmentRemoval(
        actor,
        {
          uploadedBy: r.uploadedBy,
          createdAt: r.createdAt,
          onOpenDraft: r.quoteId === null,
          kind: r.kind,
        },
        now,
        settings,
      );
      return {
        id: r.id,
        kind: r.kind as AttachmentKindValue,
        fileName: r.fileName,
        storedName: r.storedName,
        size: r.size,
        mime: r.mime,
        note: r.note,
        uploadedById: r.uploadedBy,
        uploadedByName: users.get(r.uploadedBy) ?? null,
        uploadedAt: r.createdAt.toISOString(),
        available: r.storage !== null && r.storageItemId !== null,
        storage: r.storage,
        webUrl: r.spWebUrl,
        canRemove: removal.allowed,
        removeBlockedReason: removal.reason,
        version: r.version,
        current: r.version !== null && r.supersededAt === null && r.removedAt === null,
        supersededById: r.supersededBy,
        supersededAt: r.supersededAt ? r.supersededAt.toISOString() : null,
      };
    });
  }

  // ── List ─────────────────────────────────────────────────────────────────────────────────────

  async listForQuote(
    withTx: AttachmentsWithTx,
    actor: Actor,
    quoteNumber: string,
  ): Promise<{ quoteId: string; list: AttachmentListResponse }> {
    const now = this.now();
    const result = await withTx(async (tx) => {
      const { quote, state } = await this.readableQuote(tx, actor, quoteNumber);
      const settings = await AttachmentService.settings(tx);
      const rows = await listAttachments(tx, quote.id);
      return {
        quoteId: quote.id,
        unsettled: this.unsettled(
          rows,
          renderFolderTemplate(settings.quoteFolder, { quote_number: quote.quoteNumber }),
        ),
        list: {
          items: await this.dtos(tx, actor, rows, settings, now),
          canUpload: canUploadAttachment(actor, state),
        },
      };
    });
    // A draft's files whose move failed at submit: try again (best effort; ids may change).
    if (result.unsettled.length) await this.settle(withTx, result.quoteId);
    return { quoteId: result.quoteId, list: result.list };
  }

  /**
   * FB-14 (D-013): the summaries of the quote's current Quoting models. The route needs
   * `quote.read.commercialFields`; the quote's scope is checked here (404 when it is not readable).
   */
  async modelSummaries(
    withTx: AttachmentsWithTx,
    actor: Actor,
    quoteNumber: string,
  ): Promise<{ quoteId: string; view: ModelSummaryListResponse }> {
    return withTx(async (tx) => {
      const { quote, state } = await this.readableQuote(tx, actor, quoteNumber);
      if (!can(actor, 'quote.read.commercialFields', state)) {
        throw new ServiceProblem(403, 'forbidden', 'You cannot see the figures on this quote');
      }
      return { quoteId: quote.id, view: await modelSummariesView(tx, quote.id) };
    });
  }

  async listForDraft(
    withTx: AttachmentsWithTx,
    actor: Actor,
    draftId: string,
  ): Promise<AttachmentListResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const draft = await getQuoteDraft(tx, draftId);
      if (!draft) throw notFound('No such draft');
      const settings = await AttachmentService.settings(tx);
      const rows = await listDraftAttachments(tx, draftId);
      return {
        items: await this.dtos(tx, actor, rows, settings, now),
        canUpload: draft.ownerUserId === actor.userId && !draft.submittedQuoteId,
      };
    });
  }

  // ── Upload ───────────────────────────────────────────────────────────────────────────────────

  async upload(
    withTx: AttachmentsWithTx,
    actor: Actor,
    target: UploadTarget,
    part: UploadPart,
    meta: AuditMeta,
  ): Promise<AttachmentUploadResponse> {
    // 1. Fields and limits before reading a byte of the file.
    const fields = AttachmentUploadFields.safeParse(part.fields);
    // DR-cross-cutting-05: a 0-byte file (the browser sends size 0) gets its own message, not the
    // generic "choose a kind and send the size" one.
    if (!fields.success && Number(part.fields.size) === 0) {
      drain(part.stream);
      throw new ServiceProblem(
        422,
        P.rejected,
        'The file is empty. Choose a file that has content',
        {
          errors: [{ path: '/file', message: 'The file is empty', code: 'INVALID_VALUE' }],
        },
      );
    }
    if (!fields.success) {
      drain(part.stream);
      throw new ServiceProblem(422, P.rejected, 'Choose a kind and send the file size first', {
        errors: fields.error.issues.map((i) => ({
          path: `/${i.path.join('/')}`,
          message: i.message,
          code: 'INVALID_VALUE',
        })),
      });
    }
    const { note, size } = fields.data;
    // FB-07: the ROI route fixes the kind.
    const kind = 'quoteNumber' in target && target.kind ? target.kind : fields.data.kind;
    // T-003: the name as the user sees it (a "/" is kept); the stored key is sanitized separately.
    const fileName = displayFileName(part.fileName);
    const checked = checkUploadRequest({ fileName, size, kind });
    if (checked.errors.length || !checked.type) {
      drain(part.stream);
      const tooLarge = size > ATTACHMENT_MAX_BYTES;
      throw new ServiceProblem(
        tooLarge ? 413 : 422,
        tooLarge ? P.tooLarge : P.rejected,
        checked.errors[0]!.message,
        { errors: problemErrors(checked.errors) },
      );
    }
    const type = checked.type;

    // 2. Authorize and resolve the folder (short transaction; nothing is held during the upload).
    const where = await withTx(async (tx) => {
      const settings = await AttachmentService.settings(tx);
      if ('quoteNumber' in target) {
        const { quote, state } = await this.readableQuote(tx, actor, target.quoteNumber);
        if (isQuotingModelKind(kind)) {
          await authorizeModel(tx, actor, kind, state);
        } else if (isEngineeringKind(kind)) {
          await authorizeEngineeringFile(tx, actor, state);
        } else if (!canUploadAttachment(actor, state)) {
          throw new ServiceProblem(403, 'forbidden', 'You cannot add files to this quote');
        }
        return {
          settings,
          folder: renderFolderTemplate(settings.quoteFolder, { quote_number: quote.quoteNumber }),
          // FB-14: a Quoting model's summary is read once the file is stored.
          summary: isSummaryKind(kind) ? await loadModelSummarySettings(tx) : null,
        };
      }
      if (isQuotingModelKind(kind)) {
        throw new ServiceProblem(
          422,
          P.rejected,
          'The costing model, payback model and price table are uploaded on the Quoting tab, not at intake',
          {
            errors: [{ path: '/kind', message: 'Not an intake file kind', code: 'INVALID_VALUE' }],
          },
        );
      }
      if (isEngineeringKind(kind)) {
        throw new ServiceProblem(
          422,
          P.rejected,
          'The equipment BOM is uploaded on the Engineering tab, not at intake',
          {
            errors: [{ path: '/kind', message: 'Not an intake file kind', code: 'INVALID_VALUE' }],
          },
        );
      }
      await this.ownOpenDraft(tx, actor, target.draftId);
      return {
        settings,
        folder: renderFolderTemplate(settings.draftFolder, { draft_id: target.draftId }),
        summary: null,
      };
    }).catch((err: unknown) => {
      drain(part.stream);
      throw err;
    });

    // 3. The content must match the extension (magic bytes), whatever the browser claimed.
    const peeked = await peekAndHash(part.stream, ATTACHMENT_SNIFF_BYTES);
    const contentError = checkFileContent(type, peeked.head);
    if (contentError) {
      drain(peeked.stream);
      throw new ServiceProblem(422, P.rejected, contentError.message, {
        errors: problemErrors([contentError]),
      });
    }

    // 4. Stream into the store. FB-14: a Quoting model's bytes are also kept (up to the summary's size
    // cap) so its summary can be read once it is stored; a larger file streams on and is not read.
    const storedName = sanitizeFileName(fileName);
    const summarySettings = where.summary && isSummaryKind(kind) ? where.summary : null;
    const collector =
      summarySettings && size <= summarySettings.limits.maxBytes
        ? collectUpTo(summarySettings.limits.maxBytes)
        : null;
    let stored: StoredFile;
    try {
      stored = await this.store.upload(
        `${where.folder}/${storedName}`,
        collector ? pipeThrough(peeked.stream, collector.tap) : peeked.stream,
        size,
        type.mime,
      );
    } catch (err) {
      throw this.storeProblem(err, 'upload');
    }
    const sha256 = peeked.digest();
    // FB-14: read the summary outside any transaction (CPU, capped in time). It never throws.
    const summaryRun =
      summarySettings && isSummaryKind(kind)
        ? await runModelSummary(kind, collector ? collector.result() : null, summarySettings)
        : null;

    // 5. Metadata, side effects and audit in one transaction. If it fails, the file is moved to the
    // removed folder so nothing unreferenced is left in the quote folder.
    const now = this.now();
    try {
      return await withTx(async (tx) => {
        const settings = where.settings;
        let quoteId: string | null = null;
        let quoteNumber: string | null = null;
        let modelCtx: ModelUploadContext | null = null;
        let drawingStatus: AttachmentUploadResponse['drawingStatus'] = null;
        const hasDrawing = await AttachmentService.hasDrawingCodes(tx);
        if ('quoteNumber' in target) {
          const { quote, state } = await this.readableQuote(tx, actor, target.quoteNumber);
          quoteId = quote.id;
          quoteNumber = quote.quoteNumber;
          // Checked again here: the quote may have moved on while the bytes streamed.
          if (isQuotingModelKind(kind)) modelCtx = await authorizeModel(tx, actor, kind, state);
          else if (isEngineeringKind(kind)) await authorizeEngineeringFile(tx, actor, state);
          const to = drawingStatusAfterUpload(kind, quote.drawingStatus, hasDrawing);
          if (to) drawingStatus = { from: quote.drawingStatus, to };
        } else {
          const draft = await this.ownOpenDraft(tx, actor, target.draftId, true);
          const data = draft.data as IntakeDraftData;
          const to = drawingStatusAfterUpload(kind, data.drawingStatus ?? null, hasDrawing);
          if (to) {
            drawingStatus = { from: data.drawingStatus ?? null, to };
            await updateQuoteDraft(tx, draft.id, { data: { ...data, drawingStatus: to } });
          }
        }
        const values = {
          quoteId,
          draftId: 'draftId' in target ? target.draftId : null,
          kind,
          fileName,
          storedName: stored.name,
          size,
          mime: type.mime,
          note: note || null,
          sha256,
          storage: this.store.kind,
          storageItemId: stored.itemId,
          storagePath: stored.folder,
          spDriveId: null,
          spItemId: this.store.kind === 'sharepoint' ? stored.itemId : null,
          spWebUrl: stored.webUrl,
          uploadedBy: actor.userId,
          createdAt: now,
          createdBy: actor.userId,
        };
        // FB-07 (F-074), FB-06 (F-058): a versioned kind is one record per quote and kind with history.
        let superseded: { id: string; version: number | null } | null = null;
        let row: AttachmentRow;
        if (isVersionedKind(kind) && quoteId) {
          const v = await insertAttachmentVersion(tx, { ...values, quoteId }, now);
          row = v.row;
          superseded = v.superseded;
        } else {
          row = await insertAttachment(tx, values);
        }
        await recordAudit(tx, actor, meta, {
          at: now,
          action: 'upload',
          entity: 'attachment',
          entityId: row.id,
          quoteId,
          after: {
            kind,
            fileName,
            storedName: stored.name,
            size,
            mime: type.mime,
            sha256,
            storage: this.store.kind,
            folder: stored.folder,
            ...('draftId' in target ? { draftId: target.draftId } : {}),
            ...(row.version !== null
              ? { version: row.version, supersedes: superseded?.id ?? null }
              : {}),
          },
        });
        // FB-14 (D-013): the summary read from this version, and its audit row (no figures in it).
        if (summaryRun && quoteId && isSummaryKind(kind)) {
          const s = summaryRun.extraction;
          const summary = await insertModelSummary(
            tx,
            {
              attachmentId: row.id,
              quoteId,
              kind,
              status: s.status,
              reason: s.reason,
              templateId: s.templateId,
              mapProvisional: summaryRun.template?.provisional ?? null,
              extractedAt: now,
              durationMs: summaryRun.durationMs,
              createdBy: actor.userId,
            },
            summaryFieldRows(s.fields),
          );
          await recordAudit(tx, actor, meta, {
            at: now,
            action: 'create',
            entity: 'model_summary',
            entityId: summary.id,
            quoteId,
            after: {
              attachmentId: row.id,
              kind,
              version: row.version,
              templateId: s.templateId,
              status: s.status,
              reason: s.reason,
              fieldCount: s.fields.length,
            },
          });
        }
        if (superseded) {
          await recordAudit(tx, actor, meta, {
            at: now,
            action: 'update',
            entity: 'attachment',
            entityId: superseded.id,
            quoteId,
            before: { current: true, version: superseded.version },
            after: { current: false, supersededBy: row.id, supersededAt: now.toISOString() },
          });
        }
        if (quoteId) {
          if (drawingStatus) {
            await updateQuote(tx, quoteId, { drawingStatus: drawingStatus.to, updatedAt: now });
            await recordAudit(tx, actor, meta, {
              at: now,
              action: 'update',
              entity: 'quote',
              entityId: quoteId,
              quoteId,
              before: { drawingStatus: drawingStatus.from },
              after: { drawingStatus: drawingStatus.to, reason: 'bottle_drawing uploaded' },
            });
          }
          await insertActivityEvent(tx, {
            quoteId,
            type: 'attachment_uploaded',
            actorId: actor.userId,
            at: now,
            payload: {
              attachmentId: row.id,
              fileName,
              kind,
              size,
              ...(drawingStatus ? { drawingStatus } : {}),
              ...(row.version !== null
                ? { version: row.version, replaces: superseded?.id ?? null }
                : {}),
            },
            createdBy: actor.userId,
          });
          if (modelCtx && isQuotingModelKind(kind)) {
            await this.announceModel(tx, actor, kind, row.version ?? 1, modelCtx, {
              id: quoteId,
              quoteNumber: quoteNumber!,
            });
          }
        }
        const [item] = await this.dtos(tx, actor, [row], settings, now);
        return { item: item!, drawingStatus };
      });
    } catch (err) {
      await this.store.delete(stored.itemId, where.settings.removedFolder).catch(() => undefined);
      this.opts.log.warn(
        { code: 'METADATA_FAILED' },
        'upload stored but not recorded; file moved to removed',
      );
      throw err;
    }
  }

  /**
   * FB-07 (D-001): the next person in the sequence is told through FB-05's resolver. Costing model →
   * Finance, when the quote needs an ROI; ROI model → the pricing lead. The updated price table is the
   * lead's own step: nobody is paged. In-app body and email name the uploader and the version only.
   */
  private async announceModel(
    tx: Tx,
    actor: Actor,
    kind: QuotingModelKind,
    version: number,
    ctx: ModelUploadContext,
    quote: { id: string; quoteNumber: string },
  ) {
    const entries: PlannedHandoff[] =
      kind === 'cost_model'
        ? planCostModelUploaded(ctx.roiRequired)
        : kind === 'roi_model'
          ? planRoiUploaded()
          : [];
    if (entries.length === 0) return;
    const [me] = await listUsersByIds(tx, [actor.userId]);
    const who = me?.displayName ?? null;
    const label = MODEL_LABEL[kind];
    await deliverPlanned(
      tx,
      entries,
      actor.userId,
      () =>
        kind === 'cost_model'
          ? {
              title: `${quote.quoteNumber} is ready for its payback model`,
              body: `${who ?? 'Pricing'} uploaded the ${label} (version ${version}). Capital is required on this quote: build the payback model from it and upload it on the Quoting tab.`,
              payload: { version: String(version), ...(who ? { actor: who } : {}) },
            }
          : {
              title: `${quote.quoteNumber}: the payback model is uploaded`,
              body: `${who ?? 'Finance'} uploaded the ${label} (version ${version}). Review it and approve the price (G3), or send the quote back.`,
              payload: { version: String(version), ...(who ? { actor: who } : {}) },
            },
      quote.id,
      { log: this.opts.log },
    );
  }

  // ── Download ─────────────────────────────────────────────────────────────────────────────────

  async download(
    withTx: AttachmentsWithTx,
    actor: Actor,
    id: string,
    meta: AuditMeta,
  ): Promise<AttachmentDownloadResponse> {
    const now = this.now();
    return withTx(async (tx) => {
      const row = await this.visibleAttachment(tx, actor, id);
      if (!row.storage || !row.storageItemId) {
        throw new ServiceProblem(404, P.fileUnavailable, 'This file has no stored copy');
      }
      if (row.storage !== this.store.kind) {
        throw new ServiceProblem(
          503,
          P.storageUnavailable,
          `This file is stored in ${row.storage}, which this server is not configured for`,
        );
      }
      let link;
      try {
        link = await this.store.getDownloadUrl(row.storageItemId, {
          fileName: row.fileName,
          mime: row.mime,
        });
      } catch (err) {
        throw this.storeProblem(err, 'download');
      }
      // Audited in the same transaction: no link without its audit row.
      await recordAudit(tx, actor, meta, {
        at: now,
        action: 'download',
        entity: 'attachment',
        entityId: row.id,
        quoteId: row.quoteId,
        after: { fileName: row.fileName, size: row.size, storage: row.storage },
      });
      return { url: link.url, expiresAt: link.expiresAt.toISOString(), fileName: row.fileName };
    });
  }

  /** The row if the caller may read it: RLS first, then the quote's domain read check. */
  private async visibleAttachment(tx: Tx, actor: Actor, id: string, forUpdate = false) {
    const row = await getAttachment(tx, id, forUpdate);
    if (!row || row.removedAt) throw notFound();
    if (row.quoteId) {
      const state = await loadQuoteState(tx, row.quoteId);
      if (!state || !can(actor, 'quote.read', state)) throw notFound();
    }
    return row;
  }

  // ── Remove (soft) ────────────────────────────────────────────────────────────────────────────

  async remove(
    withTx: AttachmentsWithTx,
    actor: Actor,
    id: string,
    meta: AuditMeta,
  ): Promise<void> {
    const now = this.now();
    await withTx(async (tx) => {
      const row = await this.visibleAttachment(tx, actor, id, true);
      const settings = await AttachmentService.settings(tx);
      const onOpenDraft = row.quoteId === null;
      const rule = attachmentRemoval(
        actor,
        // FB-14: the kind decides which upload permission counts (Finance removes its own payback
        // model with roi.upload; without the kind it was held to attachment.upload and refused).
        { uploadedBy: row.uploadedBy, createdAt: row.createdAt, onOpenDraft, kind: row.kind },
        now,
        settings,
      );
      if (!rule.allowed) throw new ServiceProblem(403, P.notRemovable, rule.reason!);
      // FB-07: a Quoting model locks with the pricing section after G3 (Admin may still remove one).
      if (row.quoteId && isQuotingModelKind(row.kind) && !can(actor, 'attachment.removeAny')) {
        const state = await loadQuoteState(tx, row.quoteId);
        if (state) await assertSectionUnlocked(tx, 'pricing', state);
      }
      // FB-06: the equipment BOM locks with the engineering section after G2 (Admin may still remove it).
      if (row.quoteId && isEngineeringKind(row.kind) && !can(actor, 'attachment.removeAny')) {
        const state = await loadQuoteState(tx, row.quoteId);
        if (state) await assertSectionUnlocked(tx, 'engineering', state);
      }
      const moved = await this.removeRow(tx, actor, row, settings, now, meta);
      try {
        // F-074: removing the current version makes the newest remaining one current again.
        if (row.quoteId && row.version !== null && row.supersededAt === null) {
          const restored = await restorePreviousVersion(tx, row.quoteId, row.kind, now);
          if (restored) {
            await recordAudit(tx, actor, meta, {
              at: now,
              action: 'update',
              entity: 'attachment',
              entityId: restored.id,
              quoteId: row.quoteId,
              before: { current: false, supersededBy: row.id },
              after: { current: true, version: restored.version, reason: 'newer version removed' },
            });
          }
        }
      } catch (err) {
        await this.putBack(moved, row);
        throw err;
      }
    });
  }

  /**
   * The removal failed after the bytes moved: put them back (best effort), so the row the rollback
   * leaves in place still points at its file.
   */
  private async putBack(moved: StoredFile | null, row: AttachmentRow) {
    if (!moved || !row.storagePath) return;
    try {
      await this.store.move(moved.itemId, row.storagePath);
    } catch (err) {
      this.opts.log.warn(
        { op: 'remove-undo', code: err instanceof FileStoreError ? err.code : 'UNKNOWN' },
        'file store failed',
      );
    }
  }

  /**
   * Move the bytes to the removed folder (inside the transaction: a store failure changes nothing, and
   * a database failure after the move puts the bytes back). Returns the moved file, if any.
   */
  private async removeRow(
    tx: Tx,
    actor: Actor,
    row: AttachmentRow,
    settings: AttachmentSettings,
    now: Date,
    meta: AuditMeta,
  ): Promise<StoredFile | null> {
    let moved: StoredFile | null = null;
    if (row.storage === this.store.kind && row.storageItemId) {
      try {
        moved = await this.store.delete(row.storageItemId, settings.removedFolder);
      } catch (err) {
        if (!(err instanceof FileStoreError && err.code === 'NOT_FOUND')) {
          throw this.storeProblem(err, 'remove');
        }
      }
    }
    try {
      await updateAttachment(tx, row.id, {
        removedAt: now,
        removedBy: actor.userId,
        updatedAt: now,
        ...(moved
          ? {
              storageItemId: moved.itemId,
              storagePath: moved.folder,
              ...(row.storage === 'sharepoint'
                ? { spItemId: moved.itemId, spWebUrl: moved.webUrl }
                : {}),
            }
          : {}),
      });
      await recordAudit(tx, actor, meta, {
        at: now,
        action: 'update',
        entity: 'attachment',
        entityId: row.id,
        quoteId: row.quoteId,
        before: { removed: false, folder: row.storagePath },
        after: { removed: true, folder: moved?.folder ?? row.storagePath, fileName: row.fileName },
      });
      if (row.quoteId) {
        await insertActivityEvent(tx, {
          quoteId: row.quoteId,
          type: 'attachment_removed',
          actorId: actor.userId,
          at: now,
          payload: { attachmentId: row.id, fileName: row.fileName, kind: row.kind },
          createdBy: actor.userId,
        });
      }
    } catch (err) {
      await this.putBack(moved, row);
      throw err;
    }
    return moved;
  }

  // ── Intake drafts: submit and delete ────────────────────────────────────────────────────────

  /**
   * Inside the submit transaction: the draft's files now belong to the quote, and the timeline says
   * they arrived with the intake. Their bytes move to the quote folder after the commit (`settle`).
   */
  async claimDraftFiles(tx: Tx, actor: Actor, draftId: string, quoteId: string, now: Date) {
    const rows = await claimDraftAttachments(tx, draftId, quoteId, now);
    for (const row of rows) {
      await insertActivityEvent(tx, {
        quoteId,
        type: 'attachment_uploaded',
        actorId: row.uploadedBy,
        at: now,
        payload: {
          attachmentId: row.id,
          fileName: row.fileName,
          kind: row.kind,
          size: row.size,
          fromDraft: true,
        },
        createdBy: actor.userId,
      });
    }
    return rows.length;
  }

  /** Inside the draft-delete transaction: its files are removed (soft) first. */
  async removeDraftFiles(tx: Tx, actor: Actor, draftId: string, meta: AuditMeta) {
    const rows = await listDraftAttachments(tx, draftId);
    if (!rows.length) return;
    const settings = await AttachmentService.settings(tx);
    const now = this.now();
    for (const row of rows) await this.removeRow(tx, actor, row, settings, now, meta);
  }

  private unsettled(rows: AttachmentRow[], quoteFolder: string) {
    return rows.filter(
      (r) => r.storage === this.store.kind && r.storageItemId && r.storagePath !== quoteFolder,
    );
  }

  /**
   * Move a quote's files into its folder (draft files after submit; a failed move is retried on the
   * next list). Best effort: a failure is logged with its code and the file stays downloadable where
   * it is.
   */
  async settle(withTx: AttachmentsWithTx, quoteId: string): Promise<number> {
    const plan = await withTx(async (tx) => {
      const quote = await getQuoteById(tx, quoteId);
      if (!quote) return null;
      const settings = await AttachmentService.settings(tx);
      const folder = renderFolderTemplate(settings.quoteFolder, {
        quote_number: quote.quoteNumber,
      });
      return { folder, rows: this.unsettled(await listAttachments(tx, quoteId), folder) };
    });
    if (!plan) return 0;
    let moved = 0;
    for (const row of plan.rows) {
      try {
        const file = await this.store.move(row.storageItemId!, plan.folder);
        await withTx((tx) =>
          updateAttachment(tx, row.id, {
            storageItemId: file.itemId,
            storagePath: file.folder,
            storedName: file.name,
            updatedAt: this.now(),
            ...(row.storage === 'sharepoint'
              ? { spItemId: file.itemId, spWebUrl: file.webUrl }
              : {}),
          }),
        );
        moved++;
      } catch (err) {
        this.opts.log.warn(
          { code: err instanceof FileStoreError ? err.code : 'FAILED', attachmentId: row.id },
          'attachment move to the quote folder failed; will retry',
        );
      }
    }
    return moved;
  }

  // ── Store errors → problem+json ──────────────────────────────────────────────────────────────

  private storeProblem(err: unknown, op: string): unknown {
    if (err instanceof ServiceProblem) return err;
    if (err instanceof FileStoreError) {
      this.opts.log.warn({ op, code: err.code, status: err.status }, 'file store failed');
      if (err.code === 'TOO_LARGE') {
        return new ServiceProblem(413, P.tooLarge, 'The file is larger than its declared size');
      }
      if (err.code === 'SIZE_MISMATCH') {
        return new ServiceProblem(422, P.rejected, 'The upload ended early; please try again');
      }
      if (err.code === 'NOT_FOUND') {
        return new ServiceProblem(404, P.fileUnavailable, 'The stored file is missing');
      }
      return new ServiceProblem(
        503,
        P.storageUnavailable,
        'File storage is unavailable right now; please try again',
      );
    }
    return err;
  }
}
