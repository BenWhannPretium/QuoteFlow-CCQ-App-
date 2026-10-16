import {
  CreateIntakeDraftBody,
  IntakeDraft,
  IntakeDraftListQuery,
  IntakeDraftListResponse,
  IntakeDraftParams,
  PatchIntakeDraftBody,
  QuoteNumberParams,
  SubmitIntakeResponse,
} from '@ccq/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { requireActor } from '../../plugins/auth';
import { problem, sendProblem } from '../../plugins/problem-json';
import {
  IntakeError,
  type AuditMeta,
  type IntakeService,
  type IntakeWithTx,
} from '../../services/intake';

const meta = (req: FastifyRequest): AuditMeta => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  requestId: req.id,
});

/** Run `fn`, turning an IntakeError into problem+json. */
async function handle<T>(req: FastifyRequest, reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof IntakeError) {
      return sendProblem(
        reply,
        problem(err.status, req, { detail: err.message, code: err.code, ...err.extra }),
      );
    }
    throw err;
  }
}

const tags = ['intake'];
const security = [{ bearerAuth: [] }];

/**
 * KAM intake drafts (B-07). All routes need `quote.create`. A draft is visible only to its creator
 * (plus Admin, read-only); RLS on quote_draft enforces the same.
 */
export const intakeRoutes: FastifyPluginAsyncZod<{ service: IntakeService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): IntakeWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.post(
    '/quotes/drafts',
    {
      config: { permission: 'quote.create' },
      schema: {
        tags,
        summary: 'Start an intake draft (usually with the picked SF opportunity pre-filled)',
        security,
        body: CreateIntakeDraftBody,
        response: { 201: IntakeDraft },
      },
    },
    async (req, reply) => {
      const draft = await service.create(withTx(req), requireActor(req), req.body, meta(req));
      return reply.status(201).send(draft);
    },
  );

  app.get(
    '/quotes/drafts',
    {
      config: { permission: 'quote.create' },
      schema: {
        tags,
        summary: 'Open intake drafts: your own (Admin may pass mine=false to see everyone’s)',
        security,
        querystring: IntakeDraftListQuery,
        response: { 200: IntakeDraftListResponse },
      },
    },
    async (req) => service.list(withTx(req), requireActor(req), req.query.mine),
  );

  app.get(
    '/quotes/drafts/:id',
    {
      config: { permission: 'quote.create' },
      schema: {
        tags,
        summary: 'One draft with its blocking / warning evaluation (to resume the wizard)',
        security,
        params: IntakeDraftParams,
        response: { 200: IntakeDraft },
      },
    },
    async (req, reply) => handle(req, reply, () => service.get(withTx(req), req.params.id)),
  );

  app.patch(
    '/quotes/drafts/:id',
    {
      config: { permission: 'quote.create' },
      schema: {
        tags,
        summary:
          'Autosave: replace the given top-level fields and/or the step; returns the evaluation',
        security,
        params: IntakeDraftParams,
        body: PatchIntakeDraftBody,
        response: { 200: IntakeDraft },
      },
    },
    async (req, reply) =>
      handle(req, reply, () =>
        service.patch(withTx(req), requireActor(req), req.params.id, req.body),
      ),
  );

  app.delete(
    '/quotes/drafts/:id',
    {
      config: { permission: 'quote.create' },
      schema: {
        tags,
        summary: 'Discard one of your own open drafts',
        security,
        params: IntakeDraftParams,
        response: { 204: z.null().describe('Deleted') },
      },
    },
    async (req, reply) =>
      handle(req, reply, async () => {
        await service.remove(withTx(req), requireActor(req), req.params.id, meta(req));
        return reply.status(204).send(null);
      }),
  );

  app.post(
    '/quotes/drafts/:id/submit',
    {
      config: { permission: 'quote.create' },
      schema: {
        tags,
        summary:
          'Submit: creates CCQ-YYYY-NNNNN in Intake, then routes to G1 (if enabled) or the engineering queue. 409 if the opportunity already has an active quote',
        security,
        params: IntakeDraftParams,
        response: { 201: SubmitIntakeResponse },
      },
    },
    async (req, reply) =>
      handle(req, reply, async () => {
        const result = await service.submit(
          withTx(req),
          requireActor(req),
          req.params.id,
          meta(req),
        );
        return reply.status(201).send(result);
      }),
  );

  app.post(
    '/quotes/:quoteNumber/rework',
    {
      config: { permission: 'quote.create' },
      schema: {
        tags,
        summary:
          'Fix a quote returned for rework (G1/G2 Rework): opens or reopens its rework draft. Its KAM only; 409 if it is not waiting for rework',
        security,
        params: QuoteNumberParams,
        response: { 200: IntakeDraft },
      },
    },
    async (req, reply) =>
      handle(req, reply, () =>
        service.startRework(withTx(req), requireActor(req), req.params.quoteNumber, meta(req)),
      ),
  );
};
