import type {
  OfferLetterTemplate,
  OfferRowRequired,
  OfferSpecFact,
  OfferLetterToken,
} from './config';
import { isPositiveDecimal, toCharge, toPer1000 } from './money';
import type { ModelSummaryFieldState, ModelSummaryStatus } from '../model-summary/extract';
import {
  OFFER_PRICE_UNITS,
  type OfferFieldKey,
  type OfferPriceUnit,
} from '../model-summary/config';
import { CUSTOMER_DECISION_STAGE_KEY } from '../final-review/release';

/**
 * FB-20 (F-070): can an offer letter be made for this quote, and if not, why. Pure: the API gathers
 * the facts (the quote, its items, the current costing workbook's summary, the settings) and asks.
 *
 * Ben's decisions (2026-11-16): the letter is made only after Final Review approves the quote (it is in
 * Customer Decision with a proposal-issued date and a validity date); every price comes from the
 * costing workbook's summary, never typed; one letter per quote with a row per item.
 */

export interface OfferItemFacts {
  /** The `quote_item` id; null for a pre-FB-19 quote listed from its own columns. */
  id: string | null;
  itemNo: number;
  /** The KAM's short name ("16 oz bottle"). */
  label: string | null;
  containerSize: string | null;
  standardDescription: string | null;
  /** The plant label (Engineering's decision); null when no plant is set. */
  plantLabel: string | null;
  annualVolume: number | null;
  /** Labels for the Specifications table; a missing or blank fact is not printed. */
  specs: Partial<Record<OfferSpecFact, string | null>>;
}

export interface OfferCostingField {
  key: string;
  itemNo: number | null;
  unit: string;
  state: ModelSummaryFieldState;
  number: number | null;
}

export interface OfferCostingFacts {
  attachmentId: string;
  version: number;
  fileName: string;
  uploadedAt: Date;
  uploadedByName: string | null;
  /** `none`: no summary was read for this version (uploaded before FB-14). */
  status: ModelSummaryStatus | 'none';
  /** FB-14's plain reason when the summary is not complete. */
  reasonText: string | null;
  fields: readonly OfferCostingField[];
}

export interface OfferFacts {
  quoteNumber: string;
  quoteVersion: number;
  stageKey: string;
  /** The stage's display name ("Final Review"). */
  stageName: string;
  onHold: boolean;
  proposalIssuedAt: Date | null;
  /** `YYYY-MM-DD`. */
  validityUntil: string | null;
  /** The latest G4 Approve (falls back to `proposalIssuedAt`). */
  approvedAt: Date | null;
  customerName: string | null;
  kamName: string | null;
  toolingFundingModel: string | null;
  /** Labels for the tokens the service resolves (payment terms, price basis, …). */
  termLabels: Partial<Record<OfferLetterToken, string | null>>;
  items: readonly OfferItemFacts[];
  /** `model_summary_visible`. */
  summaryVisible: boolean;
  /** The current `cost_model` version; null when none is on file. */
  costing: OfferCostingFacts | null;
}

export interface OfferSettings {
  template: OfferLetterTemplate;
  wordingApproved: boolean;
  blockIfCostingChanged: boolean;
}

export interface OfferInputs {
  attention: string | null;
  /** Part # by item number. */
  partNumbers: Readonly<Record<number, string | null | undefined>>;
}

export type OfferFixAt = 'quote' | 'engineering' | 'quoting' | 'final_review' | 'admin';

export const OFFER_BLOCKER_CODES = [
  'not_customer_decision',
  'on_hold',
  'not_released',
  'no_customer',
  'no_items',
  'no_costing',
  'summary_hidden',
  'summary_not_complete',
  'costing_changed',
  'no_plant',
  'missing_piece_price',
  'missing_required_row',
  'invalid_price',
  'config_invalid',
] as const;
export type OfferBlockerCode = (typeof OFFER_BLOCKER_CODES)[number];

export const OFFER_WARNING_CODES = [
  'wording_not_approved',
  'no_attention',
  'no_part_number',
] as const;
export type OfferWarningCode = (typeof OFFER_WARNING_CODES)[number];

export interface OfferBlocker {
  code: OfferBlockerCode;
  message: string;
  itemNo: number | null;
  fixAt: OfferFixAt | null;
}

export interface OfferWarning {
  code: OfferWarningCode;
  message: string;
}

export interface OfferReadiness {
  canGenerate: boolean;
  blockers: OfferBlocker[];
  warnings: OfferWarning[];
}

/** One item's prices as the letter will print them (decimal strings, numeric(18,4)); null = not printed. */
export interface OfferItemPrices {
  itemNo: number;
  piecePricePer1000: string | null;
  moldCharge: string | null;
  changePartsCharge: string | null;
}

export type OfferRowKey = 'piecePrice' | 'molds' | 'changeParts';
const ROW_FIELD: Record<OfferRowKey, OfferFieldKey> = {
  piecePrice: 'offer_piece_price',
  molds: 'offer_mold_charge',
  changeParts: 'offer_change_parts_charge',
};
const ROW_WORDS: Record<OfferRowKey, string> = {
  piecePrice: 'piece price',
  molds: 'mold charge',
  changeParts: 'change parts charge',
};

export const itemWords = (itemNo: number, count: number) =>
  count > 1 ? `Item ${itemNo}` : 'The item';

const isPriceUnit = (u: string): u is OfferPriceUnit =>
  (OFFER_PRICE_UNITS as readonly string[]).includes(u);

type RowRead =
  | { kind: 'value'; value: string }
  | { kind: 'absent' }
  /** In the workbook but not usable (an Excel error, text, blank, zero or negative). */
  | { kind: 'invalid'; why: string };

const STATE_WORDS: Partial<Record<ModelSummaryFieldState, string>> = {
  error: 'an Excel error',
  not_calculated: 'not calculated',
  wrong_type: 'text, not a number',
  out_of_range: 'out of range',
};

/**
 * The field for `key` and `itemNo`. A field with no item number applies only on a one-item quote (a
 * map written for a single-item workbook).
 */
function findField(
  fields: readonly OfferCostingField[],
  key: OfferFieldKey,
  itemNo: number,
  itemCount: number,
): OfferCostingField | null {
  return (
    fields.find((f) => f.key === key && f.itemNo === itemNo) ??
    (itemCount === 1 ? (fields.find((f) => f.key === key && f.itemNo === null) ?? null) : null)
  );
}

function readRow(
  fields: readonly OfferCostingField[],
  row: OfferRowKey,
  itemNo: number,
  itemCount: number,
): RowRead {
  const f = findField(fields, ROW_FIELD[row], itemNo, itemCount);
  // A cell the map names but the workbook leaves blank is "not in the workbook" (no charge, or a
  // missing price), never an error.
  if (!f || f.state === 'not_found' || f.state === 'blank') return { kind: 'absent' };
  if (f.state !== 'ok' || f.number === null) {
    return { kind: 'invalid', why: STATE_WORDS[f.state] ?? f.state };
  }
  if (row === 'piecePrice') {
    if (!isPriceUnit(f.unit)) return { kind: 'invalid', why: `in an unknown unit (${f.unit})` };
    const v = toPer1000(f.number, f.unit);
    return isPositiveDecimal(v)
      ? { kind: 'value', value: v }
      : { kind: 'invalid', why: 'not above zero' };
  }
  const v = toCharge(f.number);
  if (isPositiveDecimal(v)) return { kind: 'value', value: v };
  // A zero charge is "no charge": the row is not printed (never as $0.00). A negative is unusable.
  return v.startsWith('-') ? { kind: 'invalid', why: 'negative' } : { kind: 'absent' };
}

function rowRequired(
  rule: OfferRowRequired,
  toolingFundingModel: string | null,
  template: OfferLetterTemplate,
): boolean {
  if (rule === 'always') return true;
  if (rule === 'never') return false;
  return (
    toolingFundingModel !== null &&
    template.customerFundedToolingModels.includes(toolingFundingModel)
  );
}

/** The prices the letter will print, per item (absent or unusable values are null). */
export function offerItemPrices(facts: OfferFacts): OfferItemPrices[] {
  const fields = facts.costing?.fields ?? [];
  const n = facts.items.length;
  const value = (r: RowRead) => (r.kind === 'value' ? r.value : null);
  return facts.items.map((item) => ({
    itemNo: item.itemNo,
    piecePricePer1000: value(readRow(fields, 'piecePrice', item.itemNo, n)),
    moldCharge: value(readRow(fields, 'molds', item.itemNo, n)),
    changePartsCharge: value(readRow(fields, 'changeParts', item.itemNo, n)),
  }));
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);

/** The advisory warnings, given what the user typed (or will type). */
export function offerWarnings(
  facts: Pick<OfferFacts, 'items'>,
  settings: Pick<OfferSettings, 'wordingApproved'>,
  inputs: OfferInputs | null,
): OfferWarning[] {
  const out: OfferWarning[] = [];
  if (!settings.wordingApproved) {
    out.push({
      code: 'wording_not_approved',
      message:
        'The letter wording is not yet approved by Legal. Every letter is marked "DRAFT" until an Admin records the approval.',
    });
  }
  if (inputs) {
    if (!inputs.attention?.trim()) {
      out.push({
        code: 'no_attention',
        message: 'No Attention name: the letter has no contact line.',
      });
    }
    const missing = facts.items.filter((i) => !inputs.partNumbers[i.itemNo]?.trim());
    if (missing.length) {
      out.push({
        code: 'no_part_number',
        message:
          facts.items.length === 1
            ? 'No Part #: the letter prints the item without one.'
            : `No Part # for ${missing.map((i) => `item ${i.itemNo}`).join(', ')}: printed without one.`,
      });
    }
  }
  return out;
}

/**
 * Whether a letter can be made now. Blockers stop it; warnings are advisory (the user ticks each one
 * before generating). `inputs` null (the GET) leaves out the warnings about what is typed.
 */
export function evaluateOfferReadiness(
  facts: OfferFacts,
  settings: OfferSettings,
  inputs: OfferInputs | null = null,
): OfferReadiness {
  const blockers: OfferBlocker[] = [];
  const block = (
    code: OfferBlockerCode,
    message: string,
    fixAt: OfferFixAt | null,
    itemNo: number | null = null,
  ) => blockers.push({ code, message, fixAt, itemNo });

  // 1. The Final Review gate (decision 2): follows the stage, not a setting.
  if (facts.stageKey !== CUSTOMER_DECISION_STAGE_KEY) {
    block(
      'not_customer_decision',
      `An offer letter is made once Final Review approves the quote. This quote is in ${facts.stageName}.`,
      null,
    );
    return { canGenerate: false, blockers, warnings: offerWarnings(facts, settings, inputs) };
  }
  if (facts.onHold) {
    block('on_hold', 'The quote is on hold. Take it off hold to make an offer letter.', 'quote');
  }
  if (!facts.proposalIssuedAt || !facts.validityUntil) {
    block(
      'not_released',
      'The quote has no proposal date or validity date. Final Review sets both when it approves the quote.',
      'final_review',
    );
  }
  if (!facts.customerName?.trim()) {
    block('no_customer', 'The quote has no customer name from Salesforce.', 'quote');
  }
  if (facts.items.length === 0) {
    block('no_items', 'The quote has no items.', 'quote');
  }

  // 2. The prices (decision 1): the current costing workbook's summary, complete and shown.
  const costing = facts.costing;
  let pricesReadable = false;
  if (!costing) {
    block(
      'no_costing',
      'No costing workbook is on file. Pricing uploads it on the Quoting tab.',
      'quoting',
    );
  } else if (!facts.summaryVisible) {
    block(
      'summary_hidden',
      'An Admin has turned off showing figures read from uploaded models, so the prices cannot be read. Ask an Admin.',
      'admin',
    );
  } else if (costing.status !== 'complete') {
    const why =
      costing.reasonText ??
      (costing.status === 'partial'
        ? 'some of its figures were not found or not calculated'
        : 'no summary was read');
    block(
      'summary_not_complete',
      `The costing workbook has no readable price summary (${why.replace(/\.$/, '')}). Ask Pricing to fix the workbook or an Admin to set up the template.`,
      'quoting',
    );
  } else {
    pricesReadable = true;
  }
  if (
    costing &&
    settings.blockIfCostingChanged &&
    facts.approvedAt &&
    costing.uploadedAt.getTime() > facts.approvedAt.getTime()
  ) {
    block(
      'costing_changed',
      `The costing workbook was replaced (version ${costing.version}, ${fmtDate(costing.uploadedAt)}) after Final Review approved the quote, so the price may have changed. Send the quote back through Final Review.`,
      'final_review',
    );
  }

  // 3. Per item: a plant, and every required price row.
  const n = facts.items.length;
  for (const item of facts.items) {
    const who = itemWords(item.itemNo, n);
    if (!item.plantLabel?.trim()) {
      block(
        'no_plant',
        `${who} has no plant of manufacture. Engineering sets it on the Engineering tab.`,
        'engineering',
        item.itemNo,
      );
    }
    if (!pricesReadable) continue;
    const fields = costing!.fields;
    for (const row of ['piecePrice', 'molds', 'changeParts'] as const) {
      const read = readRow(fields, row, item.itemNo, n);
      if (read.kind === 'invalid') {
        block(
          'invalid_price',
          `${who}'s ${ROW_WORDS[row]} in the costing workbook is not usable (${read.why}). Ask Pricing to fix the workbook.`,
          'quoting',
          item.itemNo,
        );
        continue;
      }
      if (read.kind === 'value') continue;
      if (row === 'piecePrice') {
        block(
          'missing_piece_price',
          `${who} has no piece price in the costing workbook. Ask Pricing to add it, or an Admin to map it.`,
          'quoting',
          item.itemNo,
        );
      } else if (
        rowRequired(
          settings.template.rows[row].required,
          facts.toolingFundingModel,
          settings.template,
        )
      ) {
        const because =
          settings.template.rows[row].required === 'always'
            ? 'it is required on every letter'
            : 'the customer funds tooling on this quote';
        block(
          'missing_required_row',
          `${who} has no ${ROW_WORDS[row]} in the costing workbook, and ${because}. Ask Pricing to add it.`,
          'quoting',
          item.itemNo,
        );
      }
    }
  }

  return {
    canGenerate: blockers.length === 0,
    blockers,
    warnings: offerWarnings(facts, settings, inputs),
  };
}
