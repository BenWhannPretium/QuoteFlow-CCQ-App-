import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BellIcon, CheckCheckIcon } from 'lucide-react';

import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '@/components';
import { NotificationRow } from '@/components/notifications/NotificationRow';
import {
  NOTIFICATION_POLL_MS,
  notificationsQueryKey,
  useMarkRead,
} from '@/components/notifications/useNotifications';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

interface NotificationsSearch {
  /** `unread` shows only what is not read yet. */
  filter?: 'unread';
}

export const Route = createFileRoute('/notifications')({
  validateSearch: (search: Record<string, unknown>): NotificationsSearch =>
    search.filter === 'unread' ? { filter: 'unread' } : {},
  component: NotificationsPage,
});

const PAGE_SIZE = 25;

/**
 * Every in-app notification the caller has had, newest first, loaded a page at a time. Everyone has this
 * page (the data is their own). Email is separate: `/me/preferences` chooses which events also email.
 */
function NotificationsPage() {
  useDocumentTitle('Notifications');
  const { filter } = Route.useSearch();
  const unreadOnly = filter === 'unread';
  const mark = useMarkRead();
  const feed = useInfiniteQuery({
    queryKey: [...notificationsQueryKey, 'page', unreadOnly ? 'unread' : 'all'],
    queryFn: ({ pageParam }) =>
      api.notifications({ limit: PAGE_SIZE, cursor: pageParam, unread: unreadOnly }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: NOTIFICATION_POLL_MS,
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = feed.data?.pages[0]?.unread ?? 0;
  const now = new Date();

  const tab = (active: boolean) =>
    cn(
      'rounded-pill inline-flex min-h-11 items-center px-4 text-sm font-medium sm:min-h-9',
      active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
    );

  return (
    <div className="grid gap-4" data-testid="notifications-page">
      <PageHeader
        className="mb-0"
        title="Notifications"
        description="Assignments, returns, approvals and mentions. These always show here; choose which of them also arrive by email in your email preferences."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => mark.all.mutate()}
              disabled={mark.all.isPending || unread === 0}
            >
              <CheckCheckIcon aria-hidden="true" /> Mark all read
            </Button>
            <Button asChild variant="ghost">
              <Link to="/me/preferences">Email preferences</Link>
            </Button>
          </>
        }
      />
      <nav aria-label="Filter" className="flex gap-2">
        <Link
          to="/notifications"
          search={{}}
          className={tab(!unreadOnly)}
          aria-current={!unreadOnly ? 'page' : undefined}
        >
          All
        </Link>
        <Link
          to="/notifications"
          search={{ filter: 'unread' }}
          className={tab(unreadOnly)}
          aria-current={unreadOnly ? 'page' : undefined}
          data-testid="filter-unread"
        >
          Unread{unread > 0 ? ` (${unread})` : ''}
        </Link>
      </nav>

      {feed.isPending ? (
        <SkeletonRows rows={5} />
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellIcon}
          title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
          description="When a quote needs you, or someone mentions you, it shows here."
        />
      ) : (
        <Card className="gap-0 p-2">
          <ul className="grid gap-1" data-testid="notification-page-list">
            {items.map((n) => (
              <li key={n.id}>
                <NotificationRow
                  item={n}
                  now={now}
                  onOpen={mark.open}
                  actions={
                    n.readAt === null ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 shrink-0"
                        onClick={() => mark.one.mutate(n.id)}
                        disabled={mark.one.isPending}
                        aria-label={`Mark read: ${n.title}`}
                      >
                        Mark read
                      </Button>
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {feed.hasNextPage && (
        <Button
          variant="outline"
          className="justify-self-center"
          onClick={() => void feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
        >
          {feed.isFetchingNextPage ? 'Loading…' : 'Load older'}
        </Button>
      )}
    </div>
  );
}
