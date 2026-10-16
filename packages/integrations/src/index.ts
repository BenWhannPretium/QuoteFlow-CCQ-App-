/**
 * @ccq/integrations: read-only adapters to systems of record.
 * Each integration exposes an interface, a real implementation and a fake for tests and local dev.
 *
 * TODO(B-15): pricing/ (read-only SQL).
 * TODO(B-16, B-18): graph/ (SharePoint files, mail).
 */
export const INTEGRATIONS_PACKAGE = '@ccq/integrations' as const;

export * from './salesforce/index';
