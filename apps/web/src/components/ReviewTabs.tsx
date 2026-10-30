/**
 * Lead review (2026-10-30): the lead's view of a work queue, "All" or "Ready for my review" (what an
 * engineer or pricer submitted and is waiting on them). Styled like the Analytics view tabs.
 */
export type ReviewTab = 'all' | 'ready';

export function ReviewTabs({
  value,
  onChange,
  readyCount,
}: {
  value: ReviewTab;
  onChange: (tab: ReviewTab) => void;
  readyCount: number;
}) {
  const tabs: [ReviewTab, string][] = [
    ['all', 'All'],
    ['ready', `Ready for my review (${readyCount})`],
  ];
  return (
    <div role="tablist" aria-label="Queue view" className="flex gap-1 border-b">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          data-testid={`review-tab-${key}`}
          onClick={() => onChange(key)}
          className="text-foreground-2 aria-selected:border-action aria-selected:text-foreground hover:text-foreground -mb-px min-h-11 shrink-0 border-b-2 border-transparent px-3 text-sm font-medium transition-colors sm:px-4"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
