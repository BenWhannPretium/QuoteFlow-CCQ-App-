/**
 * Role landing pages (F-02): the "My work" view of the Command Center (FB-18, W13-29). The header, the
 * call to action and the order of roles live here; the dashboard blocks themselves come from
 * `GET /api/v1/dashboards/:role` (B-17, `Dashboards.tsx`). Roles without a data dashboard (Admin,
 * Post-award) keep the static cards below.
 * Copy here names roles and work, never stage or gate labels: those come from config.
 */
export type LandingRole =
  | 'KAM'
  | 'SalesLeader'
  | 'EngLead'
  | 'Engineer'
  | 'ProductionScheduler'
  | 'Pricing'
  | 'PricingLead'
  | 'Finance'
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
  // FB-16 (W13-15; D-008 open, provisional): the Production Scheduler works the capacity part of a quote
  // alongside the engineer. No data dashboard: the action opens the queue page, which lists their
  // capacity requests first.
  ProductionScheduler: {
    role: 'ProductionScheduler',
    roleLabel: 'Production scheduler',
    title: 'Capacity requests',
    description:
      'The quotes whose capacity you own: enter the capacity evidence, then approve or block capacity.',
    action: {
      label: 'Open my capacity requests',
      to: '/queue/engineering',
      permission: 'engQueue.read',
    },
    cards: [
      {
        title: 'When a quote needs you',
        description:
          'You get a notification here and an email when the engineering lead assigns you to a quote, and again when the engineer has saved the plant and the machine type (“Capacity can start”). You can start earlier: nothing locks you out. The notification opens the quote’s Engineering tab.',
      },
      {
        title: 'What you do',
        description:
          'On the Engineering tab, the cards marked “Your part”: add the capacity evidence rows (site, line, effectiveness, how loaded the line is today) and QuoteFlow calculates the utilization with this business added. Then approve capacity, or block it with a note. A block sends the work straight back to the engineer with your note.',
      },
      {
        title: 'What you don’t do',
        description:
          'The solution, the pack-out and the two-step fields are the engineer’s part: you can read them but not change them. The engineering lead decides feasibility.',
      },
    ],
  },
  Pricing: {
    role: 'Pricing',
    roleLabel: 'Pricing',
    title: 'Pricing desk',
    description: 'Quotes ready to price and proposals coming up for renewal.',
    action: { label: 'Open the queue', to: '/queue/pricing', permission: 'quoting.edit' },
  },
  // B-26: the pricing lead triages Quoting work to the pricers (pricingQueue.assign).
  PricingLead: {
    role: 'PricingLead',
    roleLabel: 'Pricing lead',
    title: 'Pricing triage',
    description: 'Assign Quoting work to the pricers and keep the pricing queue balanced.',
    action: { label: 'Open the queue', to: '/queue/pricing', permission: 'pricingQueue.assign' },
  },
  // FB-07 (F-083, D-001): Finance builds the ROI from Pricing's costing model and uploads it. No queue
  // and no data dashboard: the "ready for its ROI" notice links to the quote's Quoting tab.
  Finance: {
    role: 'Finance',
    roleLabel: 'Finance',
    title: 'Payback requests',
    description:
      'Quotes that need a payback model: take the assumptions from the costing model on the quote and upload the payback model.',
    action: { label: 'Find a quote', to: '/quotes', permission: 'quote.read' },
    cards: [
      {
        title: 'When a quote needs you',
        description:
          'You get a notification here and an email when the pricer or the pricing lead asks you for a payback model on a quote, with their note if they wrote one. If they withdraw the request, you are told so you can stop. The notification opens the Quoting tab, where you take action.',
      },
      {
        title: 'What you do',
        description:
          'On the Quoting tab, step 2 (Payback): download the current costing model, build the payback model on your template, then upload it. QuoteFlow shows a short summary of its headline figures, read from the workbook. A new upload replaces the current version; earlier versions stay in the history.',
      },
      {
        title: 'What you don’t do',
        description:
          'You provide the payback model; the pricing lead approves the price once it is uploaded. You can read quotes, upload the payback model and comment. You cannot change anything else.',
      },
    ],
  },
  Approver: {
    role: 'Approver',
    roleLabel: 'Approver',
    title: 'Approvals',
    description: 'Quotes waiting for your final review decision.',
    action: { label: 'Review approvals', to: '/approvals', permission: 'gate.G4.decide' },
  },
  // FB-18 (W13-29): no "Open analytics" button. Analytics is the second view of the Command Center, one
  // click away in the header for everyone who may read it.
  Leadership: {
    role: 'Leadership',
    roleLabel: 'Leadership',
    title: 'Leadership overview',
    description: 'Pipeline value, throughput and where work is waiting.',
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
  'PricingLead',
  'Pricing',
  'Finance',
  'Engineer',
  'ProductionScheduler',
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
