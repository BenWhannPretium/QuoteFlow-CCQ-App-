import { sentenceTokens, type OfferLetterTemplate, type OfferLetterToken } from './config';
import { formatUsd } from './money';
import {
  offerItemPrices,
  type OfferFacts,
  type OfferInputs,
  type OfferItemFacts,
  type OfferSettings,
} from './readiness';
import { proposalCalendarDate } from '../final-review/release';

/**
 * FB-20: the offer letter as plain data. The renderer (API, `docx`) only lays it out: every word on the
 * letter is decided here, from the quote's facts and the template config. No Word types in the domain.
 */

/** Printed in the header while Legal has not approved the wording (a control flag, not wording). */
export const OFFER_DRAFT_TEXT = 'DRAFT: wording not yet approved by Legal';

export interface OfferLetterItemLine {
  itemNo: number;
  /** "Item 1", or the item's label when there is one. */
  name: string;
  /** Label, container size and standard description, as printed. */
  partDescription: string;
  partNumber: string | null;
  placeOfManufacture: string;
  annualVolume: number | null;
  /** "120,000 pcs". */
  annualVolumeText: string | null;
}

export interface OfferLetterPriceLine {
  itemNo: number;
  name: string;
  placeOfManufacture: string;
  annualVolumeText: string | null;
  /** Decimal strings (numeric(18,4)) and their `$#,##0.00` text; null = not printed. */
  piecePricePer1000: string | null;
  piecePricePer1000Text: string | null;
  moldCharge: string | null;
  moldChargeText: string | null;
  /** FB-23: workbook | engineering (never printed; recorded on the letter). */
  moldChargeSource: 'workbook' | 'engineering' | null;
  changePartsCharge: string | null;
  changePartsChargeText: string | null;
}

export interface OfferLetterModel {
  draft: boolean;
  draftText: string | null;
  templateVersion: string;
  eyebrow: string | null;
  title: string;
  header: {
    to: string;
    attention: string | null;
    /** `YYYY-MM-DD` and "November 16, 2026". */
    date: string;
    dateText: string;
    quoteNumber: string;
    validUntil: string | null;
    validUntilText: string | null;
  };
  introduction: string | null;
  itemsHeading: string;
  items: OfferLetterItemLine[];
  pricing: {
    heading: string;
    labels: { piecePrice: string; molds: string; changeParts: string };
    /** A column no item has a value for is not printed. */
    showMolds: boolean;
    showChangeParts: boolean;
    rows: OfferLetterPriceLine[];
  };
  specifications: {
    heading: string;
    /** Column headings, one per item. */
    itemNames: string[];
    rows: { label: string; values: (string | null)[] }[];
  } | null;
  assumptions: { heading: string; items: { text: string; points: string[] }[] };
  closing: string | null;
  signOff: string;
  signer: { name: string | null; company: string };
  footer: { note: string | null; legalEntity: string | null; address: string | null };
}

const LONG_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

/** `2026-11-16` → "November 16, 2026". */
export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return LONG_DATE.format(new Date(Date.UTC(y, m - 1, d)));
}

const COUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Fill a sentence's tokens. A sentence that uses a token with no value on the quote is **dropped**
 * (null), never printed with a hole in it. Unknown tokens never reach here (the config validator
 * rejects them); one would drop the sentence too.
 */
export function fillTokens(
  text: string,
  values: Partial<Record<OfferLetterToken, string | null>>,
): string | null {
  const { tokens, error } = sentenceTokens(text);
  if (error) return null;
  for (const t of tokens) if (!values[t]?.trim()) return null;
  return text.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_m, name: string) =>
    values[name as OfferLetterToken]!.trim(),
  );
}

const clean = (s: string | null | undefined) => {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : null;
};

export function itemDisplayName(item: Pick<OfferItemFacts, 'itemNo' | 'label'>): string {
  return clean(item.label) ?? `Item ${item.itemNo}`;
}

/** Label, container size and standard description, without repeating a part. */
export function partDescription(item: OfferItemFacts): string {
  const parts: string[] = [];
  for (const p of [item.label, item.containerSize, item.standardDescription]) {
    const c = clean(p);
    if (c && !parts.some((x) => x.toLowerCase().includes(c.toLowerCase()))) parts.push(c);
  }
  return parts.length ? parts.join(' · ') : `Item ${item.itemNo}`;
}

/**
 * Build the letter. The caller has checked readiness (`evaluateOfferReadiness`): this does not refuse,
 * it lays out what there is.
 */
export function buildOfferLetterModel(
  facts: OfferFacts,
  inputs: OfferInputs,
  settings: OfferSettings,
): OfferLetterModel {
  const t: OfferLetterTemplate = settings.template;
  const date = facts.proposalIssuedAt ? proposalCalendarDate(facts.proposalIssuedAt) : '';
  const validUntilText = facts.validityUntil ? longDate(facts.validityUntil) : null;
  const tokens: Partial<Record<OfferLetterToken, string | null>> = {
    ...facts.termLabels,
    quoteNumber: facts.quoteNumber,
    customerName: clean(facts.customerName),
    validUntil: validUntilText,
  };
  const prices = offerItemPrices(facts, settings);
  const multi = facts.items.length > 1;

  const items: OfferLetterItemLine[] = facts.items.map((item) => ({
    itemNo: item.itemNo,
    name: multi ? `Item ${item.itemNo}` : itemDisplayName(item),
    partDescription: partDescription(item),
    partNumber: clean(inputs.partNumbers[item.itemNo]),
    placeOfManufacture: clean(item.plantLabel) ?? '',
    annualVolume: item.annualVolume,
    annualVolumeText: item.annualVolume === null ? null : `${COUNT.format(item.annualVolume)} pcs`,
  }));

  const rows: OfferLetterPriceLine[] = items.map((line) => {
    const p = prices.find((x) => x.itemNo === line.itemNo)!;
    return {
      itemNo: line.itemNo,
      name: line.name,
      placeOfManufacture: line.placeOfManufacture,
      annualVolumeText: line.annualVolumeText,
      piecePricePer1000: p.piecePricePer1000,
      piecePricePer1000Text: p.piecePricePer1000 ? formatUsd(p.piecePricePer1000) : null,
      moldCharge: p.moldCharge,
      moldChargeText: p.moldCharge ? formatUsd(p.moldCharge) : null,
      moldChargeSource: p.moldChargeSource,
      changePartsCharge: p.changePartsCharge,
      changePartsChargeText: p.changePartsCharge ? formatUsd(p.changePartsCharge) : null,
    };
  });

  const specRows = t.specifications
    .map((s) => ({
      label: s.label,
      values: facts.items.map((i) => clean(i.specs[s.fact])),
    }))
    .filter((r) => r.values.some((v) => v !== null));

  const assumptions = t.assumptions
    .filter((a) => t.showValidity || !sentenceTokens(a.text).tokens.includes('validUntil'))
    .map((a) => ({
      text: fillTokens(a.text, tokens),
      points: a.points.map((p) => fillTokens(p, tokens)).filter((p): p is string => p !== null),
    }))
    .filter((a): a is { text: string; points: string[] } => a.text !== null);

  return {
    draft: !settings.wordingApproved,
    draftText: settings.wordingApproved ? null : OFFER_DRAFT_TEXT,
    templateVersion: t.templateVersion,
    eyebrow: clean(t.eyebrow),
    title: t.title,
    header: {
      to: clean(facts.customerName) ?? '',
      attention: clean(inputs.attention),
      date,
      dateText: date ? longDate(date) : '',
      quoteNumber: facts.quoteNumber,
      validUntil: t.showValidity ? facts.validityUntil : null,
      validUntilText: t.showValidity ? validUntilText : null,
    },
    introduction: t.introduction ? fillTokens(t.introduction, tokens) : null,
    itemsHeading: t.itemsHeading,
    items,
    pricing: {
      heading: t.pricingHeading,
      labels: {
        piecePrice: t.rows.piecePrice.label,
        molds: t.rows.molds.label,
        changeParts: t.rows.changeParts.label,
      },
      showMolds: rows.some((r) => r.moldCharge !== null),
      showChangeParts: rows.some((r) => r.changePartsCharge !== null),
      rows,
    },
    specifications: specRows.length
      ? {
          heading: t.specificationsHeading,
          itemNames: items.map((i) => (multi ? `Item ${i.itemNo}` : i.name)),
          rows: specRows,
        }
      : null,
    assumptions: { heading: t.assumptionsHeading, items: assumptions },
    closing: t.closing ? fillTokens(t.closing, tokens) : null,
    signOff: t.signOff,
    signer: { name: clean(facts.kamName), company: t.signerCompany },
    footer: {
      note: clean(t.footerNote),
      legalEntity: clean(t.legalEntity),
      address: clean(t.address),
    },
  };
}
