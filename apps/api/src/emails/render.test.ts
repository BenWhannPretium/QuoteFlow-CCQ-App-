import { hasCommercialFigure } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import { escapeHtml, markup, raw } from './html';
import {
  CommercialContentError,
  EMAIL_TYPES,
  renderEmail,
  type EmailModel,
  type EmailQuote,
} from './render';

const quote: EmailQuote = {
  number: 'CCQ-2026-00042',
  account: 'Acme Packaging',
  product: 'Bottle · HDPE',
  tier: 'High',
  url: 'https://ccq.example.com/quotes/CCQ-2026-00042',
};

const model = (type: string, over: Partial<EmailModel> = {}): EmailModel => ({
  type,
  quote,
  payload: {},
  preferencesUrl: 'https://ccq.example.com/me/preferences',
  ...over,
});

/** Every type with the facts its template reads, as the app writes them. */
const FIXTURES: Record<string, Record<string, string>> = {
  'quote.ready_for_eng_review': {},
  'quote.assigned': { reassigned: 'yes' },
  'quote.reworked': { reason: 'Missing information' },
  'quote.ready_for_final_review': {},
  'quote.approved_for_customer': { validityUntil: '2026-11-25' },
  'quote.declined': { reason: 'Not strategic' },
  'comment.mention': { actor: 'Dana Whitfield' },
  'quote.validity_expiring': { validityUntil: '2026-11-02', daysLeft: '5' },
  'quote.validity_expired': { validityUntil: '2026-10-30' },
};

describe('subjects', () => {
  it.each([
    [
      'quote.ready_for_eng_review',
      '[QuoteFlow] CCQ-2026-00042 needs your review: Engineering queue',
    ],
    ['quote.assigned', '[QuoteFlow] CCQ-2026-00042 is assigned to you: Engineering review'],
    ['quote.reworked', '[QuoteFlow] CCQ-2026-00042 was returned to you: Rework needed'],
    [
      'quote.ready_for_final_review',
      '[QuoteFlow] CCQ-2026-00042 needs your decision: Final Review',
    ],
    ['quote.approved_for_customer', '[QuoteFlow] CCQ-2026-00042 was approved: Issue the proposal'],
    ['quote.declined', '[QuoteFlow] CCQ-2026-00042 was declined: Final Review'],
    ['comment.mention', '[QuoteFlow] CCQ-2026-00042 has a comment for you: Mention'],
    [
      'quote.validity_expiring',
      '[QuoteFlow] CCQ-2026-00042 proposal expires soon: Revalidate or record the outcome',
    ],
    [
      'quote.validity_expired',
      '[QuoteFlow] CCQ-2026-00042 proposal validity has passed: Revalidate or record the outcome',
    ],
  ])('%s', (type, subject) => {
    expect(renderEmail(model(type, { payload: FIXTURES[type] ?? {} })).subject).toBe(subject);
  });
});

describe('content', () => {
  it.each(Object.keys(FIXTURES))(
    '%s has HTML and a text alternative with the quote, account, product, tier and a deep link',
    (type) => {
      const email = renderEmail(model(type, { payload: FIXTURES[type]! }));
      for (const part of [email.html, email.text]) {
        expect(part).toContain('CCQ-2026-00042');
        expect(part).toContain('Acme Packaging');
        expect(part).toContain('Bottle · HDPE');
        expect(part).toContain('High');
        expect(part).toContain('https://ccq.example.com/quotes/CCQ-2026-00042');
        expect(part).toContain('https://ccq.example.com/me/preferences');
      }
      expect(email.html).toMatch(/^<!doctype html>/);
      expect(email.html).toContain('QuoteFlow');
      expect(email.text).not.toMatch(/<[a-z]/i);
    },
  );

  it('has a template for every emailed type', () => {
    expect([...EMAIL_TYPES].sort()).toEqual([...Object.keys(FIXTURES), 'quote.to_qualify'].sort());
  });

  it('says why a quote came back and what the action is', () => {
    const e = renderEmail(
      model('quote.ready_for_eng_review', { payload: { returnedFrom: 'final_review' } }),
    );
    expect(e.text).toContain('Final Review returned it for another look.');
    const r = renderEmail(model('quote.reworked', { payload: { reason: 'Missing information' } }));
    expect(r.text).toContain('Reason: Missing information.');
    expect(renderEmail(model('quote.assigned', { payload: { reassigned: 'yes' } })).text).toContain(
      'reassigned to you',
    );
    expect(
      renderEmail(
        model('quote.validity_expiring', { payload: FIXTURES['quote.validity_expiring']! }),
      ).text,
    ).toContain('5 days left');
  });

  it('leaves out facts the recipient may not see, but keeps the number and the link', () => {
    const bare = renderEmail(
      model('quote.ready_for_eng_review', {
        quote: { number: quote.number, account: null, product: null, tier: null, url: quote.url },
      }),
    );
    expect(bare.text).toContain('Quote: CCQ-2026-00042');
    expect(bare.text).not.toMatch(/Account:|Product:|Priority:/);
    expect(bare.text).toContain(quote.url);
  });

  it('snapshot: the engineering-queue email', () => {
    const e = renderEmail(model('quote.ready_for_eng_review'));
    expect(e.subject).toMatchInlineSnapshot(
      `"[QuoteFlow] CCQ-2026-00042 needs your review: Engineering queue"`,
    );
    expect(e.text).toMatchInlineSnapshot(`
      "A quote is in the engineering queue

      Open the engineering queue to assign it to an engineer.

      Quote: CCQ-2026-00042
      Account: Acme Packaging
      Product: Bottle · HDPE
      Priority: High

      Open the engineering queue: https://ccq.example.com/quotes/CCQ-2026-00042

      --
      This is an automated message from QuoteFlow (Commercial Capital Quoting). Replies are not read.
      Pricing and capital figures are never sent by email; open the quote to see what you are cleared to see.
      Choose which emails you get: https://ccq.example.com/me/preferences"
    `);
  });
});

describe('no pricing or capital figures, ever', () => {
  const HOSTILE = {
    account: 'Acme $2,400,000 account',
    product: 'Tooling USD 250,000 · 12k USD run',
    tier: 'High (capital $1.2M)',
  };

  it.each(EMAIL_TYPES.filter((t) => t !== 'quote.to_qualify'))(
    '%s: amounts typed into free text never reach the message',
    (type) => {
      const e = renderEmail(
        model(type, {
          quote: { ...quote, ...HOSTILE },
          payload: {
            ...FIXTURES[type],
            reason: 'Capital of $5,000,000 is not approved',
            actor: 'Dana $9M Whitfield',
          },
        }),
      );
      for (const part of [e.subject, e.html, e.text]) {
        expect(hasCommercialFigure(part), part.slice(0, 200)).toBe(false);
        expect(part).not.toMatch(/2,400,000|250,000|1\.2M|5,000,000|\$9M/);
      }
      expect(e.text).toContain('[figure removed]');
    },
  );

  it('fails closed: an amount that gets past the scrubbing blocks the send', () => {
    // The quote number is not free text and is never scrubbed; a corrupt one must stop the email.
    expect(() =>
      renderEmail(model('quote.assigned', { quote: { ...quote, number: 'CCQ-$5000' } })),
    ).toThrow(CommercialContentError);
  });

  it('digest: items are scrubbed too', () => {
    const e = renderEmail({
      type: 'quote.to_qualify',
      quote: null,
      payload: {},
      preferencesUrl: 'https://ccq.example.com/me/preferences',
      digest: {
        items: [{ ...quote, account: 'Acme $400,000' }],
        more: 0,
        url: 'https://ccq.example.com/approvals?gate=G1',
      },
    });
    expect(hasCommercialFigure(`${e.subject}${e.html}${e.text}`)).toBe(false);
  });
});

describe('digest', () => {
  const digest = (n: number, more = 0): EmailModel => ({
    type: 'quote.to_qualify',
    quote: null,
    payload: {},
    preferencesUrl: 'https://ccq.example.com/me/preferences',
    digest: {
      items: Array.from({ length: n }, (_, i) => ({
        ...quote,
        number: `CCQ-2026-0000${i + 1}`,
        url: `https://ccq.example.com/quotes/CCQ-2026-0000${i + 1}`,
      })),
      more,
      url: 'https://ccq.example.com/approvals?gate=G1',
    },
  });

  it('is one email listing every quote waiting, with the link to the queue', () => {
    const e = renderEmail(digest(3));
    expect(e.subject).toBe('[QuoteFlow] 3 quotes waiting to qualify: Daily summary');
    for (const n of ['CCQ-2026-00001', 'CCQ-2026-00002', 'CCQ-2026-00003']) {
      expect(e.text).toContain(n);
      expect(e.html).toContain(n);
    }
    expect(e.text).toContain('https://ccq.example.com/approvals?gate=G1');
  });

  it('says "1 quote", and counts the ones past the cut-off', () => {
    expect(renderEmail(digest(1)).subject).toBe(
      '[QuoteFlow] 1 quote waiting to qualify: Daily summary',
    );
    const e = renderEmail(digest(2, 5));
    expect(e.subject).toContain('7 quotes');
    expect(e.text).toContain('…and 5 more in the queue.');
  });
});

describe('html escaping', () => {
  it('escapes interpolated values and keeps nested templates', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    expect(markup`<p>${'<b>hi</b>'}</p>`.value).toBe('<p>&lt;b&gt;hi&lt;/b&gt;</p>');
    expect(markup`<ul>${[1, 2].map((n) => markup`<li>${n}</li>`)}</ul>`.value).toBe(
      '<ul><li>1</li><li>2</li></ul>',
    );
    expect(markup`${raw('<i>x</i>')}${null}${false}${undefined}`.value).toBe('<i>x</i>');
  });

  it('cannot be injected through an account name', () => {
    const e = renderEmail(
      model('quote.assigned', {
        quote: { ...quote, account: '<script>alert(1)</script>"><img src=x onerror=1>' },
      }),
    );
    expect(e.html).not.toContain('<script>');
    expect(e.html).not.toContain('<img src=x');
    expect(e.html).toContain('&lt;script&gt;');
  });

  it('refuses a type it has no template for', () => {
    expect(() => renderEmail(model('override.requested'))).toThrow(/No email template/);
  });
});
