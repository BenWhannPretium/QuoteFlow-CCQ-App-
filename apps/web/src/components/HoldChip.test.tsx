import type { DashHold } from '@ccq/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { holdSummary } from '@/lib/hold-text';

import { HoldChip } from './HoldChip';

/**
 * FB-18 (W13-26): the orange "On hold" chip on the Command Center lists. Rendered to static markup
 * (the tooltip itself opens in the browser: the Playwright spec hovers and focuses the chip).
 */
const render = (hold: DashHold) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <HoldChip hold={hold} />
    </TooltipProvider>,
  );

describe('HoldChip', () => {
  const hold = {
    reasonLabel: 'Awaiting customer information',
    ownerName: 'Erin Engineer',
    reviewDate: '2026-12-12',
  };

  it('says "On hold" in the orange chip colours', () => {
    const html = render(hold);
    expect(html).toContain('>On hold</span>');
    expect(html).toContain('bg-hold');
    expect(html).toContain('text-hold-foreground');
    expect(html).toContain('data-testid="hold-chip"');
  });

  it('is a button, so the keyboard reaches it and focus opens the detail', () => {
    const html = render(hold);
    expect(html).toMatch(/^<button\b/);
    expect(html).toContain('type="button"');
    expect(html).not.toContain('tabindex="-1"');
    expect(html).not.toContain('disabled');
  });

  it('is named by the sentence the quote header and the timeline use', () => {
    const summary = holdSummary(hold);
    expect(summary).toBe(
      'On hold: Awaiting customer information. Owner: Erin Engineer. Review by Dec 12, 2026.',
    );
    expect(render(hold)).toContain(`aria-label="${summary}"`);
  });

  it('leaves out what is not known, and still says "On hold"', () => {
    const owner = { reasonLabel: null, ownerName: 'Erin Engineer', reviewDate: '2026-12-12' };
    expect(render(owner)).toContain(
      'aria-label="On hold. Owner: Erin Engineer. Review by Dec 12, 2026."',
    );
    const nothing = { reasonLabel: null, ownerName: null, reviewDate: null };
    expect(render(nothing)).toContain('aria-label="On hold"');
    expect(render(nothing)).toContain('>On hold</span>');
  });
});
