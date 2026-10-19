/**
 * @ccq/integrations: read-only adapters to systems of record.
 * Each integration exposes an interface, a real implementation and a fake for tests and local dev.
 * graph/ (B-16) is the one writer: attachment files in the CCQ SharePoint site (or the Blob fallback).
 *
 * TODO(B-18): graph/ mail.
 */
export const INTEGRATIONS_PACKAGE = '@ccq/integrations' as const;

export * from './salesforce/index';
export * from './pricing/index';
export * from './graph/index';
