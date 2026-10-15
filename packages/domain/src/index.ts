/**
 * @ccq/domain: pure TypeScript business logic with NO I/O.
 * Never import fastify, drizzle, node:fs, fetch or any Azure SDK here.
 *
 * TODO(B-02): stage/gate engine, permission policy (src/policy), redaction, quote numbers.
 * TODO(B-08): scoring engine.
 */
export const DOMAIN_PACKAGE = '@ccq/domain' as const;
