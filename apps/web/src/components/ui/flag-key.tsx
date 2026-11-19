import { AlertTriangleIcon, CircleAlertIcon } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';

import { cn } from '@/lib/utils';

/**
 * FB-24 (N17-09, Bailey Schmitt): yellow everywhere read as "I can't move". Red (a light red fill, a red
 * border and its icon) stops you; yellow (amber) is worth checking. This key says so, and shows only while
 * a red or yellow flag is on screen. Never colour alone: each entry has its icon and its words.
 *
 * Two ways to use it: pass `red` / `yellow` when the caller knows which flags it shows, or pass `scope`
 * (a container) and the key watches it for `[data-tone="blocking"]` and `[data-tone="warning"]` (the
 * intake's `Notice`). FB-27 applies it to the gate, lead-review and Final Review panels.
 */

export const FLAG_KEY_TEXT = {
  red: 'Red: fix before you can go on.',
  yellow: 'Yellow: worth checking; you can still go on.',
} as const;

/** The flags on screen inside `scope`, kept up to date as the page changes. */
export function useFlagsOnScreen(scope: RefObject<HTMLElement | null> | undefined): {
  red: boolean;
  yellow: boolean;
} {
  const [flags, setFlags] = useState({ red: false, yellow: false });
  useEffect(() => {
    const root = scope?.current;
    if (!root) return;
    const read = () => {
      const red = root.querySelector('[data-tone="blocking"]') !== null;
      const yellow = root.querySelector('[data-tone="warning"]') !== null;
      setFlags((f) => (f.red === red && f.yellow === yellow ? f : { red, yellow }));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-tone'],
    });
    return () => observer.disconnect();
  }, [scope]);
  return flags;
}

export function FlagKey({
  red,
  yellow,
  scope,
  className,
}: {
  red?: boolean;
  yellow?: boolean;
  scope?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const seen = useFlagsOnScreen(scope);
  const showRed = red ?? seen.red;
  const showYellow = yellow ?? seen.yellow;
  if (!showRed && !showYellow) return null;
  return (
    <p
      className={cn('text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs', className)}
      data-testid="flag-key"
    >
      <span className="sr-only">Key: </span>
      {showRed && (
        <span className="inline-flex items-center gap-1.5" data-testid="flag-key-red">
          <span
            aria-hidden
            className="border-destructive bg-destructive/10 text-destructive inline-flex size-4 items-center justify-center rounded-sm border"
          >
            <CircleAlertIcon className="size-3" />
          </span>
          {FLAG_KEY_TEXT.red}
        </span>
      )}
      {showYellow && (
        <span className="inline-flex items-center gap-1.5" data-testid="flag-key-yellow">
          <span
            aria-hidden
            className="bg-warning text-warning-foreground inline-flex size-4 items-center justify-center rounded-sm"
          >
            <AlertTriangleIcon className="size-3" />
          </span>
          {FLAG_KEY_TEXT.yellow}
        </span>
      )}
    </p>
  );
}
