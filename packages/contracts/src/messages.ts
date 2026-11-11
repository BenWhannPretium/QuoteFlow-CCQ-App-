import { z } from 'zod';

/**
 * Plain-language validation messages (DR-engineering-01, DR-pricing-finance-06,
 * DR-approver-leadership-admin-10). zod's defaults ("Too small: expected number to be >=1", "Invalid
 * input: expected int, received number") reached users through the API's problem body and the web forms.
 *
 * One mechanism, used by the API and the web alike because both import `@ccq/contracts`:
 * - `plainIssueMessage` is installed as zod's global error customiser, so EVERY schema without its own
 *   message reads in plain words and names the field when it is known (`FIELD_LABELS`);
 * - `wholeNumber` / `numberFrom` give a field one message that names both limits ("Enter 1 to 120 months").
 * A new field gets its name in messages by adding it to `FIELD_LABELS`.
 */

/** Request-body field (the last path segment, camelCase) → the words a user sees on the screen. */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  // Engineering review and capacity
  cavitation: 'Cavitation',
  cycleTimeS: 'Cycle time (s)',
  prelimCapitalUsd: 'Budgetary capital estimate',
  unitsPerBag: 'Units per bag',
  unitsPerTray: 'Units per tray',
  unitsPerCase: 'Units per case',
  unitsPerPallet: 'Units per pallet',
  assumedEffectivenessPct: 'Assumed effectiveness %',
  utilizationBeforePct: 'Utilization before %',
  allocatedAnnualVolume: 'Allocated annual volume',
  scheduledRunDaysPerYear: 'Scheduled run days a year',
  preformNumber: 'Preform number',
  // Commercial and capital terms
  termsAmortizationMonths: 'Amortized over (months)',
  termsAgreementMonths: 'Agreement duration (months)',
  termsMinSupply: 'Minimum supply / shortfall terms',
  termsMoq: 'MOQ',
  termsNotes: 'Notes',
  termsMilestoneNote: 'Milestone note',
  // Decisions and notes
  note: 'Note',
  reasonCode: 'Reason',
  holdUntil: 'Review date',
  body: 'Comment',
  rationale: 'Rationale',
  justification: 'Justification',
  // Pricing
  approvedAt: 'Approved at',
  pricingBasisNote: 'Pricing basis note',
  capitalPendingJustification: 'Pending-capital justification',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** zod's raw issue (the parts this formatter reads). */
interface RawIssue {
  code?: string;
  path?: PropertyKey[];
  input?: unknown;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  expected?: string;
  format?: string;
  keys?: string[];
  divisor?: number;
}

/** The plain sentence for one issue, without the field name. */
function plainText(iss: RawIssue): string {
  const missing = iss.input === undefined || iss.input === null;
  const min = Number(iss.minimum);
  const max = Number(iss.maximum);
  switch (iss.code) {
    case 'too_small':
      if (iss.origin === 'string') {
        return min <= 1 ? 'Required' : `Use at least ${plural(min, 'character')}`;
      }
      if (iss.origin === 'array' || iss.origin === 'set') {
        return min <= 1 ? 'Choose at least one' : `Choose at least ${min}`;
      }
      return iss.inclusive ? `Enter ${min} or more` : `Enter more than ${min}`;
    case 'too_big':
      if (iss.origin === 'string') return `Use ${plural(max, 'character')} or fewer`;
      if (iss.origin === 'array' || iss.origin === 'set') return `Choose ${max} or fewer`;
      return iss.inclusive ? `Enter ${max} or less` : `Enter less than ${max}`;
    case 'invalid_type':
      if (missing) return 'Required';
      if (iss.expected === 'int') return 'Enter a whole number';
      if (iss.expected === 'number') return 'Enter a number';
      if (iss.expected === 'boolean') return 'Choose yes or no';
      if (iss.expected === 'string') return 'Enter text';
      if (iss.expected === 'array') return 'Choose from the list';
      return 'This value is not valid';
    case 'invalid_format':
      switch (iss.format) {
        case 'date':
          return 'Enter a date (YYYY-MM-DD)';
        case 'datetime':
          return 'Enter a date and time';
        case 'uuid':
          return 'Pick an entry from the list';
        case 'url':
          return 'Enter a full web link (https://…)';
        case 'email':
          return 'Enter an email address';
        default:
          return 'This value is not in the expected format';
      }
    case 'invalid_value':
      return 'Pick one of the options';
    case 'not_multiple_of':
      return `Enter a multiple of ${iss.divisor}`;
    case 'unrecognized_keys':
      return `This form does not take ${(iss.keys ?? []).join(', ')}`;
    default:
      return 'This value is not valid';
  }
}

/**
 * zod's global error customiser: the plain sentence, led by the field's name when it is known
 * ("Cavitation: enter 1 or more"). A schema's own message always wins over this.
 */
export function plainIssueMessage(iss: RawIssue): string {
  const text = plainText(iss);
  const last = [...(iss.path ?? [])].reverse().find((p): p is string => typeof p === 'string');
  const label = last ? FIELD_LABELS[last] : undefined;
  return label ? `${label}: ${lowerFirst(text)}` : text;
}

z.config({ customError: (iss) => plainIssueMessage(iss as RawIssue) });

/** A whole number from `min` to `max`, with one message naming both limits ("Enter 1 to 120 months"). */
export function wholeNumber(min: number, max: number, unit?: string) {
  const message = unit
    ? `Enter ${min} to ${max.toLocaleString('en-US')} ${unit}`
    : `Enter a whole number from ${min} to ${max.toLocaleString('en-US')}`;
  return z.number({ error: message }).int(message).min(min, message).max(max, message);
}

/** A number from `min` (or above it, when `aboveMin`) to `max`, with one message naming both limits. */
export function numberFrom(min: number, max: number, unit = '', aboveMin = false) {
  const tail = !unit ? '' : unit.startsWith('%') ? unit : ` ${unit}`;
  const message = aboveMin
    ? `Enter more than ${min}${tail}, up to ${max.toLocaleString('en-US')}${tail}`
    : `Enter ${min} to ${max.toLocaleString('en-US')}${tail}`;
  const base = z.number({ error: message });
  return (aboveMin ? base.gt(min, message) : base.min(min, message)).max(max, message);
}
