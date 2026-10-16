import {
  GateDecisionBody,
  GateDecisionParams,
  GateDecisionResponse,
  GateQueueParams,
  GateQueueResponse,
  QuoteDetail,
  QuoteNumberParams,
} from '@ccq/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta as meta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import { problem, sendProblem } from '../../plugins/problem-json';
import { GateError, type GateService, type GateWithTx } from '../../services/gateService';

async function handle<T>(req: FastifyRequest, reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GateError) {
      return sendProblem(
        reply,
        problem(err.status, req, { detail: err.message, code: err.code, ...err.extra }),
      );
    }
    throw err;
  }
}

const security = [{ bearerAuth: [] }];

/**
 * Quote reads and the GENERIC gate-decision route (B-08). One route serves every gate (G1–G5 and the
 * no-G1 SUBMIT gate): the route floor is `quote.read`; the domain then checks the gate's own decider
 * permission (from `gate_definition`), segregation, required fields and note/reason rules, so who
 * decides a gate is config, not code. A caller without the decider permission gets 403.
 */
export const gateRoutes: FastifyPluginAsyncZod<{ service: GateService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): GateWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/quotes/:quoteNumber',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['quotes'],
        summary:
          'One quote: intake fields, advisory priority with its explanation, warnings, decisions, and the gate actions the caller may take. Audited as a view',
        security,
        params: QuoteNumberParams,
        response: { 200: QuoteDetail },
      },
    },
    async (req, reply) =>
      handle(req, reply, async () => {
        const dto = await service.detail(withTx(req), requireActor(req), req.params.quoteNumber);
        // Audited as a view after the response, debounced per user per quote (B-09 audit plugin).
        req.auditView = { entity: 'quote', entityId: dto.id, quoteId: dto.id };
        return dto;
      }),
  );

  app.post(
    '/quotes/:quoteNumber/gates/:gateKey/decisions',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['gates'],
        summary:
          'Record a gate decision (generic for G1–G5). The domain checks stage, decider permission, segregation, required fields, note / reason code / review date; the effects are persisted in one transaction. 403 if you may not decide, 422 lists every unmet rule',
        security,
        params: GateDecisionParams,
        body: GateDecisionBody,
        response: { 201: GateDecisionResponse },
      },
    },
    async (req, reply) =>
      handle(req, reply, async () => {
        const result = await service.decide(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.params.gateKey,
          req.body,
          meta(req),
        );
        return reply.status(201).send(result);
      }),
  );

  app.get(
    '/gates/:gateKey/queue',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['gates'],
        summary:
          'Quotes waiting for a gate (in scope), highest priority first, with warnings. Empty when the gate is disabled (e.g. g1_enabled=false)',
        security,
        params: GateQueueParams,
        response: { 200: GateQueueResponse },
      },
    },
    async (req, reply) =>
      handle(req, reply, () => service.queue(withTx(req), requireActor(req), req.params.gateKey)),
  );
};
