import type { Page } from '@playwright/test';

/** Must match DEV_PERSONA_STORAGE_KEY in src/auth/permissions.ts. */
const PERSONA_KEY = 'ccq.devPersona';
const THEME_KEY = 'ccq.theme';

/**
 * What each synthetic persona (packages/db/seeds/synthetic/personas.ts) should see, given the
 * seeded permission matrix. A matrix change that moves a nav item fails here on purpose.
 */
export const PERSONA_EXPECTATIONS: { persona: string; landing: string; nav: string[] }[] = [
  { persona: 'kam', landing: 'KAM', nav: ['home', 'intake', 'pipeline'] },
  { persona: 'kam-owner', landing: 'KAM', nav: ['home', 'intake', 'pipeline'] },
  { persona: 'kam-region', landing: 'KAM', nav: ['home', 'intake', 'pipeline'] },
  {
    persona: 'sales-leader',
    landing: 'SalesLeader',
    nav: ['home', 'intake', 'qualify', 'pipeline', 'analytics'],
  },
  {
    persona: 'eng-lead',
    landing: 'EngLead',
    nav: ['home', 'queue-engineering', 'pipeline', 'analytics'],
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
    nav: ['home', 'queue-pricing', 'pipeline', 'analytics'],
  },
  { persona: 'approver', landing: 'Approver', nav: ['home', 'pipeline', 'approvals', 'analytics'] },
  { persona: 'leadership', landing: 'Leadership', nav: ['home', 'pipeline', 'analytics'] },
  { persona: 'admin', landing: 'Admin', nav: ['home', 'intake', 'pipeline', 'analytics', 'admin'] },
  {
    persona: 'multi-role',
    landing: 'Approver',
    nav: ['home', 'intake', 'qualify', 'pipeline', 'approvals', 'analytics'],
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
