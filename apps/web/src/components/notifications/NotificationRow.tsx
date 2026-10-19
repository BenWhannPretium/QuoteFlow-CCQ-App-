import type { NotificationItem } from '@ccq/contracts';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { notificationTarget } from '@/lib/notification-target';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const rowClass = 'hover:bg-accent focus-visible:bg-accent block rounded-md px-2 py-2';

/**
 * One notification: unread ones are bold with a dot. Opening it (click or keyboard) calls `onOpen`, which
 * marks it read; a notification with no quote is plain text. Shared by the bell and the page.
 */
export function NotificationRow({
  item,
  now,
  onOpen,
  actions,
}: {
  item: NotificationItem;
  now: Date;
  onOpen?: (item: NotificationItem) => void;
  /** Extra controls beside the row (the page's "Mark read"). */
  actions?: ReactNode;
}) {
  const unread = item.readAt === null;
  const content = (
    <>
      <span className={cn('flex items-start gap-2 text-sm', unread && 'font-semibold')}>
        {unread && (
          <>
            <span
              aria-hidden="true"
              className="bg-destructive mt-1.5 size-2 shrink-0 rounded-full"
              data-testid="unread-dot"
            />
            <span className="sr-only">Unread: </span>
          </>
        )}
        <span>{item.title}</span>
      </span>
      <span className="text-foreground-2 block text-xs">{item.body}</span>
      <span className="text-foreground-2 block text-xs">{relativeTime(item.createdAt, now)}</span>
    </>
  );
  const open = () => onOpen?.(item);

  let link: ReactNode;
  if (!item.quoteNumber) {
    link = <div className="px-2 py-2">{content}</div>;
  } else {
    const params = { quoteNumber: item.quoteNumber };
    const kind = notificationTarget(item.type);
    link =
      kind === 'review' ? (
        <Link to="/quotes/$quoteNumber/review" params={params} onClick={open} className={rowClass}>
          {content}
        </Link>
      ) : kind === 'engineering' ? (
        <Link
          to="/quotes/$quoteNumber"
          params={params}
          search={{ tab: 'engineering' }}
          onClick={open}
          className={rowClass}
        >
          {content}
        </Link>
      ) : (
        <Link to="/quotes/$quoteNumber" params={params} onClick={open} className={rowClass}>
          {content}
        </Link>
      );
  }
  return actions ? (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">{link}</div>
      {actions}
    </div>
  ) : (
    link
  );
}
