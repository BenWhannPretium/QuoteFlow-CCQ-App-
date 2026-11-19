/**
 * Where a notification opens: the Engineering, Capacity (FB-30) or Quoting tab, the Final Review screen,
 * the Commercial terms tab (FB-25), the To qualify queue with the quote's card open (FB-25), or the quote
 * itself (which opens on the reader's own work: UX-012).
 */
export type NotificationTarget =
  'engineering' | 'capacity' | 'quoting' | 'review' | 'commercial' | 'qualify' | 'quote' | 'rework';

export function notificationTarget(type: string): NotificationTarget {
  // FB-15 (W13-05): a send-back opens the KAM's rework at the review step, at the field to fix.
  if (type === 'quote.reworked') return 'rework';
  if (type === 'quote.ready_for_eng_review' || type === 'quote.assigned') return 'engineering';
  // FB-30 (N19-28): the production scheduler's notices (they go to the assigned scheduler only) open the
  // Capacity tab, where capacity is worked.
  if (type === 'quote.capacity_assigned' || type === 'quote.capacity_ready') return 'capacity';
  // FB-16 (W13-17): a capacity block goes to the engineer, the engineering lead and the KAM: the solution
  // is reworked on the Engineering tab. FB-22: the other part of an engineering review was submitted (the
  // in-app notice does not say which part, so it opens Engineering).
  if (type === 'quote.capacity_blocked' || type === 'quote.part_submitted') return 'engineering';
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
