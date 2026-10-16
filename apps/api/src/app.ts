import { fileURLToPath } from 'node:url';

import type { Database } from '@ccq/db';
import { createSalesforceReader, type SalesforceReader, type SfLogger } from '@ccq/integrations';
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
import { loggerOptions } from './logger';
import { auditPlugin } from './plugins/audit';
import { authPlugin } from './plugins/auth';
import { problemJsonPlugin } from './plugins/problem-json';
import { spaPlugin } from './plugins/spa';
import { requestContextPlugin } from './requestContext';
import { v1Routes } from './routes/v1/index';
import { AuditAdminService } from './services/auditAdmin';
import { EngineeringService } from './services/engineering';
import { GateService, type NotificationHook } from './services/gateService';
import { IntakeService } from './services/intake';
import { OverrideService } from './services/overrideService';
import { PricingService } from './services/pricing';
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
  });

  if (isProd) {
    await app.register(spaPlugin, { root: config.WEB_DIST_DIR ?? DEFAULT_WEB_DIST });
  }

  app.addHook('onClose', async () => {
    await sfSync?.stop();
    await app.audit.flush();
    await deps.db.close();
  });

  return app;
}
