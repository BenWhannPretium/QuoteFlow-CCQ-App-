import type { MeResponse } from '@ccq/contracts';

/** Permission names (architecture §3.4). The server is the control; this only shapes the UI. */
export type PermissionName = string;

export const meQueryKey = ['me'] as const;

export const canFromMe = (me: MeResponse | undefined, permission: PermissionName): boolean =>
  !!me && me.permissions.includes(permission);

export const DEV_PERSONA_STORAGE_KEY = 'ccq.devPersona';
