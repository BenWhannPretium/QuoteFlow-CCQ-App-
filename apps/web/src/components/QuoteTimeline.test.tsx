import type { PublicConfigResponse, TimelineItem } from '@ccq/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { describeEvent } from './QuoteTimeline';

/** One activity event as the timeline API returns it. */
const event = (type: string, payload: Record<string, unknown> = {}): TimelineItem => ({
  id: '0193f2a0-0000-7000-8000-000000000001',
  kind: 'activity',
  type,
  category: 'other',
  actorId: null,
  actorName: 'Dev kam',
  at: '2026-11-17T15:00:00.000Z',
  payload,
  comment: null,
  override: null,
});

/** The entry's title and its detail as text. */
const words = (type: string, payload: Record<string, unknown> = {}) => {
  const { title, detail } = describeEvent(event(type, payload), undefined);
  return { title, detail: detail ? renderToStaticMarkup(<>{detail}</>) : null };
};

describe('describeEvent', () => {
  // UX-008: the button is "Start review"; the entry said "accepted".
  it('calls the start of an engineering review what the button calls it', () => {
    expect(words('eng_review_accepted').title).toBe('Engineering review started');
  });

  // UX-007: the entry used to read "Quote item removed", with no item and no word on the work.
  describe('an item removed from a multi-item quote', () => {
    it('names the item by its number and label', () => {
      expect(
        words('quote_item_removed', { itemNo: 2, label: '24 oz bottle', workDiscarded: false }),
      ).toEqual({ title: 'Item 2 (24 oz bottle) removed', detail: null });
    });

    it('says so when engineering work went with it', () => {
      expect(
        words('quote_item_removed', { itemNo: 2, label: '24 oz bottle', workDiscarded: true }),
      ).toEqual({
        title: 'Item 2 (24 oz bottle) removed',
        detail: '<p>Its engineering work was discarded.</p>',
      });
    });

    it('still names an item that has no label, or an entry with no number', () => {
      expect(words('quote_item_removed', { itemNo: 3, label: null }).title).toBe('Item 3 removed');
      expect(words('quote_item_removed', {}).title).toBe('Item removed');
    });
  });
});

/** A title or detail as the page would render it (a download link needs the query client). */
const html = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );
const titleOf = (type: string, payload: Record<string, unknown>, config?: PublicConfigResponse) =>
  html(describeEvent(event(type, payload), config).title);

// FB-27 (N17-34): a file's name opens the file; a removed file's name is plain text.
describe('file events on the timeline', () => {
  const id = '0193f2a0-0000-7000-8000-0000000000aa';

  it('"File uploaded" shows the name as a link (a button that opens the audited download)', () => {
    const out = titleOf('attachment_uploaded', {
      attachmentId: id,
      fileName: 'drawing.pdf',
      kind: 'bottle_drawing',
    });
    expect(out).toContain('File uploaded: ');
    expect(out).toMatch(/<button[^>]*type="button"[^>]*>drawing\.pdf<\/button>/);
  });

  it('a Quoting model upload names its step and version, and links the file', () => {
    const out = titleOf('attachment_uploaded', {
      attachmentId: id,
      fileName: 'cost.xlsx',
      kind: 'cost_model',
      version: 2,
    });
    expect(out).toContain('Costing model v2 uploaded: ');
    expect(out).toMatch(/<button[^>]*>cost\.xlsx<\/button>/);
  });

  it('a file that has since been removed, or an old event with no file id, is plain text', () => {
    const removed = titleOf('attachment_uploaded', {
      attachmentId: id,
      fileName: 'gone.pdf',
      fileRemoved: true,
    });
    expect(removed).not.toContain('<button');
    expect(removed).toContain('gone.pdf');
    const old = titleOf('attachment_uploaded', { fileName: 'old.pdf' });
    expect(old).not.toContain('<button');
    expect(old).toContain('File uploaded: ');
  });

  it('"File removed" never links', () => {
    expect(
      describeEvent(
        event('attachment_removed', { attachmentId: id, fileName: 'gone.pdf' }),
        undefined,
      ).title,
    ).toBe('File removed: gone.pdf');
  });
});

// FB-27 (N17-15): "Priority score up 53 → 61 (Standard)".
describe('priority score changes on the timeline', () => {
  const config = {
    tiers: [
      { tier: 'STANDARD', label: 'Standard', min: 40 },
      { tier: 'HIGH', label: 'High', min: 70 },
    ],
  } as unknown as PublicConfigResponse;
  const score = (payload: Record<string, unknown>) =>
    words('priority_score_changed', payload).title as string;

  it('reads up and down with the tier, inside a tier', () => {
    const p = { tierFrom: 'STANDARD', tierTo: 'STANDARD', tierChanged: false };
    expect(
      describeEvent(event('priority_score_changed', { ...p, from: 53, to: 61 }), config).title,
    ).toBe('Priority score up 53 → 61 (Standard)');
    expect(
      describeEvent(event('priority_score_changed', { ...p, from: 61, to: 53 }), config).title,
    ).toBe('Priority score down 61 → 53 (Standard)');
  });

  it('puts the tier change in the same line', () => {
    expect(
      describeEvent(
        event('priority_score_changed', {
          from: 66,
          to: 72.5,
          tierFrom: 'STANDARD',
          tierTo: 'HIGH',
          tierChanged: true,
        }),
        config,
      ).title,
    ).toBe('Priority score up 66 → 72.5 (tier Standard → High)');
  });

  it('a tier moved by new bands with the same score still reads, and says why', () => {
    const { title, detail } = describeEvent(
      event('priority_score_changed', {
        from: 70,
        to: 70,
        tierFrom: 'STANDARD',
        tierTo: 'HIGH',
        tierChanged: true,
        trigger: 'model_change',
      }),
      config,
    );
    expect(title).toBe('Priority score changed 70 → 70 (tier Standard → High)');
    expect(renderToStaticMarkup(<>{detail}</>)).toContain('A new scoring model was activated.');
  });

  it('keeps reading the older tier-only event', () => {
    expect(score({})).toBeDefined();
    expect(words('priority_tier_changed', { from: 'LOW', to: 'HIGH' }).title).toContain(
      'Priority tier',
    );
  });
});
