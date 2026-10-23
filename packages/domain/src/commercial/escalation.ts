import { z } from 'zod';

import { DomainError } from '../errors';
import { asUserId } from '../types/ids';
import { ROLES, type Role } from '../types/roles';
import type { PlannedNotification } from '../workflow/evaluate';

/**
 * B-26 escalations and the CCQ Process Owner (deck slides 8, 10-12).
 *
 * The Process Owner owns the process, not the work (a net-new role in Commercial, TBD; Oleg Yarovinski
 * is interim). It is a named CCQ user in config (`process_owner`), never a hard-coded person.
 *
 * Anyone working a quote can raise an escalation of a configured type with a note. It is recorded on
 * the timeline and audit log and tells the route's recipients: CCQ roles, named users (for groups that
 * are not CCQ roles: Operations / Supply Chain leadership, Market Development), and optionally the
 * Process Owner. An escalation records a concern; it never changes the quote or decides a gate.
 */

export interface EscalationRoute {
  code: string;
  label: string;
  /** Who it is for, shown in the dialog. */
  description: string;
  roles: Role[];
  userIds: string[];
  processOwner: boolean;
}

/** `escalation_routes` seed (provisional, D-28): the escalation paths on the deck's stage maps. */
export const ESCALATION_ROUTES_SEED: EscalationRoute[] = [
  {
    code: 'queue_priority',
    label: 'Queue or priority conflict',
    description: 'The upfront Engineering lead, then the CCQ Process Owner (slide 11).',
    roles: ['EngLead'],
    userIds: [],
    processOwner: true,
  },
  {
    code: 'capacity',
    label: 'Capacity dispute or displacing existing business',
    description: 'Operations / Supply Chain leadership (named in settings) (slide 11).',
    roles: [],
    userIds: [],
    processOwner: false,
  },
  {
    code: 'strategic_exception',
    label: 'Strategic exception',
    description: 'Sales leadership and Market Development (slide 10).',
    roles: ['SalesLeader'],
    userIds: [],
    processOwner: false,
  },
  {
    code: 'pricing_exception',
    label: 'Below-floor or "fill the machine" pricing',
    description: 'Pricing leadership (slide 12).',
    roles: ['PricingLead'],
    userIds: [],
    processOwner: false,
  },
  {
    code: 'payback',
    label: 'Payback outside guardrails',
    description: 'The tier approver (slide 12).',
    roles: ['Approver'],
    userIds: [],
    processOwner: false,
  },
  {
    code: 'process',
    label: 'A problem with the process itself',
    description: 'The CCQ Process Owner (slide 8).',
    roles: [],
    userIds: [],
    processOwner: true,
  },
];

const routeSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9_]+$/, 'use lower_snake_case'),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(300),
    roles: z.array(z.enum(ROLES)),
    userIds: z.array(z.uuid()),
    processOwner: z.boolean(),
  })
  .strict();
const routesSchema = z
  .array(routeSchema)
  .min(1)
  .refine((r) => new Set(r.map((x) => x.code)).size === r.length, 'duplicate code');

export function parseEscalationRoutes(input: unknown): EscalationRoute[] {
  if (input === undefined || input === null) return structuredClone(ESCALATION_ROUTES_SEED);
  const parsed = routesSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(value)'}: ${i.message}`)
      .join('; ');
    throw new DomainError('INVALID_CONFIG', `escalation_routes: ${detail}`);
  }
  return parsed.data;
}

export interface ProcessOwnerSetting {
  /** The CCQ user who is the Process Owner; null = not named yet. */
  userId: string | null;
  /** How the role is shown, e.g. "CCQ Process Owner (interim)". */
  label: string;
}

export const PROCESS_OWNER_SEED: ProcessOwnerSetting = {
  userId: null,
  label: 'CCQ Process Owner (interim)',
};

const processOwnerSchema = z
  .object({ userId: z.uuid().nullable(), label: z.string().trim().min(1).max(120) })
  .strict();

export function parseProcessOwner(input: unknown): ProcessOwnerSetting {
  if (input === undefined || input === null) return { ...PROCESS_OWNER_SEED };
  const parsed = processOwnerSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError('INVALID_CONFIG', 'process_owner must be { userId: uuid | null, label }');
  }
  return parsed.data;
}

export const ESCALATION_NOTE_MAX = 2000;

export type EscalationPlan =
  | { ok: true; route: EscalationRoute; note: string; notifications: PlannedNotification[] }
  | { ok: false; errors: DomainError[] };

/** Validate an escalation and plan who hears about it. A route with nobody to tell is refused. */
export function planEscalation(input: {
  routes: readonly EscalationRoute[];
  processOwner: ProcessOwnerSetting;
  code: string;
  note: string;
  closed: boolean;
}): EscalationPlan {
  const errors: DomainError[] = [];
  if (input.closed) errors.push(new DomainError('QUOTE_CLOSED', 'The quote is closed'));
  const route = input.routes.find((r) => r.code === input.code);
  if (!route) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        `Escalation type must be one of: ${input.routes.map((r) => r.code).join(', ')}`,
        'code',
      ),
    );
  }
  const note = input.note.trim();
  if (!note) errors.push(new DomainError('NOTE_REQUIRED', 'Say what needs escalating', 'note'));
  if (note.length > ESCALATION_NOTE_MAX) {
    errors.push(
      new DomainError('INVALID_VALUE', `Keep it to ${ESCALATION_NOTE_MAX} characters`, 'note'),
    );
  }
  if (errors.length > 0 || !route) return { ok: false, errors };

  const type = 'quote.escalated';
  const notifications: PlannedNotification[] = [
    ...route.roles.map((role): PlannedNotification => ({
      type,
      recipient: { kind: 'role', role },
    })),
    ...route.userIds.map((id): PlannedNotification => ({
      type,
      recipient: { kind: 'user', userId: asUserId(id) },
    })),
  ];
  if (route.processOwner && input.processOwner.userId) {
    notifications.push({
      type,
      recipient: { kind: 'user', userId: asUserId(input.processOwner.userId) },
    });
  }
  if (notifications.length === 0) {
    return {
      ok: false,
      errors: [
        new DomainError(
          'NO_RECIPIENTS',
          `Nobody is set up to receive "${route.label}" escalations yet. Ask an Admin to name them in Settings.`,
          'code',
        ),
      ],
    };
  }
  return { ok: true, route, note, notifications };
}
