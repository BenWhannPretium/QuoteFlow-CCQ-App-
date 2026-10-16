import {
  BarChart3Icon,
  CheckSquareIcon,
  ClipboardListIcon,
  FileClockIcon,
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
  proposals: FileClockIcon,
  'queue-engineering': WrenchIcon,
  'queue-pricing': ClipboardListIcon,
  pipeline: KanbanSquareIcon,
  qualify: ListChecksIcon,
  approvals: CheckSquareIcon,
  analytics: BarChart3Icon,
  audit: ScrollTextIcon,
  admin: SettingsIcon,
};
