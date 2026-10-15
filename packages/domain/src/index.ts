/**
 * @ccq/domain: pure TypeScript business logic with NO I/O.
 * Never import fastify, drizzle, node:fs, fetch or any Azure SDK here, and never read the clock:
 * callers pass `now` in.
 *
 * TODO(B-08): scoring engine implementation (the interface is in ./scoring).
 */
export const DOMAIN_PACKAGE = '@ccq/domain' as const;

export * from './errors';
export * from './policy';
export * from './quote-number';
export * from './scoring';
export * from './types';
export * from './workflow';
