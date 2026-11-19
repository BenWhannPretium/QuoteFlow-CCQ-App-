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

  it('opens a send-back at the rework review step (FB-15, W13-05)', () => {
    expect(notificationTarget('quote.reworked')).toBe('rework');
  });

  it('FB-30: the scheduler’s capacity notices open the Capacity tab', () => {
    expect(notificationTarget('quote.capacity_assigned')).toBe('capacity');
    expect(notificationTarget('quote.capacity_ready')).toBe('capacity');
  });

  it('FB-30: a capacity block (to the engineer) and a part submitted open the Engineering tab', () => {
    expect(notificationTarget('quote.capacity_blocked')).toBe('engineering');
    expect(notificationTarget('quote.part_submitted')).toBe('engineering');
  });

  it('opens a payment-terms exception on the Commercial panel (UX-012)', () => {
    expect(notificationTarget('quote.terms_exception_requested')).toBe('commercial');
    expect(notificationTarget('quote.terms_exception_decided')).toBe('commercial');
  });

  it('FB-25 (N18-17): a quote to qualify opens To qualify, not the quote', () => {
    expect(notificationTarget('quote.to_qualify')).toBe('qualify');
  });

  it('opens the quote for everything else', () => {
    for (const type of [
      'quote.progress',
      'quote.on_hold',
      'quote.closed',
      'quote.lead_review_update',
      'comment.posted',
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
