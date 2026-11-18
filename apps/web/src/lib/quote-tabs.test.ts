import { ROLES, permissionsForRoles, type Role } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import {
  defaultQuoteTab,
  isQuoteTab,
  withOpenedTab,
  type OpenedTabs,
  type QuoteTab,
} from './quote-tabs';

/**
 * UX-012: a quote opens on the reader's own work. The permissions come from the real matrix (what `/me`
 * returns for a role), so a matrix change that moves a role's tab fails here on purpose.
 */
describe('the tab a quote opens on', () => {
  const opensOn = (role: Role, stage: 'engineering' | 'quoting' | 'other'): QuoteTab =>
    defaultQuoteTab({
      inEngineering: stage === 'engineering',
      inQuoting: stage === 'quoting',
      permissions: permissionsForRoles([role]),
    });
  const rolesOpeningOn = (tab: QuoteTab, stage: 'engineering' | 'quoting' | 'other') =>
    ROLES.filter((role) => opensOn(role, stage) === tab);

  it('is Engineering, in the engineering stage, for the roles that work it', () => {
    expect(rolesOpeningOn('engineering', 'engineering')).toEqual([
      'EngLead',
      'Engineer',
      'ProductionScheduler',
    ]);
  });

  it('is Quoting, in the quoting stage, for the roles that work it', () => {
    // Admin holds roi.upload (for support), so it counts as working the stage.
    expect(rolesOpeningOn('quoting', 'quoting')).toEqual([
      'Pricing',
      'PricingLead',
      'Finance',
      'Admin',
    ]);
  });

  it('is Overview for everyone else, and for every role in any other stage', () => {
    expect(opensOn('KAM', 'engineering')).toBe('overview');
    expect(opensOn('SalesLeader', 'quoting')).toBe('overview');
    expect(opensOn('Approver', 'quoting')).toBe('overview');
    expect(opensOn('Leadership', 'engineering')).toBe('overview');
    // An engineer does not work the quoting stage, nor a pricer the engineering stage.
    expect(opensOn('Engineer', 'quoting')).toBe('overview');
    expect(opensOn('Pricing', 'engineering')).toBe('overview');
    expect(rolesOpeningOn('overview', 'other')).toEqual([...ROLES]);
  });

  it('never opens on Engineering or Quoting without a permission', () => {
    expect(defaultQuoteTab({ inEngineering: true, inQuoting: false, permissions: [] })).toBe(
      'overview',
    );
    expect(
      defaultQuoteTab({ inEngineering: false, inQuoting: true, permissions: ['quote.read'] }),
    ).toBe('overview');
  });

  it('follows the stage for someone who works both', () => {
    const both = permissionsForRoles(['EngLead', 'PricingLead']);
    expect(defaultQuoteTab({ inEngineering: true, inQuoting: false, permissions: both })).toBe(
      'engineering',
    );
    expect(defaultQuoteTab({ inEngineering: false, inQuoting: true, permissions: both })).toBe(
      'quoting',
    );
  });
});

describe('the quote tabs', () => {
  it('knows its own names and nothing else', () => {
    expect(isQuoteTab('overview')).toBe(true);
    expect(isQuoteTab('engineering')).toBe(true);
    expect(isQuoteTab('quoting')).toBe(true);
    expect(isQuoteTab('attachments')).toBe(true);
    expect(isQuoteTab('Engineering')).toBe(false);
    expect(isQuoteTab('timeline')).toBe(false);
    expect(isQuoteTab(undefined)).toBe(false);
  });
});

/** UX-001: a tab stays on the page once it has been opened. */
describe('the tabs opened so far', () => {
  const start: OpenedTabs = { quoteNumber: 'CCQ-2026-00001', tabs: ['overview'] };

  it('adds a tab the first time it is opened', () => {
    const afterEngineering = withOpenedTab(start, 'CCQ-2026-00001', 'engineering');
    expect(afterEngineering.tabs).toEqual(['overview', 'engineering']);
    // Looking at Attachments does not drop Engineering: its typed values stay on the page.
    const afterAttachments = withOpenedTab(afterEngineering, 'CCQ-2026-00001', 'attachments');
    expect(afterAttachments.tabs).toEqual(['overview', 'engineering', 'attachments']);
  });

  it('returns the same object when the tab was already opened', () => {
    expect(withOpenedTab(start, 'CCQ-2026-00001', 'overview')).toBe(start);
  });

  it('starts again on another quote', () => {
    const both = withOpenedTab(start, 'CCQ-2026-00001', 'engineering');
    expect(withOpenedTab(both, 'CCQ-2026-00002', 'quoting')).toEqual({
      quoteNumber: 'CCQ-2026-00002',
      tabs: ['quoting'],
    });
  });
});
