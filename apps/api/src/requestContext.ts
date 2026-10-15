import { contextFromActor, withRequestContext, type Database, type Tx } from '@ccq/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { requireActor } from './plugins/auth';

export type WithTx = <T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>) => Promise<T>;

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Run `fn` in a transaction as `ccq_app` with `SET LOCAL app.user_id / app.roles / app.scope_*`
     * from `req.actor`, so Postgres RLS applies to every query inside it.
     */
    withTx: WithTx;
  }
}

export function createWithTx(database: Database | undefined): WithTx {
  return (req, fn) => {
    if (!database) throw new Error('withTx: no database configured');
    return withRequestContext(database, contextFromActor(requireActor(req)), fn);
  };
}

export const requestContextPlugin = fp(
  (app: FastifyInstance, opts: { database?: Database }) => {
    app.decorate('withTx', createWithTx(opts.database));
  },
  { name: 'request-context', dependencies: ['auth'] },
);
