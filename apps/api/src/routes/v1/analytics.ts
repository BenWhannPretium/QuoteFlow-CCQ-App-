import {
  AdoptionResponse,
  AnalyticsFiltersResponse,
  AnalyticsQuery,
  CycleTimeResponse,
  DashboardParams,
  DashboardResponse,
  EngineeringAnalyticsResponse,
  FirstPassResponse,
  FlowResponse,
  G1YieldResponse,
  GateComplianceResponse,
  OutcomesResponse,
  OverridesResponse,
  PipelineResponse,
  PriorityResponse,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ZodType } from 'zod';

import { requireActor } from '../../plugins/auth';
import type { AnalyticsService, AnalyticsWithTx } from '../../services/analytics';
import { engineeringAnalytics } from '../../services/analytics-engineering';
import type { DashboardService } from '../../services/dashboards';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/**
 * B-17 operational analytics (F-17 subset) and role dashboards (F-02).
 *
 * - `/analytics/*`: one endpoint per chart, each over the `analytics_*` views. `analytics.read`
 *   (SalesLeader, EngLead, Pricing, Approver, Leadership, Admin); the adoption chart reads the audit
 *   log, so it needs `audit.read` (Leadership, Admin) like the usage report. B-26 (A5): the
 *   Engineering lens (`/analytics/engineering`) is `engQueue.read` (EngLead, Engineer, Leadership,
 *   Admin), the same people who read the engineering queue it summarizes.
 * - `/dashboards/:role`: summary blocks for one role's landing page. The route floor is `quote.read`;
 *   the service then checks the permission that opens that role's dashboard (`DASHBOARD_PERMISSION`),
 *   and row-level security scopes every list to what the caller may see.
 *
 * Every figure is computed here from the database, never in the browser.
 */
export const analyticsRoutes: FastifyPluginAsyncZod<{
  analytics: AnalyticsService;
  dashboards: DashboardService;
}> = async (app, { analytics, dashboards }) => {
  const withTx =
    (req: FastifyRequest): AnalyticsWithTx =>
    (fn) =>
      app.withTx(req, fn);

  const chart = (
    path: string,
    summary: string,
    response: ZodType<unknown>,
    run: (w: AnalyticsWithTx, q: ReturnType<typeof AnalyticsQuery.parse>) => Promise<unknown>,
    permission: 'analytics.read' | 'audit.read' | 'engQueue.read' = 'analytics.read',
  ) =>
    app.get(
      `/analytics/${path}`,
      {
        config: { permission },
        schema: {
          tags: ['analytics'],
          summary,
          security,
          querystring: AnalyticsQuery,
          response: { 200: response },
        },
      },
      async (req, reply) =>
        handleProblems(req, reply, async () => (await run(withTx(req), req.query)) as never),
    );

  app.get(
    '/analytics/filters',
    {
      config: { permission: 'analytics.read' },
      schema: {
        tags: ['analytics'],
        summary:
          'The values the analytics filter bar offers (markets, product families, regions, KAMs) and the default window',
        security,
        response: { 200: AnalyticsFiltersResponse },
      },
    },
    async (req) => analytics.filters(withTx(req)),
  );

  chart(
    'pipeline',
    'Open quotes and SF opportunity amount (as entered) by stage, right now',
    PipelineResponse,
    (w, q) => analytics.pipeline(w, q),
  );
  chart(
    'cycle-time',
    'Median and p75 days per stage (holds excluded), and end-to-end intake → G4 by week',
    CycleTimeResponse,
    (w, q) => analytics.cycleTime(w, q),
  );
  chart(
    'flow',
    'Quotes created vs closed per week, and work in progress by stage over time',
    FlowResponse,
    (w, q) => analytics.flow(w, q),
  );
  chart(
    'outcomes',
    'Outcome capture rate and win rate (decided quotes only, always together) by market, product family and KAM, and loss reasons',
    OutcomesResponse,
    (w, q) => analytics.outcomes(w, q),
  );
  chart(
    'first-pass',
    'First-pass intake completeness (S-03) and why work is returned to the KAM',
    FirstPassResponse,
    (w, q) => analytics.firstPass(w, q),
  );
  chart('g1-yield', 'G1 qualification yield by outcome (S-04)', G1YieldResponse, (w, q) =>
    analytics.g1Yield(w, q),
  );
  chart('overrides', 'Override frequency by field and approver', OverridesResponse, (w, q) =>
    analytics.overrides(w, q),
  );
  chart(
    'gate-compliance',
    'Share of issued proposals with G1–G4 decisions recorded (S-08)',
    GateComplianceResponse,
    (w, q) => analytics.gateCompliance(w, q),
  );
  chart(
    'priority',
    'Quotes by priority tier, and tier vs actual time to assign',
    PriorityResponse,
    (w, q) => analytics.priority(w, q),
  );
  chart(
    'adoption',
    'Weekly active users by role and intakes created in QuoteFlow (S-10), from the audit log',
    AdoptionResponse,
    (w, q) => analytics.adoption(w, q),
    'audit.read',
  );

  chart(
    'engineering',
    'The Engineering lens (B-26): queue load per engineer, aging, capacity sign-offs, G2 outcomes and time in Engineering Review',
    EngineeringAnalyticsResponse,
    (w, q) => engineeringAnalytics(w, analytics.resolve(q)),
    'engQueue.read',
  );

  app.get(
    '/dashboards/:role',
    {
      config: { permission: 'quote.read' },
      schema: {
        tags: ['dashboards'],
        summary:
          "The summary blocks for one role's landing page. 403 unless the caller holds the permission that opens that dashboard; lists are scoped to what the caller may see",
        security,
        params: DashboardParams,
        response: { 200: DashboardResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        dashboards.get(withTx(req), requireActor(req), req.params.role),
      ),
  );
};
