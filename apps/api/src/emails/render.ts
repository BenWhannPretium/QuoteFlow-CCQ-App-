import { hasCommercialFigure, scrubCommercialFigures } from '@ccq/domain';

import { renderLayout, type Fact } from './layout';

/** What an email may say about a quote: the facts the spec lists, nothing commercial. */
export interface EmailQuote {
  number: string;
  /** Null when the recipient may not see the quote (RLS) or it has no account yet. */
  account: string | null;
  product: string | null;
  /** The priority tier label the recipient is allowed to see; null when hidden. */
  tier: string | null;
  /** Deep link. */
  url: string;
}

export type EmailDigestItem = EmailQuote;

export interface EmailModel {
  /** The notification type (the catalogue key). */
  type: string;
  quote: EmailQuote | null;
  /** Safe facts stored with the notification: actor, reason label, validity date, returnedFrom. */
  payload: Readonly<Record<string, string>>;
  /** The daily to-qualify digest. */
  digest?: { items: EmailDigestItem[]; more: number; url: string };
  preferencesUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Copy {
  /** After the quote number in the subject: `<number> <phrase>: <context>`. */
  phrase: string;
  context: string;
  heading: string;
  action: (p: Readonly<Record<string, string>>) => string;
  cta: string;
}

const sentence = (...parts: (string | false | undefined)[]) =>
  parts.filter((p): p is string => Boolean(p)).join(' ');

const RETURNED: Record<string, string> = {
  final_review: 'Final Review returned it for another look.',
  customer_requote: 'The customer asked for a re-quote.',
};

const COPY: Record<string, Copy> = {
  'quote.ready_for_eng_review': {
    phrase: 'needs your review',
    context: 'Engineering queue',
    heading: 'A quote is in the engineering queue',
    action: (p) =>
      sentence(
        p.returnedFrom ? RETURNED[p.returnedFrom] : undefined,
        'Open the engineering queue to assign it to an engineer.',
      ),
    cta: 'Open the engineering queue',
  },
  'quote.assigned': {
    phrase: 'is assigned to you',
    context: 'Engineering review',
    heading: 'You have a quote to review',
    action: (p) =>
      p.reassigned === 'yes'
        ? 'The engineering review was reassigned to you.'
        : 'You have a new engineering review.',
    cta: 'Open the engineering review',
  },
  // B-26: the pricing lead assigned Quoting work.
  'quote.pricing_assigned': {
    phrase: 'is assigned to you',
    context: 'Quoting',
    heading: 'You have a quote to price',
    action: (p) =>
      p.reassigned === 'yes'
        ? 'The pricing lead reassigned this quote to you.'
        : 'The pricing lead assigned you a quote to price.',
    cta: 'Open Quoting',
  },
  // Lead review (2026-10-30). `kind` is engineering | pricing.
  'quote.submitted_to_lead': {
    phrase: 'is ready for your review',
    context: 'Lead review',
    heading: 'Work is waiting for your review',
    action: (p) =>
      sentence(
        p.actor
          ? `${p.actor} submitted the ${p.kind === 'pricing' ? 'pricing' : 'engineering'} work.`
          : `The ${p.kind === 'pricing' ? 'pricing' : 'engineering'} work was submitted.`,
        `Review it, then decide ${p.kind === 'pricing' ? 'G3' : 'G2'} or send it back.`,
      ),
    cta: 'Review it',
  },
  'quote.returned_by_lead': {
    phrase: 'was sent back to you',
    context: 'Lead review',
    heading: 'Your lead sent your work back',
    action: (p) =>
      sentence(
        p.actor ? `${p.actor} asked for changes.` : 'Your lead asked for changes.',
        p.note ? `Note: ${p.note}` : undefined,
        'Make the changes, then submit it again.',
      ),
    cta: 'Open the quote',
  },
  'quote.reworked': {
    phrase: 'was returned to you',
    context: 'Rework needed',
    heading: 'A quote was returned to you for rework',
    action: (p) =>
      sentence(
        p.reason ? `Reason: ${p.reason}.` : undefined,
        'Open the quote to see what to fix, then resubmit it.',
      ),
    cta: 'Open the quote',
  },
  'quote.ready_for_final_review': {
    phrase: 'needs your decision',
    context: 'Final Review',
    heading: 'A quote is awaiting Final Review',
    action: () => 'Pricing has approved the price. Open it to release or return the proposition.',
    cta: 'Open Final Review',
  },
  'quote.approved_for_customer': {
    phrase: 'was approved',
    context: 'Issue the proposal',
    heading: 'Final Review approved a quote',
    action: (p) =>
      sentence(
        'Final Review approved it. The proposal can now be issued to the customer.',
        p.validityUntil ? `It is valid until ${p.validityUntil}.` : undefined,
      ),
    cta: 'Open the quote',
  },
  'quote.declined': {
    phrase: 'was declined',
    context: 'Final Review',
    heading: 'Final Review declined a quote',
    action: (p) =>
      sentence(
        'Final Review declined it.',
        p.reason ? `Reason: ${p.reason}.` : undefined,
        'Open the quote for the approver’s note.',
      ),
    cta: 'Open the quote',
  },
  'comment.mention': {
    phrase: 'has a comment for you',
    context: 'Mention',
    heading: 'You were mentioned in a comment',
    action: (p) =>
      sentence(
        p.actor ? `${p.actor} mentioned you.` : 'Someone mentioned you.',
        'Open the quote to read the comment.',
      ),
    cta: 'Read the comment',
  },
  'quote.validity_expiring': {
    phrase: 'proposal expires soon',
    context: 'Revalidate or record the outcome',
    heading: 'A proposal’s validity is running out',
    action: (p) =>
      sentence(
        p.validityUntil ? `The proposal is valid until ${p.validityUntil}` : 'The proposal',
        p.daysLeft
          ? `(${p.daysLeft} day${p.daysLeft === '1' ? '' : 's'} left).`
          : 'is close to expiring.',
        'Revalidate it or record the customer’s outcome.',
      ),
    cta: 'Open the quote',
  },
  'quote.validity_expired': {
    phrase: 'proposal validity has passed',
    context: 'Revalidate or record the outcome',
    heading: 'A proposal’s validity has passed',
    action: (p) =>
      sentence(
        p.validityUntil ? `It was valid until ${p.validityUntil}.` : undefined,
        'Revalidate it or record the customer’s outcome.',
      ),
    cta: 'Open the quote',
  },
};

export const EMAIL_TYPES = [...Object.keys(COPY), 'quote.to_qualify'] as const;

/** A free-text value as it may appear in a message: whitespace tidied, any amount of money removed. */
const safe = (s: string | null | undefined): string | null => {
  const t = s ? scrubCommercialFigures(s.replace(/\s+/g, ' ').trim()) : '';
  return t === '' ? null : t;
};

const quoteFacts = (q: EmailQuote): Fact[] =>
  [
    { label: 'Quote', value: q.number },
    q.account ? { label: 'Account', value: safe(q.account)! } : null,
    q.product ? { label: 'Product', value: safe(q.product)! } : null,
    q.tier ? { label: 'Priority', value: safe(q.tier)! } : null,
  ].filter((f): f is Fact => f !== null);

const detailOf = (q: EmailQuote) =>
  [safe(q.account), safe(q.product), q.tier ? `${safe(q.tier)} priority` : null]
    .filter(Boolean)
    .join(' · ') || 'Open the quote for details';

/**
 * Subject, HTML and plain text for one notification. Fails closed: if any amount of money is found in
 * the finished message (it should be impossible: no template takes a commercial field, and free text is
 * scrubbed), this throws `CommercialContentError` and nothing is sent.
 */
export function renderEmail(model: EmailModel): RenderedEmail {
  const out = build(model);
  if (hasCommercialFigure(`${out.subject}\n${out.html}\n${out.text}`)) {
    throw new CommercialContentError();
  }
  return out;
}

export class CommercialContentError extends Error {
  constructor() {
    super('The email would contain a currency amount; it was not sent');
    this.name = 'CommercialContentError';
  }
}

function build(model: EmailModel): RenderedEmail {
  if (model.type === 'quote.to_qualify') return buildDigest(model);
  const copy = COPY[model.type];
  if (!copy || !model.quote) throw new Error(`No email template for ${model.type}`);
  const q = model.quote;
  // Every stored fact is free text to a template: scrub it like the account and the product.
  const payload = Object.fromEntries(
    Object.entries(model.payload).map(([k, v]) => [k, safe(v) ?? '']),
  );
  const laid = renderLayout({
    preheader: `${q.number}: ${copy.context}`,
    heading: copy.heading,
    intro: copy.action(payload),
    facts: quoteFacts(q),
    cta: { label: copy.cta, url: q.url },
    preferencesUrl: model.preferencesUrl,
  });
  return {
    subject: `[QuoteFlow] ${q.number} ${copy.phrase}: ${copy.context}`,
    ...laid,
  };
}

function buildDigest(model: EmailModel): RenderedEmail {
  const digest = model.digest;
  if (!digest) throw new Error('The to-qualify digest needs its items');
  const n = digest.items.length + digest.more;
  const laid = renderLayout({
    preheader: `${n} quote${n === 1 ? '' : 's'} waiting at G1`,
    heading: `${n} quote${n === 1 ? ' is' : 's are'} waiting to qualify`,
    intro:
      'These quotes are at the qualification gate (G1), highest priority first. Open To qualify to advance, hold, return or stop each one.',
    facts: [],
    rows: digest.items.map((i) => ({ title: i.number, detail: detailOf(i), url: i.url })),
    ...(digest.more > 0 ? { rowsNote: `…and ${digest.more} more in the queue.` } : {}),
    cta: { label: 'Open To qualify', url: digest.url },
    preferencesUrl: model.preferencesUrl,
  });
  return {
    subject: `[QuoteFlow] ${n} quote${n === 1 ? '' : 's'} waiting to qualify: Daily summary`,
    ...laid,
  };
}
