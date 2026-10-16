/** Permission names from the architecture §3.4 matrix. Which roles hold them is data: see policy/matrix.ts. */
export const PERMISSIONS = [
  'quote.create',
  'quote.read',
  'quote.read.commercialFields',
  'gate.G1.decide',
  'engQueue.read',
  'queue.assign',
  'engReview.edit',
  'gate.G2.decide',
  'pricingQueue.read',
  'quoting.edit',
  'gate.G3.submit',
  'finalReview.read',
  'gate.G4.decide',
  'outcome.record',
  'override.request',
  'override.approve',
  'override.revert',
  'overrideLog.read',
  'audit.read',
  'attachment.upload',
  'export.csv',
  'analytics.read',
  'config.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
