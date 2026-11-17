import { useBlocker } from '@tanstack/react-router';

import {
  LEAVE_UNSAVED_TEXT,
  fileLinkJustOpened,
  useHasUnsavedChanges,
} from '@/lib/unsaved-changes';

/** Another tab of the same quote is not leaving: its cards stay on the page. Anything else asks. */
const asksBeforeLeaving = ({
  current,
  next,
}: {
  current: { pathname: string };
  next: { pathname: string };
}): boolean => current.pathname !== next.pathname && !window.confirm(LEAVE_UNSAVED_TEXT);

/** A reload or a closed window asks too (the browser's own words), but a file download does not. */
const asksBeforeUnload = (): boolean => !fileLinkJustOpened();

/**
 * UX-001: asks before leaving a quote that has unsaved changes on its Engineering or Quoting tab. Does
 * nothing while every card is saved. Render it once on the quote page.
 */
export function UnsavedChangesGuard({ quoteNumber }: { quoteNumber: string }) {
  const unsaved = useHasUnsavedChanges(quoteNumber);
  useBlocker({
    shouldBlockFn: asksBeforeLeaving,
    enableBeforeUnload: asksBeforeUnload,
    disabled: !unsaved,
  });
  return null;
}
