import type { Approval } from '@ccq/contracts';
import { ArrowDownIcon, ArrowUpIcon, ListOrderedIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';

import {
  ApprovalBadge,
  ChangeDialog,
  StatusPill,
  useCanEditConfig,
  type ChangeSubmit,
} from './shared';

/** A value-list entry or a reason code, as the list editor sees it. */
export interface ListItem {
  id: string;
  version: number;
  code: string;
  label: string;
  sort: number;
  active: boolean;
  requiresNote?: boolean;
  approval: Approval;
}

export interface ListEditorProps {
  /** "Value list" / "Reason context". */
  groupLabel: string;
  groups: readonly string[];
  group: string;
  onGroupChange: (group: string) => void;
  items: readonly ListItem[];
  /** Reason codes have "requires a note". */
  withRequiresNote?: boolean;
  onCreate: (
    input: { code: string; label: string; requiresNote: boolean },
    s: ChangeSubmit,
  ) => Promise<unknown>;
  onUpdate: (
    item: ListItem,
    patch: { label?: string; active?: boolean; requiresNote?: boolean },
    s: ChangeSubmit,
  ) => Promise<unknown>;
  onReorder: (items: readonly ListItem[], s: ChangeSubmit) => Promise<unknown>;
}

const pretty = (key: string) => key.replace(/_/g, ' ');

/**
 * Add, rename, deactivate (never delete), approve and reorder the entries of one list. Every change
 * opens the change dialog (reason required). Inactive entries stay on the quotes that use them.
 */
export function ListEditor(props: ListEditorProps) {
  const { groupLabel, groups, group, onGroupChange, items, withRequiresNote = false } = props;
  const canEdit = useCanEditConfig();
  const ids = { group: useId(), code: useId(), label: useId(), note: useId(), active: useId() };
  const [editing, setEditing] = useState<ListItem | null>(null);
  const [draft, setDraft] = useState({ label: '', active: true, requiresNote: false });
  const [adding, setAdding] = useState(false);
  const [newEntry, setNewEntry] = useState({ code: '', label: '', requiresNote: false });
  // A reorder in progress belongs to the list it started on; switching lists drops it.
  const [ordering, setOrdering] = useState<{ group: string; items: ListItem[] } | null>(null);
  const order = ordering?.group === group ? ordering.items : null;
  const setOrder = (next: ListItem[] | null) => setOrdering(next ? { group, items: next } : null);
  const [savingOrder, setSavingOrder] = useState(false);
  const rows = order ?? items;

  const move = (i: number, by: number) => {
    const next = [...rows];
    const [it] = next.splice(i, 1);
    next.splice(i + by, 0, it!);
    setOrder(next);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <label htmlFor={ids.group} className="text-sm font-medium">
            {groupLabel}
          </label>
          <NativeSelect
            id={ids.group}
            value={group}
            className="min-w-56"
            onChange={(e) => onGroupChange(e.target.value)}
          >
            {groups.map((g) => (
              <option key={g} value={g}>
                {pretty(g)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <span className="flex-1" />
        {canEdit && !order && (
          <>
            <Button
              variant="outline"
              onClick={() => setOrder([...items])}
              disabled={items.length < 2}
            >
              <ListOrderedIcon aria-hidden="true" /> Reorder
            </Button>
            <Button
              onClick={() => {
                setNewEntry({ code: '', label: '', requiresNote: false });
                setAdding(true);
              }}
            >
              <PlusIcon aria-hidden="true" /> Add
            </Button>
          </>
        )}
        {order && (
          <>
            <Button variant="outline" onClick={() => setOrder(null)}>
              Cancel
            </Button>
            <Button onClick={() => setSavingOrder(true)}>Save order</Button>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ListOrderedIcon}
          title="Nothing here yet"
          description="Add the first entry."
        />
      ) : (
        <ul
          className="bg-card rounded-card divide-y border"
          aria-label={`${pretty(group)} entries`}
        >
          {rows.map((item, i) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3"
              data-testid="list-entry"
            >
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">{item.label}</span>
                <span className="text-muted-foreground font-mono text-xs">{item.code}</span>
              </div>
              {withRequiresNote && item.requiresNote && (
                <span className="text-muted-foreground text-xs">Needs a note</span>
              )}
              <StatusPill active={item.active} />
              <ApprovalBadge approval={item.approval} />
              {order ? (
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${item.label} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUpIcon aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${item.label} down`}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon aria-hidden="true" />
                  </Button>
                </span>
              ) : (
                canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit ${item.label}`}
                    onClick={() => {
                      setDraft({
                        label: item.label,
                        active: item.active,
                        requiresNote: item.requiresNote ?? false,
                      });
                      setEditing(item);
                    }}
                  >
                    <PencilIcon aria-hidden="true" /> Edit
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      <ChangeDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={`Edit ${editing?.label ?? ''}`}
        description={
          <>
            Code <span className="font-mono">{editing?.code}</span> never changes (it is stored on
            quotes and decisions). Deactivating stops it being offered; quotes that use it keep it.
          </>
        }
        approval={editing?.approval}
        canSubmit={draft.label.trim().length > 0}
        onSubmit={(s) =>
          props.onUpdate(
            editing!,
            {
              ...(draft.label.trim() !== editing!.label ? { label: draft.label.trim() } : {}),
              ...(draft.active !== editing!.active ? { active: draft.active } : {}),
              ...(withRequiresNote && draft.requiresNote !== (editing!.requiresNote ?? false)
                ? { requiresNote: draft.requiresNote }
                : {}),
            },
            s,
          )
        }
      >
        <div className="grid gap-1.5">
          <label htmlFor={ids.label} className="text-sm font-medium">
            Label
          </label>
          <Input
            id={ids.label}
            value={draft.label}
            maxLength={200}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </div>
        <label htmlFor={ids.active} className="flex min-h-11 items-center gap-2 text-sm">
          <input
            id={ids.active}
            type="checkbox"
            className="size-4"
            checked={draft.active}
            onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
          />
          Active (offered in pick lists)
        </label>
        {withRequiresNote && (
          <label htmlFor={ids.note} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              id={ids.note}
              type="checkbox"
              className="size-4"
              checked={draft.requiresNote}
              onChange={(e) => setDraft((d) => ({ ...d, requiresNote: e.target.checked }))}
            />
            Choosing it needs a note
          </label>
        )}
      </ChangeDialog>

      <ChangeDialog
        open={adding}
        onOpenChange={setAdding}
        title={`Add to ${pretty(group)}`}
        description="New entries start provisional until the owner approves them."
        submitLabel="Add"
        canSubmit={newEntry.code.trim().length > 0 && newEntry.label.trim().length > 0}
        onSubmit={(s) =>
          props.onCreate(
            {
              code: newEntry.code.trim(),
              label: newEntry.label.trim(),
              requiresNote: newEntry.requiresNote,
            },
            s,
          )
        }
      >
        <div className="grid gap-1.5">
          <label htmlFor={ids.code} className="text-sm font-medium">
            Code
          </label>
          <Input
            id={ids.code}
            value={newEntry.code}
            maxLength={64}
            placeholder="e.g. PET_CARE"
            onChange={(e) => setNewEntry((n) => ({ ...n, code: e.target.value }))}
          />
          <span className="text-muted-foreground text-xs">
            Stored on quotes; letters, digits and _ - . + / only. It cannot be changed later.
          </span>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${ids.label}-new`} className="text-sm font-medium">
            Label
          </label>
          <Input
            id={`${ids.label}-new`}
            value={newEntry.label}
            maxLength={200}
            onChange={(e) => setNewEntry((n) => ({ ...n, label: e.target.value }))}
          />
        </div>
        {withRequiresNote && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={newEntry.requiresNote}
              onChange={(e) => setNewEntry((n) => ({ ...n, requiresNote: e.target.checked }))}
            />
            Choosing it needs a note
          </label>
        )}
      </ChangeDialog>

      <ChangeDialog
        open={savingOrder}
        onOpenChange={setSavingOrder}
        title={`Save the order of ${pretty(group)}`}
        description={(order ?? []).map((r) => r.label).join(' · ')}
        submitLabel="Save order"
        onSubmit={async (s) => {
          await props.onReorder(order!, s);
          setOrder(null);
        }}
      />
    </div>
  );
}
