import type { QuoteIntakeFacts } from '@ccq/contracts';
import type { Quote } from '@ccq/db/repos';

/**
 * FB-02: the intake's product and timing facts as every reader of the quote sees them (Engineering and
 * Pricing included; CLAUDE.md rule 2: no role is hidden from data it can enter).
 */
export function intakeFactsDto(q: Quote): QuoteIntakeFacts {
  return {
    quoteNeededBy: q.quoteNeededBy,
    productNeededBy: q.productNeededBy,
  };
}

/** FB-02 (F-017): the destination's city and state, for queue rows and headers. */
export function shipCityState(shipTo: unknown): {
  shipCity: string | null;
  shipState: string | null;
} {
  const a = (shipTo ?? {}) as { city?: unknown; state?: unknown };
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { shipCity: text(a.city), shipState: text(a.state) };
}
