import {
  BarChart3Icon,
  CheckSquareIcon,
  ClipboardListIcon,
  FilePlus2Icon,
  HomeIcon,
  KanbanSquareIcon,
  ListChecksIcon,
  ScrollTextIcon,
  SettingsIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react';

import type { NavKey } from './nav';

export const NAV_ICONS: Record<NavKey, LucideIcon> = {
  home: HomeIcon,
  intake: FilePlus2Icon,
  'queue-engineering': WrenchIcon,
  'queue-pricing': ClipboardListIcon,
  pipeline: KanbanSquareIcon,
  qualify: ListChecksIcon,
  approvals: CheckSquareIcon,
  analytics: BarChart3Icon,
  audit: ScrollTextIcon,
  admin: SettingsIcon,
};
