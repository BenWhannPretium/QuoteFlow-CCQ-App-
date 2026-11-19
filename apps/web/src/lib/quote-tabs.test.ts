import { ROLES, permissionsForRoles, type Role } from '@ccq/domain';
import { describe, expect, it } from 'vitest';

import {
  QUOTE_TABS,
  defaultQuoteTab,
  isQuoteTab,
  tabForHash,
  tabsWithWork,
  termsWorkWaiting,
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

/** FB-25 (N18-18): Commercial terms gets its own tab, and opens for the people whose work it is. */
describe('the Commercial terms tab', () => {
  it('sits between Quoting and Attachments', () => {
    expect(QUOTE_TABS).toEqual(['overview', 'engineering', 'quoting', 'commercial', 'attachments']);
  });

  const at = (role: Role, input: { inIntake?: boolean; termsWork?: boolean }) =>
    defaultQuoteTab({
      inEngineering: false,
      inQuoting: false,
      ...input,
      permissions: permissionsForRoles([role]),
    });

  it('opens for a sales leader while the quote is at Intake; others keep the Overview', () => {
    expect(ROLES.filter((r) => at(r, { inIntake: true }) === 'commercial')).toEqual([
      'SalesLeader',
    ]);
    expect(at('SalesLeader', {})).toBe('overview');
  });

  it('opens for those with terms.edit when the terms wait on them', () => {
    expect(ROLES.filter((r) => at(r, { termsWork: true }) === 'commercial')).toEqual([
      'KAM',
      'SalesLeader',
      'Pricing',
      'PricingLead',
    ]);
    expect(at('Pricing', { termsWork: false })).toBe('overview');
  });

  it('comes after the stage’s own work tab', () => {
    const permissions = permissionsForRoles(['Pricing']);
    expect(
      defaultQuoteTab({ inEngineering: false, inQuoting: true, termsWork: true, permissions }),
    ).toBe('quoting');
  });

  it('knows when the terms wait on the reader', () => {
    const base = {
      stageKey: 'FINAL_REVIEW',
      closed: false,
      canEditTerms: true,
      exceptionCanDecide: false,
      toolingCommitmentAnswered: false,
    };
    expect(termsWorkWaiting(base)).toBe(true);
    expect(termsWorkWaiting({ ...base, toolingCommitmentAnswered: true })).toBe(false);
    expect(termsWorkWaiting({ ...base, canEditTerms: false })).toBe(false);
    expect(termsWorkWaiting({ ...base, stageKey: 'QUOTING' })).toBe(false);
    expect(termsWorkWaiting({ ...base, closed: true })).toBe(false);
    // A payment-terms exception to decide, at any open stage.
    expect(
      termsWorkWaiting({
        ...base,
        stageKey: 'QUOTING',
        canEditTerms: false,
        exceptionCanDecide: true,
      }),
    ).toBe(true);
  });
});

describe('links to a place on the page (FB-25)', () => {
  it('opens Commercial terms for #commercial and its fields, so old links keep working', () => {
    expect(tabForHash('#commercial')).toBe('commercial');
    expect(tabForHash('commercial')).toBe('commercial');
    expect(tabForHash('#terms-tooling-commitment')).toBe('commercial');
  });

  it('opens the Overview for its cards, and leaves any other hash to the tab rules', () => {
    expect(tabForHash('#offer-letter')).toBe('overview');
    expect(tabForHash('#decision')).toBeNull();
    expect(tabForHash('')).toBeNull();
  });
});

describe('the dot on a tab with work waiting (FB-25)', () => {
  it('follows the next step when it is the reader’s move, and the terms', () => {
    expect(
      tabsWithWork({ nextStep: { yourMove: true, place: 'engineering' }, termsWork: false }),
    ).toEqual(['engineering']);
    expect(
      tabsWithWork({ nextStep: { yourMove: false, place: 'quoting' }, termsWork: true }),
    ).toEqual(['commercial']);
    expect(
      tabsWithWork({ nextStep: { yourMove: true, place: 'decision' }, termsWork: false }),
    ).toEqual([]);
    expect(tabsWithWork({ nextStep: undefined, termsWork: false })).toEqual([]);
  });
});

describe('the quote tabs', () => {
  it('knows its own names and nothing else', () => {
    expect(isQuoteTab('overview')).toBe(true);
    expect(isQuoteTab('engineering')).toBe(true);
    expect(isQuoteTab('quoting')).toBe(true);
    expect(isQuoteTab('attachments')).toBe(true);
    expect(isQuoteTab('commercial')).toBe(true);
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
