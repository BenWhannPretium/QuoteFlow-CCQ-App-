import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BellIcon } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { NotificationRow } from '@/components/notifications/NotificationRow';
import {
  NOTIFICATION_POLL_MS,
  notificationsQueryKey,
  useMarkRead,
} from '@/components/notifications/useNotifications';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';

export { notificationsQueryKey };

const BELL_ITEMS = 10;

/**
 * In-app notifications (B-18): the unread count on the bell (polled every minute, no websockets), the
 * latest ten, mark one read by opening it, "Mark all read", and a link to the full `/notifications` page.
 * In-app notifications cannot be switched off; email can (`/me/preferences`).
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const feed = useQuery({
    queryKey: [...notificationsQueryKey, 'bell'],
    queryFn: () => api.notifications({ limit: BELL_ITEMS }),
    refetchInterval: NOTIFICATION_POLL_MS,
  });
  const mark = useMarkRead();
  const unread = feed.data?.unread ?? 0;
  const items = feed.data?.items ?? [];
  const now = new Date();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="hover:bg-header-control relative inline-flex size-11 items-center justify-center rounded-full"
        data-testid="notification-bell"
      >
        <BellIcon className="size-5" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="bg-destructive text-destructive-foreground rounded-pill absolute top-1 right-1 min-w-5 px-1 text-center text-xs leading-5 font-semibold"
            data-testid="notification-badge"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-2rem))]" align="end">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => mark.all.mutate()}
              disabled={mark.all.isPending}
            >
              Mark all read
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon={BellIcon}
            title="You’re all caught up"
            description="Assignments, returns and decisions will show here."
            className="py-6"
          />
        ) : (
          <ul className="grid max-h-[60dvh] gap-1 overflow-y-auto" data-testid="notification-list">
            {items.map((n) => (
              <li key={n.id}>
                <NotificationRow
                  item={n}
                  now={now}
                  onOpen={(item) => {
                    mark.open(item);
                    setOpen(false);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="text-emphasis font-medium underline-offset-4 hover:underline"
            data-testid="notifications-view-all"
          >
            View all notifications
          </Link>
          <Link
            to="/me/preferences"
            onClick={() => setOpen(false)}
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            Email preferences
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
