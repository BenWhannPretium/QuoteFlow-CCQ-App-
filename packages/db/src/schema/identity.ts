import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  check,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { c, documented, inList } from './_doc';
import { PERMISSIONS, ROLES, SCOPE_TYPES } from './enums';

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const SYSTEM = 'CCQ (system)';

/** id, created_at, updated_at, created_by: on every table (architecture §5). */
export const baseColumns = () => ({
  id: c(
    uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    'Primary key. UUID v7, generated in app code.',
    SYSTEM,
  ),
  createdAt: c(
    timestamptz('created_at').notNull().defaultNow(),
    'When the row was created (UTC).',
    SYSTEM,
  ),
  updatedAt: c(
    timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    'When the row was last changed (UTC).',
    SYSTEM,
  ),
  createdBy: c(
    uuid('created_by').references((): AnyPgColumn => appUser.id, { onDelete: 'set null' }),
    'User who created the row; null for system jobs and seeds.',
    SYSTEM,
  ),
});

/** version, provisional, approved_by, approved_at: on every config table. */
export const configColumns = () => ({
  version: c(
    integer('version').notNull().default(1),
    'Config version, bumped on every admin change.',
    'Admin / Knowledge Steward',
  ),
  provisional: c(
    boolean('provisional').notNull().default(true),
    'True until the business owner approves the value (04-decisions-and-risks.md).',
    'Admin / Knowledge Steward',
  ),
  approvedBy: c(
    uuid('approved_by').references((): AnyPgColumn => appUser.id, { onDelete: 'restrict' }),
    'User who approved the value; null while provisional.',
    'Admin / Knowledge Steward',
  ),
  approvedAt: c(
    timestamptz('approved_at'),
    'When the value was approved.',
    'Admin / Knowledge Steward',
  ),
});

const ENTRA = 'IT identity (Entra ID)';

export const appUser = documented(
  pgTable(
    'app_user',
    {
      ...baseColumns(),
      entraOid: c(
        text('entra_oid').notNull().unique(),
        'Entra object id (`oid` claim). Stable user key.',
        ENTRA,
      ),
      upn: c(text('upn').notNull(), 'User principal name (`preferred_username` claim).', ENTRA),
      displayName: c(
        text('display_name').notNull(),
        'Display name from the token (`name` claim).',
        ENTRA,
      ),
      email: c(text('email'), 'Business email address.', ENTRA),
      region: c(text('region'), 'Sales region, used by region-scoped data access.', 'Admin'),
      active: c(
        boolean('active').notNull().default(true),
        'False once the user leaves; rows are never deleted.',
        'Admin',
      ),
      lastSeenAt: c(timestamptz('last_seen_at'), 'Last authenticated API request.', SYSTEM),
    },
    (t) => [index('app_user_upn_idx').on(t.upn)],
  ),
  {
    area: 'identity',
    owner: ENTRA,
    description: 'A person who has signed in to CCQ. Upserted from the Entra token.',
  },
);

export const userRole = documented(
  pgTable(
    'user_role',
    {
      ...baseColumns(),
      userId: c(
        uuid('user_id')
          .notNull()
          .references(() => appUser.id, { onDelete: 'cascade' }),
        'The user holding the role.',
      ),
      role: c(text('role').notNull(), 'App role without the `CCQ.` prefix (KAM, Pricing, …).'),
    },
    (t) => [
      unique('user_role_user_role_uq').on(t.userId, t.role),
      check('user_role_role_check', inList(t.role, ROLES)),
    ],
  ),
  {
    area: 'identity',
    owner: ENTRA,
    description:
      'App roles a user holds. Synced from the token `roles` claim on sign-in; the token is the source of truth.',
  },
);

export const userScope = documented(
  pgTable(
    'user_scope',
    {
      ...baseColumns(),
      userId: c(
        uuid('user_id')
          .notNull()
          .unique()
          .references(() => appUser.id, { onDelete: 'cascade' }),
        'The user the scope applies to (one scope per user).',
      ),
      scopeType: c(
        text('scope_type').notNull().default('all'),
        'all | region | owner | account_list.',
      ),
      values: c(
        text('values').array().notNull().default([]),
        'Regions or SF account ids for region / account_list scopes; empty otherwise.',
      ),
    },
    (t) => [check('user_scope_scope_type_check', inList(t.scopeType, SCOPE_TYPES))],
  ),
  {
    area: 'identity',
    owner: 'Admin',
    description:
      'Data scope per user (architecture §3.2). Enforced by the policy function and by RLS.',
  },
);

export const userPreference = documented(
  pgTable(
    'user_preference',
    {
      ...baseColumns(),
      userId: c(
        uuid('user_id')
          .notNull()
          .references(() => appUser.id, { onDelete: 'cascade' }),
        'The user the preference belongs to.',
      ),
      key: c(
        text('key').notNull(),
        'Preference key, e.g. email.quote.assigned (B-18: email per notification type).',
      ),
      value: c(
        jsonb('value').notNull(),
        'Preference value; email.* keys hold true or false. A missing row means the default (email on).',
      ),
    },
    (t) => [uniqueIndex('user_preference_user_key_idx').on(t.userId, t.key)],
  ),
  {
    area: 'identity',
    owner: 'Each user',
    description:
      'Per-user preferences (B-18: opt out of email per notification type). In-app notifications cannot be switched off.',
  },
);

export const rolePermission = documented(
  pgTable(
    'role_permission',
    {
      ...baseColumns(),
      ...configColumns(),
      role: c(text('role').notNull(), 'App role.'),
      permission: c(
        text('permission').notNull(),
        'Permission name from the matrix (e.g. gate.G4.decide).',
      ),
      qualifier: c(
        jsonb('qualifier'),
        'Null for an unrestricted grant, else {kind: own | assigned | fields | stages, …} (policy/matrix.ts).',
      ),
    },
    (t) => [
      unique('role_permission_role_permission_uq').on(t.role, t.permission),
      check('role_permission_role_check', inList(t.role, ROLES)),
      check('role_permission_permission_check', inList(t.permission, PERMISSIONS)),
    ],
  ),
  {
    area: 'identity',
    owner: 'Admin / Knowledge Steward',
    description:
      'Permission matrix (architecture §3.4) as config, seeded from packages/domain/src/policy/matrix.ts.',
  },
);
