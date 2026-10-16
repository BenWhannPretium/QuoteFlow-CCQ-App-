import {
  CreateOverrideBody,
  OverrideDecisionBody,
  OverrideIdParams,
  OverrideInboxQuery,
  OverrideListResponse,
  OverrideLogQuery,
  OverrideLogResponse,
  OverrideResponse,
  QuoteNumberParams,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { OverrideService, OverrideWithTx } from '../../services/overrideService';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/**
 * Governed overrides (F-06, B-09). Route floors are matrix permissions; the domain then applies the
 * per-field config (`overridable_fields`: who requests, approves, reverts) and the quote's scope.
 * Revert's floor is quote.read because the requester of a self-applied override (a KAM) may revert it.
 */
export const overrideRoutes: FastifyPluginAsyncZod<{ service: OverrideService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): OverrideWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.post(
    '/quotes/:quoteNumber/overrides',
    {
      config: { permission: 'override.request' },
      schema: {
        tags: ['overrides'],
        summary:
          'Request an override of a configured field (priority_tier, ship_to, queue_position). Justification ≥ the configured minimum. A self-applied field (ship-to) is applied at once and logged; others wait for an approver. 409 if one is already pending',
        security,
        params: QuoteNumberParams,
        body: CreateOverrideBody,
        response: { 201: OverrideResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const override = await service.request(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        );
        return reply.status(201).send({ override });
      }),
  );

  app.get(
    '/quotes/:quoteNumber/overrides',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['overrides'],
        summary: 'Every override on one quote, newest first, with what the caller may do',
        security,
        params: QuoteNumberParams,
        response: { 200: OverrideListResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.listForQuote(withTx(req), requireActor(req), req.params.quoteNumber),
      ),
  );

  app.get(
    '/overrides',
    {
      config: { permission: 'override.approve' },
      schema: {
        tags: ['overrides'],
        summary:
          'Approver inbox: open requests the caller may decide (status=requested, default); other statuses list the ones the caller requested or decided',
        security,
        querystring: OverrideInboxQuery,
        response: { 200: OverrideListResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.inbox(withTx(req), requireActor(req), req.query.status),
      ),
  );

  for (const decision of ['approve', 'reject'] as const) {
    app.post(
      `/overrides/:id/${decision}`,
      {
        config: { permission: 'override.approve' },
        schema: {
          tags: ['overrides'],
          summary:
            decision === 'approve'
              ? 'Approve a requested override: applies it at once. 409 if the field changed since the request (or it was already decided); 403 for your own request or a field you do not approve'
              : 'Reject a requested override (note required)',
          security,
          params: OverrideIdParams,
          body: OverrideDecisionBody,
          response: { 200: OverrideResponse },
        },
      },
      async (req, reply) =>
        handleProblems(req, reply, async () => ({
          override: await service.decide(
            withTx(req),
            requireActor(req),
            req.params.id,
            decision,
            req.body.note,
            auditMeta(req),
          ),
        })),
    );
  }

  app.post(
    '/overrides/:id/revert',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['overrides'],
        summary:
          'One-click revert of an applied override: restores the original value exactly. Allowed for the configured revert roles, or the requester of a self-applied override. 409 if a later change replaced the value',
        security,
        params: OverrideIdParams,
        response: { 200: OverrideResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => ({
        override: await service.revert(
          withTx(req),
          requireActor(req),
          req.params.id,
          auditMeta(req),
        ),
      })),
  );

  app.get(
    '/admin/override-log',
    {
      config: { permission: 'overrideLog.read' },
      schema: {
        tags: ['overrides', 'admin'],
        summary: 'The override log (Leadership and Admin only), newest first, keyset-paged',
        security,
        querystring: OverrideLogQuery,
        response: { 200: OverrideLogResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.log(withTx(req), requireActor(req), req.query)),
  );
};
