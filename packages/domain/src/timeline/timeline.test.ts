import { describe, expect, it } from 'vitest';

import { timelineCategory, timelineFilterTypes, TIMELINE_FILTERS } from './index';

describe('timeline categories', () => {
  it.each([
    ['gate_decided', 'decision'],
    ['stage_changed', 'decision'],
    ['override_applied', 'override'],
    ['ship_to_overridden', 'override'],
    ['attachment_uploaded', 'file'],
    ['comment_added', 'comment'],
    // FB-17 (W13-22): shown with the decisions, next to the G2 Advance that caused it.
    ['capital_needed', 'decision'],
    ['sf_status_changed', 'other'],
    ['priority_tier_changed', 'other'],
    // FB-27 (N17-15): a score change is a system note, shown under All.
    ['priority_score_changed', 'other'],
  ])('%s → %s', (type, category) => {
    expect(timelineCategory(type)).toBe(category);
  });

  it('filters map to activity types and comments', () => {
    expect(TIMELINE_FILTERS).toEqual(['all', 'decisions', 'overrides', 'files', 'comments']);
    expect(timelineFilterTypes('all')).toEqual({ types: null, comments: true });
    expect(timelineFilterTypes('comments')).toEqual({ types: [], comments: true });
    expect(timelineFilterTypes('overrides').types).toContain('override_reverted');
    expect(timelineFilterTypes('files')).toEqual({
      types: ['attachment_uploaded', 'attachment_removed', 'offer_letter_generated'],
      comments: false,
    });
    expect(timelineFilterTypes('decisions').comments).toBe(false);
  });
});
