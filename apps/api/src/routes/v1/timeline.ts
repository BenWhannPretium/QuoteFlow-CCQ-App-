import {
  CommentResponse,
  CreateCommentBody,
  QuoteNumberParams,
  TimelineQuery,
  TimelineResponse,
  UserSearchQuery,
  UserSearchResponse,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import { handleProblems } from '../../services/problem';
import type { TimelineService, TimelineWithTx } from '../../services/timeline';

const security = [{ bearerAuth: [] }];

/** The quote timeline and comments (F-08, B-09), and the @mention user picker. */
export const timelineRoutes: FastifyPluginAsyncZod<{ service: TimelineService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): TimelineWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/quotes/:quoteNumber/timeline',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['timeline'],
        summary:
          'The quote timeline, newest first: stage changes, gate decisions, overrides, uploads, assignments, SF flag changes and comments. filter = all | decisions | overrides | files | comments; page with `cursor`',
        security,
        params: QuoteNumberParams,
        querystring: TimelineQuery,
        response: { 200: TimelineResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.timeline(withTx(req), requireActor(req), req.params.quoteNumber, req.query),
      ),
  );

  app.post(
    '/quotes/:quoteNumber/comments',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['timeline'],
        summary:
          'Comment on a quote (markdown-lite, sanitized). `mentions` are user ids from the picker; each user still @named in the text is notified',
        security,
        params: QuoteNumberParams,
        body: CreateCommentBody,
        response: { 201: CommentResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const item = await service.comment(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        );
        return reply.status(201).send({ item });
      }),
  );

  app.get(
    '/users',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['timeline'],
        summary: 'Find active users by name, UPN or email (the @mention picker)',
        security,
        querystring: UserSearchQuery,
        response: { 200: UserSearchResponse },
      },
    },
    async (req) => service.users(withTx(req), req.query.q, req.query.limit),
  );
};
