import {
  CreateFeedbackBody,
  CreateFeedbackResponse,
  FeedbackIdParams,
  FeedbackItem,
  FeedbackListQuery,
  FeedbackListResponse,
  UpdateFeedbackBody,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { FeedbackService, FeedbackWithTx } from '../../services/feedback';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];
const tags = ['feedback'];

/**
 * B-23 in-app feedback. `POST /feedback` is the "Report an issue" button (every MVP role);
 * `/admin/feedback…` is the triage page (Admin only: a report can show commercial figures).
 */
export const feedbackRoutes: FastifyPluginAsyncZod<{ service: FeedbackService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): FeedbackWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.post(
    '/feedback',
    {
      config: { permission: 'feedback.submit' },
      // A screenshot of up to 2 MB travels as base64 in the JSON body.
      bodyLimit: 4 * 1024 * 1024,
      schema: {
        tags,
        summary:
          'Report an issue: type, severity, description, page context and an optional screenshot',
        security,
        body: CreateFeedbackBody,
        response: { 201: CreateFeedbackResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const created = await service.create(
          withTx(req),
          requireActor(req),
          req.body,
          auditMeta(req),
        );
        return reply.code(201).send(created);
      }),
  );

  app.get(
    '/admin/feedback',
    {
      config: { permission: 'feedback.triage' },
      schema: {
        tags,
        summary: 'Feedback reports for triage, newest first (Admin)',
        security,
        querystring: FeedbackListQuery,
        response: { 200: FeedbackListResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => ({
        items: await service.list(withTx(req), req.query.status),
      })),
  );

  app.get(
    '/admin/feedback/:id/screenshot',
    {
      config: { permission: 'feedback.triage' },
      schema: {
        tags,
        summary: 'The screenshot attached to a report (image bytes; 404 when there is none)',
        security,
        params: FeedbackIdParams,
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const shot = await service.screenshot(withTx(req), req.params.id);
        return reply
          .header('content-type', shot.contentType)
          .header('content-disposition', 'inline')
          .header('cache-control', 'private, no-store')
          .header('x-content-type-options', 'nosniff')
          .send(shot.bytes);
      }),
  );

  app.patch(
    '/admin/feedback/:id',
    {
      config: { permission: 'feedback.triage' },
      schema: {
        tags,
        summary: 'Triage a report: status, severity, owner, GitHub issue link, notes (audited)',
        security,
        params: FeedbackIdParams,
        body: UpdateFeedbackBody,
        response: { 200: FeedbackItem },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.update(withTx(req), requireActor(req), req.params.id, req.body, auditMeta(req)),
      ),
  );
};
