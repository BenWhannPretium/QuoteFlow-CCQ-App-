import type { PublicConfigResponse, QuoteDetail } from '@ccq/contracts';

type Decision = Pick<
  QuoteDetail['decisions'][number],
  'gateKey' | 'outcomeKey' | 'reasonCode' | 'decidedAt'
> & { reasonLabel?: string | null | undefined };

/** What the quote already says about its own send-back and closure (labels resolved by the server). */
type Known = {
  rework?: QuoteDetail['rework'];
  customerDecision?: Pick<QuoteDetail['customerDecision'], 'closure'>;
};

/** `missing_information` → "Missing information": the last resort, so a stored key never shows raw. */
export function plainWords(code: string): string {
  const words = code.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * UX-006: the label of a gate decision's reason code, for the Gate decisions card on the quote page
 * (it printed the stored key, "(missing_information)").
 *
 * 1. The server's label for this decision (`reasonLabel`): it knows every code, retired ones included.
 * 2. The configured label: the code in the reason context of the decision's outcome (public config).
 * 3. A code that is no longer offered is not in the public config (it lists active codes only). The quote
 *    carries the server's label for the decision that sent it back and for the one that closed it.
 * 4. Otherwise the key in plain words.
 *
 * 2 to 4 are what an older server, which sends no `reasonLabel`, leaves to go on.
 */
export function decisionReasonLabel(
  config: PublicConfigResponse | undefined,
  decision: Decision,
  known: Known = {},
): string | null {
  const code = decision.reasonCode;
  if (!code) return null;
  if (decision.reasonLabel && decision.reasonLabel !== code) return decision.reasonLabel;
  const context = config?.outcomes.find(
    (o) => o.gateKey === decision.gateKey && o.key === decision.outcomeKey,
  )?.reasonContext;
  const configured = context
    ? config?.reasonCodes.find((r) => r.code === code && r.context === context)?.label
    : undefined;
  if (configured) return configured;

  const { rework } = known;
  const closure = known.customerDecision?.closure;
  const fromServer =
    rework &&
    rework.gateKey === decision.gateKey &&
    rework.reasonCode === code &&
    rework.decidedAt === decision.decidedAt
      ? rework.reasonLabel
      : closure && closure.gateKey === decision.gateKey && closure.reasonCode === code
        ? closure.reasonLabel
        : null;
  // The server falls back to the code itself when it has no label either.
  return fromServer && fromServer !== code ? fromServer : plainWords(code);
}
