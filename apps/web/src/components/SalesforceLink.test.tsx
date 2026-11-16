import type { MeResponse } from '@ccq/contracts';
import { permissionsForRoles, type Role } from '@ccq/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { meQueryKey } from '@/auth/permissions';

import { SalesforceLink, SalesforceUrlHint } from './SalesforceLink';

/**
 * FB-18 (W13-31): the Salesforce opportunity is a link wherever it is shown. Rendered to static markup;
 * the Admin's "Set the Salesforce URL" link (a router link) is checked in the Playwright spec.
 */
const ID = '006SYN000000000001';
const LINK = `https://example.test/lightning/r/Opportunity/${ID}/view`;
const linked = { sfOpportunityId: ID, sfOpportunityUrl: LINK };
const unlinked = { sfOpportunityId: ID, sfOpportunityUrl: null };

/** Renders as a signed-in user with one role (the hint reads `/me` permissions). */
function renderAs(role: Role, node: ReactNode): string {
  const me: MeResponse = {
    user: { id: '0192f0c0-0000-7000-8000-000000000001', displayName: 'T', upn: 't', email: null },
    roles: [role],
    permissions: permissionsForRoles([role]),
    scope: { type: 'all' },
    featureFlags: {},
    authMode: 'dev',
  };
  const client = new QueryClient();
  client.setQueryData(meQueryKey, me);
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('SalesforceLink, with the Salesforce URL set', () => {
  it('opens the Lightning record in a new tab, safely', () => {
    const html = renderToStaticMarkup(<SalesforceLink quote={linked} />);
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('data-testid="open-in-salesforce"');
    expect(html).toContain('Open in Salesforce');
    expect(html).toContain('↗');
  });

  it('uses the given text as the link: the opportunity name in a queue row', () => {
    const html = renderToStaticMarkup(
      <SalesforceLink quote={linked} label="Synthetic 32 oz bottle" hint={false} />,
    );
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain('Synthetic 32 oz bottle');
    expect(html).not.toContain('Open in Salesforce ↗');
    // The link still says where it goes.
    expect(html).toContain('title="Open in Salesforce (new tab)"');
  });

  it('never shows the Admin hint: there is nothing to set', () => {
    expect(renderAs('Admin', <SalesforceLink quote={linked} />)).not.toContain('sf-url-hint');
    expect(renderAs('Admin', <SalesforceUrlHint quotes={[linked, linked]} />)).toBe('');
    expect(renderAs('Admin', <SalesforceUrlHint quotes={[]} />)).toBe('');
  });
});

describe('SalesforceLink, before an Admin sets the Salesforce URL', () => {
  it('shows the plain opportunity ID and no link', () => {
    const html = renderToStaticMarkup(<SalesforceLink quote={unlinked} hint={false} />);
    expect(html).toContain('data-testid="sf-opportunity-plain"');
    expect(html).toContain(ID);
    expect(html).not.toContain('<a ');
  });

  it('shows the given text plain (a queue row reads as before), without the ID marker', () => {
    const html = renderToStaticMarkup(
      <SalesforceLink quote={unlinked} label="Synthetic 32 oz bottle" hint={false} />,
    );
    expect(html).toContain('Synthetic 32 oz bottle');
    expect(html).not.toContain('sf-opportunity-plain');
    expect(html).not.toContain('<a ');
  });

  it('shows the hint to nobody but an Admin', () => {
    const others: Role[] = ['KAM', 'SalesLeader', 'EngLead', 'Pricing', 'Approver', 'Leadership'];
    for (const role of others) {
      const html = renderAs(role, <SalesforceLink quote={unlinked} />);
      expect(html, role).toContain(ID);
      expect(html, role).not.toContain('sf-url-hint');
      expect(renderAs(role, <SalesforceUrlHint quotes={[unlinked]} />), role).toBe('');
    }
  });
});
