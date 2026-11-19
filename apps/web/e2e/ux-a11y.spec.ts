import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';

import { prepareModels } from './models';
import { signInAs } from './personas';
import { DEV_USER_HEADER, freeOpportunities, isoDaysFromNow, submitQuote } from './quotes';

// UX-018 (docs/audit/03-ux-proposals.md, approved 2026-11-17): the accessibility pass. WCAG 2.2 AA on
// the pages people use every day, as the role that uses them:
// - axe at every impact (not only serious), light and dark, on each page in the state a user meets it;
// - every form control has a real label, and repeated buttons and links say which quote they act on;
// - the keyboard: focus is never left under the sticky header or a bar at the bottom, hidden tab panels
//   are out of the tab order, a hidden file input shows its focus on its label, menus, popovers and
//   dialogs close on Escape and give focus back, the board moves a card without a mouse, and a new
//   intake step starts at its top;
// - status messages are announced without moving focus;
// - no sideways page scroll at 320 px (400% zoom) or 640 px (200%), and reduced motion is respected;
// - targets are at least 24 px or spaced.
// Synthetic data only: the quotes are made through the API, once for the file.

const as = (persona: string) => ({ [DEV_USER_HEADER]: persona });

async function ok(res: Promise<APIResponse>) {
  const r = await res;
  expect(r.ok(), await r.text()).toBe(true);
  return r;
}

/** Provisions the persona (the e2e database is config-seeded only) and returns who it is. */
const me = async (request: APIRequestContext, persona: string) =>
  (
    (await (await ok(request.get('/api/v1/me', { headers: as(persona) }))).json()) as {
      user: { id: string; displayName: string };
    }
  ).user;

interface Quotes {
  /** Waiting for G1. */
  g1: string;
  /** Sent back to the KAM at G1 (the rework banner). */
  rework: string;
  /** On hold at G1 (the "On hold" chip). */
  held: string;
  /** In Engineering, assigned to the engineer persona, ready to submit to the lead. */
  eng: string;
  /** In Quoting. */
  quoting: string;
  /** In Final Review, the capital terms not confirmed (a blocker and warnings). */
  finalReview: string;
  /** An intake draft with every step filled in (no drawing: one warning on the review step). */
  draft: string;
}

const PERSONAS = [
  'kam',
  'sales-leader',
  'eng-lead',
  'engineer',
  'production-scheduler',
  'pricing',
  'pricing-lead',
  'finance',
  'approver',
  'leadership',
  'admin',
] as const;

let built: Promise<Quotes> | undefined;
/**
 * The quotes every test reads, made once for the run: they use seven of the shared synthetic
 * opportunities. A failed test restarts the worker, so the numbers are also kept in the run's output
 * folder (emptied when a run starts) and read back, instead of using seven more each time.
 */
function quotes(request: APIRequestContext): Promise<Quotes> {
  const kept = join(test.info().project.outputDir, 'ux-a11y-quotes.json');
  built ??= (async () => {
    if (existsSync(kept)) return JSON.parse(readFileSync(kept, 'utf8')) as Quotes;
    const made = await makeQuotes(request);
    mkdirSync(dirname(kept), { recursive: true });
    writeFileSync(kept, JSON.stringify(made));
    return made;
  })();
  return built;
}

async function makeQuotes(request: APIRequestContext): Promise<Quotes> {
  for (const p of PERSONAS) await me(request, p);
  const leader = await me(request, 'sales-leader');
  const engineer = await me(request, 'engineer');
  const pricing = await me(request, 'pricing');
  const candidates = await freeOpportunities(request, 7);
  const post = (qn: string, path: string, persona: string, data?: unknown) =>
    ok(
      request.post(`/api/v1/quotes/${qn}/${path}`, {
        headers: as(persona),
        ...(data === undefined ? {} : { data }),
      }),
    );
  const put = (qn: string, path: string, persona: string, data: unknown) =>
    ok(request.put(`/api/v1/quotes/${qn}/${path}`, { headers: as(persona), data }));
  const solution = {
    processType: 'EBM',
    machineType: 'EBM',
    plantCode: 'AURORA',
    cavitation: 8,
    cycleTimeS: 14.5,
    prelimCapitalUsd: 0,
  };
  const capacity = {
    rows: [
      {
        site: 'AURORA',
        assumedEffectivenessPct: 70,
        cycleTimeS: 14.5,
        utilizationBeforePct: 62,
        analysisDate: '2026-11-16',
        analystId: engineer.id,
      },
    ],
  };

  const g1 = await submitQuote(request, candidates);
  const rework = await submitQuote(request, candidates);
  await post(rework, 'gates/G1/decisions', 'sales-leader', {
    outcomeKey: 'rework',
    reasonCode: 'missing_information',
    note: 'Add the target neck finish',
  });
  const held = await submitQuote(request, candidates);
  await post(held, 'gates/G1/decisions', 'sales-leader', {
    outcomeKey: 'hold',
    reasonCode: 'awaiting_customer_info',
    note: 'Customer is confirming the volume',
    holdUntil: isoDaysFromNow(14),
    holdOwnerId: leader.id,
  });
  const eng = await submitQuote(request, candidates);
  await post(eng, 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
  await post(eng, 'assignment', 'eng-lead', { engineerId: engineer.id });
  await post(eng, 'eng-review/accept', 'engineer');
  await put(eng, 'eng-review', 'engineer', solution);
  await put(eng, 'capacity-evidence', 'engineer', capacity);

  const toQuoting = async () => {
    const qn = await submitQuote(request, candidates);
    await post(qn, 'gates/G1/decisions', 'sales-leader', { outcomeKey: 'advance' });
    await put(qn, 'eng-review', 'eng-lead', solution);
    await put(qn, 'capacity-evidence', 'eng-lead', capacity);
    await put(qn, 'capacity-signoff', 'eng-lead', { status: 'approved' });
    await post(qn, 'gates/G2/decisions', 'eng-lead', { outcomeKey: 'proceed' });
    return qn;
  };
  const quoting = await toQuoting();
  const finalReview = await toQuoting();
  await prepareModels(request, finalReview);
  await put(finalReview, 'pricing-record', 'pricing', {
    approvedBy: pricing.id,
    pricingBasisNote: 'March CDI',
    costingCompleted: true,
  });
  await put(finalReview, 'capital-readiness', 'pricing', { capitalReadiness: 'pre_approved' });
  await post(finalReview, 'gates/G3/decisions', 'pricing-lead', { outcomeKey: 'submit' });
  await put(finalReview, 'terms', 'kam', {
    termsToolingCommitment: true,
    termsPaymentTermsCode: 'NET_30',
  });

  const opportunityId = candidates.shift()!;
  const sf = (await (
    await ok(
      request.get(`/api/v1/salesforce/opportunities/${opportunityId}`, { headers: as('kam') }),
    )
  ).json()) as {
    opportunity: { name: string; accountId: string; accountName: string };
    account: { id: string; name: string } | null;
  };
  const shipTo = {
    line1: '1 Test Way',
    city: 'St. Louis',
    state: 'MO',
    postal: '63101',
    country: 'US',
  };
  const draftRes = await ok(
    request.post('/api/v1/quotes/drafts', {
      headers: as('kam'),
      data: {
        data: {
          sfOpportunityId: opportunityId,
          sfOpportunityName: sf.opportunity.name,
          customer: {
            status: 'existing',
            sfAccountId: sf.account?.id ?? sf.opportunity.accountId,
            name: sf.account?.name ?? sf.opportunity.accountName,
          },
          shipTo,
          shipToDefault: shipTo,
          requestClass: 'CCQ',
          productFamily: 'BOTTLE',
          components: ['CONTAINER'],
          market: 'FOOD',
          subMarket: 'FOOD_SNACKS',
          resin: 'HDPE',
          neckDiameter: '28',
          neckFinishType: '410',
          pcrLevel: '0',
          colorType: 'NATURAL',
          heightMm: 180,
          widthOrDiameterMm: 65,
          depthMm: 65,
          packagingType: 'BULK',
          estAnnualVolume: 750_000,
          estAnnualRevenue: 150_000,
          quoteNeededBy: isoDaysFromNow(30),
          productNeededBy: isoDaysFromNow(120),
          drawingStatus: 'NONE',
        },
      },
    }),
  );
  const draft = ((await draftRes.json()) as { id: string }).id;
  return { g1, rework, held, eng, quoting, finalReview, draft };
}

// ── What is checked on a page ────────────────────────────────────────────────────────────────────

/** WCAG 2.0, 2.1 and 2.2 at A and AA, and axe's best practices: every impact, not only serious. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * The two findings left as they are, both axe best practices:
 * - the comment box is a textarea with `role="combobox"` for its @mention list ("aria-allowed-role",
 *   minor). Changing how a screen reader hears that box needs a test with a real screen reader, which
 *   this pass did not have;
 * - an open menu is drawn at the end of the page, outside the landmarks, as every Radix menu is
 *   ("region", moderate). Focus is inside it while it is open, and it closes on Escape.
 */
const accepted = (ruleId: string, html: string) =>
  (ruleId === 'aria-allowed-role' && html.includes('data-testid="comment-box"')) ||
  (ruleId === 'region' && html.includes('data-radix-popper-content-wrapper'));

/** Waits for the page-load wipe, a dialog's fade or a toast, so axe measures the colours a user sees. */
async function settle(page: Page) {
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every(
            (a) =>
              a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity,
          ),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
}

async function axeViolations(page: Page): Promise<string[]> {
  await settle(page);
  const axe = new AxeBuilder({ page }).withTags(AXE_TAGS);
  // A modal menu (the board's "Move") hides the rest of the page from assistive technology while it
  // is open, as a modal dialog does. axe knows that for a dialog but not for a menu, and would report
  // the hidden page itself (focusable content under aria-hidden, no h1, no landmark). With such a
  // menu open, the menu is what is checked.
  if ((await page.locator('[data-aria-hidden="true"]').count()) > 0) {
    if ((await page.locator('[role="menu"]').count()) > 0) axe.include('[role="menu"]');
  }
  const results = await axe.analyze();
  return results.violations.flatMap((v) =>
    v.nodes
      .filter((n) => !accepted(v.id, `${n.html} ${n.target.join(' ')}`))
      .map((n) => `${v.id} [${v.impact}] ${n.target.join(' ')}`),
  );
}

/**
 * Form controls with no label of their own: axe accepts a placeholder or a title as a name, a person
 * using a screen reader or voice control should not have to. Also controls named only by a title.
 */
const unlabelledControls = (page: Page) =>
  page.evaluate(() => {
    const shown = (el: Element) => (el as HTMLElement).checkVisibility?.() !== false;
    const where = (el: Element) =>
      `${el.tagName.toLowerCase()} in ${el.closest('[data-testid]')?.getAttribute('data-testid') ?? '?'}`;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLInputElement>(
      'input:not([type=hidden]), select, textarea',
    )) {
      if (!shown(el)) continue;
      const named =
        (el.labels?.length ?? 0) > 0 ||
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby');
      if (!named) out.push(where(el));
    }
    for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
      if (!shown(el)) continue;
      const named =
        (el.textContent ?? '').trim() ||
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby');
      if (!named) out.push(where(el));
    }
    return out;
  });

/** How far the page scrolls sideways (0 = it does not). */
const sidewaysScroll = (page: Page) =>
  page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

/** The page has its heading and nothing is still loading. */
async function loaded(page: Page) {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
}

/** Opens step `n` of the intake wizard (a draft reopens on the step it was left on). */
async function intakeStep(page: Page, n: number) {
  const wizard = page.getByTestId('intake-wizard');
  await expect(wizard).toBeVisible();
  if ((await wizard.getAttribute('data-step')) !== String(n)) {
    await page.getByRole('button', { name: `Step ${n}: ` }).click();
  }
  await expect(wizard).toHaveAttribute('data-step', String(n));
}

// ── The pages, each as a role that uses it, in the state that role meets it ──────────────────────

interface Stop {
  name: string;
  persona: string;
  path: (q: Quotes) => string;
  /** Extra waiting or set-up before the page is checked. */
  ready?: (page: Page, q: Quotes) => Promise<void>;
  /** States reached from the page (a dialog, a menu, the next step), each checked as well. */
  then?: { name: string; go: (page: Page, q: Quotes) => Promise<void> }[];
  /** Checked in the light theme only (pages built from the same parts as one checked in both). */
  lightOnly?: boolean;
}

const landing = (persona: string, lightOnly = false): Stop => ({
  name: `Command Center (${persona})`,
  persona,
  path: () => '/',
  ready: async (page) => {
    await expect(page.getByTestId('landing')).toBeVisible();
    // The first-run card is part of what a new user meets.
    await expect(page.getByTestId('welcome-card')).toBeVisible();
  },
  lightOnly,
});

const quotePage = (
  name: string,
  persona: string,
  which: keyof Quotes,
  tab: string,
  extra: Partial<Stop> = {},
): Stop => ({
  name,
  persona,
  path: (q) => `/quotes/${q[which]}?tab=${tab}`,
  ready: async (page) => {
    await expect(page.getByTestId('quote-detail')).toBeVisible();
  },
  ...extra,
});

const STOPS: Stop[] = [
  {
    ...landing('kam'),
    then: [
      {
        name: 'account menu',
        go: async (page) => {
          await page.getByTestId('user-menu').click();
          await expect(page.getByRole('menu')).toBeVisible();
        },
      },
      {
        name: 'notifications popover',
        go: async (page) => {
          await page.keyboard.press('Escape');
          await page.getByTestId('notification-bell').click();
          await expect(page.getByTestId('notifications-view-all')).toBeVisible();
        },
      },
      {
        name: 'metric definition popover',
        go: async (page) => {
          await page.keyboard.press('Escape');
          await page
            .getByRole('button', { name: /^About / })
            .first()
            .click();
          await expect(page.getByTestId('info-popover')).toBeVisible();
        },
      },
      {
        name: 'report an issue dialog',
        go: async (page) => {
          await page.keyboard.press('Escape');
          await page.getByTestId('report-issue-footer').click();
          await expect(page.getByTestId('report-issue-dialog')).toBeVisible();
        },
      },
    ],
  },
  landing('sales-leader'),
  landing('eng-lead', true),
  landing('engineer'),
  landing('production-scheduler', true),
  landing('pricing', true),
  landing('pricing-lead', true),
  landing('finance', true),
  landing('approver'),
  landing('leadership'),
  landing('admin', true),

  {
    name: 'Pipeline list',
    persona: 'leadership',
    path: () => '/quotes',
    then: [
      {
        name: 'filters popover',
        go: async (page) => {
          await page.getByRole('button', { name: /^Filters/ }).click();
          await expect(page.getByRole('checkbox', { name: 'Active', exact: true })).toBeVisible();
        },
      },
    ],
  },
  { name: 'Pipeline prioritization', persona: 'leadership', path: () => '/quotes?view=priority' },
  {
    name: 'Pipeline board',
    persona: 'eng-lead',
    path: () => '/board',
    ready: async (page) => {
      await expect(page.getByTestId('board-card').first()).toBeVisible();
    },
    then: [
      {
        name: 'move menu',
        go: async (page) => {
          await page.getByTestId('card-move').first().click();
          await expect(page.getByRole('menu')).toBeVisible();
        },
      },
    ],
  },

  quotePage('Quote overview, back for rework (KAM)', 'kam', 'rework', 'overview', {
    ready: async (page) => {
      await expect(page.getByTestId('rework-banner')).toBeVisible();
      await expect(page.getByTestId('quote-next-step')).toBeVisible();
    },
  }),
  quotePage('Quote overview, on hold (sales leader)', 'sales-leader', 'held', 'overview', {
    ready: async (page) => {
      await expect(page.getByTestId('quote-next-step')).toHaveAttribute('data-state', 'on_hold');
    },
  }),
  quotePage('Quote Engineering tab (engineer)', 'engineer', 'eng', 'engineering', {
    ready: async (page) => {
      await expect(page.getByTestId('engineering-tab')).toBeVisible();
    },
  }),
  quotePage('Quote Engineering tab (engineering lead)', 'eng-lead', 'eng', 'engineering', {
    ready: async (page) => {
      await expect(page.getByTestId('engineering-tab')).toBeVisible();
    },
    lightOnly: true,
  }),
  quotePage('Quote Engineering tab, read only (KAM)', 'kam', 'eng', 'engineering', {
    lightOnly: true,
  }),
  quotePage('Quote Quoting tab (pricing)', 'pricing', 'quoting', 'quoting'),
  quotePage('Quote Quoting tab (pricing lead)', 'pricing-lead', 'quoting', 'quoting', {
    lightOnly: true,
  }),
  quotePage('Quote Attachments tab (KAM)', 'kam', 'quoting', 'attachments', {
    ready: async (page) => {
      await expect(page.getByTestId('drop-zone')).toBeVisible();
    },
  }),
  quotePage('Quote overview in Final Review (approver)', 'approver', 'finalReview', 'overview'),
  {
    name: 'Quote that cannot be opened',
    persona: 'kam',
    path: () => '/quotes/CCQ-2026-99999',
    ready: async (page) => {
      await expect(page.getByTestId('quote-not-found')).toBeVisible();
    },
  },

  {
    name: 'To qualify (G1 queue)',
    persona: 'sales-leader',
    path: () => '/approvals?gate=G1',
    ready: async (page, q) => {
      await expect(page.locator(`[data-testid="queue-item"][data-quote="${q.g1}"]`)).toBeVisible();
    },
    then: [
      {
        name: 'decision dialog: Hold chosen, errors shown, priority breakdown open',
        go: async (page, q) => {
          await page
            .locator(`[data-testid="queue-item"][data-quote="${q.g1}"]`)
            .getByRole('button', { name: `Decide ${q.g1}` })
            .click();
          const dialog = page.getByRole('dialog');
          await expect(dialog.getByTestId('completeness')).toBeVisible();
          await dialog.getByTestId('decision-priority').locator('summary').click();
          await expect(dialog.getByTestId('score-breakdown')).toBeVisible();
          await dialog.getByRole('radio', { name: 'Hold', exact: true }).check();
          await dialog.getByRole('button', { name: 'Record decision' }).click();
          await expect(dialog.getByRole('alert').first()).toBeVisible();
        },
      },
    ],
  },
  { name: 'Engineering queue (lead)', persona: 'eng-lead', path: () => '/queue/engineering' },
  {
    name: 'Engineering queue (engineer)',
    persona: 'engineer',
    path: () => '/queue/engineering',
    lightOnly: true,
  },
  { name: 'Pricing queue (lead)', persona: 'pricing-lead', path: () => '/queue/pricing' },
  {
    name: 'Pricing queue (pricer)',
    persona: 'pricing',
    path: () => '/queue/pricing',
    lightOnly: true,
  },
  { name: 'Final Review queue', persona: 'approver', path: () => '/approvals' },
  {
    name: 'Final Review screen',
    persona: 'approver',
    path: (q) => `/quotes/${q.finalReview}/review`,
    ready: async (page) => {
      await expect(page.getByTestId('review-screen')).toBeVisible();
      await expect(page.getByTestId('review-warnings')).toBeVisible();
    },
    then: [
      {
        name: 'decision dialog',
        go: async (page) => {
          // FB-25 (N17-25): one "Decide final review" opens the dialog.
          await page
            .getByTestId('decision-bar')
            .getByRole('button', { name: 'Decide final review' })
            .click();
          await expect(page.getByRole('dialog')).toBeVisible();
        },
      },
    ],
  },

  { name: 'Intake step 1', persona: 'kam', path: () => '/intake/new' },
  {
    name: 'Intake step 2',
    persona: 'kam',
    path: (q) => `/intake/new?draft=${q.draft}`,
    ready: (page) => intakeStep(page, 2),
    then: [3, 4].map((n) => ({ name: `step ${n}`, go: (page: Page) => intakeStep(page, n) })),
  },

  { name: 'Notifications', persona: 'kam', path: () => '/notifications' },
  { name: 'Email preferences', persona: 'kam', path: () => '/me/preferences', lightOnly: true },
  { name: 'My proposals', persona: 'kam', path: () => '/proposals', lightOnly: true },

  { name: 'Admin home', persona: 'admin', path: () => '/admin' },
  { name: 'Admin users', persona: 'admin', path: () => '/admin/users', lightOnly: true },
  { name: 'Admin workflow', persona: 'admin', path: () => '/admin/workflow' },
  { name: 'Admin scoring', persona: 'admin', path: () => '/admin/scoring' },
  { name: 'Admin settings', persona: 'admin', path: () => '/admin/settings', lightOnly: true },
  {
    name: 'Admin value lists',
    persona: 'admin',
    path: () => '/admin/value-lists',
    lightOnly: true,
  },
  {
    name: 'Admin reason codes',
    persona: 'admin',
    path: () => '/admin/reason-codes',
    lightOnly: true,
  },
  { name: 'Admin audit log', persona: 'admin', path: () => '/admin/audit', lightOnly: true },
  { name: 'Admin feedback', persona: 'admin', path: () => '/admin/feedback', lightOnly: true },
  { name: 'Access denied', persona: 'kam', path: () => '/admin', lightOnly: true },
];

/** Goes to each stop in turn, signed in as its persona, and calls `check` on it and on its states. */
async function tour(
  page: Page,
  q: Quotes,
  stops: Stop[],
  theme: 'light' | 'dark',
  check: (label: string) => Promise<void>,
  withStates = true,
) {
  for (const stop of stops) {
    // The persona is read from sessionStorage before the first API call of each page load.
    await signInAs(page, stop.persona, theme);
    await page.goto(stop.path(q));
    if (stop.name !== 'Access denied') await loaded(page);
    else await expect(page.getByTestId('forbidden')).toBeVisible();
    await stop.ready?.(page, q);
    await check(stop.name);
    if (!withStates) continue;
    for (const state of stop.then ?? []) {
      await state.go(page, q);
      await check(`${stop.name} > ${state.name}`);
    }
  }
}

// ── 1. Automated: axe at every impact, and labels ────────────────────────────────────────────────

for (const theme of ['light', 'dark'] as const) {
  test(`axe finds nothing at any impact on the daily pages, and every control is labelled (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const q = await quotes(request);
    await page.setViewportSize({ width: 1366, height: 850 });
    const found: string[] = [];
    await tour(
      page,
      q,
      STOPS.filter((s) => theme === 'light' || !s.lightOnly),
      theme,
      async (label) => {
        for (const v of await axeViolations(page)) found.push(`${label}: ${v}`);
        for (const c of await unlabelledControls(page)) found.push(`${label}: no label: ${c}`);
      },
    );
    expect(found).toEqual([]);
  });
}

test('the sign-in and no-access pages pass axe at every impact, light and dark', async ({
  page,
}) => {
  // Signed out: the production-mode server the smoke project uses (no dev personas there).
  const signedOut = `http://localhost:${Number(process.env.E2E_PORT ?? 3100)}/`;
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(signedOut);
    await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
    expect(await axeViolations(page), `sign-in (${colorScheme})`).toEqual([]);
    expect(await sidewaysScroll(page)).toBe(0);
  }
  await page.emulateMedia({ colorScheme: null });

  // Signed in with no role: the API's own answer, served here (every dev persona has a role).
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/problem+json',
      json: {
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'No QuoteFlow role assigned; ask IT to add you to an SG-CCQ group',
        code: 'no_role',
      },
    }),
  );
  for (const theme of ['light', 'dark'] as const) {
    await signInAs(page, 'kam', theme);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'No QuoteFlow access yet' }),
    ).toBeVisible();
    // The answer to "Check again" arrives in a status region that is already on the page.
    const answer = page
      .getByRole('status')
      .filter({ has: page.locator('[data-testid="recheck"]') });
    await expect(page.getByTestId('recheck')).toHaveAttribute('role', 'status');
    await expect(answer).toHaveCount(0);
    await page.getByRole('button', { name: 'Check again' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('recheck')).toContainText('Still no access.');
    await expect(page.getByRole('button', { name: 'Check again' })).toBeFocused();
    expect(await axeViolations(page), `no access (${theme})`).toEqual([]);
  }
});

// ── 2. Names ─────────────────────────────────────────────────────────────────────────────────────

test('repeated buttons and links say which quote or stage they act on', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const q = await quotes(request);
  await page.setViewportSize({ width: 1366, height: 850 });

  // Prioritization: one "Breakdown" per row, each named for its quote.
  await signInAs(page, 'leadership');
  await page.goto(`/quotes?view=priority&q=${q.eng}`);
  await loaded(page);
  const breakdown = page.getByRole('button', { name: `Breakdown for ${q.eng}`, exact: true });
  await expect(breakdown).toHaveAttribute('aria-expanded', 'false');
  await breakdown.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: `Hide breakdown for ${q.eng}`, exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');

  // Command Center: "View 2" under each stage says the stage; the rework link says the quote.
  await page.goto('/');
  await expect(page.getByTestId('mini-board')).toBeVisible();
  const views = page.getByTestId('mini-board').getByRole('link', { name: /^View \d+/ });
  expect(await views.count()).toBeGreaterThan(0);
  for (const link of await views.all()) {
    await expect(link).toHaveAccessibleName(/^View \d+ in \S/);
  }
  await signInAs(page, 'kam');
  await page.goto('/');
  await expect(
    page
      .getByTestId('dash-returned')
      .getByRole('link', { name: `Open to start the rework of ${q.rework}`, exact: true }),
  ).toBeVisible();
});

// ── 3. Keyboard ──────────────────────────────────────────────────────────────────────────────────

/**
 * What covers the focused element, if it sits under the sticky header, the bottom tab bar or a bar
 * stuck to the bottom of the page (WCAG 2.4.11). Null when it is clear of all three, or when focus is
 * on one of those bars itself.
 */
const coveredBy = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const main = document.querySelector('main');
    if (!el || !main?.contains(el) || el === main) return null;
    const r = el.getBoundingClientRect();
    // A region taller than the window (a tab panel, a table that scrolls) cannot be shown whole.
    if (r.height > window.innerHeight / 2) return null;
    const what = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`;
    const header = document.querySelector('[data-surface="header"]')?.getBoundingClientRect();
    if (header && r.top < header.bottom - 1 && r.bottom > header.top) {
      return `${what} is under the header (top ${Math.round(r.top)}, header ends ${Math.round(header.bottom)})`;
    }
    for (const bar of document.querySelectorAll(
      'nav[aria-label="Primary"], [data-sticky-bottom]',
    )) {
      const b = bar.getBoundingClientRect();
      const stuck = ['fixed', 'sticky'].includes(getComputedStyle(bar).position);
      if (!stuck || b.height === 0 || bar.contains(el)) continue;
      // Only a bar at the bottom edge of the window covers anything: not the side rail (the same
      // landmark on a desktop, full height), and not a sticky bar at rest further up the page.
      if (b.top < window.innerHeight / 2 || b.bottom < window.innerHeight - 80) continue;
      // A button, link or select is clear of the bar whole. A text box is scrolled to its caret, not
      // to its box, so a tall one may run under the bar: its first line, where the caret is, may not.
      const mustShow = el.matches('textarea') ? Math.min(r.height, 40) : r.height;
      if (r.top + mustShow > b.top + 1 && r.top < b.bottom) {
        return `${what} is under the bar at the bottom (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)}, bar starts ${Math.round(b.top)})`;
      }
    }
    return null;
  });

test('keyboard focus is never left under the sticky header (desktop, backwards through the page)', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const q = await quotes(request);
  await page.setViewportSize({ width: 1366, height: 700 });
  await signInAs(page, 'leadership');
  for (const path of [
    '/',
    '/quotes',
    '/quotes?view=priority',
    `/quotes/${q.finalReview}?tab=overview`,
  ]) {
    await page.goto(path);
    await loaded(page);
    // Start at the last control of the page and walk back up, as Shift+Tab does.
    await page.evaluate(() => {
      const all = document.querySelectorAll<HTMLElement>(
        'main a[href], main button:not([disabled]), main input:not([disabled]), main select, main textarea',
      );
      all[all.length - 1]?.focus();
    });
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await coveredBy(page), `${path}, Shift+Tab ${i + 1}`).toBeNull();
    }
  }
});

test('keyboard focus is never left under the bottom tab bar or the decision bar (phone width, forwards)', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const q = await quotes(request);
  // 390 px is a phone, and a 1560 px desktop at 400% zoom.
  await page.setViewportSize({ width: 390, height: 700 });
  for (const [persona, path] of [
    ['kam', '/'],
    ['kam', '/quotes'],
    ['approver', `/quotes/${q.finalReview}/review`],
  ] as const) {
    await signInAs(page, persona);
    await page.goto(path);
    await loaded(page);
    await page.locator('main').focus();
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Tab');
      expect(await coveredBy(page), `${path}, Tab ${i + 1}`).toBeNull();
    }
  }
});

test('a hidden tab panel is out of the tab order, and a hidden file input shows focus on its label', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const q = await quotes(request);
  await page.setViewportSize({ width: 1366, height: 850 });
  await signInAs(page, 'engineer');
  await page.goto(`/quotes/${q.eng}?tab=engineering`);
  const engineering = page.getByTestId('engineering-tab');
  await expect(engineering).toBeVisible();
  // The capacity upload is reached through its button; the hidden input behind it is not a stop.
  await expect(engineering.getByTestId('capacity-attach-input')).toHaveAttribute('tabindex', '-1');

  // Attachments by keyboard: the Engineering tab stays mounted (UX-001), hidden.
  await page.getByRole('tab', { name: 'Engineering' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Quoting' })).toBeFocused();
  // FB-25 (N18-18): Commercial terms sits between Quoting and Attachments.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Commercial terms' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Attachments' })).toBeFocused();
  await expect(page.getByTestId('drop-zone')).toBeVisible();
  await expect(engineering).toBeHidden();
  expect(await engineering.locator('input, select, textarea, button').count()).toBeGreaterThan(5);

  // Tab through the page once: every stop is visible, none is inside the hidden panel, and the hidden
  // file input of the "Add file" control (FB-24: the only one) draws the focus ring on its label.
  const seen: string[] = [];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const ringOn = (node: Element) => {
        const cs = getComputedStyle(node);
        return (
          (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) ||
          cs.boxShadow !== 'none'
        );
      };
      const fileLabel = el.matches('input[type="file"]') ? el.closest('label') : null;
      return {
        id: el.getAttribute('data-testid') ?? el.tagName,
        visible: el.checkVisibility(),
        inHiddenPanel: el.closest('[role="tabpanel"][hidden]') !== null,
        ring: fileLabel ? ringOn(fileLabel) : ringOn(el),
        labelVisible: fileLabel ? fileLabel.getBoundingClientRect().height >= 16 : true,
      };
    });
    if (!stop) continue;
    seen.push(stop.id);
    expect(stop, `Tab ${i + 1}: ${stop.id}`).toMatchObject({
      visible: true,
      inHiddenPanel: false,
      ring: true,
      labelVisible: true,
    });
  }
  expect(seen).toContain('attachment-input');
  expect(seen).not.toContain('attachment-camera');
  expect(seen).not.toContain('capacity-attach-input');

  // AUDIT_SCREENS=1 saves the one visible change of the pass: the ring on the file control ("Add file"
  // since FB-24).
  if (process.env.AUDIT_SCREENS === '1') {
    await page.getByRole('tab', { name: 'Attachments' }).focus();
    while (!(await page.getByTestId('attachment-input').evaluate((el) => el.matches(':focus')))) {
      await page.keyboard.press('Tab');
    }
    await page.getByTestId('attachments').screenshot({
      path: fileURLToPath(new URL('../../../docs/audit/screens/UX-018.png', import.meta.url)),
      animations: 'disabled',
    });
  }
});

/** Opens `trigger` from the keyboard, checks `opened` shows, closes with Escape, and expects focus back. */
async function opensAndGivesFocusBack(
  page: Page,
  trigger: Locator,
  opened: Locator,
  key = 'Enter',
) {
  await trigger.focus();
  await page.keyboard.press(key);
  await expect(opened).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opened).toBeHidden();
  await expect(trigger).toBeFocused();
}

test('menus, popovers, the hold tooltip and dialogs open from the keyboard, close on Escape and give focus back', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const q = await quotes(request);
  await page.setViewportSize({ width: 1366, height: 850 });

  await signInAs(page, 'kam');
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible();
  await opensAndGivesFocusBack(page, page.getByTestId('user-menu'), page.getByRole('menu'));
  await opensAndGivesFocusBack(
    page,
    page.getByTestId('notification-bell'),
    page.getByTestId('notifications-view-all'),
  );
  await opensAndGivesFocusBack(
    page,
    page.getByRole('button', { name: /^About / }).first(),
    page.getByTestId('info-popover'),
  );
  await opensAndGivesFocusBack(
    page,
    page.getByTestId('report-issue-footer'),
    page.getByTestId('report-issue-dialog'),
  );
  // The "On hold" chip: its sentence shows on keyboard focus, also when reaching the chip scrolls the
  // page (a scroll closes a tooltip), and Escape puts it away (WCAG 1.4.13).
  await page.setViewportSize({ width: 1366, height: 450 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const chip = page.getByTestId('hold-chip').first();
  await expect(chip).not.toBeInViewport();
  await chip.focus();
  await expect(chip).toBeInViewport();
  await expect(page.getByTestId('hold-chip-detail').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hold-chip-detail')).toHaveCount(0);
  await expect(chip).toBeFocused();
  await page.setViewportSize({ width: 1366, height: 850 });

  await page.goto('/quotes');
  await loaded(page);
  await opensAndGivesFocusBack(
    page,
    page.getByRole('button', { name: /^Filters/ }),
    page.getByRole('checkbox', { name: 'Active', exact: true }),
  );
  await opensAndGivesFocusBack(
    page,
    page.getByTestId('saved-views'),
    page.getByRole('dialog', { name: 'Saved views' }),
  );

  // Final Review: the decision dialog from the sticky bar.
  await signInAs(page, 'approver');
  await page.goto(`/quotes/${q.finalReview}/review`);
  await expect(page.getByTestId('review-screen')).toBeVisible();
  await opensAndGivesFocusBack(
    page,
    page.getByTestId('decision-bar').getByRole('button', { name: 'Decide final review' }),
    page.getByRole('dialog'),
  );
});

test('the board moves a card without a mouse: the Move menu, and the grip with its announcements', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const q = await quotes(request);
  await page.setViewportSize({ width: 1366, height: 850 });
  await signInAs(page, 'eng-lead');
  await page.goto(`/board?q=${q.eng}`);
  const card = page.locator(`[data-testid="board-card"][data-quote="${q.eng}"]`);
  await expect(card).toBeVisible();

  // The Move menu: Enter opens it on its first choice, Enter picks it, the gate dialog opens.
  const move = card.getByRole('button', { name: `Move ${q.eng} to another stage` });
  await move.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Nothing was decided: the card is back where it was, and the keyboard is back on its Move button.
  await expect(page.locator('[data-column="ENG_REVIEW"]')).toContainText(q.eng);
  await expect(move).toBeFocused();

  // The grip: Space picks the card up and says where it can go; Escape puts it back and says so.
  const grip = card.getByRole('button', { name: `Move ${q.eng} (drag)` });
  await expect(grip).toHaveAttribute('aria-roledescription', 'draggable quote');
  await grip.focus();
  await page.keyboard.press('Space');
  const announced = page.locator('[role="status"][aria-live="assertive"]');
  await expect(announced).toContainText(`Picked up ${q.eng}. It can move to`);
  // The keyboard sensor starts listening for Escape a moment after the pick-up is announced; on a slow
  // machine the first press can come too early and go nowhere. A second Escape with nothing picked up
  // does nothing, so pressing until the card is put back is safe.
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(announced).toContainText(`${q.eng} put back.`, { timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a new intake step starts at its top for the keyboard, and is announced', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const q = await quotes(request);
  await page.setViewportSize({ width: 1366, height: 850 });
  await signInAs(page, 'kam');
  await page.goto(`/intake/new?draft=${q.draft}`);
  const wizard = page.getByTestId('intake-wizard');
  await intakeStep(page, 2);

  // The step line is in the page for a screen reader on a desktop too (it was display:none).
  const line = wizard.locator('nav[aria-label="Intake steps"] p[aria-live="polite"]');
  await expect(line).toHaveText('Step 2 of 4 · Customer & destination');
  expect(await line.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');

  // Next, from the keyboard: the step changes and the keyboard is at the top of the page, so the
  // first Tab goes into the new step, not past the end of the page.
  const next = wizard.getByRole('button', { name: /^Next/ });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(wizard).toHaveAttribute('data-step', '3');
  await expect(line).toHaveText('Step 3 of 4 · Request & items');
  await expect(page.locator('main')).toBeFocused();
  await page.keyboard.press('Tab');
  const firstStop = await page.evaluate(() => {
    const el = document.activeElement;
    const nextButton = [...document.querySelectorAll('main button')].find((b) =>
      (b.textContent ?? '').trim().startsWith('Next'),
    );
    return {
      inMain: !!el && !!document.querySelector('main')?.contains(el),
      // DOCUMENT_POSITION_FOLLOWING: the Next button comes after the focused element.
      beforeNext: !!el && !!nextButton && (el.compareDocumentPosition(nextButton) & 4) === 4,
    };
  });
  expect(firstStop).toEqual({ inMain: true, beforeNext: true });

  // A step chosen in the stepper: its button switches off as it becomes the current step, and the
  // keyboard is not dropped on the page body.
  await page.getByRole('button', { name: 'Step 4: ' }).focus();
  await page.keyboard.press('Enter');
  await expect(wizard).toHaveAttribute('data-step', '4');
  await expect(page.locator('main')).toBeFocused();
});

// ── 4. Status messages ───────────────────────────────────────────────────────────────────────────

test('"Save your changes first." and "saved" are announced without moving focus', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const q = await quotes(request);
  await page.setViewportSize({ width: 1366, height: 850 });
  await signInAs(page, 'engineer');
  await page.goto(`/quotes/${q.eng}?tab=engineering`);
  const tab = page.getByTestId('engineering-tab');
  // FB-22 (N17-14): the engineer's Submit sits at the end of the engineer's part.
  const actions = tab.getByTestId('eng-submit');
  const submit = actions.getByRole('button', { name: 'Submit to engineering lead' });
  await expect(submit).toBeEnabled();
  // The live region is on the page, empty, before there is anything to say.
  const status = actions.getByRole('status');
  await expect(status).toHaveCount(1);
  await expect(status).toBeEmpty();

  const concept = tab.getByTestId('solution-form').getByLabel('Machine platform');
  await concept.focus();
  await page.keyboard.type('Two-cavity shuttle');
  await expect(status).toHaveText('Save your changes first.');
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAccessibleDescription('Save your changes first.');
  await expect(concept).toBeFocused();

  // Saving: the line beside the button and the toast are both status messages, and neither takes focus.
  const save = tab.getByTestId('solution-form').getByRole('button', { name: 'Save solution' });
  await save.focus();
  await page.keyboard.press('Enter');
  const saved = tab.getByTestId('solution-form').getByTestId('save-progress');
  await expect(saved).toHaveAttribute('role', 'status');
  await expect(saved).toHaveText('Progress saved');
  const toast = page.getByRole('region', { name: 'Messages' }).getByRole('status');
  await expect(toast).toContainText('Solution saved');
  await expect(toast.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  await expect(status).toBeEmpty();
  await expect(submit).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        document.activeElement?.closest(
          '[role="status"], [role="alert"], [aria-label="Messages"]',
        ) ?? null,
    ),
  ).toBeNull();
  // The keyboard carries on from the form, not from the top of the page. (The Save button is switched
  // off while it saves, which drops focus to the page for that moment: reported, not changed here.)
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(
      () => document.activeElement?.closest('[data-testid="engineering-tab"]') !== null,
    ),
  ).toBe(true);
});

// ── 5. Reflow, zoom and motion ───────────────────────────────────────────────────────────────────

test('no page scrolls sideways at 320 px (400% zoom)', async ({ page, request }) => {
  test.setTimeout(480_000);
  const q = await quotes(request);
  await page.setViewportSize({ width: 320, height: 700 });
  const scrolling: string[] = [];
  await tour(page, q, STOPS, 'light', async (label) => {
    const by = await sidewaysScroll(page);
    if (by > 0) scrolling.push(`${label}: ${by} px`);
  });
  expect(scrolling).toEqual([]);
});

test('at 200% zoom (640 px wide, two device pixels each) the main pages do not scroll sideways', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const q = await quotes(request);
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL!,
    viewport: { width: 640, height: 400 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const scrolling: string[] = [];
  const main = STOPS.filter((s) =>
    [
      'Command Center (kam)',
      'Command Center (leadership)',
      'Pipeline list',
      'Pipeline board',
      'Quote overview, back for rework (KAM)',
      'Quote Engineering tab (engineer)',
      'Quote Quoting tab (pricing)',
      'To qualify (G1 queue)',
      'Engineering queue (lead)',
      'Pricing queue (lead)',
      'Final Review screen',
      'Intake step 2',
      'Notifications',
      'Admin workflow',
    ].includes(s.name),
  );
  await tour(page, q, main, 'light', async (label) => {
    const by = await sidewaysScroll(page);
    if (by > 0) scrolling.push(`${label}: ${by} px`);
  });
  expect(scrolling).toEqual([]);
  await context.close();
});

test('reduced motion: no fade, no page-load wipe, and the board jumps to a stage instead of gliding', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await quotes(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 700 });
  // Record how the board asks the browser to scroll (the scroll itself is not needed here).
  await page.addInitScript(() => {
    const asked: unknown[] = [];
    (window as unknown as { scrollsAsked: unknown[] }).scrollsAsked = asked;
    Element.prototype.scrollIntoView = (arg?: boolean | ScrollIntoViewOptions) => {
      asked.push(typeof arg === 'object' ? (arg.behavior ?? 'auto') : 'auto');
    };
  });
  await signInAs(page, 'kam');
  await page.goto('/board');
  const stages = page.getByRole('navigation', { name: 'Stages' });
  await expect(stages).toBeVisible();
  await stages.getByRole('button').nth(2).click();
  expect(
    await page.evaluate(() => (window as unknown as { scrollsAsked: unknown[] }).scrollsAsked),
  ).toEqual(['auto']);

  // Every animation and transition on the page is cut to nothing (index.css).
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible();
  await page.getByTestId('report-issue-footer').click();
  const dialog = page.getByTestId('report-issue-dialog');
  await expect(dialog).toBeVisible();
  const longest = await page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll('*')].flatMap((el) => {
        const cs = getComputedStyle(el);
        const seconds = (v: string) =>
          v.split(',').map((s) => parseFloat(s) * (s.includes('ms') ? 0.001 : 1));
        return [...seconds(cs.animationDuration), ...seconds(cs.transitionDuration)];
      }),
    ),
  );
  expect(longest).toBeLessThan(0.001);
});

// ── 6. Targets ───────────────────────────────────────────────────────────────────────────────────

test('targets are at least 24 px tall where they sit next to another one', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await quotes(request);
  // 1280 px: the Command Center's stage columns are narrow enough for the chip to wrap under the link.
  await page.setViewportSize({ width: 1280, height: 850 });
  await signInAs(page, 'kam');
  await page.goto('/');
  const chip = page.getByTestId('mini-board').getByTestId('hold-chip').first();
  await expect(chip).toBeVisible();
  expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(24);

  await signInAs(page, 'admin');
  await page.goto('/admin/scoring');
  const groups = page.getByTestId('sub-market-points').first().locator('summary');
  await expect(groups.first()).toBeVisible();
  for (const summary of await groups.all()) {
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  }
});
