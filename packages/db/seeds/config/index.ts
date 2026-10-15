import { seedRolePermissions } from './role-permission';
import { APP_SETTINGS, seedAppSettings, seedScoringModel, seedSfStageMap } from './settings';
import { seedValueLists } from './value-lists';
import { seedWorkflow } from './workflow';
import type { DbOrTx } from '../../src/client';

export * from './role-permission';
export * from './settings';
export * from './value-lists';
export * from './workflow';

/** All config seeds, idempotent. Every row is provisional until the owner approves it. */
export async function seedConfig(db: DbOrTx): Promise<void> {
  const g1Enabled = APP_SETTINGS.find((s) => s.key === 'g1_enabled')!.value as boolean;
  await seedWorkflow(db, g1Enabled);
  await seedRolePermissions(db);
  await seedValueLists(db);
  await seedAppSettings(db);
  await seedScoringModel(db);
  await seedSfStageMap(db);
}
