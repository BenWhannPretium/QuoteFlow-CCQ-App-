import { z } from 'zod';

import { DomainError } from '../errors';
import { OVERRIDE_VALUE_KINDS } from './values';
import { ROLES, type Role } from '../types/roles';

/**
 * Governed overrides (F-06, B-09). Which fields may be overridden, and who requests, approves and
 * reverts each one, is CONFIG (`app_setting.overridable_fields`): who approves overrides is a blueprint
 * gap, confirmed in R1 (see 04-decisions-and-risks.md). The value semantics of a field (what a valid
 * tier / address / position is) are code: `OVERRIDE_VALUE_KINDS`.
 *
 * - `approval: 'approver'`: the request waits for someone in `approverRoles` (who also holds
 *   `override.approve` for the field). Approve applies it; reject closes it.
 * - `approval: 'self'`: "none (self, logged)". The requester applies it at once; it is still logged.
 */
export const OVERRIDE_APPROVAL_MODES = ['approver', 'self'] as const;
export type OverrideApprovalMode = (typeof OVERRIDE_APPROVAL_MODES)[number];

const role = z.enum(ROLES);

export const overridableFieldSchema = z.object({
  /** The overridden quote field: priority_tier | ship_to | queue_position. */
  field: z.string().min(1),
  label: z.string().min(1),
  approval: z.enum(OVERRIDE_APPROVAL_MODES),
  /** Roles that may raise the override (they must also hold `override.request`). */
  requestRoles: z.array(role).min(1),
  /** Roles that may approve or reject (they must also hold `override.approve` for the field). Empty for self. */
  approverRoles: z.array(role).default([]),
  /** Roles that may revert an applied override (with `override.revert`). A self-applying requester always may. */
  revertRoles: z.array(role).default([]),
  /** Roles limited to their own quotes for this field (a KAM changes the ship-to of their own quotes). */
  ownQuoteOnlyRoles: z.array(role).default([]),
});

export type OverridableField = z.infer<typeof overridableFieldSchema>;

export const overrideSettingsSchema = z.object({
  fields: z.array(overridableFieldSchema),
  /** Minimum justification length, after trimming. */
  justificationMinLength: z.number().int().min(1).max(500),
});

export type OverrideSettings = z.infer<typeof overrideSettingsSchema>;

/** Parses untrusted config (seed, `app_setting` rows). Throws INVALID_CONFIG. */
export function parseOverrideSettings(input: unknown): OverrideSettings {
  const parsed = overrideSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new DomainError('INVALID_CONFIG', `Override settings failed validation: ${detail}`);
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of parsed.data.fields) {
    if (seen.has(f.field)) problems.push(`Duplicate overridable field ${f.field}`);
    seen.add(f.field);
    if (!(f.field in OVERRIDE_VALUE_KINDS)) problems.push(`No value kind for field ${f.field}`);
    if (f.approval === 'approver' && f.approverRoles.length === 0) {
      problems.push(`${f.field} needs approverRoles (or approval: self)`);
    }
    if (f.approval === 'self' && f.approverRoles.length > 0) {
      problems.push(`${f.field} is self-applied, so it takes no approverRoles`);
    }
  }
  if (problems.length > 0) throw new DomainError('INVALID_CONFIG', problems.join('; '));
  return parsed.data;
}

export const findOverridableField = (settings: OverrideSettings, field: string) =>
  settings.fields.find((f) => f.field === field);

/** Roles shared by the actor and a config list. */
export const holdsAnyRole = (roles: readonly Role[], list: readonly Role[]) =>
  roles.some((r) => list.includes(r));

/**
 * Seed (provisional until R1): SalesLeader or EngLead approve the priority tier; the KAM self-applies a
 * ship-to with a reason (logged); the EngLead pins a quote to the top of the engineering queue.
 */
export const OVERRIDE_SETTINGS_SEED = {
  fields: [
    {
      field: 'priority_tier',
      label: 'Priority tier',
      approval: 'approver',
      requestRoles: ['KAM', 'SalesLeader', 'EngLead', 'Pricing'],
      approverRoles: ['SalesLeader', 'EngLead'],
      revertRoles: ['SalesLeader', 'EngLead', 'Admin'],
      ownQuoteOnlyRoles: [],
    },
    {
      field: 'ship_to',
      label: 'Ship-to',
      approval: 'self',
      requestRoles: ['KAM', 'SalesLeader'],
      approverRoles: [],
      revertRoles: ['SalesLeader', 'Admin'],
      ownQuoteOnlyRoles: ['KAM'],
    },
    {
      field: 'queue_position',
      label: 'Engineering queue position',
      approval: 'self',
      requestRoles: ['EngLead'],
      approverRoles: [],
      revertRoles: ['EngLead', 'Admin'],
      ownQuoteOnlyRoles: [],
    },
  ],
  justificationMinLength: 15,
} satisfies z.input<typeof overrideSettingsSchema>;
