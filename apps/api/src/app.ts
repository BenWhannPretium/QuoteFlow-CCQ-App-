import { fileURLToPath } from 'node:url';

import type { Database } from '@ccq/db';
import { ATTACHMENT_MAX_BYTES } from '@ccq/domain';
import {
  createFileStore,
  createMailTransport,
  createPricingReader,
  createSalesforceReader,
  type FileStore,
  type FileStoreConfig,
  type FileStoreLogger,
  type GraphCredentialConfig,
  type MailConfig,
  type MailTransport,
  type PricingLogger,
  type PricingReader,
  type SalesforceReader,
  type SfLogger,
} from '@ccq/integrations';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
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
import {
  createNotificationDispatchScheduler,
  type NotificationDispatchScheduler,
} from './jobs/notificationDispatch';
import { createSfSyncScheduler, type SfSyncScheduler } from './jobs/sfSync';
import { createValidityExpiryScheduler, type ValidityExpiryScheduler } from './jobs/validityExpiry';
import { loggerOptions } from './logger';
import { auditPlugin } from './plugins/audit';
import { authPlugin } from './plugins/auth';
import { problemJsonPlugin } from './plugins/problem-json';
import { spaPlugin } from './plugins/spa';
import { requestContextPlugin } from './requestContext';
import { v1Routes } from './routes/v1/index';
import { AnalyticsService } from './services/analytics';
import { AttachmentService, LocalLinkSigner } from './services/attachments';
import { AuditAdminService } from './services/auditAdmin';
import { DashboardService } from './services/dashboards';
import { EmailContentBuilder } from './services/emailContent';
import { EngineeringService } from './services/engineering';
import { FinalReviewService } from './services/final-review';
import { GateService, type NotificationHook } from './services/gateService';
import { IntakeService } from './services/intake';
import { NotificationService } from './services/notificationService';
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
  /** Test seam: the attachment store (defaults to FILESTORE_MODE: SharePoint, Blob or local). */
  fileStore?: FileStore;
  /** Test seam: replaces the Postgres-backed user directory. */
  directory?: UserDirectory;
  /** Test seam: Entra signing keys (defaults to the tenant JWKS). */
  entraKeySet?: JWTVerifyGetKey;
  /** Test seam: the clock for provisioning cache, sign-in audit windows, scoring and decisions. */
  now?: () => Date;
  /** Test seam: observes the gate decision's planned notifications (they are persisted in the decision's transaction). */
  notify?: NotificationHook;
  /** Test seam: the mail transport (defaults to MAIL_MODE: Graph, mailpit SMTP or the in-memory fake). */
  mail?: MailTransport;
}

const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

declare module 'fastify' {
  interface FastifyInstance {
    /** The Salesforce delta sync (B-06); null without a database. server.ts starts its schedule. */
    sfSync: SfSyncScheduler | null;
    /** B-13: the daily proposal validity expiry flags; null without a database. server.ts starts it. */
    validityExpiry: ValidityExpiryScheduler | null;
    /** B-18: the email dispatcher (and the 7:00 AM Central to-qualify digest); null without a database. server.ts starts it. */
    notificationDispatch: NotificationDispatchScheduler | null;
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

/** App-only Graph credentials: the managed identity, or (a developer, test site only) a client secret. */
export function graphCredentialFor(config: AppConfig): GraphCredentialConfig {
  return config.GRAPH_CLIENT_SECRET
    ? {
        kind: 'client-secret' as const,
        tenantId: config.GRAPH_TENANT_ID!,
        clientId: config.GRAPH_CLIENT_ID!,
        clientSecret: config.GRAPH_CLIENT_SECRET,
      }
    : { kind: 'managed-identity' as const, clientId: config.GRAPH_MI_CLIENT_ID };
}

/** B-18: where notification email goes. */
export function mailConfig(config: AppConfig): MailConfig {
  switch (config.MAIL_MODE) {
    case 'graph':
      return { mode: 'graph', mailbox: config.MAIL_FROM, credential: graphCredentialFor(config) };
    case 'smtp':
      return { mode: 'smtp', host: config.SMTP_HOST, port: config.SMTP_PORT };
    case 'fake':
      return { mode: 'fake' };
  }
}

export function fileStoreConfig(
  config: AppConfig,
  signer: LocalLinkSigner,
  now?: () => Date,
): FileStoreConfig {
  const credential = graphCredentialFor(config);
  switch (config.FILESTORE_MODE) {
    case 'sharepoint':
      return { mode: 'sharepoint', driveId: config.SP_DRIVE_ID!, credential };
    case 'blob':
      return {
        mode: 'blob',
        accountUrl: config.BLOB_ACCOUNT_URL!,
        container: config.BLOB_CONTAINER!,
        credential,
      };
    case 'local':
      return {
        mode: 'local',
        root: config.FILESTORE_LOCAL_DIR,
        downloadUrl: (itemId, fileName, expiresAt) => signer.sign(itemId, fileName, expiresAt),
        ...(now ? { now } : {}),
      };
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
  // B-16 uploads: one file per request, streamed. The limit is one byte over the 100 MB cap, so a
  // body that runs past its declared size is caught by the store (413) before the parser cuts it.
  await app.register(multipart, {
    limits: { fileSize: ATTACHMENT_MAX_BYTES + 1, files: 1, fields: 5, fieldSize: 2_000, parts: 6 },
  });

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
  // B-18: the notifications a decision plans are written in the decision's own transaction (in-app +
  // the email outbox; see gateService). This after-commit hook only logs what was planned.
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

  // B-18 notifications: the bell and preferences (reads), and the email dispatcher. Email rows are
  // written with the change that causes them; the dispatcher (every minute, advisory lock) sends them
  // from the shared mailbox and builds the 7:00 AM Central to-qualify digest.
  const notificationService = new NotificationService(deps.now ? { now: deps.now } : {});
  const mailLog = app.log.child({ component: 'notification-dispatch' });
  const mailTransport =
    deps.mail ??
    createMailTransport(mailConfig(config), {
      logger: {
        info: (obj, msg) => mailLog.info(obj, msg),
        warn: (obj, msg) => mailLog.warn(obj, msg),
        error: (obj, msg) => mailLog.error(obj, msg),
      },
    });
  const notificationDispatch =
    deps.db.db && deps.db.sql
      ? createNotificationDispatchScheduler(
          {
            database: deps.db.db,
            sql: deps.db.sql,
            logger: {
              info: (obj, msg) => mailLog.info(obj, msg),
              error: (obj, msg) => mailLog.error(obj, msg),
            },
            transport: mailTransport,
            from: config.MAIL_FROM,
            content: new EmailContentBuilder({
              database: deps.db.db,
              quotes: quoteReads,
              gates: gateService,
              appBaseUrl: config.APP_BASE_URL,
              now: deps.now ?? (() => new Date()),
            }),
            ...(deps.now ? { now: deps.now } : {}),
          },
          config.NOTIFICATION_DISPATCH_INTERVAL_SECONDS,
        )
      : null;
  app.decorate('notificationDispatch', notificationDispatch);

  // B-16 attachments (F-13): SharePoint via Graph (Sites.Selected), the Blob fallback, or local disk.
  // Logs carry operations, sizes and error codes only, never file names or contents.
  const fileLog = app.log.child({ component: 'attachments' });
  const fileLogger: FileStoreLogger = {
    info: (obj, msg) => fileLog.info(obj, msg),
    warn: (obj, msg) => fileLog.warn(obj, msg),
    error: (obj, msg) => fileLog.error(obj, msg),
  };
  const localSigner = new LocalLinkSigner();
  const fileStore =
    deps.fileStore ??
    createFileStore(fileStoreConfig(config, localSigner, deps.now), { logger: fileLogger });
  const attachmentService = new AttachmentService({
    store: fileStore,
    log: fileLog,
    ...(deps.now ? { now: deps.now } : {}),
  });

  // B-07 intake. A picked opportunity must be in the local snapshot (the quote's FK); a live read
  // refreshes it.
  const intakeService = new IntakeService({
    ...(deps.now ? { now: deps.now } : {}),
    scoring,
    ensureOpportunity: async (withTx, id) => (await sfService.detail(withTx, id)) !== null,
    attachments: attachmentService,
    log: app.log.child({ component: 'intake' }),
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
    notificationService,
    pricingService,
    pricingAppService,
    finalReviewService,
    outcomeService,
    pipelineService,
    attachmentService,
    analyticsService: new AnalyticsService(now),
    dashboardService: new DashboardService(now),
    fileStore,
    localSigner,
  });

  if (isProd) {
    await app.register(spaPlugin, { root: config.WEB_DIST_DIR ?? DEFAULT_WEB_DIST });
  }

  app.addHook('onClose', async () => {
    await sfSync?.stop();
    await validityExpiry?.stop();
    await notificationDispatch?.stop();
    await pricingUsage.stop();
    await app.audit.flush();
    await deps.db.close();
  });

  return app;
}
