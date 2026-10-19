/**
 * Role landing pages (F-02). The header, the call to action and the order of roles live here; the
 * dashboard blocks themselves come from `GET /api/v1/dashboards/:role` (B-17, `Dashboards.tsx`). Roles
 * without a data dashboard (Admin, Post-award) keep the static cards below.
 * Copy here names roles and work, never stage or gate labels: those come from config.
 */
export type LandingRole =
  | 'KAM'
  | 'SalesLeader'
  | 'EngLead'
  | 'Engineer'
  | 'Pricing'
  | 'Approver'
  | 'Leadership'
  | 'Admin'
  | 'PostAward';

export interface LandingCard {
  title: string;
  description: string;
}

export interface LandingDefinition {
  role: LandingRole;
  /** Short role name for the eyebrow and the role switcher. */
  roleLabel: string;
  title: string;
  description: string;
  action?: { label: string; to: string; permission: string };
  /** Static cards, only for roles without a data dashboard. */
  cards?: LandingCard[];
}

export const LANDINGS: Record<LandingRole, LandingDefinition> = {
  KAM: {
    role: 'KAM',
    roleLabel: 'Key account manager',
    title: 'My quotes',
    description: 'Your intakes and quotes, and anything waiting on you.',
    action: { label: 'New intake', to: '/intake/new', permission: 'quote.create' },
  },
  SalesLeader: {
    role: 'SalesLeader',
    roleLabel: 'Sales leader',
    title: 'Sales pipeline',
    description: 'Qualification decisions and the health of your team’s pipeline.',
    action: { label: 'New intake', to: '/intake/new', permission: 'quote.create' },
  },
  EngLead: {
    role: 'EngLead',
    roleLabel: 'Engineering lead',
    title: 'Engineering queue',
    description: 'Assign upfront engineering work and keep the queue moving.',
    action: { label: 'Open the queue', to: '/queue/engineering', permission: 'queue.assign' },
  },
  Engineer: {
    role: 'Engineer',
    roleLabel: 'Engineer',
    title: 'My assignments',
    description: 'The engineering reviews assigned to you.',
    action: { label: 'Open my work', to: '/queue/engineering', permission: 'engQueue.read' },
  },
  Pricing: {
    role: 'Pricing',
    roleLabel: 'Pricing',
    title: 'Pricing desk',
    description: 'Quotes ready to price and proposals coming up for renewal.',
    action: { label: 'Open the queue', to: '/queue/pricing', permission: 'quoting.edit' },
  },
  Approver: {
    role: 'Approver',
    roleLabel: 'Approver',
    title: 'Approvals',
    description: 'Quotes waiting for your final review decision.',
    action: { label: 'Review approvals', to: '/approvals', permission: 'gate.G4.decide' },
  },
  Leadership: {
    role: 'Leadership',
    roleLabel: 'Leadership',
    title: 'Leadership overview',
    description: 'Pipeline value, throughput and where work is waiting.',
    action: { label: 'Open analytics', to: '/analytics', permission: 'analytics.read' },
  },
  Admin: {
    role: 'Admin',
    roleLabel: 'Admin',
    title: 'Administration',
    description: 'Configuration, users and system status.',
    action: { label: 'Open admin', to: '/admin', permission: 'config.manage' },
    cards: [
      { title: 'Provisional settings', description: 'Seed values still waiting on an owner.' },
      { title: 'Users and roles', description: 'Who has which QuoteFlow role.' },
    ],
  },
  PostAward: {
    role: 'PostAward',
    roleLabel: 'Post-award',
    title: 'Awarded quotes',
    description: 'Quotes handed over after award.',
    cards: [{ title: 'Recently awarded', description: 'New handoffs, newest first.' }],
  },
};

/**
 * Which landing a multi-role user sees first: the role with the most time-critical work.
 * A user with several roles can switch with the role tabs on the landing page.
 */
export const LANDING_PRECEDENCE: readonly LandingRole[] = [
  'Approver',
  'EngLead',
  'Pricing',
  'Engineer',
  'SalesLeader',
  'KAM',
  'Leadership',
  'Admin',
  'PostAward',
];

const isLandingRole = (role: string): role is LandingRole => role in LANDINGS;

/** The user's landing roles, in precedence order. */
export function landingRolesFor(roles: readonly string[]): LandingRole[] {
  const held = new Set(roles.filter(isLandingRole));
  return LANDING_PRECEDENCE.filter((r) => held.has(r));
}

/** The landing to show: the requested role if the user holds it, else the primary role. */
export function landingFor(roles: readonly string[], requested?: string): LandingDefinition | null {
  const held = landingRolesFor(roles);
  const role = held.find((r) => r === requested) ?? held[0];
  return role ? LANDINGS[role] : null;
}
