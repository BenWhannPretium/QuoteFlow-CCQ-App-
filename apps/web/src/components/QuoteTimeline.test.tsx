import type { TimelineItem } from '@ccq/contracts';
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
