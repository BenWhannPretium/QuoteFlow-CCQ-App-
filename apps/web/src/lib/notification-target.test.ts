import { describe, expect, it } from 'vitest';

import { notificationTarget } from './notification-target';

describe('notificationTarget', () => {
  it('sends engineering alerts to the Engineering tab', () => {
    expect(notificationTarget('quote.ready_for_eng_review')).toBe('engineering');
    expect(notificationTarget('quote.assigned')).toBe('engineering');
  });

  it('sends an approval request to the Final Review screen', () => {
    expect(notificationTarget('quote.ready_for_final_review')).toBe('review');
  });

  it('opens the quote for everything else', () => {
    for (const type of [
      'quote.reworked',
      'quote.to_qualify',
      'quote.approved_for_customer',
      'quote.declined',
      'comment.mention',
      'quote.validity_expiring',
      'quote.validity_expired',
      'override.requested',
      'something.new',
    ]) {
      expect(notificationTarget(type), type).toBe('quote');
    }
  });
});
