import { BellIcon } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Placeholder until B-18 (notifications) adds the feed and the unread count. */
export function NotificationBell() {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications"
        className="hover:bg-header-control inline-flex size-11 items-center justify-center rounded-full"
      >
        <BellIcon className="size-5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent>
        <h2 className="mb-3 text-sm font-semibold">Notifications</h2>
        <EmptyState
          icon={BellIcon}
          title="You’re all caught up"
          description="Assignments, returns and decisions will show here."
          className="py-6"
        />
      </PopoverContent>
    </Popover>
  );
}
