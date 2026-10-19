import { SCOPE_TYPE_VALUES, type AdminUser } from '@ccq/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ExternalLinkIcon, PencilIcon, UsersIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import {
  adminKey,
  BackToAdmin,
  ChangeDialog,
  ReadOnlyNotice,
  useCanEditConfig,
} from '@/admin/shared';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonRows } from '@/components/Skeletons';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/time';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

export const Route = createFileRoute('/admin/users')({ component: UsersPage });

type ScopeType = (typeof SCOPE_TYPE_VALUES)[number];

const SCOPE_LABEL: Record<ScopeType, string> = {
  all: 'All quotes',
  owner: 'Own quotes only',
  region: 'Regions',
  account_list: 'Accounts (SF ids)',
};
const needsValues = (t: ScopeType) => t === 'region' || t === 'account_list';

/**
 * B-19 screen 6: who uses CCQ, their roles (read-only: they come from Entra security groups) and
 * their data scope (editable, versioned and audited; architecture §3.2).
 */
function UsersPage() {
  useDocumentTitle('Users and scope');
  const canEdit = useCanEditConfig();
  const ids = { q: useId(), type: useId(), values: useId() };
  const users = useQuery({ queryKey: adminKey('users'), queryFn: api.admin.users });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [scopeType, setScopeType] = useState<ScopeType>('all');
  const [values, setValues] = useState('');

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const items = users.data?.items ?? [];
    return needle
      ? items.filter((u) =>
          [u.displayName, u.upn, u.roles.join(' ')].some((s) => s.toLowerCase().includes(needle)),
        )
      : items;
  }, [users.data, q]);

  const parsedValues = values
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
  const roleChangeUrl = users.data?.roleChangeUrl;

  return (
    <div data-testid="page" data-page-title="Users and scope">
      <BackToAdmin />
      <PageHeader
        eyebrow="Configuration"
        title="Users and scope"
        description="Everyone who has signed in. Roles come from Entra ID groups at sign-in; data scope is set here."
      />
      {!canEdit && <ReadOnlyNotice />}
      <aside
        className="bg-card rounded-card mb-4 grid gap-1 border p-4 text-sm"
        aria-label="Request a role change"
      >
        <h2 className="font-medium">Need a different role?</h2>
        <p className="text-muted-foreground">
          CCQ roles are Entra security groups (SG-CCQ-…), so they can&apos;t be changed here. Ask IT
          to add or remove the person from the group; the new role applies at their next sign-in.
        </p>
        {roleChangeUrl ? (
          <a
            href={roleChangeUrl}
            target="_blank"
            rel="noreferrer"
            className="text-emphasis inline-flex min-h-11 items-center gap-1 font-medium underline-offset-4 hover:underline sm:min-h-0"
          >
            Open the IT request form <ExternalLinkIcon className="size-4" aria-hidden="true" />
          </a>
        ) : (
          <p>
            Contact the IT help desk (the request form link is set in App settings ›
            role_change_request_url once IT confirms it).
          </p>
        )}
      </aside>

      <div className="mb-3 grid max-w-sm gap-1.5">
        <label htmlFor={ids.q} className="text-sm font-medium">
          Find a user
        </label>
        <Input
          id={ids.q}
          type="search"
          value={q}
          placeholder="Name, email or role"
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : !users.data ? (
        <SkeletonRows rows={8} />
      ) : list.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users match" description="Try another search." />
      ) : (
        <ul className="bg-card rounded-card divide-y border" aria-label="Users">
          {list.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3"
              data-testid="user-row"
            >
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">
                  {u.displayName}
                  {!u.active && (
                    <span className="text-muted-foreground ml-2 text-xs">inactive</span>
                  )}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {u.upn}
                  {u.lastSeenAt ? ` · seen ${relativeTime(u.lastSeenAt)}` : ''}
                </span>
              </div>
              <span className="flex flex-wrap gap-1" aria-label="Roles">
                {u.roles.length === 0 && (
                  <span className="text-muted-foreground text-xs">No role</span>
                )}
                {u.roles.map((r) => (
                  <span key={r} className="bg-muted rounded-full px-2 py-0.5 text-xs font-medium">
                    {r}
                  </span>
                ))}
              </span>
              <span className="text-sm" data-testid="user-scope">
                {SCOPE_LABEL[u.scope.type]}
                {u.scope.values.length > 0 && `: ${u.scope.values.join(', ')}`}
                {!u.scopeExplicit && (
                  <span className="text-muted-foreground block text-xs">default</span>
                )}
              </span>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Edit scope of ${u.displayName}`}
                  onClick={() => {
                    setScopeType(u.scope.type);
                    setValues(u.scope.values.join('\n'));
                    setEditing(u);
                  }}
                >
                  <PencilIcon aria-hidden="true" /> Scope
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ChangeDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={`Data scope: ${editing?.displayName ?? ''}`}
        description="Which quotes this person can see (KAM and Engineer roles; other roles see all quotes in MVP). Enforced on the server and in the database."
        canSubmit={!needsValues(scopeType) || parsedValues.length > 0}
        onSubmit={(s) =>
          api.admin.updateUserScope(editing!.id, {
            version: editing!.scopeVersion,
            changeReason: s.changeReason,
            type: scopeType,
            values: needsValues(scopeType) ? parsedValues : [],
          })
        }
      >
        <div className="grid gap-1.5">
          <label htmlFor={ids.type} className="text-sm font-medium">
            Scope
          </label>
          <NativeSelect
            id={ids.type}
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value as ScopeType)}
          >
            {SCOPE_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {SCOPE_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {needsValues(scopeType) && (
          <div className="grid gap-1.5">
            <label htmlFor={ids.values} className="text-sm font-medium">
              {scopeType === 'region' ? 'Regions' : 'Salesforce account ids'} (one per line)
            </label>
            <textarea
              id={ids.values}
              className="border-input bg-card min-h-24 rounded-md border px-3 py-2 text-base sm:text-sm"
              value={values}
              onChange={(e) => setValues(e.target.value)}
            />
          </div>
        )}
      </ChangeDialog>
    </div>
  );
}
