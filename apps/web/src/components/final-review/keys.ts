/** Query keys for Final Review (B-12): kept apart so the decision dialog can invalidate them. */
export const finalReviewQueueKey = ['final-review-queue'] as const;
export const reviewSummaryKey = (quoteNumber: string) => ['review-summary', quoteNumber] as const;
