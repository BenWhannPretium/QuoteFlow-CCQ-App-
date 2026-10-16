import type { DbOrTx } from '@ccq/db';
import { getSetting } from '@ccq/db/repos';
import {
  parseApproverTierRules,
  parseValidityDays,
  type ApproverTierRules,
  type DomainError,
} from '@ccq/domain';

/**
 * Config that changes who may release a proposition and what an approval sets (B-12). Read from
 * `app_setting`; a malformed value never silently disables a control: the parsed value is null and
 * the error is kept so the decision is refused with a clear message (`fail closed`).
 */
export interface ReleaseSettings {
  /** `validity_days_default` (provisional 30, D-12); null when the setting is malformed. */
  validityDays: number | null;
  validityError: string | null;
  /** `g4_tier_rules`; null = disabled (the seed) or malformed. */
  approverTiers: ApproverTierRules | null;
  tiersError: string | null;
}

const message = (err: unknown) => (err as DomainError).message ?? String(err);

export async function loadReleaseSettings(db: DbOrTx): Promise<ReleaseSettings> {
  const [days, tiers] = await Promise.all([
    getSetting(db, 'validity_days_default'),
    getSetting(db, 'g4_tier_rules'),
  ]);
  const out: ReleaseSettings = {
    validityDays: null,
    validityError: null,
    approverTiers: null,
    tiersError: null,
  };
  try {
    out.validityDays = parseValidityDays(days);
  } catch (err) {
    out.validityError = message(err);
  }
  try {
    out.approverTiers = parseApproverTierRules(tiers);
  } catch (err) {
    out.tiersError = message(err);
  }
  return out;
}
