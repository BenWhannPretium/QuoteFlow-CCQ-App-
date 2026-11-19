import {
  BulkReassignBody,
  BulkReassignResponse,
  CapitalReadinessBody,
  PaybackRequestBody,
  PaybackWithdrawBody,
  PricerAssignmentBody,
  PricerAssignmentResponse,
  PricingQueueQuery,
  PricingQueueResponse,
  PricingRecordBody,
  QuoteNumberParams,
  QuotingDetail,
  SendBackBody,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { PricingService, PricingWithTx } from '../../services/pricing';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/**
 * B-11 pricing queue and Quoting tab (CR-25/26, DEC-19/20/23). G3 goes through the generic gate route
 * (gates.ts). Floors: the queue needs `pricingQueue.read` (Pricing, Leadership, Admin); the two PUTs
 * need `quoting.edit` (Pricing) and the domain limits them to quotes in Quoting. There is no route
 * that takes a price figure.
 */
export const pricingRoutes: FastifyPluginAsyncZod<{ service: PricingService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): PricingWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/queue/pricing',
    {
      config: { permission: 'pricingQueue.read' },
      schema: {
        tags: ['pricing'],
        summary:
          'The pricing queue: open quotes in Quoting (in scope), ordered tier → score → longest in Quoting, with the G2 outcome flag, capital readiness and approval status',
        security,
        querystring: PricingQueueQuery,
        response: { 200: PricingQueueResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.queue(withTx(req), requireActor(req), req.query)),
  );

  app.post(
    '/quotes/:quoteNumber/pricing-assignment',
    {
      config: { permission: 'pricingQueue.assign' },
      schema: {
        tags: ['pricing'],
        summary:
          'B-26: assign or reassign the pricer on a quote in Quoting (the pricing lead, Admin). Recorded on the timeline, audited, and the pricer is notified. The same pricer again changes nothing',
        security,
        params: QuoteNumberParams,
        body: PricerAssignmentBody,
        response: { 200: PricerAssignmentResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.assignPricer(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body.pricerId,
          auditMeta(req),
        ),
      ),
  );

  app.post(
    '/queue/pricing/reassign',
    {
      config: { permission: 'pricingQueue.assign' },
      schema: {
        tags: ['pricing'],
        summary:
          "B-26: move a pricer's open Quoting work (all, or the listed quotes) to another pricer in one go, e.g. when someone leaves. Each move is recorded and announced like a single assignment",
        security,
        body: BulkReassignBody,
        response: { 200: BulkReassignResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.bulkReassign(withTx(req), requireActor(req), req.body, auditMeta(req)),
      ),
  );

  app.put(
    '/quotes/:quoteNumber/pricing-record',
    {
      config: { permission: 'quoting.edit' },
      schema: {
        tags: ['pricing'],
        summary:
          'Record the price approval for the current version (only the keys sent change): approver (a Pricing user), time, basis and range notes, legacy ERF numbers (transition only, format-checked), costing attestation. No price figures',
        security,
        params: QuoteNumberParams,
        body: PricingRecordBody,
        response: { 200: QuotingDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateRecord(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  app.put(
    '/quotes/:quoteNumber/capital-readiness',
    {
      config: { permission: 'quoting.edit' },
      schema: {
        tags: ['pricing'],
        summary:
          'Set capital readiness (not_required | pending | pre_approved | not_approved), CER reference and notes. Cannot be not_required while Engineering says capital is needed (the preliminary capital, or an old G2 "Capital required")',
        security,
        params: QuoteNumberParams,
        body: CapitalReadinessBody,
        response: { 200: QuotingDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateCapital(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  // FB-21 (N17-21; Ben, 2026-11-18): a payback model only when the pricer or the pricing lead asks.
  app.post(
    '/quotes/:quoteNumber/quoting/payback-request',
    {
      config: { permission: 'payback.request' },
      schema: {
        tags: ['pricing'],
        summary:
          'Ask Finance for a payback model (optional note). The pricing lead on any quote; a pricer on a quote assigned to them. Needs the costing model on file; one open request at a time. Finance is told; G3 then needs a payback model uploaded after the request',
        security,
        params: QuoteNumberParams,
        body: PaybackRequestBody,
        response: { 200: QuotingDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.requestPayback(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  app.post(
    '/quotes/:quoteNumber/quoting/payback-request/withdraw',
    {
      config: { permission: 'payback.request' },
      schema: {
        tags: ['pricing'],
        summary:
          'Withdraw the open payback request with a short reason. Finance is told, and G3 no longer needs the payback model',
        security,
        params: QuoteNumberParams,
        body: PaybackWithdrawBody,
        response: { 200: QuotingDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.withdrawPayback(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body,
          auditMeta(req),
        ),
      ),
  );

  // Lead review (2026-10-30): the assigned pricer submits to the pricing lead, who may send it back.
  app.post(
    '/quotes/:quoteNumber/quoting/submit',
    {
      config: { permission: 'quoting.edit' },
      schema: {
        tags: ['pricing'],
        summary:
          "Lead review: the assigned pricer submits their part to the pricing lead, who is told. Checked against G3 Advance (less the lead's own steps); locked for the pricer until sent back",
        security,
        params: QuoteNumberParams,
        response: { 200: QuotingDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.submitToLead(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          auditMeta(req),
        ),
      ),
  );

  app.post(
    '/quotes/:quoteNumber/quoting/send-back',
    {
      config: { permission: 'gate.G3.submit' },
      schema: {
        tags: ['pricing'],
        summary:
          'Lead review: the pricing lead sends a submitted part back to the pricer with a note (required); the pricer is told and can edit again',
        security,
        params: QuoteNumberParams,
        body: SendBackBody,
        response: { 200: QuotingDetail },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.sendBack(
          withTx(req),
          requireActor(req),
          req.params.quoteNumber,
          req.body.note,
          auditMeta(req),
        ),
      ),
  );
};
