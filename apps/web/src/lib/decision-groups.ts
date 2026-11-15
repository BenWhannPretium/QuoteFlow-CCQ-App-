import type { AvailableGateAction, OutcomeGroup } from '@ccq/contracts';

/**
 * FB-17 (W13-23, W13-24; walkthrough 2026-11-13): the decision dialog offers four plain choices, in this
 * order: Advance, Send back to…, Hold, Stop. Which choice an outcome sits under is config
 * (`gate_outcome_definition.outcome_group`, on each available action as `outcomeGroup`), never read from
 * the outcome's key. Outcome keys and transitions are unchanged.
 */
export const DECISION_GROUPS = ['advance', 'send_back', 'hold', 'stop'] as const;
export type DecisionGroup = (typeof DECISION_GROUPS)[number];

/** The words the decider reads for each choice. */
export const DECISION_GROUP_LABELS: Record<DecisionGroup, string> = {
  advance: 'Advance',
  send_back: 'Send back to…',
  hold: 'Hold',
  stop: 'Stop',
};

type Grouped = Pick<AvailableGateAction, 'outcomeKey' | 'outcomeLabel' | 'outcomeGroup'>;

const isDecisionGroup = (group: OutcomeGroup | null | undefined): group is DecisionGroup =>
  !!group && (DECISION_GROUPS as readonly string[]).includes(group);

/**
 * Whether the dialog shows the four choices. Only when every offered outcome sits under one of them: a
 * gate with customer outcomes (G5: Awarded, In negotiation, Lost, Expired, Re-quote) or with an outcome
 * that has no group keeps the flat list it had before FB-17.
 */
export function showsDecisionGroups(actions: readonly Pick<Grouped, 'outcomeGroup'>[]): boolean {
  return actions.length > 0 && actions.every((a) => isDecisionGroup(a.outcomeGroup));
}

/** The offered outcomes under each of the four choices, in config order; empty choices are left out. */
export function groupDecisions<T extends Pick<Grouped, 'outcomeGroup'>>(
  actions: readonly T[],
): { group: DecisionGroup; label: string; actions: T[] }[] {
  return DECISION_GROUPS.map((group) => ({
    group,
    label: DECISION_GROUP_LABELS[group],
    actions: actions.filter((a) => a.outcomeGroup === group),
  })).filter((g) => g.actions.length > 0);
}

const SEND_BACK_PREFIX = /^send back to\s+/i;

/**
 * Where a send-back goes, for the "Send to" list: the outcome's label without its leading "Send back
 * to" ("Send back to the KAM (fix the intake)" → "The KAM (fix the intake)"). A label an Admin worded
 * differently is shown as it is.
 */
export function sendBackDestination(outcomeLabel: string): string {
  const label = outcomeLabel.trim();
  const rest = label.replace(SEND_BACK_PREFIX, '');
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : label;
}

export interface SendBackOption {
  /** The `<option>` value: the outcome key, with the target stage when the outcome has several. */
  value: string;
  outcomeKey: string;
  /** Set when the outcome lets the decider pick between stages (G4 Return, G6 Re-quote). */
  targetStageKey: string | null;
  label: string;
}

export const sendBackValue = (outcomeKey: string, targetStageKey?: string | null): string =>
  targetStageKey ? `${outcomeKey}>${targetStageKey}` : outcomeKey;

/**
 * The "Send to" options: one per send-back outcome, named by where the quote goes. An outcome whose
 * transition offers several stages (G4 Return: Quoting or Engineering) becomes one option per stage,
 * named by the stage, so the destination is picked once, in one list.
 */
export function sendBackOptions(
  actions: readonly (Grouped & Pick<AvailableGateAction, 'targetStageKeys'>)[],
  stageName: (stageKey: string) => string,
): SendBackOption[] {
  return actions
    .filter((a) => a.outcomeGroup === 'send_back')
    .flatMap((a): SendBackOption[] =>
      a.targetStageKeys.length > 1
        ? a.targetStageKeys.map((stageKey) => ({
            value: sendBackValue(a.outcomeKey, stageKey),
            outcomeKey: a.outcomeKey,
            targetStageKey: stageKey,
            label: stageName(stageKey),
          }))
        : [
            {
              value: sendBackValue(a.outcomeKey),
              outcomeKey: a.outcomeKey,
              targetStageKey: null,
              label: sendBackDestination(a.outcomeLabel),
            },
          ],
    );
}

type NoteHelpAction = Pick<AvailableGateAction, 'outcomeKey' | 'outcomeGroup' | 'closesAs'>;

/**
 * DR-engineering-10, DR-kam-sales-leader-16: what the required note should say. FB-17: a hold, a
 * send-back and a stop are told apart by the outcome's group (config). The other outcomes (an advance
 * with risk, the customer outcomes at G5, an outcome with no group) keep the wording they had.
 */
export function noteHelp(action: NoteHelpAction): string {
  switch (action.outcomeGroup) {
    case 'hold':
      return 'Say what you are waiting for, and from whom.';
    case 'send_back':
      return 'Say what needs to change, and where.';
    case 'stop':
      // "Not CCQ work" closes the quote as redirected: the note says where the work goes.
      return action.closesAs === 'redirected'
        ? 'Say where the work goes instead, and why.'
        : 'Say why it stops here.';
    default:
      return noteHelpByKey(action.outcomeKey);
  }
}

function noteHelpByKey(outcomeKey: string): string {
  if (/hold/.test(outcomeKey)) return 'Say what you are waiting for, and from whom.';
  if (/rework|return|requote/.test(outcomeKey)) return 'Say what needs to change, and where.';
  if (outcomeKey === 'recost') return 'Say what changed and needs costing again.';
  if (/redirect/.test(outcomeKey)) return 'Say where the work goes instead, and why.';
  if (/stop|decline|lost/.test(outcomeKey)) return 'Say why it stops here.';
  if (/expired/.test(outcomeKey)) return 'Say why it is expired now.';
  if (/risk/.test(outcomeKey)) return 'Say what the risk is and how it is covered.';
  if (/capital/.test(outcomeKey)) return 'Say what the capital is for.';
  return 'Say why this decision was made.';
}

/** The note's placeholder: a send-back says what to fix; other outcomes have none. */
export function notePlaceholder(
  action: Pick<AvailableGateAction, 'outcomeKey' | 'outcomeGroup'> | undefined,
): string | undefined {
  if (!action) return undefined;
  if (action.outcomeGroup === 'send_back') return 'What needs fixing?';
  // An outcome with no group (a config from before FB-17): as before.
  if (!action.outcomeGroup && /^rework(_kam)?$/.test(action.outcomeKey)) {
    return 'What should the KAM fix?';
  }
  return undefined;
}
