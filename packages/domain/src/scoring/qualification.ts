import { DomainError } from '../errors';
import { getFact, toNumber } from './inputs';
import type { ScoringFacts } from './inputs';

/**
 * G1 qualification screens (D-06 open). They only WARN: nothing here ever rejects a quote.
 * The thresholds come from app settings and are off (null / {}) until sales leadership sets them.
 */
export interface QualificationSettings {
  /** `min_opportunity_value_warning_usd`: warn below this estimated annual revenue. Null = off. */
  minOpportunityValueUsd: number | null;
  /**
   * `min_volume_warning_by_process`: warn below this annual volume, keyed by process_type code.
   * The key `*` applies when the process is not known yet (at G1 it usually isn't).
   */
  minVolumeByProcess: Readonly<Record<string, number>>;
  /**
   * `qualification_exception_note_outcomes`: `gate:outcome` pairs that need a strategic exception note
   * when the quote has a warning (seed: `G1:advance`).
   */
  exceptionNoteOutcomes: readonly string[];
}

export interface QualificationWarning {
  code: 'below_min_value' | 'below_min_volume';
  field: 'est_annual_revenue' | 'est_annual_volume';
  threshold: number;
  actual: number;
  message: string;
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Reads the settings rows (untrusted JSON) into `QualificationSettings`; bad values switch a screen off. */
export function parseQualificationSettings(raw: {
  minOpportunityValueUsd?: unknown;
  minVolumeByProcess?: unknown;
  exceptionNoteOutcomes?: unknown;
}): QualificationSettings {
  const volume: Record<string, number> = {};
  if (raw.minVolumeByProcess && typeof raw.minVolumeByProcess === 'object') {
    for (const [k, v] of Object.entries(raw.minVolumeByProcess)) {
      const n = toNumber(v);
      if (n !== null) volume[k] = n;
    }
  }
  return {
    minOpportunityValueUsd: toNumber(raw.minOpportunityValueUsd),
    minVolumeByProcess: volume,
    exceptionNoteOutcomes: Array.isArray(raw.exceptionNoteOutcomes)
      ? raw.exceptionNoteOutcomes.filter((v): v is string => typeof v === 'string')
      : [],
  };
}

export function qualificationWarnings(
  settings: QualificationSettings,
  facts: ScoringFacts,
): QualificationWarning[] {
  const warnings: QualificationWarning[] = [];

  const value = toNumber(getFact(facts, 'quote.est_annual_revenue'));
  const minValue = settings.minOpportunityValueUsd;
  if (minValue !== null && value !== null && value < minValue) {
    warnings.push({
      code: 'below_min_value',
      field: 'est_annual_revenue',
      threshold: minValue,
      actual: value,
      message: `Below the ${usd.format(minValue)} minimum opportunity value (${usd.format(value)}); requires a strategic exception note`,
    });
  }

  const volume = toNumber(getFact(facts, 'quote.est_annual_volume'));
  const process = getFact(facts, 'eng_review.process_type');
  const processKey = typeof process === 'string' && process ? process : null;
  const minVolume =
    (processKey ? settings.minVolumeByProcess[processKey] : undefined) ??
    settings.minVolumeByProcess['*'];
  if (minVolume !== undefined && volume !== null && volume < minVolume) {
    warnings.push({
      code: 'below_min_volume',
      field: 'est_annual_volume',
      threshold: minVolume,
      actual: volume,
      message: `Below the ${num.format(minVolume)}-unit minimum annual volume${
        processKey ? ` for ${processKey}` : ''
      } (${num.format(volume)}); requires a strategic exception note`,
    });
  }
  return warnings;
}

/** NOTE_REQUIRED when a warned quote takes an outcome configured to need a strategic exception note. */
export function exceptionNoteErrors(
  settings: QualificationSettings,
  warnings: readonly unknown[],
  request: { gateKey: string; outcomeKey: string; note?: string | undefined },
): DomainError[] {
  if (warnings.length === 0) return [];
  if (!settings.exceptionNoteOutcomes.includes(`${request.gateKey}:${request.outcomeKey}`)) {
    return [];
  }
  if (request.note?.trim()) return [];
  return [
    new DomainError(
      'NOTE_REQUIRED',
      'This quote is below a qualification minimum: add a strategic exception note',
      'note',
    ),
  ];
}
