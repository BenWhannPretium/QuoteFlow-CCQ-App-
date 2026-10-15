import { AuthConfigResponse } from '@ccq/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { devPersonas } from '../../auth/dev';
import type { AppConfig } from '../../config';

/** Runtime sign-in settings for the SPA (one web build for every environment). Nothing secret. */
export const authConfigRoutes: FastifyPluginAsyncZod<{ config: AppConfig }> = async (
  app,
  { config },
) => {
  app.get(
    '/auth/config',
    {
      config: { public: true },
      schema: {
        tags: ['auth'],
        summary: 'How the SPA should sign in (Entra settings, or dev personas)',
        response: { 200: AuthConfigResponse },
      },
    },
    async () => {
      if (config.AUTH_MODE === 'dev') {
        return { authMode: 'dev' as const, personas: devPersonas() };
      }
      // config.ts guarantees these are set when AUTH_MODE=entra.
      const audience = config.ENTRA_API_AUDIENCE!;
      return {
        authMode: 'entra' as const,
        tenantId: config.ENTRA_TENANT_ID!,
        spaClientId: config.ENTRA_SPA_CLIENT_ID!,
        apiScope: `${audience.replace(/\/+$/, '')}/${config.ENTRA_API_SCOPE}`,
      };
    },
  );
};
