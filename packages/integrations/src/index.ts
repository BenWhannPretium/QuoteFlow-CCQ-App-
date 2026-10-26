/**
 * @ccq/integrations: read-only adapters to systems of record.
 * Each integration exposes an interface, a real implementation and a fake for tests and local dev.
 * graph/ (B-16) is the one writer: attachment files in the CCQ SharePoint site (or the Blob fallback).
 * mail/ (B-18) sends the notification emails: Graph from the shared mailbox, SMTP to mailpit, or a fake.
 * fabric/ (B-27) reads the health of the Fabric mirror of the CCQ database (read-only).
 */
export const INTEGRATIONS_PACKAGE = '@ccq/integrations' as const;

export * from './salesforce/index';
export * from './pricing/index';
export * from './graph/index';
export * from './mail/index';
export * from './fabric/index';
