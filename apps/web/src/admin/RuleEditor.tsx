import { requiredRuleSchema, type RequiredRule } from '@ccq/domain';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useId } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The guided editor for required-field rules (the domain DSL in `RequiredRule`): rows of
 * "field + check", grouped with "any of" / "all of". It writes the DSL and validates it with the
 * domain's zod schema before the dialog may save; the server validates again.
 */

type Leaf = Extract<RequiredRule, { field: string }>;
type Op = Leaf['op'];

const OPS: { op: Op; label: string }[] = [
  { op: 'present', label: 'is filled in' },
  { op: 'minItems', label: 'has at least (items)' },
  { op: 'gte', label: 'is at least' },
  { op: 'equals', label: 'equals' },
  { op: 'oneOf', label: 'is one of (comma-separated)' },
];

const rulesSchema = z.array(requiredRuleSchema);

/** Null when valid, else the first problem in words. */
export function rulesProblem(rules: unknown): string | null {
  const parsed = rulesSchema.safeParse(rules);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  return issue
    ? `Rule ${issue.path.map((p) => Number(p) + 1 || p).join(' › ')}: ${issue.message}`
    : 'Invalid rules';
}

const isGroup = (r: RequiredRule): r is { anyOf: RequiredRule[] } | { allOf: RequiredRule[] } =>
  'anyOf' in r || 'allOf' in r;

function leafWith(rule: Leaf, op: Op): Leaf {
  switch (op) {
    case 'present':
      return { field: rule.field, op };
    case 'minItems':
      return { field: rule.field, op, value: 1 };
    case 'gte':
      return { field: rule.field, op, value: 0 };
    case 'equals':
      return { field: rule.field, op, value: '' };
    case 'oneOf':
      return { field: rule.field, op, value: [] };
  }
}

/** "true"/"false" → boolean, numeric text → number, else the text. */
function scalar(text: string): string | number | boolean {
  if (text === 'true') return true;
  if (text === 'false') return false;
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) ? n : text;
}

function LeafRow({
  rule,
  listId,
  readOnly,
  onChange,
}: {
  rule: Leaf;
  listId: string;
  readOnly: boolean;
  onChange: (r: Leaf) => void;
}) {
  const valueText =
    'value' in rule ? (Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value)) : '';
  return (
    <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <Input
        aria-label="Field"
        list={listId}
        value={rule.field}
        disabled={readOnly}
        placeholder="field (e.g. resin, eng_review.process_type)"
        onChange={(e) => onChange({ ...rule, field: e.target.value.trim() })}
      />
      <NativeSelect
        aria-label="Check"
        value={rule.op}
        disabled={readOnly}
        onChange={(e) => onChange(leafWith(rule, e.target.value as Op))}
      >
        {OPS.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      {rule.op === 'present' ? (
        <span className="text-muted-foreground hidden self-center text-xs sm:block">—</span>
      ) : (
        <Input
          aria-label="Value"
          value={valueText}
          disabled={readOnly}
          inputMode={rule.op === 'minItems' || rule.op === 'gte' ? 'numeric' : undefined}
          onChange={(e) => {
            const text = e.target.value;
            if (rule.op === 'minItems' || rule.op === 'gte') {
              onChange({ ...rule, value: Number(text) });
            } else if (rule.op === 'oneOf') {
              onChange({
                ...rule,
                value: text
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean)
                  .map((v) => {
                    const s = scalar(v);
                    return typeof s === 'boolean' ? v : s;
                  }),
              });
            } else {
              onChange({ ...rule, value: scalar(text) });
            }
          }}
        />
      )}
    </div>
  );
}

function RuleNode({
  rule,
  depth,
  fields,
  listId,
  readOnly,
  onChange,
  onRemove,
}: {
  rule: RequiredRule;
  depth: number;
  fields: readonly string[];
  listId: string;
  readOnly: boolean;
  onChange: (r: RequiredRule) => void;
  onRemove: () => void;
}) {
  const remove = !readOnly && (
    <Button type="button" variant="ghost" size="icon" aria-label="Remove rule" onClick={onRemove}>
      <Trash2Icon aria-hidden="true" />
    </Button>
  );
  if (!isGroup(rule)) {
    return (
      <div className="flex items-start gap-2">
        <LeafRow rule={rule} listId={listId} readOnly={readOnly} onChange={onChange} />
        {remove}
      </div>
    );
  }
  const mode = 'anyOf' in rule ? 'anyOf' : 'allOf';
  const children = 'anyOf' in rule ? rule.anyOf : rule.allOf;
  const set = (next: RequiredRule[]) =>
    onChange(mode === 'anyOf' ? { anyOf: next } : { allOf: next });
  return (
    <div className={cn('grid gap-2 rounded-md border border-dashed p-3', depth > 0 && 'ml-2')}>
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label="Group type"
          className="w-auto"
          value={mode}
          disabled={readOnly}
          onChange={(e) =>
            onChange(e.target.value === 'anyOf' ? { anyOf: children } : { allOf: children })
          }
        >
          <option value="anyOf">At least one of</option>
          <option value="allOf">All of</option>
        </NativeSelect>
        <span className="flex-1" />
        {remove}
      </div>
      {children.map((child, i) => (
        <RuleNode
          key={i}
          rule={child}
          depth={depth + 1}
          fields={fields}
          listId={listId}
          readOnly={readOnly}
          onChange={(r) => set(children.map((c, j) => (j === i ? r : c)))}
          onRemove={() => set(children.filter((_, j) => j !== i))}
        />
      ))}
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => set([...children, { field: '', op: 'present' }])}
        >
          <PlusIcon aria-hidden="true" /> Add field to group
        </Button>
      )}
    </div>
  );
}

export function RuleEditor({
  value,
  onChange,
  fields,
  readOnly = false,
  label = 'Required fields',
}: {
  value: RequiredRule[];
  onChange: (rules: RequiredRule[]) => void;
  /** Field names to suggest. */
  fields: readonly string[];
  readOnly?: boolean;
  label?: string;
}) {
  const listId = useId();
  const problem = rulesProblem(value);
  return (
    <fieldset className="grid gap-2" data-testid="rule-editor">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <datalist id={listId}>
        {fields.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {value.length === 0 && <p className="text-muted-foreground text-sm">No required fields.</p>}
      {value.map((rule, i) => (
        <RuleNode
          key={i}
          rule={rule}
          depth={0}
          fields={fields}
          listId={listId}
          readOnly={readOnly}
          onChange={(r) => onChange(value.map((v, j) => (j === i ? r : v)))}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}
        />
      ))}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...value, { field: '', op: 'present' }])}
          >
            <PlusIcon aria-hidden="true" /> Add field
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...value, { anyOf: [{ field: '', op: 'present' }] }])}
          >
            <PlusIcon aria-hidden="true" /> Add "at least one of" group
          </Button>
        </div>
      )}
      {problem && (
        <p className="text-destructive text-xs" role="alert">
          {problem}
        </p>
      )}
    </fieldset>
  );
}

/** One line per rule, for read-only display ("resin is filled in; ship_to.line1 or ship_to.city"). */
export function describeRules(rules: readonly RequiredRule[]): string {
  const one = (r: RequiredRule): string => {
    if ('anyOf' in r) return `(${r.anyOf.map(one).join(' or ')})`;
    if ('allOf' in r) return `(${r.allOf.map(one).join(' and ')})`;
    const op = OPS.find((o) => o.op === r.op)?.label ?? r.op;
    if (r.op === 'present') return `${r.field} ${op}`;
    return `${r.field} ${op} ${Array.isArray(r.value) ? r.value.join(', ') : String(r.value)}`;
  };
  return rules.length ? rules.map(one).join('; ') : 'none';
}
