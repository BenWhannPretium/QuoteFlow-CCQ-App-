import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import staticPlugin from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/** A year, and never revalidated: Vite names every file under `assets/` by its content hash. */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** Kept, but checked with the server before every use: `index.html` names the current build's files. */
export const REVALIDATE_CACHE = 'no-cache';

/**
 * Cache policy for a built SPA file. Everything used to go out as `public, max-age=0`, so a browser
 * revalidated every script, style and font on every page load (a round trip each) although their names
 * change whenever their content does. Hashed files are now cached for good; `index.html` and the few
 * unhashed files (the favicon, the help pages) are always revalidated, so a deploy is picked up at once.
 */
export function cacheControlFor(root: string, filePath: string): string {
  const rel = relative(root, filePath).split(sep).join('/');
  return rel.startsWith('assets/') ? IMMUTABLE_CACHE : REVALIDATE_CACHE;
}

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
    await app.register(staticPlugin, {
      root,
      wildcard: false,
      index: ['index.html'],
      // Set per file below.
      cacheControl: false,
      setHeaders: (res, filePath) => {
        void res.header('cache-control', cacheControlFor(root, filePath));
      },
    });
  },
  { name: 'spa', dependencies: ['problem-json'] },
);
