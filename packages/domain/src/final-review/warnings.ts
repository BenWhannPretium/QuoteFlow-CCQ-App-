import type { QuotingWarning } from '../pricing/record';

/**
 * The "open warnings" on the review screen: everything the approver should weigh that does not block
 * the decision. Pure: the API passes in what it loaded.
 */
export interface ReviewWarning {
  code: string;
  /** `risk` = think before approving; `info` = context. */
  severity: 'risk' | 'info';
  message: string;
}

export interface ReviewWarningInput {
  /** The qualification screens (below minimum value / volume), already worded. */
  qualification: readonly { code: string; message: string }[];
  /** `quotingWarnings` for the current version's pricing record; empty for roles that cannot read it. */
  quoting: readonly QuotingWarning[];
  g2Outcome: string | null;
  g2Note: string | null;
  priceApproved: boolean;
  capacityEvidenceRows: number;
  /** The approver tier this quote falls in (when `g4_tier_rules` is on) and whether the viewer meets it. */
  requirement: { tierLabel: string; satisfied: boolean } | null;
}

export function reviewWarnings(input: ReviewWarningInput): ReviewWarning[] {
  const out: ReviewWarning[] = [];
  if (!input.priceApproved) {
    out.push({
      code: 'PRICE_NOT_APPROVED',
      severity: 'risk',
      message: 'No price approval is recorded for this version',
    });
  }
  if (input.g2Outcome === 'capital_required') {
    out.push({
      code: 'G2_CAPITAL_REQUIRED',
      severity: 'risk',
      message: 'Engineering flagged capital as required',
    });
  }
  if (input.g2Outcome === 'proceed_with_risk') {
    out.push({
      code: 'G2_PROCEED_WITH_RISK',
      severity: 'risk',
      message: `Engineering proceeded with risk${input.g2Note ? `: ${input.g2Note}` : ''}`,
    });
  }
  if (input.capacityEvidenceRows === 0) {
    out.push({
      code: 'CAPACITY_EVIDENCE_MISSING',
      severity: 'risk',
      message: 'No capacity evidence is recorded for this version',
    });
  }
  for (const w of input.quoting) {
    out.push({
      code: w.code,
      severity: w.code === 'NO_PRICING_APP_RECORD' ? 'info' : 'risk',
      message: w.message,
    });
  }
  for (const w of input.qualification) {
    out.push({ code: w.code, severity: 'info', message: w.message });
  }
  if (input.requirement && !input.requirement.satisfied) {
    out.push({
      code: 'TIER_APPROVER_REQUIRED',
      severity: 'risk',
      message: `This quote needs the "${input.requirement.tierLabel}" approver tier: you cannot approve it`,
    });
  }
  return out;
}
