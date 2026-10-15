/** Entra app roles (architecture §3.1), without the `CCQ.` prefix. PostAward is P2. */
export const ROLES = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'Pricing',
  'Approver',
  'Leadership',
  'Admin',
  'PostAward',
] as const;

export type Role = (typeof ROLES)[number];

export const isRole = (value: string): value is Role =>
  (ROLES as readonly string[]).includes(value);
