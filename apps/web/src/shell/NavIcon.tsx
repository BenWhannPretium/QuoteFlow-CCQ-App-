import {
  BarChart3Icon,
  CheckSquareIcon,
  ClipboardListIcon,
  FilePlus2Icon,
  HomeIcon,
  KanbanSquareIcon,
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
  approvals: CheckSquareIcon,
  analytics: BarChart3Icon,
  admin: SettingsIcon,
};
