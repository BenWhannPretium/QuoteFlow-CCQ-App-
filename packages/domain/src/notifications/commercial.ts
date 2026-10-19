/**
 * Email carries no pricing, margin or capital figures, ever, whatever the recipient's role (B-18).
 * Templates only receive non-commercial facts; this is the second lock: free text is scrubbed before
 * it is placed in a message, and the finished message is scanned, failing closed.
 */

/** A whole amount: digits with separators, and an optional k / M / MM / bn suffix. */
const AMOUNT = String.raw`\d(?:[\d.,]*\d)?(?:\s?(?:k|mm|m|bn)\b)?`;
const SYMBOL = String.raw`[$€£¥]`;
const CODE = String.raw`US\$|USD|CAD|EUR|GBP|MXN`;

/** Currency symbols, codes and words next to an amount, in either order. The whole amount matches. */
const CURRENCY_SOURCES = [
  String.raw`${SYMBOL}\s?${AMOUNT}`,
  String.raw`${AMOUNT}\s?${SYMBOL}`,
  String.raw`\b(?:${CODE})\s?${AMOUNT}`,
  String.raw`${AMOUNT}\s?(?:${CODE}|dollars?|euros?)\b`,
] as const;

const PATTERN = new RegExp(CURRENCY_SOURCES.join('|'), 'i');
const PATTERN_GLOBAL = new RegExp(CURRENCY_SOURCES.join('|'), 'gi');

/** True when the text contains an amount of money. Quote numbers (`CCQ-2026-00042`) and dates do not. */
export const hasCommercialFigure = (text: string): boolean => PATTERN.test(text);

/** The matched figures (for logs and tests; never the surrounding text). */
export const findCommercialFigures = (text: string): string[] => text.match(PATTERN_GLOBAL) ?? [];

/** Free text from a user (account names, descriptions) with any amount of money removed. */
export const scrubCommercialFigures = (text: string): string =>
  text.replace(PATTERN_GLOBAL, '[figure removed]');
