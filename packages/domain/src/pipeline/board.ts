/**
 * B-14 pipeline board (F-07): which kanban columns a card may be dropped on, for this actor, right now.
 *
 * The board never decides anything itself. A drop only opens the gate-decision dialog with the matching
 * outcome preselected; the decision then goes through the generic gate route, where `evaluateTransition`
 * is the authority. The input is the domain's `availableActions` for the quote and actor (gate in the
 * quote's stage, decider permission, segregation, approver tier), so the board can't offer a move the
 * engine would refuse for those reasons.
 */

/** The parts of an available gate action the board needs (an `AvailableAction` or its DTO fits). */
export interface BoardActionInput {
  gateKey: string;
  gateLabel: string;
  outcomeKey: string;
  outcomeLabel: string;
  targetStageKeys: readonly string[];
  nextStatus: 'active' | 'on_hold' | 'closed';
}

/** One way to move a card to another column: the gate outcome that does it. */
export interface BoardMove {
  targetStageKey: string;
  gateKey: string;
  gateLabel: string;
  outcomeKey: string;
  outcomeLabel: string;
  /** The move closes the quote (a terminal stage). */
  closes: boolean;
}

/** The collapsed "Closed (n)" lane: one drop target standing for every terminal stage. */
export const CLOSED_LANE_KEY = '__closed__';

/**
 * Every column move the actions allow, in the actions' order (config order: the forward outcome first).
 * Holds keep the quote in its stage, so they are not moves; nor is a target equal to the current stage.
 */
export function boardMoves(
  actions: readonly BoardActionInput[],
  fromStageKey: string,
): BoardMove[] {
  const moves: BoardMove[] = [];
  for (const a of actions) {
    if (a.nextStatus === 'on_hold') continue;
    for (const target of a.targetStageKeys) {
      if (target === fromStageKey) continue;
      moves.push({
        targetStageKey: target,
        gateKey: a.gateKey,
        gateLabel: a.gateLabel,
        outcomeKey: a.outcomeKey,
        outcomeLabel: a.outcomeLabel,
        closes: a.nextStatus === 'closed',
      });
    }
  }
  return moves;
}

/**
 * The droppable columns: stage key → the moves into it, the first being the one the dialog preselects.
 * Terminal stages are also reachable through the collapsed lane (`CLOSED_LANE_KEY`).
 */
export function droppableColumns(
  moves: readonly BoardMove[],
  terminalStageKeys: readonly string[],
): Map<string, BoardMove[]> {
  const terminal = new Set(terminalStageKeys);
  const map = new Map<string, BoardMove[]>();
  const add = (key: string, move: BoardMove) => {
    const list = map.get(key);
    if (list) list.push(move);
    else map.set(key, [move]);
  };
  for (const m of moves) {
    add(m.targetStageKey, m);
    if (m.closes || terminal.has(m.targetStageKey)) add(CLOSED_LANE_KEY, m);
  }
  return map;
}

/** What a drop on `columnKey` opens: the gate, the outcome to preselect (when unambiguous) and target. */
export interface DropPlan {
  gateKey: string;
  /** Preselected outcome; null when several closing outcomes compete on the collapsed lane. */
  outcomeKey: string | null;
  /** The target stage to preselect (an outcome with more than one target, e.g. G4 Return). */
  targetStageKey: string | null;
}

export function planDrop(
  moves: readonly BoardMove[],
  terminalStageKeys: readonly string[],
  columnKey: string,
): DropPlan | null {
  const candidates = droppableColumns(moves, terminalStageKeys).get(columnKey);
  const first = candidates?.[0];
  if (!candidates || !first) return null;
  if (columnKey === CLOSED_LANE_KEY) {
    const outcomes = new Set(candidates.map((m) => `${m.gateKey}:${m.outcomeKey}`));
    return outcomes.size === 1
      ? {
          gateKey: first.gateKey,
          outcomeKey: first.outcomeKey,
          targetStageKey: first.targetStageKey,
        }
      : { gateKey: first.gateKey, outcomeKey: null, targetStageKey: null };
  }
  return { gateKey: first.gateKey, outcomeKey: first.outcomeKey, targetStageKey: columnKey };
}

export interface DropDenialInput {
  fromStageKey: string;
  toColumnKey: string;
  status: string;
  moves: readonly BoardMove[];
  terminalStageKeys: readonly string[];
  /** The gate deciding the card's current stage (from config), if any. */
  gate: { key: string; label: string; enabled: boolean } | null;
  stageLabel: (key: string) => string;
}

/**
 * Why a drop is not allowed, in words for the tooltip / live region; null when it is allowed or is a
 * no-op (dropping back on its own column).
 */
export function dropDenialReason(input: DropDenialInput): string | null {
  const { fromStageKey, toColumnKey, moves, gate, stageLabel } = input;
  if (toColumnKey === fromStageKey) return null;
  if (droppableColumns(moves, input.terminalStageKeys).has(toColumnKey)) return null;
  const to = toColumnKey === CLOSED_LANE_KEY ? 'Closed' : stageLabel(toColumnKey);
  const from = stageLabel(fromStageKey);
  if (input.status === 'closed') return 'This quote is closed. Closed quotes don’t move.';
  if (!gate || !gate.enabled) return `Nothing moves a quote from ${from} on the board.`;
  if (moves.length === 0) {
    return `You can’t decide “${gate.label}” (${gate.key}) on this quote, so you can’t move it out of ${from}.`;
  }
  const options = [...new Set(moves.map((m) => stageLabel(m.targetStageKey)))].join(', ');
  return `No “${gate.label}” outcome moves a quote from ${from} to ${to}. You can move it to: ${options}.`;
}
