/**
 * Where a notification opens: the Engineering or Quoting tab, the Final Review screen, the Commercial
 * terms tab (FB-25), the To qualify queue with the quote's card open (FB-25), or the quote itself (which
 * opens on the reader's own work: UX-012).
 */
export type NotificationTarget =
  'engineering' | 'quoting' | 'review' | 'commercial' | 'qualify' | 'quote' | 'rework';

export function notificationTarget(type: string): NotificationTarget {
  // FB-15 (W13-05): a send-back opens the KAM's rework at the review step, at the field to fix.
  if (type === 'quote.reworked') return 'rework';
  if (type === 'quote.ready_for_eng_review' || type === 'quote.assigned') return 'engineering';
  // FB-16 (W13-15, W13-17): the capacity notices open the Engineering tab, where capacity is worked.
  if (
    type === 'quote.capacity_assigned' ||
    type === 'quote.capacity_ready' ||
    type === 'quote.capacity_blocked'
  ) {
    return 'engineering';
  }
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
  // FB-25 (N18-17; Ben Whann, Bailey Schmitt): the sales leader decides advance or stop on To qualify,
  // where the card opens with what the KAM entered; the quote's Overview was a page of empty fields.
  if (type === 'quote.to_qualify') return 'qualify';
  // UX-012: a payment-terms exception is asked for and decided on the Commercial terms tab (FB-25). The
  // bare quote would open a pricer on the Quoting tab, away from what the notice is about.
  if (type === 'quote.terms_exception_requested' || type === 'quote.terms_exception_decided') {
    return 'commercial';
  }
  return 'quote';
}
