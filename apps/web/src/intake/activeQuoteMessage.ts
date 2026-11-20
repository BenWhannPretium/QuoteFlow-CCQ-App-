/**
 * FB-33 (N19-20): the sentence the intake shows when the opportunity already has an active quote and
 * only one is allowed. The term is spelled out here, where a KAM is told what blocks the submit; the
 * quote numbers carry the short form.
 */
export function oneQuotePerOpportunityMessage(quoteNumbers: readonly string[]): string {
  return `This opportunity already has an active Commercial Capital Quote (${quoteNumbers.join(', ')}). There is one quote per opportunity.`;
}
