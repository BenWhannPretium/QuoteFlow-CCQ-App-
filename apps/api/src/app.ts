import { fileURLToPath } from 'node:url';

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

import type { AppConfig } from './config';
import { loggerOptions } from './logger';
import { problemJsonPlugin } from './plugins/problem-json';
import { spaPlugin } from './plugins/spa';
import { v1Routes } from './routes/v1/index';

export interface AppDeps {
  db: {
    ping(): Promise<boolean>;
    close(): Promise<void>;
  };
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
        // TODO(B-04): add https://login.microsoftonline.com for MSAL token requests.
        'connect-src': ["'self'"],
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
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
  }

  // TODO(B-04): auth plugin (jose / Entra JWT or AUTH_MODE=dev fake users) + request context.
  // TODO(B-09): audit plugin.
  await app.register(v1Routes, { prefix: '/api/v1', deps, version: config.GIT_SHA });

  if (isProd) {
    await app.register(spaPlugin, { root: config.WEB_DIST_DIR ?? DEFAULT_WEB_DIST });
  }

  app.addHook('onClose', async () => {
    await deps.db.close();
  });

  return app;
}
