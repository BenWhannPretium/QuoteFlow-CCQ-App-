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
  'pricingQueue.assign',
  'quoting.edit',
  'gate.G3.submit',
  // FB-07 (F-083): upload or replace the ROI model in Quoting.
  'roi.upload',
  'finalReview.read',
  'gate.G4.decide',
  // FB-08 (F-082, off until A-035): an extra Final Review sign-off (g4_additional_approvals).
  'finalReview.signoff',
  'outcome.record',
  'outcome.assignOwner',
  'handoff.edit',
  'gate.G6.decide',
  'terms.edit',
  // FB-08 (F-021, D-003 provisional): MOQ and tooling funding are Engineering's.
  'terms.engineering.edit',
  // FB-08 (F-068): the approver confirms the capital terms at Final Review.
  'terms.finalize',
  // FB-08 (T-007): approve or reject a non-standard payment-terms exception.
  'terms.exception.decide',
  'capitalFlag.edit',
  'capacity.signoff',
  'quote.escalate',
  'override.request',
  'override.approve',
  'override.revert',
  'overrideLog.read',
  'audit.read',
  'attachment.upload',
  'attachment.removeAny',
  'export.csv',
  'analytics.read',
  'config.read',
  'config.manage',
  'feedback.submit',
  'feedback.triage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
