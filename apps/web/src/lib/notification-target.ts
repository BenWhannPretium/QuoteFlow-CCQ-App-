/** Where a notification opens: the Engineering or Quoting tab, the Final Review screen, or the quote itself. */
export type NotificationTarget = 'engineering' | 'quoting' | 'review' | 'quote';

export function notificationTarget(type: string): NotificationTarget {
  if (type === 'quote.ready_for_eng_review' || type === 'quote.assigned') return 'engineering';
  // FB-05: "ready for pricing" and a pricing assignment open the Quoting tab.
  if (type === 'quote.ready_for_quoting' || type === 'quote.pricing_assigned') return 'quoting';
  if (type === 'quote.ready_for_final_review') return 'review';
  return 'quote';
}
