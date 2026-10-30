/**
 * @ccq/domain: pure TypeScript business logic with NO I/O.
 * Never import fastify, drizzle, node:fs, fetch or any Azure SDK here, and never read the clock:
 * callers pass `now` in.
 */
export const DOMAIN_PACKAGE = '@ccq/domain' as const;

export * from './attachments';
export * from './commercial';
export * from './comments';
export * from './config-admin';
export * from './engineering';
export * from './errors';
export * from './feedback';
export * from './final-review';
export * from './intake';
export * from './lead-review';
export * from './notifications';
export * from './outcome';
export * from './overrides';
export * from './policy';
export * from './pipeline';
export * from './pricing';
export * from './quote-number';
export * from './scoring';
export * from './timeline';
export * from './types';
export * from './workflow';
