import { fileURLToPath } from 'node:url';

import type { Database } from '@ccq/db';
import {
  createPricingReader,
  createSalesforceReader,
  type PricingLogger,
  type PricingReader,
  type SalesforceReader,
  type SfLogger,
} from '@ccq/integrations';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { JWTVerifyGetKey } from 'jose';
import type { Sql } from 'postgres';

import {
  createIdentityService,
  createPgDirectory,
  unavailableDirectory,
  type UserDirectory,
} from './auth/directory';
import { createEntraVerifier } from './auth/entra';
import type { AppConfig } from './config';
import { createSfSyncScheduler, type SfSyncScheduler } from './jobs/sfSync';
import { createValidityExpiryScheduler, type ValidityExpiryScheduler } from './jobs/validityExpiry';
import { loggerOptions } from './logger';
import { auditPlugin } from './plugins/audit';
import { authPlugin } from './plugins/auth';
import { problemJsonPlugin } from './plugins/problem-json';
import { spaPlugin } from './plugins/spa';
import { requestContextPlugin } from './requestContext';
import { v1Routes } from './routes/v1/index';
import { AuditAdminService } from './services/auditAdmin';
import { EngineeringService } from './services/engineering';
import { FinalReviewService } from './services/final-review';
import { GateService, type NotificationHook } from './services/gateService';
import { IntakeService } from './services/intake';
import { OutcomeService } from './services/outcome';
import { OverrideService } from './services/overrideService';
import { PipelineService } from './services/pipeline';
import { PricingService } from './services/pricing';
import { PricingAppService, PricingUsage } from './services/pricing-app';
import { QuoteReadService } from './services/quotes';
import { SalesforceService } from './services/salesforce';
import { ScoringService } from './services/scoring';
import { TimelineService } from './services/timeline';

export interface AppDeps {
  db: {
    ping(): Promise<boolean>;
    close(): Promise<void>;
    /** Drizzle handle for provisioning and `withTx`. Absent only in unit tests with a fake directory. */
    db?: Database;
    /** postgres.js client: background jobs take advisory locks on a reserved session. */
    sql?: Sql;
  };
  /** Test seam: the Salesforce reader (defaults to SF_MODE: the synthetic fake or jsforce). */
  salesforce?: SalesforceReader;
  /** Test seam: the pricing-app reader (defaults to PRICING_MODE: the synthetic fake, Route A or B). */
  pricing?: PricingReader;
  /** Test seam: replaces the Postgres-backed user directory. */
  directory?: UserDirectory;
  /** Test seam: Entra signing keys (defaults to the tenant JWKS). */
  entraKeySet?: JWTVerifyGetKey;
  /** Test seam: the clock for provisioning cache, sign-in audit windows, scoring and decisions. */
  now?: () => Date;
  /** Test seam: where gate decisions' planned notifications go (B-18 delivers them). */
  notify?: NotificationHook;
}

const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

declare module 'fastify' {
  interface FastifyInstance {
    /** The Salesforce delta sync (B-06); null without a database. server.ts starts its schedule. */
    sfSync: SfSyncScheduler | null;
    /** B-13: the daily proposal validity expiry flags; null without a database. server.ts starts it. */
    validityExpiry: ValidityExpiryScheduler | null;
    /** B-15: hourly pricing-app usage counts (flushed to integration_run about once a minute). */
    pricingUsage: PricingUsage;
  }
}

function salesforceReaderFor(config: AppConfig, logger: SfLogger): SalesforceReader {
  if (config.SF_MODE === 'fake') return createSalesforceReader({ mode: 'fake' }, { logger });
  return createSalesforceReader(
    {
      mode: 'live',
      loginUrl: config.SF_LOGIN_URL,
      clientId: config.SF_CLIENT_ID!,
      username: config.SF_USERNAME!,
      privateKey: config.SF_PRIVATE_KEY!,
      apiVersion: config.SF_API_VERSION,
    },
    { logger },
  );
}

function pricingReaderFor(config: AppConfig, logger: PricingLogger): PricingReader {
  switch (config.PRICING_MODE) {
    case 'fake':
      return createPricingReader({ mode: 'fake' }, { logger });
    case 'sqlserver':
      return createPricingReader(
        {
          mode: 'sqlserver',
          server: config.PRICING_SQL_SERVER!,
          port: config.PRICING_SQL_PORT,
          database: config.PRICING_SQL_DATABASE!,
          user: config.PRICING_SQL_USER!,
          password: config.PRICING_SQL_PASSWORD!,
        },
        { logger },
      );
    case 'fabric':
      return createPricingReader(
        {
          mode: 'fabric',
          server: config.PRICING_SQL_SERVER!,
          database: config.PRICING_SQL_DATABASE!,
          managedIdentityClientId: config.PRICING_SQL_MI_CLIENT_ID,
        },
        { logger },
      );
  }
}

export async function buildApp(config: AppConfig, deps: AppDeps): Promise<FastifyInstance> {
  const isProd = config.NODE_ENV === 'production';

  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: isProd, // behind Azure App Service front end
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(problemJsonPlugin, { spaFallback: isProd });
  await app.register(sensible);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        // MSAL: token requests (fetch) and silent renewal (hidden iframe) go to Entra.
        'connect-src': ["'self'", 'https://login.microsoftonline.com'],
        'frame-src': ['https://login.microsoftonline.com'],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': isProd ? [] : null,
      },
    },
  });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: '1 minute' });

  if (!isProd) {
    await app.register(swagger, {
      openapi: {
        info: { title: 'QuoteFlow API', version: config.GIT_SHA },
        servers: [{ url: config.APP_BASE_URL }],
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT (Entra ID)' },
          },
        },
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
  }

  const directory =
    deps.directory ??
    (deps.db.db ? createPgDirectory(deps.db.db, deps.now) : unavailableDirectory());
  const identity = createIdentityService(directory, deps.now ? { now: deps.now } : {});

  if (config.AUTH_MODE === 'dev') {
    app.log.warn(
      '\n' +
        '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n' +
        '!!  AUTH_MODE=dev: NO REAL AUTHENTICATION. Any caller can pick a persona with  !!\n' +
        '!!  the x-dev-user header. Local development only; refused in production.      !!\n' +
        '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    );
  }
  await app.register(authPlugin, {
    config,
    identity,
    ...(config.AUTH_MODE === 'entra'
      ? {
          verifyToken: createEntraVerifier({
            tenantId: config.ENTRA_TENANT_ID!,
            audiences: [config.ENTRA_API_AUDIENCE!, config.ENTRA_API_CLIENT_ID].filter(
              (a): a is string => !!a,
            ),
            requiredScope: config.ENTRA_API_SCOPE,
            ...(deps.entraKeySet ? { keySet: deps.entraKeySet } : {}),
          }),
        }
      : {}),
  });
  await app.register(requestContextPlugin, deps.db.db ? { database: deps.db.db } : {});
  // B-09 usage audit: async, debounced quote-view rows; services write mutation rows in their transaction.
  await app.register(auditPlugin, { database: deps.db.db, now: deps.now });

  // Salesforce (B-06): read-only. Logs carry ids and counts only, never record contents.
  const sfLog = app.log.child({ component: 'salesforce' });
  const sfLogger: SfLogger = {
    info: (obj, msg) => sfLog.info(obj, msg),
    warn: (obj, msg) => sfLog.warn(obj, msg),
    error: (obj, msg) => sfLog.error(obj, msg),
  };
  if (config.SF_MODE === 'fake' && isProd) {
    app.log.warn('SF_MODE=fake in production: Salesforce data is the synthetic fixture');
  }
  const salesforce = deps.salesforce ?? salesforceReaderFor(config, sfLogger);
  const sfService = new SalesforceService(salesforce, sfLogger, deps.now);
  const sfSync =
    deps.db.db && deps.db.sql
      ? createSfSyncScheduler(
          {
            database: deps.db.db,
            sql: deps.db.sql,
            reader: salesforce,
            logger: sfLogger,
            ...(deps.now ? { now: deps.now } : {}),
          },
          config.SF_SYNC_INTERVAL_MINUTES,
        )
      : null;
  app.decorate('sfSync', sfSync);

  // B-08 advisory scoring, quote reads and the generic gate-decision service.
  const scoring = new ScoringService();
  const quoteReads = new QuoteReadService(scoring);
  const gateLog = app.log.child({ component: 'gates' });
  // TODO(B-18): deliver in-app + email notifications. Until then planned notifications are logged.
  const notify: NotificationHook = (notifications, ctx) => {
    if (notifications.length > 0) {
      gateLog.info(
        { ...ctx, notifications: notifications.map((n) => n.type) },
        'notifications planned',
      );
    }
  };
  const gateService = new GateService({
    scoring,
    quotes: quoteReads,
    notify: deps.notify ?? notify,
    ...(deps.now ? { now: deps.now } : {}),
  });

  // B-07 intake. A picked opportunity must be in the local snapshot (the quote's FK); a live read
  // refreshes it.
  const intakeService = new IntakeService({
    ...(deps.now ? { now: deps.now } : {}),
    scoring,
    ensureOpportunity: async (withTx, id) => (await sfService.detail(withTx, id)) !== null,
  });

  // B-09 governed overrides, the quote timeline + comments, and the admin audit viewer / usage report.
  const now = deps.now ? { now: deps.now } : {};
  const overrideService = new OverrideService({
    quotes: quoteReads,
    log: app.log.child({ component: 'overrides' }),
    ...now,
  });
  const timelineService = new TimelineService({
    quotes: quoteReads,
    log: app.log.child({ component: 'timeline' }),
    ...now,
  });
  const auditService = new AuditAdminService(now);
  // B-10 engineering queue and Engineering Review.
  const engineeringService = new EngineeringService({
    quotes: quoteReads,
    scoring,
    log: app.log.child({ component: 'engineering' }),
    ...now,
  });

  // B-11 pricing queue and the Quoting tab.
  const pricingService = new PricingService({
    quotes: quoteReads,
    log: app.log.child({ component: 'pricing' }),
    ...now,
  });

  // B-15 pricing-app reader (F-11): read-only ERF/BPR lookups and the quote's pricing context.
  // Logs carry operations, counts and error codes only, never row contents.
  const pricingLog = app.log.child({ component: 'pricing-app' });
  const pricingLogger: PricingLogger = {
    info: (obj, msg) => pricingLog.info(obj, msg),
    warn: (obj, msg) => pricingLog.warn(obj, msg),
    error: (obj, msg) => pricingLog.error(obj, msg),
  };
  if (config.PRICING_MODE === 'fake' && isProd) {
    app.log.warn('PRICING_MODE=fake in production: pricing-app data is the synthetic fixture');
  }
  const pricingUsage = new PricingUsage({
    database: deps.db.db,
    now: deps.now ?? (() => new Date()),
    logger: pricingLogger,
  });
  const pricingAppService = new PricingAppService({
    reader: deps.pricing ?? pricingReaderFor(config, pricingLogger),
    usage: pricingUsage,
    logger: pricingLogger,
    ...now,
  });
  app.decorate('pricingUsage', pricingUsage);

  // B-12 Final Review: the approvals queue and the one-page review summary (decisions are G4 via the gate route).
  const finalReviewService = new FinalReviewService({ quotes: quoteReads, ...now });

  // B-13 customer decision: my open proposals, the Awarded hand-off, the outcomes report (G5 decisions
  // are the gate route), and the daily validity expiry job (flags + tells the KAM; never closes, D-12).
  const outcomeService = new OutcomeService({
    quotes: quoteReads,
    log: app.log.child({ component: 'outcome' }),
    ...now,
  });
  // B-14 pipeline views: the quote list / prioritization view, the board and the CSV export.
  const pipelineService = new PipelineService({ quotes: quoteReads, ...now });

  const expiryLog = app.log.child({ component: 'validity-expiry' });
  const validityExpiry =
    deps.db.db && deps.db.sql
      ? createValidityExpiryScheduler(
          {
            database: deps.db.db,
            sql: deps.db.sql,
            logger: {
              info: (obj, msg) => expiryLog.info(obj, msg),
              error: (obj, msg) => expiryLog.error(obj, msg),
            },
            ...(deps.now ? { now: deps.now } : {}),
          },
          config.VALIDITY_EXPIRY_INTERVAL_HOURS,
        )
      : null;
  app.decorate('validityExpiry', validityExpiry);

  await app.register(v1Routes, {
    prefix: '/api/v1',
    deps,
    version: config.GIT_SHA,
    config,
    identity,
    sfService,
    sfSync,
    intakeService,
    gateService,
    overrideService,
    timelineService,
    auditService,
    engineeringService,
    pricingService,
    pricingAppService,
    finalReviewService,
    outcomeService,
    pipelineService,
  });

  if (isProd) {
    await app.register(spaPlugin, { root: config.WEB_DIST_DIR ?? DEFAULT_WEB_DIST });
  }

  app.addHook('onClose', async () => {
    await sfSync?.stop();
    await validityExpiry?.stop();
    await pricingUsage.stop();
    await app.audit.flush();
    await deps.db.close();
  });

  return app;
}
