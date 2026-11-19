import { PACK_OUT_UNIT_FIELDS, type PackOutUnitField } from './pack-out';
import { DomainError } from '../errors';

/**
 * FB-23 (N18-03 to N18-10, N18-14; Jim Zweifel, 2026-11-18; Ben's decisions D4, D5, D6): the engineering
 * cost estimate (Jim's "ECE Summary"), one column per item.
 *
 * - **Cost lines** (`app_setting.engineering_cost_lines`, provisional): tooling lines Engineering fills in and
 *   new-line equipment lines Operations would. Each line says which processes show it and whether the
 *   customer funds it. Blank (or $0) = not used.
 * - **Totals**: project total = every line; customer funded = the lines marked `customerFunded`; net cost to
 *   Pretium = project total − customer funded; **customer tooling price** = customer funded × (1 + markup %),
 *   the markup being the one noted on the item, else `tooling_markup_default_pct` (seed 0: D5, no markup
 *   unless noted).
 * - **Pack-out calculation**: containers per pallet, pieces per pallet, pieces per trailer.
 * - **Labor**: packers + operators per line.
 *
 * Money is added in whole cents and the markup in basis points, so totals are exact (no float drift).
 * Pure: no I/O.
 */

// ── Limits (the zod request schemas and the database checks use the same numbers) ─────────────────

/** A cost amount is 0 to this (USD, two decimals). */
export const COST_AMOUNT_MAX_USD = 999_999_999.99;
export const MOLD_LEAD_TIME_MAX_LENGTH = 40;
export const COST_LINE_DESCRIPTION_MAX_LENGTH = 120;
/** Lower blow molds for freight: 1 to this. */
export const COST_LINE_QUANTITY_MAX = 99;
/** Packers / operators per line: 0 to this (fractional: 0.68 means one packer covers more than one line). */
export const LABOR_PER_LINE_MAX = 99.99;
export const MARKUP_PCT_MAX = 100;
export const PACK_CONTAINER_ITEM_NO_MAX_LENGTH = 40;
export const PACK_CONTAINER_DESCRIPTION_MAX_LENGTH = 120;
export const PALLET_BUILD_HEIGHT_MAX_LENGTH = 20;
export const SPECIAL_PACKAGING_NOTE_MAX_LENGTH = 300;
export const RETURNABLE_DUNNAGE_DESCRIPTION_MAX_LENGTH = 200;
export const CONTAINERS_PER_LAYER_MAX = 9_999;
export const LAYERS_PER_PALLET_MAX = 999;
export const PALLETS_PER_TRAILER_MAX = 999;

// ── Config: the cost lines ────────────────────────────────────────────────────────────────────────

export const COST_LINE_GROUPS = ['tooling', 'new_line'] as const;
export type CostLineGroup = (typeof COST_LINE_GROUPS)[number];
/** A line the form can pre-fill from `engineering_cost_defaults`. */
export const COST_LINE_PREFILLS = ['freight', 'start_up'] as const;
export type CostLinePrefill = (typeof COST_LINE_PREFILLS)[number];

export interface CostLineDef {
  /** Stable key stored on `eng_cost_line.line_key`. */
  key: string;
  label: string;
  group: CostLineGroup;
  /** Process-type codes that show the line, or `all`. */
  processes: string[] | 'all';
  /** Counted in "customer funded" (passed on to the customer). */
  customerFunded: boolean;
  /** The line needs a description when it has an amount ("Other"). */
  needsDescription: boolean;
  /** Freight (complete mold / lower blow molds × n) or start-up assistance, pre-filled from the defaults. */
  prefill: CostLinePrefill | null;
}

const line = (
  key: string,
  label: string,
  group: CostLineGroup,
  extra: Partial<Omit<CostLineDef, 'key' | 'label' | 'group'>> = {},
): CostLineDef => ({
  key,
  label,
  group,
  processes: 'all',
  customerFunded: false,
  needsDescription: false,
  prefill: null,
  ...extra,
});

/**
 * The seed (provisional). The ECE Summary's lines in its order, plus "Tariffs / duties" (D4). Customer
 * funded: Molds, Freight and Start-up as the sheet adds them, and Tariffs / duties (D4). Which processes
 * show a line is from the record where it says (perso parts: two-stage molds, RHB; head tooling: extrusion
 * blow, EBM); every other line shows for every process until Jim says otherwise.
 */
export const ENGINEERING_COST_LINES_SEED: readonly CostLineDef[] = [
  line('molds', 'Molds', 'tooling', { customerFunded: true }),
  line('unit_mold', 'Unit mold', 'tooling'),
  line('perso_parts', 'Perso parts', 'tooling', { processes: ['RHB'] }),
  line('head_tooling', 'Head tooling', 'tooling', { processes: ['EBM'] }),
  line('freight', 'Freight', 'tooling', { customerFunded: true, prefill: 'freight' }),
  line('start_up', 'Start-up assistance (3 days)', 'tooling', {
    customerFunded: true,
    prefill: 'start_up',
  }),
  line('tariffs', 'Tariffs / duties', 'tooling', { customerFunded: true }),
  line('other', 'Other', 'tooling', { needsDescription: true }),
  line('blow_molders', 'Blow molders', 'new_line'),
  line('resin_handling', 'Resin handling equipment', 'new_line'),
  line('packaging_inspection', 'Packaging & inspection equipment', 'new_line'),
  line('support_equipment', 'Support equipment', 'new_line'),
  line('misc_equipment', 'Misc. equipment', 'new_line'),
];

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const badConfig = (key: string, msg: string) => new DomainError('INVALID_CONFIG', `${key}: ${msg}`);

/** `engineering_cost_lines`: null / undefined → the seed. Throws INVALID_CONFIG on a malformed value. */
export function parseEngineeringCostLines(input: unknown): CostLineDef[] {
  if (input === undefined || input === null)
    return ENGINEERING_COST_LINES_SEED.map((l) => ({ ...l }));
  const bad = (msg: string) => badConfig('engineering_cost_lines', msg);
  if (!Array.isArray(input) || input.length === 0 || input.length > 40) {
    throw bad('must be a list of 1 to 40 lines');
  }
  const seen = new Set<string>();
  const prefills = new Set<string>();
  return input.map((raw, i): CostLineDef => {
    const at = `line ${i + 1}`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      throw bad(`${at} must be an object`);
    const v = raw as Record<string, unknown>;
    if (typeof v.key !== 'string' || !KEY.test(v.key)) {
      throw bad(`${at}: "key" must be lower-case letters, digits or "_" (up to 40)`);
    }
    if (seen.has(v.key)) throw bad(`${at}: the key "${v.key}" is used twice`);
    seen.add(v.key);
    if (typeof v.label !== 'string' || !v.label.trim() || v.label.trim().length > 80) {
      throw bad(`${at}: "label" must be 1 to 80 characters`);
    }
    if (!(COST_LINE_GROUPS as readonly unknown[]).includes(v.group)) {
      throw bad(`${at}: "group" must be one of ${COST_LINE_GROUPS.join(', ')}`);
    }
    let processes: string[] | 'all';
    if (v.processes === 'all' || v.processes === undefined) processes = 'all';
    else if (
      Array.isArray(v.processes) &&
      v.processes.length > 0 &&
      v.processes.length <= 20 &&
      v.processes.every((p) => typeof p === 'string' && p.trim().length > 0 && p.length <= 40)
    ) {
      processes = (v.processes as string[]).map((p) => p.trim());
    } else throw bad(`${at}: "processes" must be "all" or a list of process-type codes`);
    if (typeof v.customerFunded !== 'boolean')
      throw bad(`${at}: "customerFunded" must be true or false`);
    if (v.needsDescription !== undefined && typeof v.needsDescription !== 'boolean') {
      throw bad(`${at}: "needsDescription" must be true or false`);
    }
    let prefill: CostLinePrefill | null = null;
    if (v.prefill !== undefined && v.prefill !== null) {
      if (!(COST_LINE_PREFILLS as readonly unknown[]).includes(v.prefill)) {
        throw bad(`${at}: "prefill" must be one of ${COST_LINE_PREFILLS.join(', ')}`);
      }
      prefill = v.prefill as CostLinePrefill;
      if (prefills.has(prefill)) throw bad(`${at}: only one line may pre-fill ${prefill}`);
      prefills.add(prefill);
    }
    return {
      key: v.key,
      label: v.label.trim(),
      group: v.group as CostLineGroup,
      processes,
      customerFunded: v.customerFunded,
      needsDescription: v.needsDescription === true,
      prefill,
    };
  });
}

// ── Config: the defaults and the markup ───────────────────────────────────────────────────────────

export interface EngineeringCostDefaults {
  /** Freight for a complete mold. */
  freightCompleteMoldUsd: number;
  /** Freight for each lower blow mold. */
  freightLowerBlowMoldUsd: number;
  /** Start-up assistance, 3 days. */
  startUpAssistanceUsd: number;
}

export const ENGINEERING_COST_DEFAULTS_SEED: EngineeringCostDefaults = {
  freightCompleteMoldUsd: 1500,
  freightLowerBlowMoldUsd: 750,
  startUpAssistanceUsd: 5500,
};

/** Is `n` a USD amount from 0 to the cap with at most two decimals? */
export function isUsdAmount(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    n >= 0 &&
    n <= COST_AMOUNT_MAX_USD &&
    Math.abs(Math.round(n * 100) - n * 100) < 1e-6
  );
}

/** `engineering_cost_defaults`: null / undefined → the seed. */
export function parseEngineeringCostDefaults(input: unknown): EngineeringCostDefaults {
  if (input === undefined || input === null) return { ...ENGINEERING_COST_DEFAULTS_SEED };
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw badConfig('engineering_cost_defaults', 'must be an object');
  }
  const v = input as Record<string, unknown>;
  const out = {} as EngineeringCostDefaults;
  for (const k of Object.keys(
    ENGINEERING_COST_DEFAULTS_SEED,
  ) as (keyof EngineeringCostDefaults)[]) {
    if (!isUsdAmount(v[k])) {
      throw badConfig('engineering_cost_defaults', `"${k}" must be a USD amount from 0, in cents`);
    }
    out[k] = v[k];
  }
  return out;
}

export const TOOLING_MARKUP_DEFAULT_PCT_SEED = 0;

/** Is `n` a percentage from 0 to 100 with at most two decimals? */
export function isMarkupPct(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    n >= 0 &&
    n <= MARKUP_PCT_MAX &&
    Math.abs(Math.round(n * 100) - n * 100) < 1e-6
  );
}

/** `tooling_markup_default_pct`: null / undefined → 0 (D5). */
export function parseToolingMarkupDefaultPct(input: unknown): number {
  if (input === undefined || input === null) return TOOLING_MARKUP_DEFAULT_PCT_SEED;
  if (!isMarkupPct(input)) {
    throw badConfig(
      'tooling_markup_default_pct',
      'must be a percentage from 0 to 100 (two decimals)',
    );
  }
  return input;
}

// ── Which lines an item shows ─────────────────────────────────────────────────────────────────────

export interface ItemCostLineDef extends CostLineDef {
  /** False when the line does not usually apply to the item's process (shown because it holds a value). */
  usual: boolean;
}

/**
 * The lines of a group the item shows, in config order: the ones for its process (every line while no
 * process is chosen), and any line that already holds a value, so nothing counted in a total is hidden.
 */
export function costLinesForItem(
  defs: readonly CostLineDef[],
  group: CostLineGroup,
  processType: string | null,
  storedKeys: ReadonlySet<string> = new Set(),
): ItemCostLineDef[] {
  return defs
    .filter((d) => d.group === group)
    .flatMap((d) => {
      const usual =
        d.processes === 'all' || processType === null || d.processes.includes(processType);
      return usual || storedKeys.has(d.key) ? [{ ...d, usual }] : [];
    });
}

/** Freight pre-filled from the defaults: a complete mold, or n lower blow molds. */
export function freightPrefill(
  defaults: EngineeringCostDefaults,
  kind: 'complete' | 'lower',
  lowerMolds = 1,
): number {
  if (kind === 'complete') return defaults.freightCompleteMoldUsd;
  return fromCents(toCents(defaults.freightLowerBlowMoldUsd) * Math.max(1, Math.trunc(lowerMolds)));
}

// ── Totals (exact cents) ──────────────────────────────────────────────────────────────────────────

export const toCents = (usd: number): number => Math.round(usd * 100);
export const fromCents = (cents: number): number => cents / 100;

/** `num / den` rounded half up, for non-negative integers (exact; no float division error). */
function divRoundHalfUp(num: number, den: number): number {
  let q = Math.floor(num / den);
  let r = num - q * den;
  if (r < 0) {
    q -= 1;
    r += den;
  } else if (r >= den) {
    q += 1;
    r -= den;
  }
  return r * 2 >= den ? q + 1 : q;
}

/** `cents × (1 + pct / 100)`, rounded to the cent. */
export function applyMarkup(cents: number, pct: number): number {
  const bp = Math.round(pct * 100);
  return divRoundHalfUp(cents * (10_000 + bp), 10_000);
}

export interface CostLineValue {
  lineKey: string;
  amountUsd: number;
}

export interface CostTotals {
  projectTotalUsd: number;
  customerFundedUsd: number;
  /** Project total − customer funded. */
  netCostUsd: number;
  /** The markup applied: the item's noted markup, else the default (0 by D5). */
  markupPct: number;
  /** The item has its own markup noted (blank = the default). */
  markupNoted: boolean;
  /** Customer funded × (1 + markup %), to the cent. */
  customerToolingPriceUsd: number;
}

export interface MarkupInput {
  /** The item's `tooling_markup_pct` (null = none noted). */
  notedPct: number | null;
  /** `tooling_markup_default_pct`. */
  defaultPct: number;
}

/**
 * One item's totals, or null when no line has an amount. A line whose key is no longer in the config
 * still counts in the project total (never customer funded), so a removed line cannot make money vanish.
 */
export function costTotals(
  lines: readonly CostLineValue[],
  defs: readonly CostLineDef[],
  markup: MarkupInput,
): CostTotals | null {
  if (lines.length === 0) return null;
  const funded = new Set(defs.filter((d) => d.customerFunded).map((d) => d.key));
  let total = 0;
  let customer = 0;
  for (const l of lines) {
    const c = toCents(l.amountUsd);
    total += c;
    if (funded.has(l.lineKey)) customer += c;
  }
  const markupNoted = markup.notedPct !== null;
  const markupPct = markup.notedPct ?? markup.defaultPct;
  return {
    projectTotalUsd: fromCents(total),
    customerFundedUsd: fromCents(customer),
    netCostUsd: fromCents(total - customer),
    markupPct,
    markupNoted,
    customerToolingPriceUsd: fromCents(applyMarkup(customer, markupPct)),
  };
}

/** The quote's totals: the sum over items (null when no item has a line). */
export type CostTotalsSum = Omit<CostTotals, 'markupPct' | 'markupNoted'>;

export function sumCostTotals(items: readonly (CostTotalsSum | null)[]): CostTotalsSum | null {
  const present = items.filter((t): t is CostTotalsSum => t !== null);
  if (present.length === 0) return null;
  const sum = (
    k: 'projectTotalUsd' | 'customerFundedUsd' | 'netCostUsd' | 'customerToolingPriceUsd',
  ) => fromCents(present.reduce((s, t) => s + toCents(t[k]), 0));
  return {
    projectTotalUsd: sum('projectTotalUsd'),
    customerFundedUsd: sum('customerFundedUsd'),
    netCostUsd: sum('netCostUsd'),
    customerToolingPriceUsd: sum('customerToolingPriceUsd'),
  };
}

// ── Cost lines sent on a save ────────────────────────────────────────────────────────────────────

export interface CostLineInput {
  lineKey: string;
  /** Null = blank: the line is removed. */
  amountUsd: number | null;
  description?: string | null | undefined;
  quantity?: number | null | undefined;
}

export interface NormalizedCostLine {
  lineKey: string;
  amountUsd: number | null;
  description: string | null;
  quantity: number | null;
}

/**
 * The lines as they will be stored: description trimmed (blank = none), a quantity only on the freight
 * line, and a blank line's description and quantity dropped. Pure.
 */
export function normalizeCostLines(
  lines: readonly CostLineInput[],
  defs: readonly CostLineDef[],
): NormalizedCostLine[] {
  return lines.map((l) => {
    const def = defs.find((d) => d.key === l.lineKey);
    const blank = l.amountUsd === null;
    const description = l.description?.trim() ? l.description.trim() : null;
    return {
      lineKey: l.lineKey,
      amountUsd: l.amountUsd,
      description: blank ? null : description,
      quantity: blank || def?.prefill !== 'freight' ? null : (l.quantity ?? null),
    };
  });
}

/** Save errors for the lines sent (`field` is `costLines/<index>/<key>`). */
export function validateCostLines(
  lines: readonly NormalizedCostLine[],
  defs: readonly CostLineDef[],
): DomainError[] {
  const errors: DomainError[] = [];
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    const at = (k: string) => `costLines/${i}/${k}`;
    const def = defs.find((d) => d.key === l.lineKey);
    if (!def) {
      errors.push(
        new DomainError('INVALID_VALUE', `"${l.lineKey}" is not a cost line`, at('lineKey')),
      );
      return;
    }
    if (seen.has(l.lineKey)) {
      errors.push(new DomainError('INVALID_VALUE', `${def.label} is sent twice`, at('lineKey')));
    }
    seen.add(l.lineKey);
    if (l.amountUsd === null) return;
    if (!isUsdAmount(l.amountUsd)) {
      errors.push(
        new DomainError(
          'INVALID_VALUE',
          `${def.label}: enter an amount from $0 to $${COST_AMOUNT_MAX_USD.toLocaleString('en-US')}, in cents`,
          at('amountUsd'),
        ),
      );
    }
    if (def.needsDescription && !l.description) {
      errors.push(
        new DomainError(
          'MISSING_FIELD',
          `${def.label}: say what the cost is for`,
          at('description'),
        ),
      );
    }
    if ((l.description?.length ?? 0) > COST_LINE_DESCRIPTION_MAX_LENGTH) {
      errors.push(
        new DomainError(
          'INVALID_VALUE',
          `${def.label}: keep the description to ${COST_LINE_DESCRIPTION_MAX_LENGTH} characters`,
          at('description'),
        ),
      );
    }
    if (
      l.quantity !== null &&
      (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > COST_LINE_QUANTITY_MAX)
    ) {
      errors.push(
        new DomainError(
          'INVALID_VALUE',
          `${def.label}: the number of molds is a whole number from 1 to ${COST_LINE_QUANTITY_MAX}`,
          at('quantity'),
        ),
      );
    }
  });
  return errors;
}

// ── Pack-out ──────────────────────────────────────────────────────────────────────────────────────

export interface PackOutCalcInput {
  /** The count the method uses (`value_list.pack_method.meta.countField`); null: no container (bulk). */
  countField: PackOutUnitField | null;
  unitsPerBag: number | null;
  unitsPerTray: number | null;
  unitsPerCase: number | null;
  containersPerLayer: number | null;
  layersPerPallet: number | null;
  palletsPerTrailer: number | null;
  /** Pieces per pallet as typed (used when it is not calculated). */
  unitsPerPallet: number | null;
}

export interface PackOutFigures {
  piecesPerContainer: number | null;
  /** Per layer × layers. */
  containersPerPallet: number | null;
  /** Pieces per container × containers per pallet when calculated, else as typed. */
  piecesPerPallet: number | null;
  /** True when per layer and layers are both given: pieces per pallet is the calculation (read-only). */
  piecesPerPalletCalculated: boolean;
  /** Pieces per pallet × pallets per trailer. */
  piecesPerTrailer: number | null;
}

const given = (n: number | null | undefined): n is number => typeof n === 'number' && n > 0;

/**
 * Jim's pack-out calculation. A missing input leaves the figure it feeds blank (never 0). When per layer and
 * layers are both given, pieces per pallet is calculated (blank while the method's count is missing);
 * otherwise it is what was typed.
 */
export function packOutFigures(input: PackOutCalcInput): PackOutFigures {
  const piecesPerContainer = input.countField ? (input[input.countField] ?? null) : null;
  const containersPerPallet =
    given(input.containersPerLayer) && given(input.layersPerPallet)
      ? input.containersPerLayer * input.layersPerPallet
      : null;
  const piecesPerPalletCalculated = containersPerPallet !== null;
  const piecesPerPallet = piecesPerPalletCalculated
    ? given(piecesPerContainer)
      ? piecesPerContainer * containersPerPallet
      : null
    : (input.unitsPerPallet ?? null);
  const piecesPerTrailer =
    given(piecesPerPallet) && given(input.palletsPerTrailer)
      ? piecesPerPallet * input.palletsPerTrailer
      : null;
  return {
    piecesPerContainer: given(piecesPerContainer) ? piecesPerContainer : null,
    containersPerPallet,
    piecesPerPallet,
    piecesPerPalletCalculated,
    piecesPerTrailer,
  };
}

/** A `pack_method` entry's count field (`meta.countField`), or null when it has none or names no count. */
export function packMethodCountField(meta: unknown): PackOutUnitField | null {
  const field = (meta as { countField?: unknown } | null)?.countField;
  return (PACK_OUT_UNIT_FIELDS as readonly unknown[]).includes(field)
    ? (field as PackOutUnitField)
    : null;
}

/**
 * With a method chosen, only its count is kept (the other counts are cleared, as unticking two-step clears
 * its details), so a hidden count never reaches Pricing and `pack_out_rule` keeps working. No method: the
 * counts are left as they are (an older quote).
 */
export function normalizePackOutCounts<T extends Record<PackOutUnitField, number | null>>(
  values: T,
  method: string | null,
  countField: PackOutUnitField | null,
): T {
  if (method === null) return values;
  const out = { ...values };
  for (const f of PACK_OUT_UNIT_FIELDS) if (f !== countField) out[f] = null as T[typeof f];
  return out;
}

// ── Labor ─────────────────────────────────────────────────────────────────────────────────────────

/** Packers + operators per line (blank when both are blank). */
export function laborTotalPerLine(packers: number | null, operators: number | null): number | null {
  if (packers === null && operators === null) return null;
  return fromCents(toCents(packers ?? 0) + toCents(operators ?? 0));
}

// ── The per-item fields' checks (the route's zod schema checks the same; the domain is the rule) ──

export interface CostEstimateFields {
  moldLeadTime: string | null;
  packersPerLine: number | null;
  operatorsPerLine: number | null;
  packContainerItemNo: string | null;
  packContainerDescription: string | null;
  containersPerLayer: number | null;
  layersPerPallet: number | null;
  palletBuildHeight: string | null;
  palletsPerTrailer: number | null;
  specialPackagingNote: string | null;
  returnableDunnageDescription: string | null;
  returnableDunnageCostUsd: number | null;
  toolingMarkupPct: number | null;
}

export const COST_ESTIMATE_TEXT_LIMITS = {
  moldLeadTime: [MOLD_LEAD_TIME_MAX_LENGTH, 'the mold lead time'],
  packContainerItemNo: [PACK_CONTAINER_ITEM_NO_MAX_LENGTH, 'the item number'],
  packContainerDescription: [PACK_CONTAINER_DESCRIPTION_MAX_LENGTH, 'the description'],
  palletBuildHeight: [PALLET_BUILD_HEIGHT_MAX_LENGTH, 'the pallet build height'],
  specialPackagingNote: [SPECIAL_PACKAGING_NOTE_MAX_LENGTH, 'the special-packaging note'],
  returnableDunnageDescription: [
    RETURNABLE_DUNNAGE_DESCRIPTION_MAX_LENGTH,
    'the dunnage description',
  ],
} as const satisfies Partial<Record<keyof CostEstimateFields, readonly [number, string]>>;

const WHOLE_LIMITS = {
  containersPerLayer: [CONTAINERS_PER_LAYER_MAX, 'Bags or cartons per layer'],
  layersPerPallet: [LAYERS_PER_PALLET_MAX, 'Layers per pallet'],
  palletsPerTrailer: [PALLETS_PER_TRAILER_MAX, 'Pallets per trailer'],
} as const satisfies Partial<Record<keyof CostEstimateFields, readonly [number, string]>>;

/** Trim the text fields (blank = empty). Pure. */
export function normalizeCostEstimate<T extends CostEstimateFields>(values: T): T {
  const out = { ...values };
  for (const k of Object.keys(
    COST_ESTIMATE_TEXT_LIMITS,
  ) as (keyof typeof COST_ESTIMATE_TEXT_LIMITS)[]) {
    const t = out[k]?.trim();
    out[k] = (t ? t : null) as T[typeof k];
  }
  return out;
}

export function validateCostEstimate(values: CostEstimateFields): DomainError[] {
  const errors: DomainError[] = [];
  for (const [k, [max, words]] of Object.entries(COST_ESTIMATE_TEXT_LIMITS) as [
    keyof typeof COST_ESTIMATE_TEXT_LIMITS,
    readonly [number, string],
  ][]) {
    if ((values[k]?.length ?? 0) > max) {
      errors.push(new DomainError('INVALID_VALUE', `Keep ${words} to ${max} characters`, k));
    }
  }
  for (const [k, [max, label]] of Object.entries(WHOLE_LIMITS) as [
    keyof typeof WHOLE_LIMITS,
    readonly [number, string],
  ][]) {
    const v = values[k];
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > max)) {
      errors.push(
        new DomainError(
          'INVALID_VALUE',
          `${label} must be a whole number from 1 to ${max.toLocaleString('en-US')}`,
          k,
        ),
      );
    }
  }
  for (const k of ['packersPerLine', 'operatorsPerLine'] as const) {
    const v = values[k];
    if (
      v !== null &&
      !(v >= 0 && v <= LABOR_PER_LINE_MAX && Math.abs(Math.round(v * 100) - v * 100) < 1e-6)
    ) {
      errors.push(
        new DomainError(
          'INVALID_VALUE',
          `Enter ${k === 'packersPerLine' ? 'packers' : 'operators'} per line from 0 to ${LABOR_PER_LINE_MAX} (two decimals)`,
          k,
        ),
      );
    }
  }
  if (values.returnableDunnageCostUsd !== null && !isUsdAmount(values.returnableDunnageCostUsd)) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        'Enter the estimated dunnage cost from $0, in cents',
        'returnableDunnageCostUsd',
      ),
    );
  }
  if (values.toolingMarkupPct !== null && !isMarkupPct(values.toolingMarkupPct)) {
    errors.push(
      new DomainError(
        'INVALID_VALUE',
        'Enter the markup from 0 to 100 % (two decimals), or leave it blank for none',
        'toolingMarkupPct',
      ),
    );
  }
  return errors;
}
