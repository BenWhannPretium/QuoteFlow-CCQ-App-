import { DomainError } from '../errors';

/**
 * FB-16 (W13-12, W13-13; Bailey Schmitt, Zachary Cairns, 2026-11-13): one "Process & machine type" pick,
 * filtered by plant.
 *
 * The engineer picks the plant, then one machine type from the ones that plant runs (Jim Zweifel's plant
 * x machine-type list, FB-13: each plant's `meta.machineTypes`). The process type is no longer picked:
 * the server derives it from the machine type through `app_setting.machine_type_process_map`, so every
 * reader of `process_type` (the G2 rule, the routing suggestion, the volume guardrails) keeps working
 * unchanged.
 *
 * The map is config (rule 4), provisional: Jim's approved `machine_type` rows are not edited to hold it,
 * and the process behind each non-forming machine type (DECO, PAD PRINTING, …) is a question for
 * Engineering (W13-W11), seeded `OTHER`.
 *
 * Pure: no I/O. The API loads the lists and the settings and passes them in.
 */

/** Machine type code (the `machine_type` list) → process type code (the `process_type` list). */
export type MachineTypeProcessMap = Readonly<Record<string, string>>;

/** The seed (provisional). Keys are Jim Zweifel's machine-type codes; values are process-type codes. */
export const MACHINE_TYPE_PROCESS_MAP_SEED: MachineTypeProcessMap = {
  EBM: 'EBM',
  IBM: 'IBM',
  ISBM: 'ISBM',
  RHB: 'RHB',
  'INJ-CAP': 'IMM',
  'INJ-PREFORM': 'IMM_PREFORM',
  'INJ-OTHER': 'IMM',
  // W13-W11: the process behind the non-forming machine types waits for Engineering (Jim Zweifel).
  DECO: 'OTHER',
  'PAD PRINTING': 'OTHER',
  PRINTING: 'OTHER',
  LAMINATION: 'OTHER',
  'DIE CUTTING': 'OTHER',
  STAMPING: 'OTHER',
  '12B': 'OTHER',
};

const isCode = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 40;

/** Null / undefined → the seed. A malformed value is an INVALID_CONFIG error (the Admin console shows it). */
export function parseMachineTypeProcessMap(input: unknown): MachineTypeProcessMap {
  if (input === undefined || input === null) return { ...MACHINE_TYPE_PROCESS_MAP_SEED };
  const bad = (msg: string) =>
    new DomainError('INVALID_CONFIG', `machine_type_process_map: ${msg}`);
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw bad('must be an object of machine type code → process type code');
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 200) throw bad('at most 200 machine types');
  const out: Record<string, string> = {};
  for (const [machineType, processType] of entries) {
    if (!isCode(machineType)) throw bad('every key must be a machine type code');
    if (!isCode(processType)) throw bad(`"${machineType}" needs a process type code`);
    out[machineType.trim()] = processType.trim();
  }
  return out;
}

/**
 * The cross-list check the Admin console runs before saving the map: every key an active machine type,
 * every value an active process type. (The parser cannot know the lists.)
 */
export function machineTypeProcessMapErrors(
  map: MachineTypeProcessMap,
  lists: { machineTypes: readonly string[]; processTypes: readonly string[] },
): DomainError[] {
  const errors: DomainError[] = [];
  for (const [machineType, processType] of Object.entries(map)) {
    if (!lists.machineTypes.includes(machineType)) {
      errors.push(
        new DomainError(
          'INVALID_CONFIG',
          `"${machineType}" is not an active machine type`,
          machineType,
        ),
      );
    }
    if (!lists.processTypes.includes(processType)) {
      errors.push(
        new DomainError(
          'INVALID_CONFIG',
          `"${processType}" (for ${machineType}) is not an active process type`,
          machineType,
        ),
      );
    }
  }
  return errors;
}

/** The process type a machine type stands for, or null when the map has no entry for it. */
export const processTypeForMachine = (
  map: MachineTypeProcessMap,
  machineType: string | null | undefined,
): string | null => (machineType ? (map[machineType] ?? null) : null);

/**
 * Does the stored pair fit the map? False for an old quote whose process type was picked by hand and
 * differs from what its machine type derives (it keeps its stored values and shows them read-only).
 * A review with no machine type, or a machine type the map does not know (a retired code), has nothing
 * to compare: true.
 */
export function pairFitsMap(
  map: MachineTypeProcessMap,
  pair: { processType: string | null | undefined; machineType: string | null | undefined },
): boolean {
  const derived = processTypeForMachine(map, pair.machineType);
  return derived === null || derived === (pair.processType ?? null);
}

// ── Plant × machine type ─────────────────────────────────────────────────────────────────────────

/** A value-list entry as the pickers see it (the `plant` list carries `meta.machineTypes`, FB-13). */
export interface PickListEntry {
  code: string;
  label: string;
  meta?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * The machine types a plant runs (`meta.machineTypes`, migration 0039), or null when the plant has no
 * such meta (a placeholder plant, or a plant an Admin added without one): then nothing is filtered or
 * checked for it.
 */
export function plantMachineTypes(plant: Pick<PickListEntry, 'meta'> | undefined): string[] | null {
  const raw = plant?.meta?.machineTypes;
  if (!Array.isArray(raw)) return null;
  return raw.filter((c): c is string => typeof c === 'string');
}

/**
 * The machine types to offer: the chosen plant's, in the list's own order. Every active machine type
 * when no plant is chosen yet, the plant is unknown, or it has no `meta.machineTypes`.
 */
export function machineTypesForPlant<T extends PickListEntry>(
  machineTypes: readonly T[],
  plants: readonly PickListEntry[],
  plantCode: string | null | undefined,
): T[] {
  const runs = plantCode ? plantMachineTypes(plants.find((p) => p.code === plantCode)) : null;
  return runs === null ? [...machineTypes] : machineTypes.filter((m) => runs.includes(m.code));
}

/**
 * The plants that run any of `machineTypeCodes` (the capacity row's Site for the solution's machine type;
 * the preform and blow plants of a two-step process). An empty list of codes offers every plant; a plant
 * with no `meta.machineTypes` is always offered (it cannot be judged).
 */
export function plantsRunning<T extends PickListEntry>(
  plants: readonly T[],
  machineTypeCodes: readonly string[],
): T[] {
  if (machineTypeCodes.length === 0) return [...plants];
  return plants.filter((p) => {
    const runs = plantMachineTypes(p);
    return runs === null || machineTypeCodes.some((c) => runs.includes(c));
  });
}

export type PlantMachineCheck =
  | { ok: true }
  | { ok: false; error: DomainError; plantLabel: string; machineLabel: string };

/**
 * The server check behind the filtered pick: a machine type the chosen plant does not run is refused,
 * with a field error on `machineType`. Not checked (ok) when either is missing, the plant has no
 * `meta.machineTypes`, or the machine type is not an active code (a retired code on an old quote).
 */
export function checkPlantRunsMachineType(input: {
  plantCode: string | null | undefined;
  machineType: string | null | undefined;
  plants: readonly PickListEntry[];
  /** Active machine types (label lookup, and "is this code still offered?"). */
  machineTypes: readonly PickListEntry[];
}): PlantMachineCheck {
  const { plantCode, machineType } = input;
  if (!plantCode || !machineType) return { ok: true };
  const plant = input.plants.find((p) => p.code === plantCode);
  const runs = plantMachineTypes(plant);
  const machine = input.machineTypes.find((m) => m.code === machineType);
  if (!plant || runs === null || !machine) return { ok: true };
  if (runs.includes(machineType)) return { ok: true };
  return {
    ok: false,
    plantLabel: plant.label,
    machineLabel: machine.label,
    error: new DomainError(
      'INVALID_VALUE',
      `${plant.label} does not run ${machine.label}; pick again`,
      'machineType',
    ),
  };
}

// ── Two-step plant pickers ───────────────────────────────────────────────────────────────────────

/**
 * `app_setting.two_step_plant_machine_types` (provisional): the machine types a plant must run to be
 * offered as the Preform plant or the Blow plant of a two-step process.
 */
export interface TwoStepPlantMachineTypes {
  preform: string[];
  blow: string[];
}

export const TWO_STEP_PLANT_MACHINE_TYPES_SEED: TwoStepPlantMachineTypes = {
  preform: ['INJ-PREFORM'],
  blow: ['RHB', 'ISBM'],
};

const isCodeList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 50 && v.every(isCode);

/** Null / undefined → the seed. Throws INVALID_CONFIG on a malformed value. */
export function parseTwoStepPlantMachineTypes(input: unknown): TwoStepPlantMachineTypes {
  if (input === undefined || input === null) {
    return {
      preform: [...TWO_STEP_PLANT_MACHINE_TYPES_SEED.preform],
      blow: [...TWO_STEP_PLANT_MACHINE_TYPES_SEED.blow],
    };
  }
  const v = input as Partial<Record<keyof TwoStepPlantMachineTypes, unknown>>;
  if (
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !isCodeList(v.preform) ||
    !isCodeList(v.blow)
  ) {
    throw new DomainError(
      'INVALID_CONFIG',
      'two_step_plant_machine_types must be { preform: [machine type codes], blow: [machine type codes] }',
    );
  }
  return { preform: v.preform.map((c) => c.trim()), blow: v.blow.map((c) => c.trim()) };
}

/** The Admin console's cross-list check: every code an active machine type. */
export function twoStepPlantMachineTypeErrors(
  setting: TwoStepPlantMachineTypes,
  activeMachineTypes: readonly string[],
): DomainError[] {
  return (['preform', 'blow'] as const).flatMap((step) =>
    setting[step]
      .filter((code) => !activeMachineTypes.includes(code))
      .map(
        (code) =>
          new DomainError('INVALID_CONFIG', `"${code}" (${step}) is not an active machine type`),
      ),
  );
}

// ── The solution pick as the server stores it ────────────────────────────────────────────────────

export interface SolutionPick {
  plantCode: string | null;
  machineType: string | null;
  processType: string | null;
}

export type SolutionPickPlan =
  | { ok: true; pick: SolutionPick }
  | { ok: false; errors: DomainError[] };

/**
 * What the Engineering Review stores for the plant, the machine type and the (derived) process type.
 *
 * - `sent` holds only the keys the caller sent (`undefined` = not sent, `null` = cleared).
 * - A machine type that **changes** sets the process type from the map; clearing it clears the process
 *   type. A machine type with no map entry is refused: the Admin adds it to the map first.
 * - A machine type that does not change leaves the stored process type alone, so an old quote whose pair
 *   does not fit the map keeps its values until someone picks again.
 * - A process type sent on its own (no machine-type change) is stored as sent: an older client, and the
 *   quotes that have a process but no machine type yet.
 * - The plant check runs when the plant or the machine type changes (`checkPlantRunsMachineType`).
 */
export function planSolutionPick(input: {
  stored: SolutionPick;
  sent: Partial<SolutionPick>;
  map: MachineTypeProcessMap;
  plants: readonly PickListEntry[];
  machineTypes: readonly PickListEntry[];
}): SolutionPickPlan {
  const { stored, sent, map } = input;
  const plantCode = sent.plantCode === undefined ? stored.plantCode : sent.plantCode;
  const machineType = sent.machineType === undefined ? stored.machineType : sent.machineType;
  const machineChanged = machineType !== stored.machineType;
  const plantChanged = plantCode !== stored.plantCode;
  const errors: DomainError[] = [];

  let processType = sent.processType === undefined ? stored.processType : sent.processType;
  if (machineChanged) {
    if (machineType === null) {
      processType = null;
    } else {
      const derived = processTypeForMachine(map, machineType);
      if (derived === null) {
        errors.push(
          new DomainError(
            'INVALID_CONFIG',
            `"${machineType}" has no process type yet: an Admin adds it under Settings → Engineering (machine type to process type)`,
            'machineType',
          ),
        );
      } else {
        processType = derived;
      }
    }
  }

  if (machineChanged || plantChanged) {
    const check = checkPlantRunsMachineType({
      plantCode,
      machineType,
      plants: input.plants,
      machineTypes: input.machineTypes,
    });
    if (!check.ok) errors.push(check.error);
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, pick: { plantCode, machineType, processType } };
}
