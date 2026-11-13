/** Where a notification opens: the Engineering or Quoting tab, the Final Review screen, or the quote itself. */
export type NotificationTarget = 'engineering' | 'quoting' | 'review' | 'quote' | 'rework';

export function notificationTarget(type: string): NotificationTarget {
  // FB-15 (W13-05): a send-back opens the KAM's rework at the review step, at the field to fix.
  if (type === 'quote.reworked') return 'rework';
  if (type === 'quote.ready_for_eng_review' || type === 'quote.assigned') return 'engineering';
  // FB-05: "ready for pricing" and a pricing assignment open the Quoting tab.
  // FB-07: the costing / ROI hand-offs open the Quoting tab too.
  if (
    type === 'quote.ready_for_quoting' ||
    type === 'quote.pricing_assigned' ||
    type === 'quote.ready_for_roi' ||
    type === 'quote.roi_uploaded'
  ) {
    return 'quoting';
  }
  if (type === 'quote.ready_for_final_review') return 'review';
  return 'quote';
}
