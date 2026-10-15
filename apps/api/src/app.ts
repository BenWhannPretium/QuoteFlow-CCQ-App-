import { fileURLToPath } from 'node:url';

import type { Database } from '@ccq/db';
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

import {
  createIdentityService,
  createPgDirectory,
  unavailableDirectory,
  type UserDirectory,
} from './auth/directory';
import { createEntraVerifier } from './auth/entra';
import type { AppConfig } from './config';
import { loggerOptions } from './logger';
import { authPlugin } from './plugins/auth';
import { problemJsonPlugin } from './plugins/problem-json';
import { spaPlugin } from './plugins/spa';
import { requestContextPlugin } from './requestContext';
import { v1Routes } from './routes/v1/index';

export interface AppDeps {
  db: {
    ping(): Promise<boolean>;
    close(): Promise<void>;
    /** Drizzle handle for provisioning and `withTx`. Absent only in unit tests with a fake directory. */
    db?: Database;
  };
  /** Test seam: replaces the Postgres-backed user directory. */
  directory?: UserDirectory;
  /** Test seam: Entra signing keys (defaults to the tenant JWKS). */
  entraKeySet?: JWTVerifyGetKey;
  /** Test seam: the clock for provisioning cache and sign-in audit windows. */
  now?: () => Date;
}

const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

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

  // TODO(B-09): audit plugin.
  await app.register(v1Routes, {
    prefix: '/api/v1',
    deps,
    version: config.GIT_SHA,
    config,
    identity,
  });

  if (isProd) {
    await app.register(spaPlugin, { root: config.WEB_DIST_DIR ?? DEFAULT_WEB_DIST });
  }

  app.addHook('onClose', async () => {
    await deps.db.close();
  });

  return app;
}
