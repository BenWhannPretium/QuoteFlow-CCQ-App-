import { describe, expect, it } from 'vitest';

import {
  EMAIL_MAX_ATTEMPTS,
  NOTIFICATION_EVENTS,
  dueDigestDay,
  centralHour,
  emailDeliveryFor,
  emailPreferenceEvents,
  emailPreferenceKey,
  emailRetryDelayMs,
  findCommercialFigures,
  hasCommercialFigure,
  isEmailPreferenceType,
  scrubCommercialFigures,
} from './index';
import { quotesToWarnExpiring } from '../outcome/validity';

describe('notification catalogue', () => {
  it('lists each type once', () => {
    const types = NOTIFICATION_EVENTS.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('matches the B-18 P0 table', () => {
    const immediate = [
      'quote.ready_for_eng_review',
      'quote.assigned',
      'quote.reworked',
      'quote.ready_for_final_review',
      'quote.approved_for_customer',
      'quote.declined',
      'comment.mention',
      'quote.validity_expiring',
      'quote.validity_expired',
    ];
    for (const t of immediate) expect(emailDeliveryFor(t), t).toBe('immediate');
    expect(emailDeliveryFor('quote.to_qualify')).toBe('daily_digest');
  });

  it('keeps overrides, pricing arrival and integration failures in-app only', () => {
    for (const t of [
      'override.requested',
      'override.approved',
      'override.rejected',
      'override.reverted',
      'quote.ready_for_quoting',
      'integration.failed',
      'notification.delivery_failed',
      'something.unknown',
    ]) {
      expect(emailDeliveryFor(t), t).toBe('none');
      expect(isEmailPreferenceType(t), t).toBe(false);
    }
  });

  it('offers a preference for exactly the types that have an email', () => {
    const offered = emailPreferenceEvents().map((e) => e.type);
    expect(offered).toContain('quote.to_qualify');
    expect(offered).not.toContain('override.requested');
    expect(offered.every((t) => emailDeliveryFor(t) !== 'none')).toBe(true);
    expect(emailPreferenceKey('quote.assigned')).toBe('email.quote.assigned');
  });
});

describe('email retry schedule', () => {
  it('allows 3 tries with 1 and 5 minute waits', () => {
    expect(EMAIL_MAX_ATTEMPTS).toBe(3);
    expect(emailRetryDelayMs(1)).toBe(60_000);
    expect(emailRetryDelayMs(2)).toBe(300_000);
    expect(emailRetryDelayMs(3)).toBeNull();
    expect(emailRetryDelayMs(9)).toBeNull();
  });
});

describe('commercial figure guard', () => {
  it.each([
    '$1,200,000',
    'about $ 5',
    '€450',
    '£12.50',
    'USD 4500',
    'US$ 12',
    '12,500 USD',
    '3.5 dollars',
    '1.2M USD',
    '45 $',
  ])('flags %s', (text) => {
    expect(hasCommercialFigure(text)).toBe(true);
    expect(findCommercialFigures(`cost ${text} ok`).length).toBeGreaterThan(0);
  });

  it.each([
    'CCQ-2026-00042 needs your review: Engineering queue',
    'Valid until 2026-11-12',
    'Tier: High',
    '3 days left',
    'Acme Packaging · 16 oz HDPE bottle',
    'Engineering',
  ])('does not flag %s', (text) => {
    expect(hasCommercialFigure(text)).toBe(false);
  });

  it('scrubs figures out of free text', () => {
    expect(scrubCommercialFigures('Tooling is $250,000 for the 16 oz')).toBe(
      'Tooling is [figure removed] for the 16 oz',
    );
    expect(scrubCommercialFigures('no money here')).toBe('no money here');
  });

  it('removes the whole amount, suffixes and trailing punctuation included', () => {
    expect(scrubCommercialFigures('Budget $1.2M, tooling USD 4,500. Done')).toBe(
      'Budget [figure removed], tooling [figure removed]. Done',
    );
    expect(scrubCommercialFigures('capital of 2.5 MM USD approved')).toBe(
      'capital of [figure removed] approved',
    );
    expect(hasCommercialFigure(scrubCommercialFigures('$99 and 12 EUR and 7k USD'))).toBe(false);
  });
});

describe('digest schedule (7:00 US Central)', () => {
  it('is not due before 7:00 Central and is due after, keyed by the Central date', () => {
    // 2026-10-20 11:59Z = 6:59 CDT; 12:00Z = 7:00 CDT.
    expect(dueDigestDay(new Date('2026-10-20T11:59:00Z'))).toBeNull();
    expect(dueDigestDay(new Date('2026-10-20T12:00:00Z'))).toBe('2026-10-20');
    expect(dueDigestDay(new Date('2026-10-20T14:59:00Z'))).toBe('2026-10-20'); // 9:59 CDT
  });

  it('stops after the catch-up window, so a late restart sends nothing mid-afternoon', () => {
    expect(dueDigestDay(new Date('2026-10-20T15:00:00Z'))).toBeNull(); // 10:00 CDT
    expect(dueDigestDay(new Date('2026-10-20T23:30:00Z'))).toBeNull();
  });

  it('follows the clock change (CST after 2026-11-01)', () => {
    // 2026-11-03 12:59Z = 6:59 CST; 13:00Z = 7:00 CST.
    expect(dueDigestDay(new Date('2026-11-03T12:59:00Z'))).toBeNull();
    expect(dueDigestDay(new Date('2026-11-03T13:00:00Z'))).toBe('2026-11-03');
  });

  it('reads the Central wall clock, not UTC', () => {
    // 2026-10-21 02:00Z is still 9 PM on the 20th in Chicago: nowhere near the window.
    expect(centralHour(new Date('2026-10-21T02:00:00Z'))).toBe(21);
    expect(dueDigestDay(new Date('2026-10-21T02:00:00Z'))).toBeNull();
    // 12:30Z is 7:30 CDT on the same UTC date.
    expect(dueDigestDay(new Date('2026-10-21T12:30:00Z'))).toBe('2026-10-21');
  });
});

describe('quotesToWarnExpiring', () => {
  const base = {
    id: 'q',
    quoteNumber: 'CCQ-2026-00001',
    stageKey: 'CUSTOMER_DECISION',
    status: 'active',
    kamUserId: 'u',
    validityExpiredFlaggedAt: null,
  };
  const now = new Date('2026-10-20T15:00:00Z'); // 2026-10-20 Central

  it('selects open Customer Decision quotes within the warning window, not past it', () => {
    const rows = [
      { ...base, id: 'far', validityUntil: '2026-11-30' },
      { ...base, id: 'edge', validityUntil: '2026-10-27' }, // 7 days left
      { ...base, id: 'today', validityUntil: '2026-10-20' }, // last valid day
      { ...base, id: 'gone', validityUntil: '2026-10-19' }, // expired: the expiry job's state
      { ...base, id: 'closed', validityUntil: '2026-10-22', status: 'closed' },
      { ...base, id: 'elsewhere', validityUntil: '2026-10-22', stageKey: 'QUOTING' },
      { ...base, id: 'none', validityUntil: null },
    ];
    const out = quotesToWarnExpiring(rows, now, 7);
    expect(out.map((r) => [r.id, r.daysLeft])).toEqual([
      ['edge', 7],
      ['today', 0],
    ]);
  });

  it('honours the configured window', () => {
    const rows = [{ ...base, id: 'a', validityUntil: '2026-10-27' }];
    expect(quotesToWarnExpiring(rows, now, 3)).toEqual([]);
    expect(quotesToWarnExpiring(rows, now, 14)).toHaveLength(1);
  });
});
