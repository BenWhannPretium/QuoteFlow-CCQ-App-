import type { OfferPriceUnit } from '../model-summary/config';

/**
 * FB-20: exact decimal arithmetic for the offer letter's prices. A price is never multiplied as a
 * floating-point number: it is turned into a scaled integer (`bigint`), converted, and rounded half
 * away from zero to the four decimals the letter stores (`numeric(18,4)`).
 */

/** Decimals kept while converting (the model summary stores numeric(24,10)). */
const WORK_DIGITS = 10;
/** Decimals the letter stores. */
export const OFFER_PRICE_DIGITS = 4;

const pow10 = (n: number) => 10n ** BigInt(n);

/** A finite number or decimal string as an integer scaled by 10^digits (half away from zero). */
export function toScaled(value: number | string, digits: number = WORK_DIGITS): bigint {
  const text = typeof value === 'number' ? numberText(value, digits) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new RangeError(`not a decimal: ${text}`);
  const negative = m[1] === '-';
  const whole = BigInt(m[2]!);
  const fraction = m[3] ?? '';
  const kept = fraction.slice(0, digits).padEnd(digits, '0');
  let scaled = whole * pow10(digits) + BigInt(kept || '0');
  // Round half away from zero on the first dropped digit.
  if (fraction.length > digits && Number(fraction[digits]) >= 5) scaled += 1n;
  return negative ? -scaled : scaled;
}

function numberText(value: number, digits: number): string {
  if (!Number.isFinite(value)) throw new RangeError('not a finite number');
  // toFixed gives the decimal expansion rounded at `digits` (no exponent below 1e21).
  return value.toFixed(digits);
}

/** A scaled integer back to a fixed-point string with `digits` decimals. */
export function scaledText(scaled: bigint, digits: number): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const base = pow10(digits);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(digits, '0');
  return `${negative ? '-' : ''}${whole.toString()}${digits > 0 ? `.${fraction}` : ''}`;
}

/** Divide a scaled integer by 10^drop, rounding half away from zero. */
function dropDigits(scaled: bigint, drop: number): bigint {
  if (drop <= 0) return scaled;
  const base = pow10(drop);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  let q = abs / base;
  if ((abs % base) * 2n >= base) q += 1n;
  return negative ? -q : q;
}

/**
 * A piece price read from the costing workbook, as the price per 1,000 pieces with four decimals.
 * `0.0825` per piece → `"82.5000"`; `82.5` per 1,000 → `"82.5000"`.
 */
export function toPer1000(value: number | string, unit: OfferPriceUnit): string {
  const scaled = toScaled(value);
  const per1000 = unit === 'usd_per_unit' ? scaled * 1000n : scaled;
  return scaledText(dropDigits(per1000, WORK_DIGITS - OFFER_PRICE_DIGITS), OFFER_PRICE_DIGITS);
}

/** A charge (molds, change parts) in USD with four decimals, as stored. */
export function toCharge(value: number | string): string {
  return scaledText(
    dropDigits(toScaled(value), WORK_DIGITS - OFFER_PRICE_DIGITS),
    OFFER_PRICE_DIGITS,
  );
}

/** `"1234.5"` → `"$1,234.50"` (`$#,##0.00`, half away from zero; negatives as `-$1.00`). */
export function formatUsd(value: string | number): string {
  const cents = dropDigits(toScaled(value, OFFER_PRICE_DIGITS), OFFER_PRICE_DIGITS - 2);
  const negative = cents < 0n;
  const text = scaledText(negative ? -cents : cents, 2);
  const [whole, fraction] = text.split('.') as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${fraction}`;
}

/** Whether a decimal string is above zero. */
export const isPositiveDecimal = (value: string): boolean => toScaled(value) > 0n;
