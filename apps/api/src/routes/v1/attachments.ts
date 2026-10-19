import {
  ATTACHMENT_PROBLEM_CODES,
  AttachmentDownloadQuery,
  AttachmentDownloadResponse,
  AttachmentListResponse,
  AttachmentParams,
  AttachmentUploadResponse,
  IntakeDraftParams,
  QuoteNumberParams,
} from '@ccq/contracts';
import { fileTypeForName } from '@ccq/domain';
import { contentDisposition, LocalFileStore, type FileStore } from '@ccq/integrations';
import type {} from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import { problem, sendProblem } from '../../plugins/problem-json';
import type {
  AttachmentService,
  AttachmentsWithTx,
  LocalLinkSigner,
  UploadPart,
  UploadTarget,
} from '../../services/attachments';
import { handleProblems, ServiceProblem } from '../../services/problem';

const tags = ['attachments'];
const security = [{ bearerAuth: [] }];

const UPLOAD_HELP =
  'multipart/form-data, streamed to the file store (never buffered): the text fields `kind` (bottle_drawing | spec | sample_photo | other), `note` (optional) and `size` (bytes) **before** the `file` part. Types: pdf, png, jpg/jpeg, heic, dwg, dxf, step/stp, igs, xlsx, docx, msg, eml; the content must match the extension. Max 100 MB (413). Audited.';

/** The first file part and the text fields sent before it. */
async function readPart(req: FastifyRequest): Promise<UploadPart> {
  if (!req.isMultipart()) {
    throw new ServiceProblem(415, ATTACHMENT_PROBLEM_CODES.rejected, 'Send multipart/form-data');
  }
  const file = await req.file();
  if (!file) {
    throw new ServiceProblem(422, ATTACHMENT_PROBLEM_CODES.rejected, 'Attach a file', {
      errors: [{ path: '/file', message: 'Attach a file', code: 'MISSING_FIELD' }],
    });
  }
  const fields: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(file.fields)) {
    if (value && !Array.isArray(value) && value.type === 'field')
      fields[name] = String(value.value);
  }
  return { fileName: file.filename, fields, stream: file.file };
}

export interface AttachmentRoutesOptions {
  service: AttachmentService;
  store: FileStore;
  signer: LocalLinkSigner;
  now?: () => Date;
}

/**
 * Attachments (F-13, B-16): upload to a quote at any stage or to an open intake draft, list,
 * download (authorized, audited, then a short-lived link) and soft removal.
 */
export const attachmentRoutes: FastifyPluginAsyncZod<AttachmentRoutesOptions> = async (
  app,
  { service, store, signer, now = () => new Date() },
) => {
  const withTx =
    (req: FastifyRequest): AttachmentsWithTx =>
    (fn) =>
      app.withTx(req, fn);

  const upload = (req: FastifyRequest, target: UploadTarget) =>
    readPart(req).then((part) =>
      service.upload(withTx(req), requireActor(req), target, part, auditMeta(req)),
    );

  app.post(
    '/quotes/:quoteNumber/attachments',
    {
      config: { permission: 'attachment.upload' },
      schema: {
        tags,
        summary: `Upload a file to a quote (any stage). A bottle_drawing sets drawing_status to the "have drawing" code. ${UPLOAD_HELP}`,
        security,
        consumes: ['multipart/form-data'],
        params: QuoteNumberParams,
        response: { 201: AttachmentUploadResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () =>
        reply.status(201).send(await upload(req, { quoteNumber: req.params.quoteNumber })),
      ),
  );

  app.get(
    '/quotes/:quoteNumber/attachments',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags,
        summary:
          "The quote's files (kind, name, size, uploader, date), oldest first, with whether the caller may remove each. Follows quote.read scope",
        security,
        params: QuoteNumberParams,
        response: { 200: AttachmentListResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const { quoteId, list } = await service.listForQuote(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
        );
        req.auditView = { entity: 'quote', entityId: quoteId, quoteId };
        return list;
      }),
  );

  app.post(
    '/quotes/drafts/:id/attachments',
    {
      config: { permission: 'quote.create' },
      schema: {
        tags,
        summary: `Upload a file to your open intake draft (it moves to the quote folder on submit). ${UPLOAD_HELP}`,
        security,
        consumes: ['multipart/form-data'],
        params: IntakeDraftParams,
        response: { 201: AttachmentUploadResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () =>
        reply.status(201).send(await upload(req, { draftId: req.params.id })),
      ),
  );

  app.get(
    '/quotes/drafts/:id/attachments',
    {
      config: { permission: 'quote.create' },
      schema: {
        tags,
        summary: "An intake draft's files (the draft's owner; Admin read-only)",
        security,
        params: IntakeDraftParams,
        response: { 200: AttachmentListResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.listForDraft(withTx(req), requireActor(req), req.params.id),
      ),
  );

  app.get(
    '/attachments/:id/download',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags,
        summary:
          'Download a file: authorization check, an audit row, then a 302 to a short-lived link (SharePoint download URL, Blob SAS or a signed local link). `format=json` returns the link instead (the SPA)',
        security,
        params: AttachmentParams,
        querystring: AttachmentDownloadQuery,
        response: { 200: AttachmentDownloadResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const link = await service.download(
          withTx(req),
          requireActor(req),
          req.params.id,
          auditMeta(req),
        );
        if (req.query.format === 'json') return link;
        void reply.header('cache-control', 'no-store');
        return reply.redirect(link.url, 302);
      }),
  );

  app.delete(
    '/attachments/:id',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags,
        summary:
          'Remove a file (soft: it moves to the removed folder). The uploader within attachment_settings.uploaderRemoveHours (24 h), the draft owner on an open draft, or attachment.removeAny (Admin)',
        security,
        params: AttachmentParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        await service.remove(withTx(req), requireActor(req), req.params.id, auditMeta(req));
        return reply.status(204).send(null);
      }),
  );

  // FILESTORE_MODE=local only: the signed link stands in for SharePoint's pre-authenticated URL.
  if (store instanceof LocalFileStore) {
    app.get(
      '/files/local',
      {
        config: { public: true },
        schema: {
          tags,
          summary:
            'Local store only (dev/CI): the bytes behind a signed, short-lived download link',
          querystring: z.object({ t: z.string().max(4096) }),
        },
      },
      async (req, reply) => {
        const link = signer.verify(req.query.t, now());
        const opened = link ? await store.openRead(link.itemId).catch(() => null) : null;
        if (!link || !opened) {
          return sendProblem(
            reply,
            problem(404, req, {
              detail: 'This link has expired',
              code: ATTACHMENT_PROBLEM_CODES.notFound,
            }),
          );
        }
        const { file, stream } = opened;
        return reply
          .header(
            'content-type',
            fileTypeForName(link.fileName)?.mime ?? 'application/octet-stream',
          )
          .header('content-length', String(file.size))
          .header('content-disposition', contentDisposition(link.fileName))
          .header('cache-control', 'private, no-store')
          .header('x-content-type-options', 'nosniff')
          .send(stream);
      },
    );
  }
};
