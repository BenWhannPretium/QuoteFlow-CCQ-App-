import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { revealCollapsed, sectionsStore } from './collapse';

/** Ben (2026-11-20): sections a user fills in can be collapsed one by one or all at once. */
describe('collapsible sections', () => {
  it('start expanded, and the all-at-once switch sets the mode', () => {
    expect(sectionsStore.get()).toBe('expanded');
    sectionsStore.setAll('collapsed');
    expect(sectionsStore.get()).toBe('collapsed');
    sectionsStore.setAll('expanded');
    expect(sectionsStore.get()).toBe('expanded');
  });

  it('a collapsible card has a toggle in its header and its content shown', () => {
    const html = renderToStaticMarkup(
      <Card collapsible>
        <CardHeader>
          <CardTitle>
            <h2>Pack-out</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>Fields</CardContent>
      </Card>,
    );
    expect(html).toContain('data-testid="section-toggle"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-collapsed="false"');
    // The content is shown: no `hidden` attribute (the chevron's aria-hidden is not one).
    expect(html).not.toMatch(/\shidden=/);
  });

  it('a plain card has no toggle', () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>Text</CardContent>
      </Card>,
    );
    expect(html).not.toContain('section-toggle');
    expect(html).not.toContain('data-collapsed');
  });

  it('revealCollapsed opens every collapsed section around an element', () => {
    const opened: string[] = [];
    const section = (name: string, parent: unknown) => ({
      name,
      parentElement: parent,
      dispatchEvent: () => opened.push(name),
    });
    const outer = section('outer', null);
    const inner = section('inner', {
      closest: () => outer,
    });
    const field = { closest: () => inner } as unknown as Element;
    expect(revealCollapsed(field)).toBe(true);
    expect(opened).toEqual(['inner', 'outer']);
    expect(revealCollapsed({ closest: () => null } as unknown as Element)).toBe(false);
    expect(revealCollapsed(null)).toBe(false);
  });

  it('revealCollapsed also opens a collapsed section inside the target (an anchor around a card)', () => {
    const opened: string[] = [];
    const card = { dispatchEvent: () => opened.push('card') };
    const anchor = {
      closest: () => null,
      querySelectorAll: () => [card],
    } as unknown as Element;
    expect(revealCollapsed(anchor)).toBe(true);
    expect(opened).toEqual(['card']);
  });
});
