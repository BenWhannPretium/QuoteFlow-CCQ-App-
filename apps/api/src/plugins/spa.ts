import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import staticPlugin from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Production only: serve the built SPA from apps/web/dist. The index.html fallback for
 * client-side routes lives in the problem-json not-found handler (Fastify allows only one).
 */
export const spaPlugin = fp(
  async (app: FastifyInstance, opts: { root: string }) => {
    const root = resolve(opts.root);
    if (!existsSync(resolve(root, 'index.html'))) {
      throw new Error(`SPA build not found at ${root}. Run \`pnpm build\` or set WEB_DIST_DIR.`);
    }
    await app.register(staticPlugin, { root, wildcard: false, index: ['index.html'] });
  },
  { name: 'spa', dependencies: ['problem-json'] },
);
