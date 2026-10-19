import type { NotificationItem } from '@ccq/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

/** Every notification query (the bell and the page) shares this prefix, so one invalidation refreshes both. */
export const notificationsQueryKey = ['notifications'] as const;

/** The bell polls once a minute (no websockets in the MVP). */
export const NOTIFICATION_POLL_MS = 60_000;

/** Mark one notification read, or all of them; both refresh every notification query. */
export function useMarkRead() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
  const one = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: refresh,
  });
  const all = useMutation({ mutationFn: () => api.markNotificationsRead(), onSuccess: refresh });
  return {
    /** Opening an unread notification marks it read; an already-read one costs nothing. */
    open: (item: NotificationItem) => {
      if (item.readAt === null) one.mutate(item.id);
    },
    one,
    all,
  };
}
