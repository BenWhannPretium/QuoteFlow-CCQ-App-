import type { ModelSummaryTemplate } from './config';
import type { ExtractedField, ModelSummaryReason, ModelSummaryStatus } from './extract';

/**
 * FB-14: what a reviewer is told about a summary, in plain words. Every warning is advisory: none
 * blocks an upload, a step or G3 (the gate rules do not change). Which fields are a payback and which
 * holds the hurdle is the template map's (config); the words are here.
 */

export type ModelSummaryWarningCode =
  | 'excel_error'
  | 'blank'
  | 'non_positive'
  | 'above_hurdle'
  | 'not_found'
  | 'not_calculated'
  | 'wrong_type'
  | 'out_of_range';

export interface ModelSummaryWarning {
  code: ModelSummaryWarningCode;
  fieldKey: string | null;
  message: string;
}

/** Who to ask about a workbook, by its kind. */
export function modelOwnerWords(kind: string): string {
  if (kind === 'roi_model') return 'Finance';
  if (kind === 'price_table') return 'the pricing lead';
  return 'Pricing';
}

/** Why there is no summary, in words a KAM understands. Reasons name no cell contents. */
export function modelSummaryReasonText(
  status: ModelSummaryStatus,
  reason: ModelSummaryReason | null,
): string | null {
  if (status === 'not_configured') return 'No summary is set up for this kind of file yet.';
  if (status !== 'unavailable') return null;
  switch (reason) {
    case 'not_xlsx':
      return 'A summary is read from an Excel workbook (.xlsx) only. The file is stored.';
    case 'too_large':
      return 'The file is too large for QuoteFlow to read a summary from. The file is stored.';
    case 'unreadable':
      return 'QuoteFlow could not read the file as an Excel workbook. The file is stored.';
    case 'timed_out':
      return 'Reading the workbook took too long, so no summary is shown. The file is stored.';
    case 'not_recognised':
      return 'This workbook does not match a known template, so no summary is shown. The file is stored.';
    case 'not_calculated':
      return 'The workbook has not been calculated. Open it in Excel, let it calculate, save it and upload it again.';
    case 'fields_not_found':
      return "None of the summary's figures were found in the workbook. The layout may have changed: ask an Admin to check the summary map.";
    default:
      return 'Summary unavailable. The file is stored.';
  }
}

function num(f: ExtractedField | undefined): number | null {
  return f && f.state === 'ok' && f.number !== null ? f.number : null;
}

/**
 * The advisory warnings for a summary's fields. `template` is the map the summary was read with (its
 * `warnings` block names the payback fields and the hurdle); when it is gone (an Admin removed it),
 * only the per-field warnings are given.
 */
export function modelSummaryWarnings(
  kind: string,
  fields: readonly ExtractedField[],
  template: Pick<ModelSummaryTemplate, 'warnings'> | null,
): ModelSummaryWarning[] {
  const owner = modelOwnerWords(kind);
  const out: ModelSummaryWarning[] = [];
  for (const f of fields) {
    switch (f.state) {
      case 'error':
        out.push({
          code: 'excel_error',
          fieldKey: f.key,
          message: `The workbook shows an error in ${f.label}. Ask ${owner} to check it.`,
        });
        break;
      case 'blank':
        if (f.headline) {
          out.push({
            code: 'blank',
            fieldKey: f.key,
            message: `${f.label} is blank in the workbook. Ask ${owner} to fill it in.`,
          });
        }
        break;
      case 'not_found':
        out.push({
          code: 'not_found',
          fieldKey: f.key,
          message: `QuoteFlow could not find ${f.label} in the workbook. The layout may have changed: ask an Admin to check the summary map.`,
        });
        break;
      case 'not_calculated':
        out.push({
          code: 'not_calculated',
          fieldKey: f.key,
          message: `${f.label} has not been calculated. Ask ${owner} to open the workbook in Excel, let it calculate, save it and upload it again.`,
        });
        break;
      case 'wrong_type':
        out.push({
          code: 'wrong_type',
          fieldKey: f.key,
          message: `${f.label} does not hold a ${f.type} in the workbook (it shows as text). Ask ${owner} to check it.`,
        });
        break;
      case 'out_of_range':
        out.push({
          code: 'out_of_range',
          fieldKey: f.key,
          message: `${f.label} is too large to be a real figure. Ask ${owner} to check it.`,
        });
        break;
      case 'ok':
        break;
    }
  }
  if (!template) return out;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const key of template.warnings.nonPositive) {
    const f = byKey.get(key);
    const v = num(f);
    if (f && v !== null && v <= 0) {
      out.push({
        code: 'non_positive',
        fieldKey: key,
        message: `${f.label} is ${v === 0 ? 'zero' : 'negative'} in the workbook, so the investment does not pay back as entered. Ask ${owner} to check the inputs.`,
      });
    }
  }
  const h = template.warnings.hurdle;
  if (h) {
    const f = byKey.get(h.field);
    const limit = byKey.get(h.limitField);
    const v = num(f);
    const l = num(limit);
    if (f && limit && v !== null && l !== null && v > l) {
      out.push({
        code: 'above_hurdle',
        fieldKey: h.field,
        message: `${f.label} is above the workbook's ${limit.label}. A slower payback needs a strategic reason.`,
      });
    }
  }
  return out;
}
