import {
  engInputError,
  type CostTotalsView,
  type EngineeringDetail,
  type QuoteDetail,
} from '@ccq/contracts';
import {
  COST_LINE_DESCRIPTION_MAX_LENGTH,
  ENGINEERING_COST_DEFAULTS_SEED,
  MOLD_LEAD_TIME_MAX_LENGTH,
  PACK_CONTAINER_DESCRIPTION_MAX_LENGTH,
  PACK_CONTAINER_ITEM_NO_MAX_LENGTH,
  PACK_OUT_LABELS,
  PACK_OUT_RULE_SEED,
  PACK_OUT_UNIT_FIELDS,
  PALLET_BUILD_HEIGHT_MAX_LENGTH,
  RETURNABLE_DUNNAGE_DESCRIPTION_MAX_LENGTH,
  SPECIAL_PACKAGING_NOTE_MAX_LENGTH,
  costLinesForItem,
  costTotals,
  freightPrefill,
  laborTotalPerLine,
  packMethodCountField,
  packOutFigures,
  packOutRuleErrors,
  parseEngineeringCostDefaults,
  parseEngineeringCostLines,
  parsePackOutRule,
  parseToolingMarkupDefaultPct,
  type CostLineDef,
  type CostLineGroup,
  type CostTotals,
  type EngineeringCostDefaults,
  type PackOutUnitField,
} from '@ccq/domain';
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { usePublicConfig } from '@/config/public-config';
import { api } from '@/lib/api';
import { useSyncedForm } from '@/lib/synced-form';
import { toast } from '@/lib/toast';
import { useReportUnsaved } from '@/lib/unsaved-changes';
import { cn } from '@/lib/utils';

import {
  Field,
  FormErrors,
  SaveStatus,
  errorFor,
  problemErrors,
  saveStatusOf,
  useSaved,
  type ServerError,
} from '../forms';
import { KeyValueGrid } from '../KeyValueGrid';

/**
 * FB-23 (N18-03 to N18-10, N18-14; Jim Zweifel, 2026-11-18; Ben's D4, D5, D6): Jim's ECE Summary on the
 * Engineering tab, per item: tooling and start-up (with the totals and the customer tooling price), new-line
 * equipment, direct labor and the pack-out with its calculation. The lines, the pre-fill figures and the
 * default markup are settings (provisional); the server recalculates and is the rule.
 */

type Review = EngineeringDetail['review'];
type Refresh = (detail?: EngineeringDetail) => Promise<unknown>;

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const count = (n: number | null | undefined) => (n == null ? null : n.toLocaleString('en-US'));
const num = (t: string) => (t.trim() === '' ? null : Number(t));
const str = (n: number | null | undefined) => (n == null ? '' : String(n));

function settingOr<T>(parse: (input: unknown) => T, input: unknown): T {
  try {
    return parse(input);
  } catch {
    return parse(null);
  }
}

/** The three cost settings from the public config (the seed when unset or malformed). */
export function useCostConfig(): {
  defs: CostLineDef[];
  defaults: EngineeringCostDefaults;
  defaultMarkupPct: number;
} {
  const { data: config } = usePublicConfig();
  return {
    defs: settingOr(parseEngineeringCostLines, config?.settings.engineering_cost_lines),
    defaults: config
      ? settingOr(parseEngineeringCostDefaults, config.settings.engineering_cost_defaults)
      : ENGINEERING_COST_DEFAULTS_SEED,
    defaultMarkupPct: settingOr(
      parseToolingMarkupDefaultPct,
      config?.settings.tooling_markup_default_pct,
    ),
  };
}

/** The review of one item in a save's response (item 1's at the top level). */
const reviewOf = (detail: EngineeringDetail, itemId: string | undefined) =>
  (itemId && detail.items.find((i) => i.id === itemId)?.review) || detail.review;

function CardShell({
  title,
  testId,
  children,
  note,
}: {
  title: string;
  testId: string;
  children: ReactNode;
  note?: string | undefined;
}) {
  return (
    <Card collapsible data-testid={testId}>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">{title}</h2>
        </CardTitle>
        <p className="text-muted-foreground text-xs">{note ?? 'Engineer’s part'}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** One save path for every card: the changed keys, the item, then refresh and "Progress saved". */
function useCardSave(
  quote: QuoteDetail,
  itemId: string | undefined,
  card: string,
  savedTitle: string,
  refresh: Refresh,
  onSaved: (review: Review) => void,
) {
  const [errors, setErrors] = useState<ServerError[]>([]);
  const status = useSaved(`${card}:${quote.quoteNumber}:${itemId ?? ''}`);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.updateEngReview(quote.quoteNumber, itemId ? { ...body, itemId } : body),
    onSuccess: async (detail) => {
      setErrors([]);
      onSaved(reviewOf(detail, itemId));
      await refresh(detail);
      status.markSaved();
      toast.success({ title: savedTitle });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });
  return { save, errors, status };
}

// ── Totals ───────────────────────────────────────────────────────────────────────────────────────

/** The three totals and the customer tooling price ("+ n % markup" when one is noted). */
export function CostTotalsGrid({
  totals,
  testId,
}: {
  totals: CostTotalsView | CostTotals | null;
  testId?: string;
}) {
  if (!totals) {
    return <p className="text-muted-foreground text-sm">No cost lines entered.</p>;
  }
  return (
    <div data-testid={testId ?? 'cost-totals'}>
      <KeyValueGrid
        columns={2}
        items={[
          { id: 'customer-funded', label: 'Customer funded', value: usd(totals.customerFundedUsd) },
          { id: 'net-cost', label: 'Net cost to Pretium', value: usd(totals.netCostUsd) },
          { id: 'project-total', label: 'Project total', value: usd(totals.projectTotalUsd) },
          {
            id: 'tooling-price',
            label: 'Customer tooling price',
            value:
              totals.markupNoted && (totals.markupPct ?? 0) > 0
                ? `${usd(totals.customerToolingPriceUsd)} (+ ${totals.markupPct} % markup)`
                : usd(totals.customerToolingPriceUsd),
          },
        ]}
      />
    </div>
  );
}

// ── Cost lines (tooling and new-line equipment) ──────────────────────────────────────────────────

interface LineForm {
  amount: string;
  description: string;
  quantity: string;
}
/** Flat (as `useSyncedForm` compares): `<line>.amount`, `<line>.description`, `<line>.quantity`, and the two fields. */
type CostForm = Record<string, string>;
const LINE_PARTS = ['amount', 'description', 'quantity'] as const;

function costForm(review: Review, defs: readonly CostLineDef[]): CostForm {
  const out: CostForm = {
    moldLeadTime: review.moldLeadTime ?? '',
    toolingMarkupPct: str(review.toolingMarkupPct),
  };
  for (const d of defs) for (const p of LINE_PARTS) out[`${d.key}.${p}`] = '';
  for (const l of review.costLines) {
    out[`${l.lineKey}.amount`] = str(l.amountUsd);
    out[`${l.lineKey}.description`] = l.description ?? '';
    out[`${l.lineKey}.quantity`] = str(l.quantity);
  }
  return out;
}

const lineOf = (form: CostForm, key: string): LineForm => ({
  amount: form[`${key}.amount`] ?? '',
  description: form[`${key}.description`] ?? '',
  quantity: form[`${key}.quantity`] ?? '',
});

const lineChanged = (form: CostForm, initial: CostForm, key: string) =>
  LINE_PARTS.some((p) => (form[`${key}.${p}`] ?? '') !== (initial[`${key}.${p}`] ?? ''));

function CostLineInputs({
  def,
  value,
  onChange,
  defaults,
  error,
  disabled,
}: {
  def: CostLineDef & { usual: boolean };
  value: LineForm;
  onChange: (v: LineForm) => void;
  defaults: EngineeringCostDefaults;
  error: string | undefined;
  disabled?: boolean;
}) {
  const [lower, setLower] = useState(value.quantity || '1');
  const amountId = useId();
  const amountError = engInputError('costAmountUsd', value.amount) ?? error;
  const label = def.usual ? def.label : `${def.label} (not usual for this process)`;
  const extra =
    def.prefill === 'freight' ? (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="sm:min-h-10"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...value,
              amount: String(freightPrefill(defaults, 'complete')),
              quantity: '',
            })
          }
        >
          Complete mold ({usd(defaults.freightCompleteMoldUsd)})
        </Button>
        <span className="flex flex-wrap items-center gap-2">
          <span>or lower blow molds ×</span>
          <Input
            aria-label="Number of lower blow molds"
            type="number"
            min={1}
            max={99}
            step={1}
            className="w-20"
            disabled={disabled}
            value={lower}
            onChange={(e) => setLower(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="sm:min-h-10"
            disabled={disabled}
            onClick={() => {
              const n = Math.min(99, Math.max(1, Math.trunc(Number(lower) || 1)));
              onChange({
                ...value,
                amount: String(freightPrefill(defaults, 'lower', n)),
                quantity: String(n),
              });
            }}
          >
            Fill in ({usd(defaults.freightLowerBlowMoldUsd)} each)
          </Button>
        </span>
      </div>
    ) : def.needsDescription ? (
      <Input
        aria-label={`${def.label}: what the cost is for`}
        placeholder="What the cost is for"
        maxLength={COST_LINE_DESCRIPTION_MAX_LENGTH}
        disabled={disabled}
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
      />
    ) : null;
  // One table row (the parent's three columns, from `sm` up): the cost's name, its extra controls (the
  // freight pre-fill, "what the cost is for") and the amount, named "<cost> (USD)".
  return (
    <div
      className="grid gap-2 sm:col-span-3 sm:grid-cols-subgrid sm:items-start"
      data-testid={`cost-line-${def.key}`}
    >
      {def.prefill === 'start_up' ? (
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium sm:min-h-10">
          <input
            type="checkbox"
            className="size-5"
            data-testid="start-up-tick"
            disabled={disabled}
            checked={value.amount.trim() !== ''}
            onChange={(e) =>
              onChange({
                ...value,
                amount: e.target.checked ? String(defaults.startUpAssistanceUsd) : '',
              })
            }
          />
          {label}
        </label>
      ) : (
        <label htmlFor={amountId} className="flex items-center text-sm font-medium sm:min-h-10">
          {label}
          <span className="sr-only"> (USD)</span>
        </label>
      )}
      <div className={cn('min-w-0', !extra && 'max-sm:hidden')}>{extra}</div>
      <div className="grid content-start gap-1">
        <div className="relative">
          <span
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
          >
            $
          </span>
          <Input
            id={amountId}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className="pl-6"
            {...(def.prefill === 'start_up' ? { 'aria-label': `${def.label} (USD)` } : {})}
            aria-describedby={amountError ? `${amountId}-error` : undefined}
            aria-invalid={amountError ? true : undefined}
            data-testid={`cost-amount-${def.key}`}
            disabled={disabled}
            value={value.amount}
            onChange={(e) =>
              // A typed amount on freight is no longer "n lower blow molds".
              onChange({
                ...value,
                amount: e.target.value,
                ...(def.prefill === 'freight' ? { quantity: '' } : {}),
              })
            }
          />
        </div>
        {amountError && (
          <span id={`${amountId}-error`} role="alert" className="text-destructive text-xs">
            {amountError}
          </span>
        )}
      </div>
    </div>
  );
}

const cardKey = (group: CostLineGroup) => (group === 'tooling' ? 'tooling' : 'new-line');

/**
 * FB-23: the tooling and start-up card (with mold lead time, the markup and the totals), or the new-line
 * equipment card (collapsed until opened: Operations fills it in when a new line is needed).
 */
export function CostLinesCard({
  quote,
  itemId,
  refresh,
  group,
}: {
  quote: QuoteDetail;
  itemId?: string | undefined;
  refresh: Refresh;
  group: CostLineGroup;
}) {
  const eng = quote.engineering;
  const review = eng.review;
  const { defs, defaults, defaultMarkupPct } = useCostConfig();
  const tooling = group === 'tooling';
  const stored = new Set(review.costLines.map((l) => l.lineKey));
  const shown = costLinesForItem(defs, group, review.processType, stored);
  const initial = costForm(review, defs);
  const [form, setForm] = useSyncedForm(initial);
  const [open, setOpen] = useState(tooling || review.costLines.some((l) => l.group === group));
  const card = cardKey(group);
  const { save, errors, status } = useCardSave(
    quote,
    itemId,
    card,
    tooling ? 'Tooling and start-up saved' : 'New-line equipment saved',
    refresh,
    (r) => setForm(costForm(r, defs)),
  );
  const changedLines = shown.filter((d) => lineChanged(form, initial, d.key));
  const changed =
    changedLines.length > 0 ||
    (tooling &&
      (form.moldLeadTime !== initial.moldLeadTime ||
        form.toolingMarkupPct !== initial.toolingMarkupPct));
  useReportUnsaved(quote.quoteNumber, `${card}:${itemId ?? ''}`, eng.canEdit && changed);
  const markupError =
    engInputError('toolingMarkupPct', form.toolingMarkupPct ?? '') ??
    errorFor(errors, 'toolingMarkupPct');
  const invalid =
    shown.some((d) => engInputError('costAmountUsd', lineOf(form, d.key).amount)) || !!markupError;

  // Live totals from what is typed (the server recalculates on save).
  const liveLines = defs
    .map((d) => [d.key, lineOf(form, d.key)] as const)
    .flatMap(([lineKey, v]) =>
      v.amount.trim() !== '' && Number.isFinite(Number(v.amount))
        ? [{ lineKey, amountUsd: Number(v.amount) }]
        : [],
    );
  const markupTyped = num(form.toolingMarkupPct ?? '');
  const live = costTotals(liveLines, defs, {
    notedPct: markupTyped !== null && Number.isFinite(markupTyped) ? markupTyped : null,
    defaultPct: defaultMarkupPct,
  });
  const groupLines = review.costLines.filter((l) => l.group === group);

  const title = tooling ? 'Tooling and start-up' : 'New-line equipment';
  const note = tooling
    ? undefined
    : 'Only when the quote needs a new line. Operations fills these in.';
  if (!eng.canEdit) {
    return (
      <CardShell title={title} testId={`${card}-card`} note={note}>
        <div className="grid gap-3">
          {tooling && (
            <KeyValueGrid
              items={[
                { id: 'lead-time', label: 'Estimated mold lead time', value: review.moldLeadTime },
              ]}
            />
          )}
          <CostLineList lines={groupLines} />
          {tooling && <CostTotalsGrid totals={review.costTotals ?? null} />}
        </div>
      </CardShell>
    );
  }

  const body = () => {
    const out: Record<string, unknown> = {};
    if (tooling) {
      if (form.moldLeadTime !== initial.moldLeadTime)
        out.moldLeadTime = (form.moldLeadTime ?? '').trim() || null;
      if (form.toolingMarkupPct !== initial.toolingMarkupPct)
        out.toolingMarkupPct = num(form.toolingMarkupPct ?? '');
    }
    if (changedLines.length > 0) {
      out.costLines = changedLines.map((d) => {
        const v = lineOf(form, d.key);
        return {
          lineKey: d.key,
          amountUsd: num(v.amount),
          ...(d.needsDescription ? { description: v.description.trim() || null } : {}),
          ...(d.prefill === 'freight' ? { quantity: num(v.quantity) } : {}),
        };
      });
    }
    return out;
  };
  const lineError = (i: number) =>
    errorFor(errors, `costLines/${i}/amountUsd`) ??
    errorFor(errors, `costLines/${i}/description`) ??
    errorFor(errors, `costLines/${i}/quantity`);

  const formEl = (
    <form
      className="grid gap-4"
      noValidate
      data-testid={`${card}-form`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) save.mutate(body());
      }}
    >
      {tooling && (
        <div className="field-row grid gap-4 sm:grid-cols-2">
          <Field
            label="Estimated mold lead time"
            hint='Free text, for example "16-18 weeks"'
            error={errorFor(errors, 'moldLeadTime')}
          >
            {(id) => (
              <Input
                id={id}
                maxLength={MOLD_LEAD_TIME_MAX_LENGTH}
                value={form.moldLeadTime ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, moldLeadTime: e.target.value }))}
              />
            )}
          </Field>
          <Field
            label="Markup on customer-funded tooling (%) — leave blank for none"
            hint={
              defaultMarkupPct > 0
                ? `Blank uses the standard ${defaultMarkupPct} %.`
                : 'Only when a markup is noted for this quote.'
            }
            error={markupError}
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={100}
                step="0.01"
                inputMode="decimal"
                data-testid="tooling-markup"
                value={form.toolingMarkupPct ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, toolingMarkupPct: e.target.value }))}
              />
            )}
          </Field>
        </div>
      )}
      {/* A compact table: the cost, its extra controls and the amount, one line each. */}
      <div
        className="grid gap-x-4 gap-y-3 sm:grid-cols-[fit-content(15rem)_minmax(0,1fr)_10rem] sm:gap-y-2"
        data-testid={`${card}-lines`}
      >
        <div
          aria-hidden="true"
          className="text-muted-foreground hidden text-xs font-medium sm:col-span-3 sm:grid sm:grid-cols-subgrid"
        >
          <span>Cost</span>
          <span>Leave a line blank if it is not used</span>
          <span>Amount (USD)</span>
        </div>
        {shown.map((d) => {
          const i = changedLines.findIndex((c) => c.key === d.key);
          return (
            <CostLineInputs
              key={d.key}
              def={d}
              defaults={defaults}
              value={lineOf(form, d.key)}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  [`${d.key}.amount`]: v.amount,
                  [`${d.key}.description`]: v.description,
                  [`${d.key}.quantity`]: v.quantity,
                }))
              }
              error={i >= 0 ? lineError(i) : undefined}
            />
          );
        })}
      </div>
      {tooling && <CostTotalsGrid totals={live} />}
      <FormErrors
        errors={errors.filter((e) => !e.path.match(/^\/\w+$/) && !e.path.startsWith('/costLines'))}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!changed || invalid || save.isPending}>
          {save.isPending
            ? 'Saving…'
            : tooling
              ? 'Save tooling and start-up'
              : 'Save new-line equipment'}
        </Button>
        <SaveStatus {...saveStatusOf(save, status.saved && !changed)} />
      </div>
    </form>
  );

  return (
    <CardShell title={title} testId={`${card}-card`} note={note}>
      {tooling ? (
        formEl
      ) : (
        <div className="grid gap-3">
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            aria-expanded={open}
            data-testid="new-line-toggle"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Hide new-line equipment' : 'Show new-line equipment'}
          </Button>
          {open && formEl}
        </div>
      )}
    </CardShell>
  );
}

/** The cost lines that have a value, read-only. */
export function CostLineList({ lines }: { lines: Review['costLines'] }) {
  const withValue = lines.filter((l) => (l.amountUsd ?? 0) > 0);
  if (withValue.length === 0) return null;
  return (
    <KeyValueGrid
      items={withValue.map((l) => ({
        id: `line-${l.lineKey}`,
        label: l.description ? `${l.label}: ${l.description}` : l.label,
        value:
          l.amountUsd == null
            ? null
            : l.quantity
              ? `${usd(l.amountUsd)} (${l.quantity} lower blow molds)`
              : usd(l.amountUsd),
      }))}
    />
  );
}

// ── Direct labor ─────────────────────────────────────────────────────────────────────────────────

export function LaborCard({
  quote,
  itemId,
  refresh,
}: {
  quote: QuoteDetail;
  itemId?: string | undefined;
  refresh: Refresh;
}) {
  const eng = quote.engineering;
  const review = eng.review;
  const initial = {
    packersPerLine: str(review.packersPerLine),
    operatorsPerLine: str(review.operatorsPerLine),
  };
  const [form, setForm] = useSyncedForm(initial);
  const { save, errors, status } = useCardSave(
    quote,
    itemId,
    'labor',
    'Direct labor saved',
    refresh,
    (r) =>
      setForm({ packersPerLine: str(r.packersPerLine), operatorsPerLine: str(r.operatorsPerLine) }),
  );
  const changed =
    form.packersPerLine !== initial.packersPerLine ||
    form.operatorsPerLine !== initial.operatorsPerLine;
  useReportUnsaved(quote.quoteNumber, `labor:${itemId ?? ''}`, eng.canEdit && changed);
  const err = (k: 'packersPerLine' | 'operatorsPerLine') =>
    engInputError(k, form[k]) ?? errorFor(errors, k);
  const invalid = !!(
    engInputError('packersPerLine', form.packersPerLine) ||
    engInputError('operatorsPerLine', form.operatorsPerLine)
  );
  const p = num(form.packersPerLine);
  const o = num(form.operatorsPerLine);
  const total =
    (p === null || Number.isFinite(p)) && (o === null || Number.isFinite(o))
      ? laborTotalPerLine(p, o)
      : null;
  if (!eng.canEdit) {
    return (
      <CardShell title="Direct labor" testId="labor-card">
        <LaborGrid review={review} />
      </CardShell>
    );
  }
  return (
    <CardShell title="Direct labor" testId="labor-card">
      <form
        className="grid gap-4"
        noValidate
        data-testid="labor-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          const body: Record<string, unknown> = {};
          if (form.packersPerLine !== initial.packersPerLine)
            body.packersPerLine = num(form.packersPerLine);
          if (form.operatorsPerLine !== initial.operatorsPerLine)
            body.operatorsPerLine = num(form.operatorsPerLine);
          save.mutate(body);
        }}
      >
        <div className="field-row grid gap-4 sm:grid-cols-3">
          <Field
            label="Packers per line"
            hint="Can be a fraction, for example 0.68"
            error={err('packersPerLine')}
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={99.99}
                step="0.01"
                inputMode="decimal"
                value={form.packersPerLine}
                onChange={(e) => setForm((f) => ({ ...f, packersPerLine: e.target.value }))}
              />
            )}
          </Field>
          <Field label="Operators per line" error={err('operatorsPerLine')}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={99.99}
                step="0.01"
                inputMode="decimal"
                value={form.operatorsPerLine}
                onChange={(e) => setForm((f) => ({ ...f, operatorsPerLine: e.target.value }))}
              />
            )}
          </Field>
          <div className="grid content-start gap-1.5" data-slot="field" data-testid="labor-total">
            <span className="text-sm font-medium">Total per line</span>
            <span className="flex min-h-11 items-center text-sm sm:min-h-10">
              {total === null ? '–' : total}
            </span>
          </div>
        </div>
        <FormErrors errors={errors.filter((e) => !e.path.match(/^\/\w+$/))} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!changed || invalid || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save direct labor'}
          </Button>
          <SaveStatus {...saveStatusOf(save, status.saved && !changed)} />
        </div>
      </form>
    </CardShell>
  );
}

export function LaborGrid({ review }: { review: Review }) {
  return (
    <KeyValueGrid
      columns={2}
      items={[
        { id: 'packers', label: 'Packers per line', value: count(review.packersPerLine) },
        { id: 'operators', label: 'Operators per line', value: count(review.operatorsPerLine) },
        { id: 'labor-total', label: 'Total per line', value: count(review.laborTotalPerLine) },
      ]}
    />
  );
}

// ── Pack-out ─────────────────────────────────────────────────────────────────────────────────────

const PACK_KEYS = [
  'packMethod',
  'packContainerItemNo',
  'packContainerDescription',
  'unitsPerBag',
  'unitsPerTray',
  'unitsPerCase',
  'containersPerLayer',
  'layersPerPallet',
  'unitsPerPallet',
  'palletBuildHeight',
  'palletType',
  'palletsPerTrailer',
  'specialPackagingNote',
  'returnableDunnageDescription',
  'returnableDunnageCostUsd',
] as const;
type PackKey = (typeof PACK_KEYS)[number];
type PackForm = Record<PackKey, string>;
const PACK_NUMERIC: ReadonlySet<PackKey> = new Set([
  'unitsPerBag',
  'unitsPerTray',
  'unitsPerCase',
  'containersPerLayer',
  'layersPerPallet',
  'unitsPerPallet',
  'palletsPerTrailer',
  'returnableDunnageCostUsd',
]);
const CHECKED: Partial<Record<PackKey, Parameters<typeof engInputError>[0]>> = {
  unitsPerBag: 'unitsPerBag',
  unitsPerTray: 'unitsPerTray',
  unitsPerCase: 'unitsPerCase',
  unitsPerPallet: 'unitsPerPallet',
  containersPerLayer: 'containersPerLayer',
  layersPerPallet: 'layersPerPallet',
  palletsPerTrailer: 'palletsPerTrailer',
  returnableDunnageCostUsd: 'returnableDunnageCostUsd',
};

const packForm = (r: Review): PackForm =>
  Object.fromEntries(
    PACK_KEYS.map((k) => {
      const v = (r as Record<string, unknown>)[k];
      return [k, typeof v === 'number' || typeof v === 'string' ? String(v) : ''];
    }),
  ) as PackForm;

/** The choice's words in the units-per-pack picker (no pack method chosen). */
const UNIT_WORD: Record<PackOutUnitField, string> = {
  unitsPerBag: 'Bag',
  unitsPerTray: 'Tray',
  unitsPerCase: 'Case',
};

/** The container word for a method ("bag", "carton", "tray"), from its value-list meta. */
const containerWord = (meta: unknown) => {
  const c = (meta as { container?: unknown } | null)?.container;
  return typeof c === 'string' ? c : null;
};

/** The pack-out labels for a method: "Pieces per bag", "Bags per layer", … */
function packLabels(word: string | null) {
  const plural = word ? `${word[0]!.toUpperCase()}${word.slice(1)}s` : 'Bags or cartons';
  return {
    perContainer: word ? `Pieces per ${word}` : 'Pieces per pack',
    perLayer: `${plural} per layer`,
    perPallet: `${plural} per pallet`,
  };
}

/**
 * FB-23 (N18-10, D4, D6): the pack-out card. Replaces FB-06's pack-out inputs: the method, what the parts
 * are packed in or on, the method's count, per layer, layers, the pallet, pallets per 53-ft trailer, a
 * special-packaging note and (when the KAM ticked returnable dunnage) the dunnage, with the calculated
 * figures read-only. Without a method the three counts are offered as before (an older quote).
 */
export function PackOutCard({
  quote,
  itemId,
  refresh,
}: {
  quote: QuoteDetail;
  itemId?: string | undefined;
  refresh: Refresh;
}) {
  const eng = quote.engineering;
  const review = eng.review;
  const { data: config } = usePublicConfig();
  const methods = config?.valueLists.pack_method ?? [];
  const pallets = config?.valueLists.pallet_type ?? [];
  const packOutRule = settingOr(
    (v) => (v == null ? { ...PACK_OUT_RULE_SEED } : parsePackOutRule(v)),
    config?.settings.pack_out_rule,
  );
  const initial = packForm(review);
  const [form, setForm] = useSyncedForm(initial);
  const { save, errors, status } = useCardSave(
    quote,
    itemId,
    'pack-out',
    'Pack-out saved',
    refresh,
    (r) => setForm(packForm(r)),
  );
  const set = (k: PackKey) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  // Ben (2026-11-20): with no pack method, bag, tray or case is one choice and the count is typed once.
  // A stored count decides the choice; changing it moves the count and clears the other two.
  const unitGroupId = useId();
  const unitOf = (f: PackForm) => PACK_OUT_UNIT_FIELDS.find((u) => f[u].trim() !== '');
  const [pickedUnit, setPickedUnit] = useState<PackOutUnitField>('unitsPerBag');
  const unit = unitOf(form) ?? pickedUnit;
  const pickUnit = (next: PackOutUnitField) => {
    setPickedUnit(next);
    setForm((f) => {
      const typed = f[unitOf(f) ?? pickedUnit];
      return {
        ...f,
        ...Object.fromEntries(PACK_OUT_UNIT_FIELDS.map((u) => [u, u === next ? typed : ''])),
      };
    });
  };
  const method = methods.find((m) => m.code === form.packMethod);
  const countField: PackOutUnitField | null = method ? packMethodCountField(method.meta) : null;
  const labels = packLabels(method ? containerWord(method.meta) : null);
  const typedError = (k: PackKey) => {
    const f = CHECKED[k];
    return f ? (engInputError(f, form[k]) ?? undefined) : undefined;
  };
  const together =
    form.packMethod === ''
      ? packOutRuleErrors(
          {
            unitsPerBag: num(form.unitsPerBag),
            unitsPerTray: num(form.unitsPerTray),
            unitsPerCase: num(form.unitsPerCase),
            unitsPerPallet: num(form.unitsPerPallet),
          },
          packOutRule,
        )
      : [];
  const err = (k: PackKey) =>
    typedError(k) ?? together.find((e) => e.field === k)?.message ?? errorFor(errors, k);
  const invalid = PACK_KEYS.some((k) => typedError(k)) || together.length > 0;
  const figures = packOutFigures({
    countField,
    unitsPerBag: num(form.unitsPerBag),
    unitsPerTray: num(form.unitsPerTray),
    unitsPerCase: num(form.unitsPerCase),
    containersPerLayer: num(form.containersPerLayer),
    layersPerPallet: num(form.layersPerPallet),
    palletsPerTrailer: num(form.palletsPerTrailer),
    unitsPerPallet: num(form.unitsPerPallet),
  });
  const showDunnage =
    eng.returnableDunnage ||
    !!review.returnableDunnageDescription ||
    review.returnableDunnageCostUsd != null;
  const changed = PACK_KEYS.some((k) => form[k] !== initial[k]);
  useReportUnsaved(quote.quoteNumber, `pack-out:${itemId ?? ''}`, eng.canEdit && changed);

  if (!eng.canEdit) {
    return (
      <CardShell title="Pack-out" testId="pack-out-card">
        <PackOutGrid review={review} />
      </CardShell>
    );
  }

  const countInput = (f: PackOutUnitField, label: string, error = err(f)) => (
    <Field key={f} label={label} hint="A whole number" error={error}>
      {(id) => (
        <Input
          id={id}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          data-testid={`pack-out-${f}`}
          value={form[f]}
          onChange={(e) => set(f)(e.target.value)}
        />
      )}
    </Field>
  );
  const whole = (k: PackKey, label: string, hint?: string) => (
    <Field label={label} hint={hint} error={err(k)}>
      {(id) => (
        <Input
          id={id}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          data-testid={`pack-out-${k}`}
          value={form[k]}
          onChange={(e) => set(k)(e.target.value)}
        />
      )}
    </Field>
  );
  const select = (k: 'packMethod' | 'palletType', label: string, list: typeof methods) => (
    <Field label={label} error={err(k)}>
      {(id) => (
        <NativeSelect
          id={id}
          data-testid={`pack-out-${k}`}
          value={form[k]}
          onChange={(e) => set(k)(e.target.value)}
        >
          <option value="">Choose…</option>
          {form[k] !== '' && !list.some((v) => v.code === form[k]) && (
            <option value={form[k]}>{`${form[k]} (no longer offered)`}</option>
          )}
          {list.map((v) => (
            <option key={v.code} value={v.code}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );

  return (
    <CardShell title="Pack-out" testId="pack-out-card">
      <form
        className="grid gap-4"
        noValidate
        data-testid="pack-out-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          const body: Record<string, unknown> = {};
          for (const k of PACK_KEYS) {
            if (form[k] === initial[k]) continue;
            // Pieces per pallet is calculated by the server once per layer and layers are given.
            if (k === 'unitsPerPallet' && figures.piecesPerPalletCalculated) continue;
            const t = form[k].trim();
            body[k] = t === '' ? null : PACK_NUMERIC.has(k) ? Number(t) : t;
          }
          save.mutate(body);
        }}
      >
        <p className="text-muted-foreground text-sm">
          Pricing reads these when it costs the quote. All optional
          {packOutRule.requireOneOf ? ', except one count per pack' : ''}.
        </p>
        <div className="field-row grid gap-4 sm:grid-cols-3">
          {select('packMethod', 'Pack method', methods)}
          <Field
            label="Item number"
            hint="What the parts are packed in or on"
            error={err('packContainerItemNo')}
          >
            {(id) => (
              <Input
                id={id}
                maxLength={PACK_CONTAINER_ITEM_NO_MAX_LENGTH}
                value={form.packContainerItemNo}
                onChange={(e) => set('packContainerItemNo')(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Description"
            hint="Bag, carton (with liner), tray or slip sheet"
            error={err('packContainerDescription')}
          >
            {(id) => (
              <Input
                id={id}
                maxLength={PACK_CONTAINER_DESCRIPTION_MAX_LENGTH}
                value={form.packContainerDescription}
                onChange={(e) => set('packContainerDescription')(e.target.value)}
              />
            )}
          </Field>
        </div>
        {form.packMethod === '' ? (
          <fieldset className="grid gap-3 rounded-md border p-3" data-testid="pack-out-units">
            <legend className="px-1 text-sm font-medium">
              Units per pack (fill in one: bag, tray or case)
              {packOutRule.requireOneOf ? ' (required)' : ''}
            </legend>
            <div className="field-row grid gap-4 sm:grid-cols-3">
              <div
                className="grid content-start gap-1.5"
                data-slot="field"
                role="radiogroup"
                aria-labelledby={`${unitGroupId}-label`}
                data-testid="pack-out-unit-kind"
              >
                <span id={`${unitGroupId}-label`} className="text-sm font-medium">
                  Packed in
                </span>
                <div className="flex min-h-11 flex-wrap items-center gap-2 sm:min-h-10">
                  {PACK_OUT_UNIT_FIELDS.map((u) => (
                    <label
                      key={u}
                      className="border-line-strong has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-ring rounded-pill flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm has-[:focus-visible]:ring-2 sm:min-h-10"
                    >
                      <input
                        type="radio"
                        name={`${unitGroupId}-kind`}
                        className="sr-only"
                        data-testid={`pack-out-kind-${u}`}
                        checked={unit === u}
                        onChange={() => pickUnit(u)}
                      />
                      {UNIT_WORD[u]}
                    </label>
                  ))}
                </div>
                <span className="text-muted-foreground text-xs">One only</span>
              </div>
              {countInput(
                unit,
                PACK_OUT_LABELS[unit],
                err(unit) ?? PACK_OUT_UNIT_FIELDS.map((u) => err(u)).find(Boolean),
              )}
            </div>
          </fieldset>
        ) : null}
        <div className="field-row grid gap-4 sm:grid-cols-3">
          {countField && countInput(countField, labels.perContainer)}
          {whole('containersPerLayer', labels.perLayer)}
          {whole('layersPerPallet', 'Layers per pallet')}
          {figures.piecesPerPalletCalculated ? (
            <div
              className="grid content-start gap-1.5"
              data-slot="field"
              data-testid="pieces-per-pallet-calculated"
            >
              <span className="text-sm font-medium">Pieces per pallet</span>
              <span className="flex min-h-11 items-center text-sm sm:min-h-10">
                {count(figures.piecesPerPallet) ??
                  `Fill in the ${labels.perContainer.toLowerCase()}`}
              </span>
              <span className="text-muted-foreground text-xs">Calculated</span>
            </div>
          ) : (
            whole(
              'unitsPerPallet',
              'Pieces per pallet',
              'Calculated once per layer and layers are filled in',
            )
          )}
          <Field
            label="Pallet build height"
            hint='With its unit, for example "96 in"'
            error={err('palletBuildHeight')}
          >
            {(id) => (
              <Input
                id={id}
                maxLength={PALLET_BUILD_HEIGHT_MAX_LENGTH}
                value={form.palletBuildHeight}
                onChange={(e) => set('palletBuildHeight')(e.target.value)}
              />
            )}
          </Field>
          {select('palletType', 'Pallet', pallets)}
          {whole('palletsPerTrailer', 'Pallets per 53-ft trailer')}
        </div>
        <div data-testid="pack-out-figures">
          <KeyValueGrid
            columns={3}
            items={[
              {
                id: 'per-pallet-containers',
                label: labels.perPallet,
                value: count(figures.containersPerPallet),
              },
              {
                id: 'per-pallet-pieces',
                label: 'Pieces per pallet',
                value: count(figures.piecesPerPallet),
              },
              {
                id: 'per-trailer-pieces',
                label: 'Pieces per trailer',
                value: count(figures.piecesPerTrailer),
              },
            ]}
          />
        </div>
        <Field
          label="Special packaging"
          hint="For example packaging that needs floor loading"
          error={err('specialPackagingNote')}
        >
          {(id) => (
            <Textarea
              id={id}
              maxLength={SPECIAL_PACKAGING_NOTE_MAX_LENGTH}
              value={form.specialPackagingNote}
              onChange={(e) => set('specialPackagingNote')(e.target.value)}
            />
          )}
        </Field>
        {showDunnage && (
          <fieldset className="grid gap-3 rounded-md border p-3" data-testid="dunnage">
            <legend className="px-1 text-sm font-medium">
              Returnable dunnage (the KAM ticked it at intake)
            </legend>
            <div className="field-row grid gap-4 sm:grid-cols-2">
              <Field label="Dunnage description" error={err('returnableDunnageDescription')}>
                {(id) => (
                  <Input
                    id={id}
                    maxLength={RETURNABLE_DUNNAGE_DESCRIPTION_MAX_LENGTH}
                    value={form.returnableDunnageDescription}
                    onChange={(e) => set('returnableDunnageDescription')(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Estimated dunnage cost (USD)" error={err('returnableDunnageCostUsd')}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={form.returnableDunnageCostUsd}
                    onChange={(e) => set('returnableDunnageCostUsd')(e.target.value)}
                  />
                )}
              </Field>
            </div>
          </fieldset>
        )}
        <FormErrors errors={errors.filter((e) => !e.path.match(/^\/\w+$/))} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!changed || invalid || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save pack-out'}
          </Button>
          <SaveStatus {...saveStatusOf(save, status.saved && !changed)} />
        </div>
      </form>
    </CardShell>
  );
}

/** The pack-out, read-only (the Engineering tab when locked, and Quoting). Empty values are left out. */
export function PackOutGrid({ review }: { review: Review }) {
  const { data: config } = usePublicConfig();
  const label = (list: string, code: string | null) =>
    code ? (config?.valueLists[list]?.find((v) => v.code === code)?.label ?? code) : null;
  const method = config?.valueLists.pack_method?.find((m) => m.code === review.packMethod);
  const labels = packLabels(method ? containerWord(method.meta) : null);
  const countField = method ? packMethodCountField(method.meta) : null;
  const f = review.packOut;
  const items = [
    { id: 'pack-method', label: 'Pack method', value: label('pack_method', review.packMethod) },
    {
      id: 'pack-item-no',
      label: 'Packed in or on: item number',
      value: review.packContainerItemNo,
    },
    {
      id: 'pack-description',
      label: 'Packed in or on: description',
      value: review.packContainerDescription,
    },
    ...(countField
      ? [{ id: 'pack-count', label: labels.perContainer, value: count(review[countField]) }]
      : PACK_OUT_UNIT_FIELDS.map((u) => ({
          id: `pack-${u}`,
          label: PACK_OUT_LABELS[u],
          value: count(review[u]),
        }))),
    { id: 'pack-per-layer', label: labels.perLayer, value: count(review.containersPerLayer) },
    { id: 'pack-layers', label: 'Layers per pallet', value: count(review.layersPerPallet) },
    { id: 'pack-containers-pallet', label: labels.perPallet, value: count(f?.containersPerPallet) },
    {
      id: 'pack-pieces-pallet',
      label: 'Pieces per pallet',
      value: count(f?.piecesPerPallet ?? review.unitsPerPallet),
    },
    { id: 'pack-height', label: 'Pallet build height', value: review.palletBuildHeight },
    { id: 'pack-pallet', label: 'Pallet', value: label('pallet_type', review.palletType) },
    {
      id: 'pack-trailer',
      label: 'Pallets per 53-ft trailer',
      value: count(review.palletsPerTrailer),
    },
    { id: 'pack-pieces-trailer', label: 'Pieces per trailer', value: count(f?.piecesPerTrailer) },
    { id: 'pack-special', label: 'Special packaging', value: review.specialPackagingNote },
    { id: 'pack-dunnage', label: 'Returnable dunnage', value: review.returnableDunnageDescription },
    {
      id: 'pack-dunnage-cost',
      label: 'Estimated dunnage cost (USD)',
      value: review.returnableDunnageCostUsd == null ? null : usd(review.returnableDunnageCostUsd),
    },
  ].filter((i) => i.value !== null && i.value !== undefined && i.value !== '');
  if (items.length === 0)
    return <p className="text-muted-foreground text-sm">No pack-out details entered.</p>;
  return <KeyValueGrid columns={3} items={items} />;
}

// ── Beside the budgetary capital estimate ────────────────────────────────────────────────────────

/**
 * FB-23 (C5): the cost lines' totals beside the budgetary capital estimate, and "Use the project total".
 * The estimate never changes on its own: the button fills the field, and saving the solution is the
 * normal, audited edit. Whether it should be the project total or the net cost is open (decision 18).
 */
export function CostLinesCapitalLine({
  totals,
  onUse,
}: {
  totals: CostTotalsView | null | undefined;
  onUse: ((value: number) => void) | null;
}) {
  if (!totals) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
      data-testid="cost-lines-capital"
    >
      <span>
        Cost lines: project total {usd(totals.projectTotalUsd)} · customer funded{' '}
        {usd(totals.customerFundedUsd)} · net cost to Pretium {usd(totals.netCostUsd)}
      </span>
      {onUse && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onUse(totals.projectTotalUsd)}
        >
          Use the project total
        </Button>
      )}
    </div>
  );
}

// ── Quoting: what Pricing reads, per item ────────────────────────────────────────────────────────

/** FB-23 (D): one item's lead time, cost lines with a value and totals, labor and pack-out, read-only. */
export function CostEstimateReadOnly({ review }: { review: Review }) {
  const hasLabor = review.packersPerLine != null || review.operatorsPerLine != null;
  return (
    <div className="grid gap-3" data-testid="cost-estimate">
      <KeyValueGrid
        items={[{ id: 'lead-time', label: 'Estimated mold lead time', value: review.moldLeadTime }]}
      />
      <CostLineList lines={review.costLines} />
      {review.costTotals && <CostTotalsGrid totals={review.costTotals} />}
      {hasLabor && <LaborGrid review={review} />}
      <PackOutGrid review={review} />
    </div>
  );
}

// ── Final Review: the lead time and the three totals per item ────────────────────────────────────

/**
 * FB-23 (D): what Final Review shows of the cost estimate: each item's mold lead time and its customer
 * funded, net cost to Pretium and project total (and the customer tooling price). Nothing when no item has
 * a lead time or a cost line.
 */
export function CostEstimateSummary({ engineering }: { engineering: EngineeringDetail }) {
  const items =
    engineering.items.length > 0
      ? engineering.items.map((i) => ({ id: i.id, name: i.name, review: i.review }))
      : [{ id: 'quote', name: null as string | null, review: engineering.review }];
  const shown = items.filter((i) => i.review.moldLeadTime || i.review.costTotals);
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-3" data-testid="review-cost-estimate">
      <h3 className="text-sm font-semibold">Engineering cost estimate</h3>
      {shown.map((item) => (
        <div key={item.id} className="grid gap-2" data-testid="review-cost-estimate-item">
          {items.length > 1 && <p className="text-sm font-medium">{item.name}</p>}
          <KeyValueGrid
            items={[
              {
                id: 'lead-time',
                label: 'Estimated mold lead time',
                value: item.review.moldLeadTime,
              },
            ]}
          />
          {item.review.costTotals && <CostTotalsGrid totals={item.review.costTotals} />}
        </div>
      ))}
    </div>
  );
}
