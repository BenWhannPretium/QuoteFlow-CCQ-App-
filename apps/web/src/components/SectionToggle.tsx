import { ChevronDownIcon, ChevronsDownUpIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useLayoutEffect, useRef, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { sectionsStore, useSectionsMode } from '@/lib/collapse';
import { cn } from '@/lib/utils';

/**
 * The chevron in a collapsible section's header. Its name says which section ("Collapse Pack-out"): the
 * text of the section's heading, read from `headingRoot`.
 */
export function SectionToggle({
  collapsed,
  onToggle,
  controls,
  headingRoot,
}: {
  collapsed: boolean;
  onToggle: () => void;
  controls: string;
  headingRoot: RefObject<HTMLElement | null>;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // The name is set on the element: the heading is the section's own markup, read once it is rendered.
  useLayoutEffect(() => {
    // From the button itself: on the first render the section's own ref is not attached yet (a child's
    // layout effect runs first), so `headingRoot` is only the fallback.
    const root = button.current?.closest('[data-collapsed]') ?? headingRoot.current;
    const heading = root?.querySelector('h1, h2, h3, h4, [data-slot="card-title"]');
    const name = heading?.textContent?.trim() || 'section';
    button.current?.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${name}`);
  }, [headingRoot, collapsed]);
  return (
    <Button
      ref={button}
      type="button"
      variant="ghost"
      size="icon"
      className="-my-1 -mr-2 shrink-0 sm:size-8"
      aria-expanded={!collapsed}
      aria-controls={controls}
      data-testid="section-toggle"
      onClick={onToggle}
    >
      <ChevronDownIcon
        aria-hidden="true"
        className={cn(
          'transition-transform duration-150 motion-reduce:transition-none',
          collapsed && '-rotate-90',
        )}
      />
    </Button>
  );
}

/** "Collapse all" / "Expand all": sets every collapsible section on the page (and later ones) at once. */
export function SectionsToggle({ className }: { className?: string }) {
  const mode = useSectionsMode();
  const collapse = mode === 'expanded';
  const Icon = collapse ? ChevronsDownUpIcon : ChevronsUpDownIcon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      data-testid="sections-toggle"
      onClick={() => sectionsStore.setAll(collapse ? 'collapsed' : 'expanded')}
    >
      <Icon aria-hidden="true" />
      {collapse ? 'Collapse all sections' : 'Expand all sections'}
    </Button>
  );
}
