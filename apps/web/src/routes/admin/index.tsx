import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ActivityIcon,
  BarChart3Icon,
  BookOpenCheckIcon,
  GaugeIcon,
  LinkIcon,
  ListIcon,
  PaletteIcon,
  PlugIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TagsIcon,
  UsersIcon,
  WorkflowIcon,
  type LucideIcon,
} from 'lucide-react';

import { ReadOnlyNotice, useCanEditConfig } from '@/admin/shared';
import { useCan } from '@/auth';
import { PageHeader } from '@/components/PageHeader';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/')({ component: AdminHome });

interface Section {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
  permission: string;
}

/** B-19 (CR-51): "Configure what is pending". Every screen reads for Leadership, writes for Admin. */
const CONFIG: Section[] = [
  {
    to: '/admin/value-lists',
    title: 'Value lists',
    description: 'Resins, markets, plants and the other pick lists.',
    icon: ListIcon,
    permission: 'config.read',
  },
  {
    to: '/admin/reason-codes',
    title: 'Reason codes',
    description: 'Why a quote was lost, declined, stopped, held or redirected.',
    icon: TagsIcon,
    permission: 'config.read',
  },
  {
    to: '/admin/workflow',
    title: 'Workflow labels and rules',
    description: 'Stage, gate and outcome labels, required fields, notes, reason codes and G1.',
    icon: WorkflowIcon,
    permission: 'config.read',
  },
  {
    to: '/admin/settings',
    title: 'App settings',
    description: 'Validity days, warning thresholds, aging buckets, approvers and more.',
    icon: SettingsIcon,
    permission: 'config.read',
  },
  {
    to: '/admin/scoring',
    title: 'Scoring model',
    description: 'Weights, bands and tiers, as versions with a preview before activation.',
    icon: GaugeIcon,
    permission: 'config.read',
  },
  {
    to: '/admin/users',
    title: 'Users and scope',
    description: 'Who has which role (from Entra) and which quotes they see.',
    icon: UsersIcon,
    permission: 'config.read',
  },
  {
    to: '/admin/integrations',
    title: 'Integrations',
    description: 'Connector health, recent runs and the Salesforce sync.',
    icon: PlugIcon,
    permission: 'config.read',
  },
  {
    to: '/admin/decision-log',
    title: 'Decision log',
    description: 'Every configuration change: who, what, why and when.',
    icon: BookOpenCheckIcon,
    permission: 'config.read',
  },
];

const REPORTS: Section[] = [
  {
    to: '/admin/audit',
    title: 'Audit log',
    description: 'Every view, change, decision, export and sign-in.',
    icon: ScrollTextIcon,
    permission: 'audit.read',
  },
  {
    to: '/admin/reports/usage',
    title: 'Usage report',
    description: 'Adoption by role and day.',
    icon: ActivityIcon,
    permission: 'audit.read',
  },
  {
    to: '/admin/override-log',
    title: 'Override log',
    description: 'Every governed override and who decided it.',
    icon: ShieldCheckIcon,
    permission: 'overrideLog.read',
  },
  {
    to: '/admin/reports/outcomes',
    title: 'Outcomes report',
    description: 'Awarded, lost and declined, with reasons.',
    icon: BarChart3Icon,
    permission: 'analytics.read',
  },
  {
    to: '/admin/reports/erf-linkage',
    title: 'ERF linkage',
    description: 'CCQ quotes against the Salesforce ERF number.',
    icon: LinkIcon,
    permission: 'config.manage',
  },
  {
    to: '/admin/ui-kit',
    title: 'UI kit',
    description: 'Shared components with synthetic data.',
    icon: PaletteIcon,
    permission: 'config.manage',
  },
];

function Card({ s }: { s: Section }) {
  const allowed = useCan(s.permission);
  if (!allowed) return null;
  const Icon = s.icon;
  return (
    <li>
      <Link
        to={s.to}
        className="bg-card rounded-card hover:bg-accent focus-visible:ring-ring flex h-full gap-3 border p-4 transition-colors"
      >
        <Icon className="text-emphasis mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <span className="grid gap-0.5">
          <span className="font-medium">{s.title}</span>
          <span className="text-muted-foreground text-sm">{s.description}</span>
        </span>
      </Link>
    </li>
  );
}

function AdminHome() {
  useDocumentTitle('Admin');
  const canEdit = useCanEditConfig();
  return (
    <div data-testid="page" data-page-title="Admin">
      <PageHeader
        eyebrow="Configuration"
        title="Admin"
        description="Open business decisions live here as data: change them without a code change. Every change needs a reason and is recorded in the decision log."
      />
      {!canEdit && <ReadOnlyNotice />}
      <nav aria-label="Configuration" className="mb-8">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CONFIG.map((s) => (
            <Card key={s.to} s={s} />
          ))}
        </ul>
      </nav>
      <h2 className="font-display mb-3 text-lg">Reports and audit</h2>
      <nav aria-label="Reports and audit">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {REPORTS.map((s) => (
            <Card key={s.to} s={s} />
          ))}
        </ul>
      </nav>
    </div>
  );
}
