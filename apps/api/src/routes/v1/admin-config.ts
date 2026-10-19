import {
  ActivateScoringDraftBody,
  ActivateScoringResponse,
  AdminReasonCodesResponse,
  AdminScoringResponse,
  AdminSettingsResponse,
  AdminUsersResponse,
  AdminValueListsResponse,
  AdminWorkflowResponse,
  ConnectorHealthResponse,
  CreateReasonCodeBody,
  CreateScoringDraftBody,
  CreateValueListEntryBody,
  DecisionLogQuery,
  DecisionLogResponse,
  DiscardScoringDraftBody,
  ReorderBody,
  ScoringPreviewBody,
  ScoringPreviewResponse,
  UpdateGateBody,
  UpdateOutcomeBody,
  UpdateReasonCodeBody,
  UpdateScoringDraftBody,
  UpdateSettingBody,
  UpdateStageBody,
  UpdateUserScopeBody,
  UpdateValueListEntryBody,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { AdminConfigService, AdminWithTx } from '../../services/adminConfig';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];
const tags = ['admin', 'config'];
const read = { permission: 'config.read' } as const;
const manage = { permission: 'config.manage' } as const;

const Saved = z.object({ id: z.uuid(), version: z.number().int() });
const Created = z.object({ id: z.uuid() });
const Ok = z.object({ ok: z.literal(true) });
const IdParams = z.object({ id: z.uuid() });

/**
 * B-19 admin configuration console (CR-51; the F-21 decision log). Reads: config.read (Leadership
 * + Admin). Writes: config.manage (Admin), each with `version` (stale → 409) and `changeReason`,
 * audited as `config_change`. Adding or removing stages / transitions is deliberately not here: that is
 * a migration plus a domain seed change.
 */
export const adminConfigRoutes: FastifyPluginAsyncZod<{ service: AdminConfigService }> = async (
  app,
  { service },
) => {
  const tx =
    (req: FastifyRequest): AdminWithTx =>
    (fn) =>
      app.withTx(req, fn);

  // ── Value lists ──
  app.get(
    '/admin/config/value-lists',
    {
      config: read,
      schema: {
        tags,
        summary: 'Every value-list entry, active or not',
        security,
        response: { 200: AdminValueListsResponse },
      },
    },
    async (req) => service.valueLists(tx(req)),
  );
  app.post(
    '/admin/config/value-lists',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Add a value-list entry (provisional until approved)',
        security,
        body: CreateValueListEntryBody,
        response: { 201: Created },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const out = await service.createValueListEntry(
          tx(req),
          requireActor(req),
          auditMeta(req),
          req.body,
        );
        return reply.status(201).send(out);
      }),
  );
  app.patch(
    '/admin/config/value-lists/:id',
    {
      config: manage,
      schema: {
        tags,
        summary:
          'Rename, (de)activate or approve an entry. Deactivating a value open quotes use needs confirmInUse',
        security,
        params: IdParams,
        body: UpdateValueListEntryBody,
        response: { 200: Saved },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateValueListEntry(
          tx(req),
          requireActor(req),
          auditMeta(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.put(
    '/admin/config/value-lists/:listKey/order',
    {
      config: manage,
      schema: {
        tags,
        summary: "Set a list's display order",
        security,
        params: z.object({ listKey: z.string().max(64) }),
        body: ReorderBody,
        response: { 200: Ok },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.reorderValueList(
          tx(req),
          requireActor(req),
          auditMeta(req),
          req.params.listKey,
          req.body,
        ),
      ),
  );

  // ── Reason codes ──
  app.get(
    '/admin/config/reason-codes',
    {
      config: read,
      schema: {
        tags,
        summary: 'Every reason code, active or not, by context',
        security,
        response: { 200: AdminReasonCodesResponse },
      },
    },
    async (req) => service.reasonCodes(tx(req)),
  );
  app.post(
    '/admin/config/reason-codes',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Add a reason code to a context',
        security,
        body: CreateReasonCodeBody,
        response: { 201: Created },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const out = await service.createReasonCode(
          tx(req),
          requireActor(req),
          auditMeta(req),
          req.body,
        );
        return reply.status(201).send(out);
      }),
  );
  app.patch(
    '/admin/config/reason-codes/:id',
    {
      config: manage,
      schema: {
        tags,
        summary:
          'Rename, (de)activate, toggle requiresNote or approve a code. 422 if the workflow would break',
        security,
        params: IdParams,
        body: UpdateReasonCodeBody,
        response: { 200: Saved },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateReasonCode(
          tx(req),
          requireActor(req),
          auditMeta(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.put(
    '/admin/config/reason-codes/:context/order',
    {
      config: manage,
      schema: {
        tags,
        summary: "Set a context's display order",
        security,
        params: z.object({ context: z.string().max(64) }),
        body: ReorderBody,
        response: { 200: Ok },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.reorderReasonCodes(
          tx(req),
          requireActor(req),
          auditMeta(req),
          req.params.context,
          req.body,
        ),
      ),
  );

  // ── Workflow labels and rules ──
  app.get(
    '/admin/config/workflow',
    {
      config: read,
      schema: {
        tags,
        summary: 'Stages, gates and outcomes with labels, help text and required-field rules',
        security,
        response: { 200: AdminWorkflowResponse },
      },
    },
    async (req) => service.workflow(tx(req)),
  );
  app.patch(
    '/admin/config/stages/:key',
    {
      config: manage,
      schema: {
        tags,
        summary: "Edit a stage's label or help text (stages are added only by migration)",
        security,
        params: z.object({ key: z.string().max(64) }),
        body: UpdateStageBody,
        response: { 200: Saved },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateStage(tx(req), requireActor(req), auditMeta(req), req.params.key, req.body),
      ),
  );
  app.patch(
    '/admin/config/gates/:key',
    {
      config: manage,
      schema: {
        tags,
        summary: "Edit a gate's label, help text or required-field rules (domain DSL, validated)",
        security,
        params: z.object({ key: z.string().max(64) }),
        body: UpdateGateBody,
        response: { 200: Saved },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateGate(tx(req), requireActor(req), auditMeta(req), req.params.key, req.body),
      ),
  );
  app.patch(
    '/admin/config/gates/:gateKey/outcomes/:key',
    {
      config: manage,
      schema: {
        tags,
        summary:
          "Edit an outcome's label, help text, requiresNote / requiresReasonCode or required-field rules",
        security,
        params: z.object({ gateKey: z.string().max(64), key: z.string().max(64) }),
        body: UpdateOutcomeBody,
        response: { 200: Saved },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateOutcome(
          tx(req),
          requireActor(req),
          auditMeta(req),
          req.params.gateKey,
          req.params.key,
          req.body,
        ),
      ),
  );

  // ── App settings ──
  app.get(
    '/admin/config/settings',
    {
      config: read,
      schema: {
        tags,
        summary: 'Every app setting with its editor and approval state',
        security,
        response: { 200: AdminSettingsResponse },
      },
    },
    async (req) => service.settings(tx(req)),
  );
  app.patch(
    '/admin/config/settings/:key',
    {
      config: manage,
      schema: {
        tags,
        summary:
          'Change a setting (validated by the domain parser) or its approval. g1_enabled also flips the G1 / SUBMIT gates',
        security,
        params: z.object({ key: z.string().max(100) }),
        body: UpdateSettingBody,
        response: { 200: Saved },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateSetting(tx(req), requireActor(req), auditMeta(req), req.params.key, req.body),
      ),
  );

  // ── Scoring model ──
  app.get(
    '/admin/config/scoring',
    {
      config: read,
      schema: {
        tags,
        summary: 'Every scoring model version (active, superseded, draft), newest first',
        security,
        response: { 200: AdminScoringResponse },
      },
    },
    async (req) => service.scoring(tx(req)),
  );
  app.post(
    '/admin/config/scoring/preview',
    {
      config: read,
      schema: {
        tags,
        summary:
          'Score the last 50 quotes under the active model and the given one: tier and rank changes. Writes nothing',
        security,
        body: ScoringPreviewBody,
        response: { 200: ScoringPreviewResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.previewScoring(tx(req), req.body.model)),
  );
  app.post(
    '/admin/config/scoring/draft',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Create new version: clone the active model into a draft',
        security,
        body: CreateScoringDraftBody,
        response: { 201: z.object({ id: z.uuid(), modelVersion: z.number().int() }) },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, async () => {
        const out = await service.createScoringDraft(
          tx(req),
          requireActor(req),
          auditMeta(req),
          req.body,
        );
        return reply.status(201).send(out);
      }),
  );
  app.put(
    '/admin/config/scoring/draft',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Save the draft (weights must sum to 1). Active and old versions are read-only',
        security,
        body: UpdateScoringDraftBody,
        response: { 200: Saved },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateScoringDraft(tx(req), requireActor(req), auditMeta(req), req.body),
      ),
  );
  app.post(
    '/admin/config/scoring/draft/activate',
    {
      config: manage,
      schema: {
        tags,
        summary:
          'Activate the draft (effective now) and rescore open quotes in the background. Historical scores are untouched',
        security,
        body: ActivateScoringDraftBody,
        response: { 200: ActivateScoringResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.activateScoringDraft(tx(req), requireActor(req), auditMeta(req), req.body),
      ),
  );
  app.post(
    '/admin/config/scoring/draft/discard',
    {
      config: manage,
      schema: {
        tags,
        summary: 'Discard the draft',
        security,
        body: DiscardScoringDraftBody,
        response: { 200: Ok },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.discardScoringDraft(tx(req), requireActor(req), auditMeta(req), req.body),
      ),
  );

  // ── Users and scope ──
  app.get(
    '/admin/users',
    {
      config: read,
      schema: {
        tags: ['admin'],
        summary: 'Users with their Entra roles (read-only) and data scope',
        security,
        response: { 200: AdminUsersResponse },
      },
    },
    async (req) => service.users(tx(req)),
  );
  app.put(
    '/admin/users/:id/scope',
    {
      config: manage,
      schema: {
        tags: ['admin'],
        summary: "Set a user's data scope (roles come from Entra groups and are not editable here)",
        security,
        params: IdParams,
        body: UpdateUserScopeBody,
        response: { 200: Ok },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updateUserScope(
          tx(req),
          requireActor(req),
          auditMeta(req),
          req.params.id,
          req.body,
        ),
      ),
  );

  // ── Connector health ──
  app.get(
    '/admin/integrations/health',
    {
      config: read,
      schema: {
        tags: ['admin'],
        summary: 'Per connector: mode, last run, last success and failures in 24 h',
        security,
        response: { 200: ConnectorHealthResponse },
      },
    },
    async (req) => service.connectorHealth(tx(req)),
  );

  // ── Decision log ──
  app.get(
    '/admin/config/decision-log',
    {
      config: read,
      schema: {
        tags,
        summary: 'Every config change, newest first: who, what (diff), why and when',
        security,
        querystring: DecisionLogQuery,
        response: { 200: DecisionLogResponse },
      },
    },
    async (req, reply) => handleProblems(req, reply, () => service.decisionLog(tx(req), req.query)),
  );
  app.get(
    '/admin/config/decision-log/export.csv',
    {
      config: read,
      schema: {
        tags,
        summary: 'The decision log as CSV (capped at 10,000 rows). The export is audited',
        security,
        querystring: DecisionLogQuery,
        produces: ['text/csv'],
      },
    },
    async (req, reply) => {
      const { csv, truncated, fileName } = await service.decisionLogCsv(
        tx(req),
        requireActor(req),
        auditMeta(req),
        req.query,
      );
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .header('x-ccq-truncated', String(truncated))
        .send(csv);
    },
  );
};
