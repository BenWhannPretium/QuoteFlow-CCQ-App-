import { describe, expect, it } from 'vitest';

import { notificationTarget } from './notification-target';

describe('notificationTarget', () => {
  it('sends engineering alerts to the Engineering tab', () => {
    expect(notificationTarget('quote.ready_for_eng_review')).toBe('engineering');
    expect(notificationTarget('quote.assigned')).toBe('engineering');
  });

  it('sends pricing alerts to the Quoting tab (FB-05)', () => {
    expect(notificationTarget('quote.ready_for_quoting')).toBe('quoting');
    expect(notificationTarget('quote.pricing_assigned')).toBe('quoting');
    expect(notificationTarget('quote.ready_for_roi')).toBe('quoting');
    expect(notificationTarget('quote.roi_uploaded')).toBe('quoting');
  });

  it('sends an approval request to the Final Review screen', () => {
    expect(notificationTarget('quote.ready_for_final_review')).toBe('review');
  });

  it('opens the quote for everything else', () => {
    for (const type of [
      'quote.reworked',
      'quote.progress',
      'quote.on_hold',
      'quote.closed',
      'quote.lead_review_update',
      'comment.posted',
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
