import type { QuoteSummary } from '@ccq/contracts';
import { Link } from '@tanstack/react-router';
import type { MouseEvent, ReactNode } from 'react';

import { useCan } from '@/auth/hooks';
import { cn } from '@/lib/utils';

/** Anything that carries the opportunity: a quote, or a row of a queue or list. */
type Linked = Pick<QuoteSummary, 'sfOpportunityId' | 'sfOpportunityUrl'>;

// Inside a table row that opens the quote on click, the link must not open the quote too.
const stop = (e: MouseEvent) => e.stopPropagation();

// 44 px tall on a phone (mobile.spec.ts); the text's own height from 641 px.
const TAP = 'inline-flex min-h-11 items-center sm:min-h-0';

/**
 * The Salesforce opportunity as a link, wherever the opportunity is shown (FB-04, F-076; FB-18, W13-31,
 * Zachary Cairns and Bailey Schmitt: a link the KAM can tap, also on a phone). It opens the Lightning
 * record page in a new tab; on a phone with the Salesforce app the same URL opens the app.
 *
 * - No `label`: "Open in Salesforce ↗" (the quote header, the reminder).
 * - With a `label` (the opportunity's name in a queue row, the ID on the Intake card): that text is the
 *   link.
 *
 * Until an Admin sets `salesforce_instance_url` there is no link: the plain ID (or the label) is shown
 * and, to Admins only, where to set the URL. Lists pass `hint={false}` and show the hint once.
 */
export function SalesforceLink({
  quote,
  className,
  label,
  hint = true,
}: {
  quote: Linked;
  className?: string;
  /** The link's text instead of "Open in Salesforce". */
  label?: ReactNode;
  /** Show the Admin-only "Set the Salesforce URL" link when there is no URL (default true). */
  hint?: boolean;
}) {
  const named = label !== undefined && label !== null;
  if (!quote.sfOpportunityUrl) {
    return (
      <>
        {named ? (
          <span className={className}>{label}</span>
        ) : (
          <span className={cn('font-mono text-xs', className)} data-testid="sf-opportunity-plain">
            {quote.sfOpportunityId}
          </span>
        )}
        {hint && <SalesforceUrlHint />}
      </>
    );
  }
  return (
    <a
      href={quote.sfOpportunityUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop}
      {...(named ? { title: 'Open in Salesforce (new tab)' } : {})}
      className={cn(
        TAP,
        'text-emphasis gap-1 text-sm font-medium underline-offset-4 hover:underline',
        className,
      )}
      data-testid="open-in-salesforce"
    >
      {named ? label : 'Open in Salesforce'} ↗
    </a>
  );
}

/**
 * FB-18 (W13-31): shown to Admins only (`config.manage`) while the Salesforce URL is not set, so the
 * person who can fix it sees where. With `quotes` (a list page) it shows once, and only when a listed
 * quote has no link.
 */
export function SalesforceUrlHint({
  quotes,
  className,
}: {
  quotes?: readonly Linked[];
  className?: string;
}) {
  const isAdmin = useCan('config.manage');
  if (!isAdmin) return null;
  if (quotes?.every((q) => q.sfOpportunityUrl)) return null;
  return (
    <Link
      to="/admin/settings"
      onClick={stop}
      className={cn(
        TAP,
        'text-emphasis w-fit text-xs font-medium underline-offset-4 hover:underline',
        className,
      )}
      data-testid="sf-url-hint"
    >
      Set the Salesforce URL in Admin → Settings
    </Link>
  );
}
