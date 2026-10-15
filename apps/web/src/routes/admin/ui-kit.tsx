import { createFileRoute, Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { InboxIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FiltersPopover,
  GateDecisionDialog,
  KeyValueGrid,
  PageHeader,
  ScorePill,
  SkeletonCard,
  SkeletonRows,
  StageBadge,
  TierChip,
  Timeline,
  type FilterValue,
} from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePublicConfig } from '@/config/public-config';
import { ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

/**
 * Admin-only reference page for the shared components, rendered with synthetic sample data.
 * The axe checks in e2e/a11y.spec.ts scan it in light and dark, so every component stays legible.
 */
export const Route = createFileRoute('/admin/ui-kit')({
  component: UiKitPage,
});

interface SampleRow {
  quoteNumber: string;
  customer: string;
  stageKey: string;
  tier: string;
  score: number;
  ageDays: number;
}

const SAMPLE_CUSTOMERS = [
  'Northwind Foods',
  'Contoso Beverages',
  'Fabrikam Home Care',
  'Tailspin Pet',
];
const column = createColumnHelper<SampleRow>();

function UiKitPage() {
  useDocumentTitle('UI kit');
  const { data: config } = usePublicConfig();
  const [filters, setFilters] = useState<FilterValue>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);

  const stages = useMemo(() => config?.stages ?? [], [config]);
  const tiers = useMemo(
    () => config?.tiers.map((t) => t.tier) ?? ['Critical', 'High', 'Standard', 'Low'],
    [config],
  );
  const firstGate = config?.gates.find((g) => g.enabled)?.key ?? 'G1';

  const rows = useMemo<SampleRow[]>(
    () =>
      SAMPLE_CUSTOMERS.map((customer, i) => ({
        quoteNumber: `CCQ-2026-0${1001 + i}`,
        customer,
        stageKey: stages[i % Math.max(stages.length, 1)]?.key ?? 'INTAKE',
        tier: tiers[i % tiers.length] ?? 'Standard',
        score: 92 - i * 17,
        ageDays: 3 + i * 5,
      })),
    [stages, tiers],
  );

  const columns = useMemo(
    () => [
      column.accessor('quoteNumber', {
        header: 'Quote',
        meta: { primary: true },
        cell: (info) => (
          <Link
            to="/quotes/$quoteNumber"
            params={{ quoteNumber: info.getValue() }}
            className="text-emphasis font-semibold underline-offset-4 hover:underline"
          >
            {info.getValue()}
          </Link>
        ),
      }),
      column.accessor('customer', { header: 'Customer' }),
      column.accessor('stageKey', {
        header: 'Stage',
        cell: (info) => <StageBadge stageKey={info.getValue()} />,
      }),
      column.accessor('tier', {
        header: 'Tier',
        cell: (info) => <TierChip tier={info.getValue()} />,
      }),
      column.accessor('score', {
        header: 'Score',
        meta: { numeric: true },
        cell: (info) => <ScorePill score={info.getValue()} />,
      }),
      column.accessor('ageDays', { header: 'Age (days)', meta: { numeric: true } }),
    ],
    [],
  );

  return (
    <div data-testid="ui-kit">
      <PageHeader
        eyebrow="Admin · Reference"
        title="UI kit"
        description="Shared QuoteFlow components with sample data. Labels come from live config."
        actions={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(true)}>
              Confirm dialog
            </Button>
            <Button onClick={() => setGateOpen(true)}>Gate decision</Button>
          </>
        }
      />

      <div className="grid gap-6">
        <Section title="Priority tiers and scores">
          <div className="flex flex-wrap items-center gap-2">
            {tiers.map((t) => (
              <TierChip key={t} tier={t} />
            ))}
            <ScorePill score={82} tooltip="Sample: revenue 90, volume 75, strategic fit 80." />
            <ScorePill score={null} />
          </div>
        </Section>

        <Section title="Stages (from config)">
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => (
              <StageBadge key={s.key} stageKey={s.key} />
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-2">
            <Button>Action</Button>
            <Button variant="primary">Primary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
        </Section>

        <Section title="Data table">
          <div className="mb-3 flex justify-end">
            <FiltersPopover
              groups={[
                { key: 'tier', label: 'Tier', options: tiers.map((t) => ({ value: t, label: t })) },
                {
                  key: 'stage',
                  label: 'Stage',
                  options: stages.map((s) => ({ value: s.key, label: s.label })),
                },
              ]}
              value={filters}
              onChange={setFilters}
            />
          </div>
          <DataTable
            caption="Sample quotes"
            columns={columns}
            data={rows.filter(
              (r) =>
                (!filters.tier?.length || filters.tier.includes(r.tier)) &&
                (!filters.stage?.length || filters.stage.includes(r.stageKey)),
            )}
            getRowId={(r) => r.quoteNumber}
            empty={<EmptyState icon={InboxIcon} title="No quotes match these filters" />}
          />
        </Section>

        <Section title="Key values">
          <KeyValueGrid
            columns={3}
            items={[
              { label: 'Customer', value: 'Northwind Foods' },
              { label: 'Opportunity', value: '006XX0000012345' },
              { label: 'Plant', value: null },
            ]}
          />
        </Section>

        <Section title="Timeline">
          <Timeline
            items={[
              {
                id: '1',
                at: '2026-10-12T14:05:00Z',
                title: 'Intake submitted',
                actor: 'Sample KAM',
                kind: 'stage',
              },
              {
                id: '2',
                at: '2026-10-13T09:30:00Z',
                title: 'Qualified',
                actor: 'Sample sales leader',
                kind: 'gate',
                detail: 'Strategic account; capacity at the sample plant.',
              },
              { id: '3', at: '2026-10-14T16:45:00Z', title: 'Note added', kind: 'note' },
            ]}
          />
        </Section>

        <Section title="States">
          <div className="grid gap-4 lg:grid-cols-2">
            <EmptyState
              icon={InboxIcon}
              title="Nothing here yet"
              description="Sample empty state."
            />
            <ErrorState
              error={
                new ApiError({
                  type: 'about:blank',
                  title: 'Unprocessable Content',
                  status: 422,
                  detail: 'Some fields need attention.',
                  errors: [{ path: 'plant', message: 'Choose a plant' }],
                  instance: 'req-sample-123',
                })
              }
            />
            <SkeletonCard />
            <SkeletonRows rows={3} />
          </div>
        </Section>

        <Section title="Toasts">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => toast.success({ title: 'Saved' })}>
              Success toast
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.error({ title: 'Something went wrong on our side', description: 'Sample.' })
              }
            >
              Error toast
            </Button>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Withdraw this quote?"
        description="Sample confirmation. Nothing is changed."
        confirmLabel="Withdraw"
        destructive
        onConfirm={() => setConfirmOpen(false)}
      />
      <GateDecisionDialog
        open={gateOpen}
        onOpenChange={setGateOpen}
        gateKey={firstGate}
        quoteNumber="CCQ-2026-01001"
        onSubmit={() => {
          setGateOpen(false);
          toast.info({ title: 'Sample decision recorded', description: 'Nothing was saved.' });
        }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
