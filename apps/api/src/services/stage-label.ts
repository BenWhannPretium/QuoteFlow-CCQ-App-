import { openStages } from '@ccq/db/repos';
import { ENG_QUEUE_STAGE_KEY } from '@ccq/domain';

type Db = Parameters<typeof openStages>[0];

/**
 * FB-16 (W13-16): a stage's configured label, for text that names the stage. The label is Admin-editable
 * config ("Engineering & Capacity", provisional), so metric descriptions and messages read it instead of
 * repeating it. `fallback` covers a stage that is not in the open list (it never should be missing).
 */
export async function stageLabelOf(db: Db, stageKey: string, fallback: string): Promise<string> {
  return (await openStages(db)).find((s) => s.key === stageKey)?.label ?? fallback;
}

/** The engineering stage's label (stage key ENG_REVIEW, which does not change). */
export const engStageLabel = (db: Db): Promise<string> =>
  stageLabelOf(db, ENG_QUEUE_STAGE_KEY, 'Engineering');
