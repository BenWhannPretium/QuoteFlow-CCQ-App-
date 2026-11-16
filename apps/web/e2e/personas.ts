import type { Page } from '@playwright/test';

/** Must match DEV_PERSONA_STORAGE_KEY in src/auth/permissions.ts. */
const PERSONA_KEY = 'ccq.devPersona';
const THEME_KEY = 'ccq.theme';

/**
 * What each synthetic persona (packages/db/seeds/synthetic/personas.ts) should see, given the
 * seeded permission matrix. A matrix change that moves a nav item fails here on purpose.
 * FB-18 (W13-29): `home` is the Command Center, and Analytics is one of its views, not a nav item.
 */
export const PERSONA_EXPECTATIONS: { persona: string; landing: string; nav: string[] }[] = [
  { persona: 'kam', landing: 'KAM', nav: ['home', 'intake', 'proposals', 'pipeline'] },
  { persona: 'kam-owner', landing: 'KAM', nav: ['home', 'intake', 'proposals', 'pipeline'] },
  { persona: 'kam-region', landing: 'KAM', nav: ['home', 'intake', 'proposals', 'pipeline'] },
  {
    persona: 'sales-leader',
    landing: 'SalesLeader',
    nav: ['home', 'intake', 'proposals', 'qualify', 'pipeline', 'approvals'],
  },
  {
    persona: 'eng-lead',
    landing: 'EngLead',
    nav: ['home', 'queue-engineering', 'pipeline', 'approvals'],
  },
  { persona: 'engineer', landing: 'Engineer', nav: ['home', 'queue-engineering', 'pipeline'] },
  {
    persona: 'engineer-owner',
    landing: 'Engineer',
    nav: ['home', 'queue-engineering', 'pipeline'],
  },
  {
    persona: 'pricing',
    landing: 'Pricing',
    nav: ['home', 'queue-pricing', 'pipeline'],
  },
  // B-26: the pricing lead triages the same queue.
  {
    persona: 'pricing-lead',
    landing: 'PricingLead',
    nav: ['home', 'queue-pricing', 'pipeline'],
  },
  // FB-16 (W13-15): the Production Scheduler works the capacity part of the quotes assigned to them.
  {
    persona: 'production-scheduler',
    landing: 'ProductionScheduler',
    nav: ['home', 'queue-engineering', 'pipeline'],
  },
  // FB-07 (F-083): Finance reads quotes and uploads the ROI model, nothing else.
  { persona: 'finance', landing: 'Finance', nav: ['home', 'pipeline'] },
  { persona: 'approver', landing: 'Approver', nav: ['home', 'pipeline', 'approvals'] },
  {
    persona: 'leadership',
    landing: 'Leadership',
    nav: ['home', 'queue-engineering', 'queue-pricing', 'pipeline', 'approvals', 'admin'],
  },
  {
    persona: 'admin',
    landing: 'Admin',
    nav: ['home', 'intake', 'queue-engineering', 'queue-pricing', 'pipeline', 'approvals', 'admin'],
  },
  {
    persona: 'multi-role',
    landing: 'Approver',
    nav: ['home', 'intake', 'proposals', 'qualify', 'pipeline', 'approvals'],
  },
];

/** Sign in as a dev persona (the app reads it from sessionStorage before the first API call). */
export async function signInAs(page: Page, persona: string, theme?: 'light' | 'dark') {
  await page.addInitScript(
    ([personaKey, persona, themeKey, theme]) => {
      window.sessionStorage.setItem(personaKey!, persona!);
      if (theme) window.localStorage.setItem(themeKey!, theme);
    },
    [PERSONA_KEY, persona, THEME_KEY, theme ?? ''],
  );
}

/** The data-nav keys of the visible primary navigation (rail on desktop, tabs on mobile). */
export async function visibleNavKeys(page: Page): Promise<string[]> {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  return nav
    .locator('[data-nav]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-nav') ?? ''));
}
