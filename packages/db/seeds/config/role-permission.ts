import { PERMISSION_MATRIX } from '@ccq/domain';
import type { Permission, Role } from '@ccq/domain';

import { upsertConfig } from './_upsert';
import type { DbOrTx } from '../../src/client';
import { rolePermission } from '../../src/schema/index';

/** `role_permission` rows from `packages/domain/src/policy/matrix.ts`. Qualified grants keep their qualifier. */
export function rolePermissionRows() {
  return Object.entries(PERMISSION_MATRIX).flatMap(([permission, grants]) =>
    Object.entries(grants).map(([role, grant]) => ({
      role: role as Role,
      permission: permission as Permission,
      qualifier: grant === true ? null : grant,
      provisional: true,
    })),
  );
}

export const seedRolePermissions = (db: DbOrTx) =>
  upsertConfig(db, rolePermission, rolePermissionRows(), ['role', 'permission']);
