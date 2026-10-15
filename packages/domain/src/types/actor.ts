import type { UserId } from './ids';
import type { Role } from './roles';

/** Mirrors `user_scope`: { scope_type: all | region | owner | account_list, values[] }. */
export type Scope =
  | { type: 'all' }
  | { type: 'owner' }
  | { type: 'region'; values: readonly string[] }
  | { type: 'account_list'; values: readonly string[] };

export type ScopeType = Scope['type'];

export interface Actor {
  userId: UserId;
  roles: readonly Role[];
  scope: Scope;
}
