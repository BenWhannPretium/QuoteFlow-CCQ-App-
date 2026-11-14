import { expect, test, type APIRequestContext } from '@playwright/test';

import { seriousViolations } from './axe';
import { as, centralToday, ok, quoteInCustomerDecision } from './customer-decision';
import { signInAs } from './personas';
import { freeOpportunities, submitQuote } from './quotes';

// FB-04: the funding wording (F-022, V-055), the sales-leader-only priority override shown to
// Engineering (F-065, T-024) and the Salesforce link and reminder (F-076, T-035). The override
// lifecycle itself is in overrides.spec.ts; the scoring panel is in g1.spec.ts.

const INSTANCE = 'https://pretium.lightning.force.com';

async function setInstanceUrl(request: APIRequestContext, value: string) {
  const list = (await (
    await request.get('/api/v1/admin/config/settings', { headers: as('admin') })
  ).json()) as { items?: { key: string; version: number }[] } | { key: string; version: number }[];
  const rows = Array.isArray(list) ? list : (list.items ?? []);
  const row = rows.find((s) => s.key === 'salesforce_instance_url')!;
  await ok(
    request.patch('/api/v1/admin/config/settings/salesforce_instance_url', {
      headers: as('admin'),
      data: { version: row.version, changeReason: 'FB-04 e2e', value },
    }),
  );
}

test('the funding options: $0 CER is explained and Shared is offered', async ({
  page,
  request,
}) => {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  // FB-08 (F-021): on the quote, tooling funding is Engineering's (the KAM answers it at intake).
  await signInAs(page, 'eng-lead');
  await page.goto(`/quotes/${quoteNumber}`);
  const select = page.getByLabel('Tooling funding model');
  await expect(
    select.locator('option', { hasText: '$0 CER (customer-reimbursed capital)' }),
  ).toHaveCount(1);
  await expect(select.locator('option', { hasText: 'Shared (company and customer)' })).toHaveCount(
    1,
  );
  await page.getByTestId('funding-help').click();
  const help = page.getByRole('dialog');
  await expect(help).toContainText(
    'reimbursed by the customer as a lump sum or through amortization',
  );
  await expect(help).toContainText('the customer invoice or contract goes with the mold PO');
  // FB-15 (W13-09): Shared now asks for the customer's share instead of a note in the terms.
  await expect(help).toContainText("Enter the customer's share; Pretium covers the rest");
  // Bailey Schmitt (2026-11-12): Amortized is explained too.
  await expect(help).toContainText('The customer pays for the tooling over time');
  expect(await seriousViolations(page)).toEqual([]);
});

test('Engineering sees why a sales leader changed the tier on the queue row', async ({
  page,
  request,
}) => {
  const quoteNumber = await submitQuote(request, await freeOpportunities(request, 1));
  await ok(
    request.post(`/api/v1/quotes/${quoteNumber}/gates/G1/decisions`, {
      headers: as('sales-leader'),
      data: { outcomeKey: 'advance' },
    }),
    201,
  );
  const why = 'Customer line trial moved up; Sales leadership asked for this one first';
  const quote = (await (
    await request.get(`/api/v1/quotes/${quoteNumber}`, { headers: as('sales-leader') })
  ).json()) as { priority: { tier: string } };
  await ok(
    request.post(`/api/v1/quotes/${quoteNumber}/overrides`, {
      headers: as('sales-leader'),
      data: {
        field: 'priority_tier',
        requestedValue: quote.priority.tier === 'CRITICAL' ? 'HIGH' : 'CRITICAL',
        justification: why,
      },
    }),
    201,
  );

  await signInAs(page, 'eng-lead');
  await page.goto('/queue/engineering');
  const row = page.getByRole('row', { name: new RegExp(quoteNumber) });
  await expect(row.getByTestId('queue-priority-override')).toContainText(why);
  expect(await seriousViolations(page)).toEqual([]);

  // The priority panel on the quote's overview repeats it.
  await page.goto(`/quotes/${quoteNumber}`);
  await expect(page.getByTestId('priority-override-note')).toContainText(why);
});

test('Salesforce: the quote links to its opportunity, and recording Awarded shows the reminder with the link', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const id = async (persona: string) =>
    (
      (await (await request.get('/api/v1/me', { headers: as(persona) })).json()) as {
        user: { id: string };
      }
    ).user.id;
  for (const p of ['kam', 'sales-leader', 'eng-lead', 'pricing', 'approver']) {
    await request.get('/api/v1/me', { headers: as(p) });
  }
  const quoteNumber = await quoteInCustomerDecision(
    request,
    await id('engineer'),
    await id('pricing'),
  );
  const detail = (await (
    await request.get(`/api/v1/quotes/${quoteNumber}`, { headers: as('kam') })
  ).json()) as { sfOpportunityId: string; sfOpportunityUrl: string | null };
  expect(detail.sfOpportunityUrl).toBeNull();

  // Not set: the plain opportunity ID, no link.
  await signInAs(page, 'kam');
  await page.goto(`/quotes/${quoteNumber}`);
  await expect(page.getByTestId('sf-opportunity-plain')).toHaveText(detail.sfOpportunityId);
  await expect(page.getByTestId('open-in-salesforce')).toHaveCount(0);

  await setInstanceUrl(request, INSTANCE);
  try {
    const href = `${INSTANCE}/lightning/r/Opportunity/${detail.sfOpportunityId}/view`;
    await page.reload();
    const link = page.getByTestId('open-in-salesforce').first();
    await expect(link).toHaveText('Open in Salesforce ↗');
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByTestId('sf-update-reminder')).toHaveCount(0);

    // Record Awarded (T-035).
    await page.getByRole('button', { name: 'Record customer decision' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Awarded' }).check();
    await dialog.getByLabel(/^Acceptance evidence/).selectOption({ label: 'Purchase order (PO)' });
    await dialog.getByLabel(/^Customer accepted on/).fill(centralToday());
    await dialog.getByRole('button', { name: 'Record decision' }).click();
    await expect(dialog).toHaveCount(0);

    const reminder = page.getByTestId('sf-update-reminder');
    await expect(reminder).toContainText(
      'Update the Salesforce opportunity to match: Verbal Award.',
    );
    await expect(reminder.getByTestId('open-in-salesforce')).toHaveAttribute('href', href);
    expect(await seriousViolations(page)).toEqual([]);

    // Dismissing it writes nothing: the quote is unchanged and the reminder is gone.
    const before = (await (
      await request.get(`/api/v1/quotes/${quoteNumber}`, { headers: as('kam') })
    ).json()) as unknown;
    await reminder.getByRole('button', { name: 'Dismiss the Salesforce reminder' }).click();
    await expect(reminder).toHaveCount(0);
    const after = (await (
      await request.get(`/api/v1/quotes/${quoteNumber}`, { headers: as('kam') })
    ).json()) as unknown;
    expect(after).toEqual(before);
  } finally {
    await setInstanceUrl(request, '');
  }
});
