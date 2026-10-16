import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BellIcon } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

export const notificationsQueryKey = ['notifications'] as const;

/**
 * In-app notifications (B-10 minimum: the EngLead's queue-arrival alert and assignments, plus the
 * B-09 override and @mention rows). Polls every minute; "Mark all read" clears the badge. B-18 adds
 * email and per-item read state.
 */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const feed = useQuery({
    queryKey: notificationsQueryKey,
    queryFn: () => api.notifications(),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: () => api.markNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationsQueryKey }),
  });
  const unread = feed.data?.unread ?? 0;
  const items = feed.data?.items ?? [];
  const now = new Date();

  return (
    <Popover>
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
              onClick={() => markRead.mutate()}
              disabled={markRead.isPending}
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
            {items.map((n) => {
              const body = (
                <>
                  <span className={cn('block text-sm', !n.readAt && 'font-semibold')}>
                    {n.title}
                  </span>
                  <span className="text-muted-foreground block text-xs">{n.body}</span>
                  <span className="text-muted-foreground block text-xs">
                    {relativeTime(n.createdAt, now)}
                  </span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.quoteNumber ? (
                    <Link
                      to="/quotes/$quoteNumber"
                      params={{ quoteNumber: n.quoteNumber }}
                      {...(n.type.startsWith('quote.ready_for_eng') || n.type === 'quote.assigned'
                        ? { search: { tab: 'engineering' as const } }
                        : {})}
                      className="hover:bg-accent block rounded-md px-2 py-2"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="px-2 py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
