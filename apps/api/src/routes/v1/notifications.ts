import {
  MarkNotificationReadResponse,
  MarkNotificationsReadResponse,
  NotificationIdParams,
  NotificationListQuery,
  NotificationListResponse,
  PreferencesResponse,
  UpdatePreferencesBody,
} from '@ccq/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { auditMeta } from '../../plugins/audit';
import { requireActor } from '../../plugins/auth';
import type { NotificationService, NotificationWithTx } from '../../services/notificationService';
import { handleProblems } from '../../services/problem';

const security = [{ bearerAuth: [] }];

/**
 * B-18 notifications. Everything here is the caller's own (RLS on `notification` and the explicit
 * user filter in each query), so the floor is "signed in": every role has a bell and preferences.
 */
export const notificationRoutes: FastifyPluginAsyncZod<{ service: NotificationService }> = async (
  app,
  { service },
) => {
  const withTx =
    (req: FastifyRequest): NotificationWithTx =>
    (fn) =>
      app.withTx(req, fn);

  app.get(
    '/notifications',
    {
      config: { permission: 'authenticated' },
      schema: {
        tags: ['notifications'],
        summary:
          'The caller’s in-app notifications, newest first (paged by cursor), with the total unread count',
        security,
        querystring: NotificationListQuery,
        response: { 200: NotificationListResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.list(withTx(req), requireActor(req), req.query)),
  );

  app.post(
    '/notifications/read',
    {
      config: { permission: 'authenticated' },
      schema: {
        tags: ['notifications'],
        summary: 'Mark all of the caller’s notifications read',
        security,
        response: { 200: MarkNotificationsReadResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.markAllRead(withTx(req), requireActor(req))),
  );

  app.post(
    '/notifications/:id/read',
    {
      config: { permission: 'authenticated' },
      schema: {
        tags: ['notifications'],
        summary: 'Mark one of the caller’s notifications read (404 if it is not theirs)',
        security,
        params: NotificationIdParams,
        response: { 200: MarkNotificationReadResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.markRead(withTx(req), requireActor(req), req.params.id),
      ),
  );

  app.get(
    '/me/preferences',
    {
      config: { permission: 'authenticated' },
      schema: {
        tags: ['notifications'],
        summary:
          'The caller’s email preferences: one switch per notification type that has an email (in-app cannot be switched off)',
        security,
        response: { 200: PreferencesResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () => service.preferences(withTx(req), requireActor(req))),
  );

  app.put(
    '/me/preferences',
    {
      config: { permission: 'authenticated' },
      schema: {
        tags: ['notifications'],
        summary: 'Opt in or out of email per notification type. Only the types sent change.',
        security,
        body: UpdatePreferencesBody,
        response: { 200: PreferencesResponse },
      },
    },
    async (req, reply) =>
      handleProblems(req, reply, () =>
        service.updatePreferences(withTx(req), requireActor(req), req.body, auditMeta(req)),
      ),
  );
};
