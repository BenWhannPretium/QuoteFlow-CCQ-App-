import type { AdminSetting, AdminUser } from '@ccq/contracts';
import { ROLES, type RequiredRule } from '@ccq/domain';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';

import { describeRules, RuleEditor, rulesProblem } from './RuleEditor';

/**
 * One editor per `SettingSpec.editor` (domain `SETTING_EDITORS`). The editor holds the draft value;
 * `settingProblem` says whether it can be saved (the server validates again with the domain parser).
 * JSON settings are edited as text: the draft is the text, parsed on save.
 */

export interface SettingEditorContext {
  users: readonly AdminUser[];
  ruleFields: readonly string[];
}

export type Draft = unknown;

const asNumberMap = (v: unknown): [string, number][] =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.entries(v as Record<string, number>)
    : [];

/** The draft an editor starts from. */
export function initialDraft(s: AdminSetting): Draft {
  if (s.editor === 'json') return JSON.stringify(s.value, null, 2);
  if (s.editor === 'numberMap') return s.value === null ? null : asNumberMap(s.value);
  return s.value;
}

/** Draft → the JSON value to send. Throws on unparsable JSON. */
export function draftValue(s: AdminSetting, draft: Draft): unknown {
  if (s.editor === 'json') return JSON.parse(draft as string) as unknown;
  if (s.editor === 'numberMap') {
    return draft === null ? null : Object.fromEntries(draft as [string, number][]);
  }
  if (s.editor === 'text' && s.nullable && draft === '') return null;
  return draft;
}

/** Why the draft can't be saved, or null. */
export function settingProblem(s: AdminSetting, draft: Draft): string | null {
  try {
    const v = draftValue(s, draft);
    if (v === null) return s.nullable ? null : 'A value is required';
    switch (s.editor) {
      case 'integer':
        return Number.isInteger(v) ? null : 'Enter a whole number';
      case 'number':
      case 'nullableNumber':
        return typeof v === 'number' && Number.isFinite(v) ? null : 'Enter a number';
      case 'numberMap':
        return (draft as [string, number][]).some(([k, n]) => !k.trim() || !Number.isFinite(n))
          ? 'Every row needs a code and a number'
          : null;
      case 'agingDays': {
        const a = v as { aging: number; old: number };
        return Number.isInteger(a.aging) &&
          Number.isInteger(a.old) &&
          a.old >= a.aging &&
          a.aging >= 1
          ? null
          : 'Whole days, with "old" at least "aging"';
      }
      case 'rules':
        return rulesProblem(v);
      case 'text':
        return typeof v === 'string' && v.trim() ? null : 'Enter a value';
      default:
        return null;
    }
  } catch {
    return 'Not valid JSON';
  }
}

/** One-line read-only summary of a value. */
export function formatSetting(s: AdminSetting, users: readonly AdminUser[] = []): string {
  const v = s.value;
  if (v === null || v === undefined) return 'Not set';
  switch (s.editor) {
    case 'boolean':
      return v ? 'Yes' : 'No';
    case 'numberMap': {
      const rows = asNumberMap(v);
      return rows.length ? rows.map(([k, n]) => `${k}: ${n.toLocaleString()}`).join(', ') : 'None';
    }
    case 'agingDays': {
      const a = v as { aging: number; old: number };
      return `Aging after ${a.aging} business days, old after ${a.old}`;
    }
    case 'userIds': {
      const ids = v as string[];
      if (!ids.length) return 'Nobody';
      return ids.map((id) => users.find((u) => u.id === id)?.displayName ?? id).join(', ');
    }
    case 'rules':
      return describeRules(v as RequiredRule[]);
    case 'overridableFields':
      return (v as { label: string; approval: string; approverRoles: string[] }[])
        .map((f) =>
          f.approval === 'self'
            ? `${f.label}: self (logged)`
            : `${f.label}: ${f.approverRoles.join(' / ')}`,
        )
        .join(' · ');
    case 'json': {
      const text = JSON.stringify(v);
      return text.length > 120 ? `${text.slice(0, 117)}…` : text;
    }
    default:
      return typeof v === 'number'
        ? v.toLocaleString()
        : typeof v === 'string'
          ? v
          : JSON.stringify(v);
  }
}

interface OverridableField {
  field: string;
  label: string;
  approval: 'approver' | 'self';
  requestRoles: string[];
  approverRoles: string[];
  revertRoles: string[];
  ownQuoteOnlyRoles: string[];
}

const ROLE_GROUPS = [
  ['requestRoles', 'May request'],
  ['approverRoles', 'Approves'],
  ['revertRoles', 'May revert'],
  ['ownQuoteOnlyRoles', 'Own quotes only'],
] as const;

function RoleChecks({
  legend,
  value,
  disabled,
  onChange,
}: {
  legend: string;
  value: string[];
  disabled?: boolean;
  onChange: (roles: string[]) => void;
}) {
  return (
    <fieldset className="grid gap-1" disabled={disabled}>
      <legend className="text-xs font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-3">
        {ROLES.filter((r) => r !== 'PostAward').map((role) => (
          <label key={role} className="flex min-h-9 items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              className="size-4"
              checked={value.includes(role)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))
              }
            />
            {role}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingEditor({
  setting,
  draft,
  onChange,
  ctx,
}: {
  setting: AdminSetting;
  draft: Draft;
  onChange: (d: Draft) => void;
  ctx: SettingEditorContext;
}) {
  const id = useId();
  const s = setting;
  const unsetToggle = s.nullable && s.editor !== 'json' && s.editor !== 'text' && (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4"
        checked={draft === null}
        onChange={(e) =>
          onChange(
            e.target.checked
              ? null
              : s.editor === 'numberMap'
                ? []
                : s.editor === 'nullableNumber'
                  ? 0
                  : '',
          )
        }
      />
      Not set (off)
    </label>
  );

  switch (s.editor) {
    case 'boolean':
      return (
        <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            className="size-4"
            checked={draft === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {s.label}
        </label>
      );
    case 'integer':
    case 'number':
    case 'nullableNumber':
      return (
        <div className="grid gap-1.5">
          {unsetToggle}
          {draft !== null && (
            <>
              <label htmlFor={id} className="text-sm font-medium">
                Value
              </label>
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                step={s.editor === 'integer' ? 1 : 'any'}
                value={typeof draft === 'number' || typeof draft === 'string' ? draft : ''}
                onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </>
          )}
        </div>
      );
    case 'text':
      return (
        <div className="grid gap-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            Value
          </label>
          <Input
            id={id}
            value={(draft as string | null) ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
          {s.nullable && <span className="text-muted-foreground text-xs">Empty = not set.</span>}
        </div>
      );
    case 'select':
      return (
        <div className="grid gap-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            Value
          </label>
          <NativeSelect id={id} value={String(draft)} onChange={(e) => onChange(e.target.value)}>
            {(s.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </NativeSelect>
        </div>
      );
    case 'numberMap': {
      const rows = (draft as [string, number][] | null) ?? null;
      return (
        <div className="grid gap-2">
          {unsetToggle}
          {rows && (
            <>
              {rows.map(([k, n], i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label="Code"
                    value={k}
                    placeholder="code (e.g. IBM, or * when unknown)"
                    onChange={(e) =>
                      onChange(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))
                    }
                  />
                  <Input
                    aria-label="Number"
                    type="number"
                    value={Number.isFinite(n) ? n : ''}
                    onChange={(e) =>
                      onChange(rows.map((r, j) => (j === i ? [r[0], Number(e.target.value)] : r)))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove row"
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => onChange([...rows, ['', 0]])}
              >
                <PlusIcon aria-hidden="true" /> Add row
              </Button>
            </>
          )}
        </div>
      );
    }
    case 'agingDays': {
      const a = (draft as { aging: number; old: number }) ?? { aging: 3, old: 10 };
      return (
        <div className="grid grid-cols-2 gap-3">
          {(['aging', 'old'] as const).map((k) => (
            <div key={k} className="grid gap-1.5">
              <label htmlFor={`${id}-${k}`} className="text-sm font-medium">
                {k === 'aging' ? 'Aging after (business days)' : 'Old after (business days)'}
              </label>
              <Input
                id={`${id}-${k}`}
                type="number"
                step={1}
                min={1}
                value={a[k]}
                onChange={(e) => onChange({ ...a, [k]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
      );
    }
    case 'userIds': {
      const ids = (draft as string[]) ?? [];
      const candidates = ctx.users.filter((u) => u.active && !ids.includes(u.id));
      return (
        <div className="grid gap-2">
          <ul className="flex flex-wrap gap-2" aria-label="Selected users">
            {ids.length === 0 && <li className="text-muted-foreground text-sm">Nobody yet</li>}
            {ids.map((uid) => (
              <li
                key={uid}
                className="bg-muted inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3 text-sm"
              >
                {ctx.users.find((u) => u.id === uid)?.displayName ?? uid}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Remove"
                  onClick={() => onChange(ids.filter((x) => x !== uid))}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <label htmlFor={id} className="text-sm font-medium">
            Add someone
          </label>
          <NativeSelect
            id={id}
            value=""
            onChange={(e) => e.target.value && onChange([...ids, e.target.value])}
          >
            <option value="">Choose a user…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.roles.join(', ') || 'no role'})
              </option>
            ))}
          </NativeSelect>
          <span className="text-muted-foreground text-xs">
            They need a role that can open the engineering queue (engQueue.read).
          </span>
        </div>
      );
    }
    case 'rules':
      return (
        <RuleEditor
          value={(draft as RequiredRule[]) ?? []}
          onChange={onChange}
          fields={ctx.ruleFields}
        />
      );
    case 'overridableFields': {
      const fields = (draft as OverridableField[]) ?? [];
      const set = (i: number, patch: Partial<OverridableField>) =>
        onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
      return (
        <div className="grid gap-3">
          {fields.map((f, i) => (
            <fieldset key={f.field} className="grid gap-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                {f.label} <span className="text-muted-foreground font-mono text-xs">{f.field}</span>
              </legend>
              <div className="grid gap-1.5">
                <label htmlFor={`${id}-${f.field}`} className="text-xs font-medium">
                  Approval
                </label>
                <NativeSelect
                  id={`${id}-${f.field}`}
                  value={f.approval}
                  onChange={(e) =>
                    set(i, {
                      approval: e.target.value as OverridableField['approval'],
                      ...(e.target.value === 'self' ? { approverRoles: [] } : {}),
                    })
                  }
                >
                  <option value="approver">Needs an approver</option>
                  <option value="self">None (self-applied, logged)</option>
                </NativeSelect>
              </div>
              {ROLE_GROUPS.map(([key, legend]) => (
                <RoleChecks
                  key={key}
                  legend={legend}
                  value={f[key]}
                  disabled={key === 'approverRoles' && f.approval === 'self'}
                  onChange={(roles) => set(i, { [key]: roles })}
                />
              ))}
            </fieldset>
          ))}
        </div>
      );
    }
    case 'json':
    default:
      return (
        <div className="grid gap-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            Value (JSON)
          </label>
          <Textarea
            id={id}
            className="min-h-48 font-mono text-xs"
            spellCheck={false}
            value={draft as string}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="text-muted-foreground text-xs">
            Checked on save against the same rules the feature uses. Use null for “not set” where
            allowed.
          </span>
        </div>
      );
  }
}
