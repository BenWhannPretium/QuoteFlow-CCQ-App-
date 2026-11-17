import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
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
          await page
            .getByTestId('decision-bar')
            .getByRole('button', { name: 'Hold', exact: true })
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
