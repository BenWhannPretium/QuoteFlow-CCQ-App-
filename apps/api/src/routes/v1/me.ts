import { MeResponse } from '@ccq/contracts';
import { permissionsForRoles } from '@ccq/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { IdentityService } from '../../auth/directory';
import type { AppConfig } from '../../config';
import { requireActor } from '../../plugins/auth';

export const meRoutes: FastifyPluginAsyncZod<{
  config: AppConfig;
  identity: IdentityService;
}> = async (app, { config, identity }) => {
  app.get(
    '/me',
    {
      config: { permission: 'authenticated' },
      schema: {
        tags: ['auth'],
        summary: 'The signed-in user, roles, permissions, data scope and feature flags',
        security: [{ bearerAuth: [] }],
        response: { 200: MeResponse },
      },
    },
    async (req) => {
      const actor = requireActor(req);
      const user = req.currentUser!;
      const body: MeResponse = {
        user: { id: user.userId, displayName: user.displayName, upn: user.upn, email: user.email },
        roles: [...actor.roles],
        permissions: permissionsForRoles(actor.roles),
        scope:
          actor.scope.type === 'region' || actor.scope.type === 'account_list'
            ? { type: actor.scope.type, values: [...actor.scope.values] }
            : { type: actor.scope.type },
        featureFlags: await identity.featureFlags(),
        authMode: config.AUTH_MODE,
        ...(user.devPersona ? { devPersona: user.devPersona } : {}),
      };
      return body;
    },
  );
};
