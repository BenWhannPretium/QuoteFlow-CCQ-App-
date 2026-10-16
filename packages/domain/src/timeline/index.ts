/**
 * The quote timeline (F-08): which filter chip each activity type belongs to. The timeline merges
 * `activity_event` rows with `comment` rows; every later stage adds its own event types here.
 */
export const TIMELINE_FILTERS = ['all', 'decisions', 'overrides', 'files', 'comments'] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

export type TimelineCategory = 'decision' | 'override' | 'file' | 'comment' | 'other';

/** Activity types per category. Anything not listed (SF flag changes, assignments, rescoring) is `other`. */
export const TIMELINE_CATEGORY_TYPES: Readonly<
  Record<Exclude<TimelineCategory, 'other'>, readonly string[]>
> = {
  decision: [
    'quote_created',
    'quote_resubmitted',
    'gate_decided',
    'stage_changed',
    'hold_started',
    'hold_ended',
    'version_bumped',
    'quote_closed',
  ],
  override: [
    'override_requested',
    'override_applied',
    'override_rejected',
    'override_reverted',
    // B-07 interim event, before overrides moved to `override` rows.
    'ship_to_overridden',
  ],
  file: ['attachment_uploaded', 'attachment_removed'],
  comment: ['comment_added'],
};

export function timelineCategory(type: string): TimelineCategory {
  for (const [category, types] of Object.entries(TIMELINE_CATEGORY_TYPES)) {
    if (types.includes(type)) return category as TimelineCategory;
  }
  return 'other';
}

const FILTER_CATEGORY: Record<
  Exclude<TimelineFilter, 'all'>,
  Exclude<TimelineCategory, 'other'>
> = {
  decisions: 'decision',
  overrides: 'override',
  files: 'file',
  comments: 'comment',
};

/** The activity types a filter shows (null = every type), and whether comments are included. */
export function timelineFilterTypes(filter: TimelineFilter): {
  types: readonly string[] | null;
  comments: boolean;
} {
  if (filter === 'all') return { types: null, comments: true };
  const category = FILTER_CATEGORY[filter];
  return {
    types: category === 'comment' ? [] : TIMELINE_CATEGORY_TYPES[category],
    comments: category === 'comment',
  };
}
