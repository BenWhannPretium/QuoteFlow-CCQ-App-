import { ENG_QUEUE_STAGE_KEY } from '../engineering/queue';
import { DomainError } from '../errors';
import { PRICING_QUEUE_STAGE_KEY } from '../pricing/queue';

/**
 * FB-17 (W13-25; Zachary Cairns and Bailey Schmitt, 2026-11-13): the hold owner is the person who will
 * clear the hold. The dialog used to default to the decider ("Me") and offer the KAM, who has nothing to
 * do with, say, a capacity question. Now it offers the people working the stage first and defaults to
 * them when there is exactly one.
 *
 * Provisional. `app_setting.hold_owner_default` chooses the default (`stage_assignee`, the seed, or
 * `decider`, the behaviour before FB-17); the offered people and their order are the same either way.
 * The server is unchanged: it takes whichever active user the decider names.
 */
export const HOLD_OWNER_DEFAULTS = ['stage_assignee', 'decider'] as const;
export type HoldOwnerDefault = (typeof HOLD_OWNER_DEFAULTS)[number];
export const HOLD_OWNER_DEFAULT_SEED: HoldOwnerDefault = 'stage_assignee';

/** Null / undefined → the seed. Throws INVALID_CONFIG on anything else that is not a known value. */
export function parseHoldOwnerDefault(input: unknown): HoldOwnerDefault {
  if (input === undefined || input === null) return HOLD_OWNER_DEFAULT_SEED;
  if ((HOLD_OWNER_DEFAULTS as readonly unknown[]).includes(input)) return input as HoldOwnerDefault;
  throw new DomainError(
    'INVALID_CONFIG',
    `hold_owner_default must be one of: ${HOLD_OWNER_DEFAULTS.join(', ')}`,
  );
}

export interface HoldOwnerPerson {
  id: string;
  displayName: string;
}

export type HoldOwnerKind = 'engineer' | 'scheduler' | 'pricer' | 'me' | 'kam';

export interface HoldOwnerChoice extends HoldOwnerPerson {
  kind: HoldOwnerKind;
  /** "The assigned engineer (Avery Stone)", "Me", "The KAM (Jordan Reyes)". */
  label: string;
}

export interface HoldOwnerInput {
  /** The stage the quote is held in. */
  stageKey: string;
  me: HoldOwnerPerson;
  kam: HoldOwnerPerson | null;
  engineer?: HoldOwnerPerson | null;
  scheduler?: HoldOwnerPerson | null;
  pricer?: HoldOwnerPerson | null;
  defaultTo?: HoldOwnerDefault;
}

const ASSIGNEE_LABEL: Record<Exclude<HoldOwnerKind, 'me' | 'kam'>, string> = {
  engineer: 'The assigned engineer',
  scheduler: 'The production scheduler',
  pricer: 'The assigned pricer',
};

/**
 * Who the decider can name as the hold owner without searching, in order: the stage's assignees (the
 * engineer and the production scheduler in Engineering, the pricer in Quoting), then "Me", then the KAM.
 * A person is listed once (an assignee who is the decider is "Me"). The default is the stage's assignee
 * when there is exactly one, otherwise "Me".
 */
export function holdOwnerChoices(input: HoldOwnerInput): {
  choices: HoldOwnerChoice[];
  defaultChoice: HoldOwnerChoice;
} {
  const me: HoldOwnerChoice = { ...input.me, kind: 'me', label: 'Me' };
  const candidates: [Exclude<HoldOwnerKind, 'me' | 'kam'>, HoldOwnerPerson | null | undefined][] =
    input.stageKey === ENG_QUEUE_STAGE_KEY
      ? [
          ['engineer', input.engineer],
          ['scheduler', input.scheduler],
        ]
      : input.stageKey === PRICING_QUEUE_STAGE_KEY
        ? [['pricer', input.pricer]]
        : [];
  const assignees: HoldOwnerChoice[] = [];
  for (const [kind, person] of candidates) {
    if (!person || person.id === me.id || assignees.some((a) => a.id === person.id)) continue;
    assignees.push({
      ...person,
      kind,
      label: `${ASSIGNEE_LABEL[kind]} (${person.displayName})`,
    });
  }
  const kam =
    input.kam && input.kam.id !== me.id && !assignees.some((a) => a.id === input.kam!.id)
      ? [{ ...input.kam, kind: 'kam' as const, label: `The KAM (${input.kam.displayName})` }]
      : [];
  const defaultTo = input.defaultTo ?? HOLD_OWNER_DEFAULT_SEED;
  return {
    choices: [...assignees, me, ...kam],
    defaultChoice: defaultTo === 'stage_assignee' && assignees.length === 1 ? assignees[0]! : me,
  };
}
