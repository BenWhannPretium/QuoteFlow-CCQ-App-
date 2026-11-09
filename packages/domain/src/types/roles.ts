/** Entra app roles (architecture §3.1), without the `CCQ.` prefix. PostAward is P2. */
export const ROLES = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'Pricing',
  // B-26: the pricing lead (Hema's role) triages the pricing queue, like EngLead does engineering.
  'PricingLead',
  // FB-07 (F-083, D-001): Finance builds the ROI from the costing model and uploads it. An input, not an
  // approver: reads quotes and uploads the ROI model, nothing else. Entra app role CCQ.Finance (A-032).
  'Finance',
  'Approver',
  'Leadership',
  'Admin',
  'PostAward',
] as const;

export type Role = (typeof ROLES)[number];

export const isRole = (value: string): value is Role =>
  (ROLES as readonly string[]).includes(value);
