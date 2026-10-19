/** Where a notification opens: the Engineering tab, the Final Review screen, or the quote itself. */
export type NotificationTarget = 'engineering' | 'review' | 'quote';

export function notificationTarget(type: string): NotificationTarget {
  if (type === 'quote.ready_for_eng_review' || type === 'quote.assigned') return 'engineering';
  if (type === 'quote.ready_for_final_review') return 'review';
  return 'quote';
}
