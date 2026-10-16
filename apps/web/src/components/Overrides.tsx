import type {
  OverrideDto,
  PublicConfigResponse,
  QuoteDetail,
  QuoteOverridableField,
} from '@ccq/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightIcon, ClockIcon, PencilIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePublicConfig } from '@/config/public-config';
import { api, isApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { quoteQueryKey } from './GateDecisionDialog';

/** Query keys the override actions invalidate (quote page, timeline, inbox, log). */
export const timelineQueryKey = (quoteNumber: string) => ['timeline', quoteNumber] as const;
export const overrideInboxQueryKey = ['overrides', 'inbox'] as const;

type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
};
const ADDRESS_PARTS: [keyof Address, string][] = [
  ['line1', 'Street'],
  ['city', 'City'],
  ['state', 'State'],
  ['postal', 'Postal code'],
  ['country', 'Country'],
];

/** A field's value as people read it: tier label, one-line address, queue position. */
export function formatOverrideValue(
  field: string,
  value: unknown,
  config: PublicConfigResponse | undefined,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'priority_tier' && typeof value === 'string') {
    return config?.tiers.find((t) => t.tier === value)?.label ?? value;
  }
  if (field === 'ship_to' && typeof value === 'object') {
    const a = value as Address;
    return (
      [a.line1, a.line2, a.city, a.state, a.postal, a.country].filter(Boolean).join(', ') || '—'
    );
  }
  if (field === 'queue_position' && typeof value === 'number') return `#${value}`;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * The small copper "Overridden" marker. Hover, focus or tap shows the original value, the
 * justification and who applied it.
 */
export function OverriddenMarker({
  override,
  className,
}: {
  override: OverrideDto;
  className?: string;
}) {
  const { data: config } = usePublicConfig();
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'text-emphasis border-emphasis/40 inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] font-semibold tracking-wide uppercase',
            className,
          )}
          data-testid={`overridden-${override.field}`}
          aria-label={`Overridden. Original: ${formatOverrideValue(override.field, override.originalValue, config)}. Why: ${override.justification}`}
        >
          Overridden
        </button>
      </TooltipTrigger>
      <TooltipContent className="grid gap-1">
        <span>
          <span className="font-semibold">Original:</span>{' '}
          {formatOverrideValue(override.field, override.originalValue, config)}
        </span>
        <span>
          <span className="font-semibold">Why:</span> {override.justification}
        </span>
        <span className="opacity-80">
          {override.requestedByName ?? 'Someone'}
          {override.approvalMode === 'approver' && override.decidedByName
            ? `, approved by ${override.decidedByName}`
            : ' (self-applied, logged)'}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export function PendingOverrideBadge({ override }: { override: OverrideDto }) {
  const { data: config } = usePublicConfig();
  return (
    <span
      className="bg-warning text-warning-foreground inline-flex min-h-6 items-center gap-1 rounded-full px-2 text-xs font-medium"
      data-testid={`override-pending-${override.field}`}
      title={`Requested ${formatOverrideValue(override.field, override.requestedValue, config)} by ${override.requestedByName ?? 'someone'}: ${override.justification}`}
    >
      <ClockIcon className="size-3" aria-hidden="true" />
      Override pending: {formatOverrideValue(override.field, override.requestedValue, config)}
    </span>
  );
}

/**
 * Next to an overridable value: the copper marker when an override set it, the pending badge while a
 * request waits, and the pencil + "Override" affordance when the caller may raise one.
 */
export function FieldOverride({ quote, field }: { quote: QuoteDetail; field: string }) {
  const [open, setOpen] = useState(false);
  const f = quote.overridableFields.find((x) => x.field === field);
  if (!f) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {f.applied && <OverriddenMarker override={f.applied} />}
      {f.pending && <PendingOverrideBadge override={f.pending} />}
      {f.canRequest && (
        <Button
          variant="ghost"
          size="sm"
          className="text-emphasis h-8 min-h-8 px-2"
          onClick={() => setOpen(true)}
          aria-label={`Override ${f.label.toLowerCase()}`}
          data-testid={`override-${field}`}
        >
          <PencilIcon aria-hidden="true" />
          Override
        </Button>
      )}
      {open && (
        <OverrideDialog open onOpenChange={setOpen} quoteNumber={quote.quoteNumber} field={f} />
      )}
    </span>
  );
}

interface ServerError {
  path: string;
  message: string;
}

/** Current → requested value with a justification. Who must approve is the field's config. */
export function OverrideDialog({
  open,
  onOpenChange,
  quoteNumber,
  field,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteNumber: string;
  field: QuoteOverridableField;
}) {
  const queryClient = useQueryClient();
  const { data: config } = usePublicConfig();
  const minLength = Number(config?.settings.override_justification_min_length ?? 15);
  const ids = { value: useId(), why: useId(), errors: useId() };
  const current = field.currentValue;
  const [tier, setTier] = useState('');
  const [address, setAddress] = useState<Address>(() =>
    field.field === 'ship_to' && current && typeof current === 'object'
      ? { ...(current as Address) }
      : {},
  );
  const [position, setPosition] = useState('1');
  const [justification, setJustification] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ServerError[]>([]);

  const requestedValue: unknown =
    field.field === 'priority_tier'
      ? tier || null
      : field.field === 'ship_to'
        ? Object.fromEntries(Object.entries(address).filter(([, v]) => v?.trim()))
        : Number(position);
  const trimmed = justification.trim();
  const problems = [
    field.field === 'priority_tier' && !tier && 'Choose a tier.',
    field.field === 'ship_to' &&
      !address.line1?.trim() &&
      !address.city?.trim() &&
      'Enter at least a street or a city.',
    trimmed.length < minLength && `Explain why in at least ${minLength} characters.`,
  ].filter((p): p is string => !!p);

  const mutation = useMutation({
    mutationFn: () =>
      api.requestOverride(quoteNumber, {
        field: field.field,
        requestedValue,
        justification: trimmed,
      }),
    onSuccess: async ({ override }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) }),
        queryClient.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) }),
        queryClient.invalidateQueries({ queryKey: overrideInboxQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['eng-queue'] }),
      ]);
      toast.success({
        title: override.status === 'applied' ? `${field.label} overridden` : 'Override requested',
        description:
          override.status === 'applied'
            ? 'Applied and logged. You can revert it from the timeline.'
            : 'It applies once an approver accepts it.',
      });
      onOpenChange(false);
    },
    onError: (err) => {
      if (isApiError(err)) {
        const errors = (err.problem as { errors?: ServerError[] }).errors;
        setServerErrors(
          errors?.length
            ? errors
            : [{ path: '/', message: err.problem.detail ?? err.problem.title }],
        );
      }
    },
  });
  const busy = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Override {field.label.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {field.approval === 'self'
              ? 'Applies now and is logged with your reason. It can be reverted in one click.'
              : 'An approver must accept it before it applies. The original value is kept.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="override-form"
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            setServerErrors([]);
            if (problems.length === 0) mutation.mutate();
          }}
        >
          <div
            className="bg-secondary grid items-center gap-2 rounded-md px-3 py-2 text-sm sm:grid-cols-[1fr_auto_1fr]"
            data-testid="override-current-requested"
          >
            <span>
              <span className="text-foreground-2 block text-xs">Current</span>
              {formatOverrideValue(field.field, current, config)}
            </span>
            <ArrowRightIcon
              className="text-muted-foreground hidden size-4 sm:block"
              aria-hidden="true"
            />
            <span>
              <span className="text-foreground-2 block text-xs">Requested</span>
              {formatOverrideValue(field.field, requestedValue, config)}
            </span>
          </div>

          {field.field === 'priority_tier' && (
            <div className="grid gap-1.5">
              <label htmlFor={ids.value} className="text-sm font-medium">
                New tier
              </label>
              <NativeSelect
                id={ids.value}
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                aria-invalid={submitted && !tier}
              >
                <option value="">Choose a tier…</option>
                {(config?.tiers ?? [])
                  .filter((t) => t.tier !== current)
                  .map((t) => (
                    <option key={t.tier} value={t.tier}>
                      {t.label}
                    </option>
                  ))}
              </NativeSelect>
            </div>
          )}

          {field.field === 'ship_to' && (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium">New ship-to</legend>
              {ADDRESS_PARTS.map(([key, label]) => (
                <label
                  key={key}
                  className={cn('grid gap-1 text-xs', key === 'line1' && 'sm:col-span-2')}
                >
                  <span className="text-muted-foreground">{label}</span>
                  <Input
                    value={address[key] ?? ''}
                    onChange={(e) => setAddress((a) => ({ ...a, [key]: e.target.value }))}
                    autoComplete="off"
                  />
                </label>
              ))}
            </fieldset>
          )}

          {field.field === 'queue_position' && (
            <div className="grid gap-1.5">
              <label htmlFor={ids.value} className="text-sm font-medium">
                Queue position (1 = top)
              </label>
              <Input
                id={ids.value}
                type="number"
                min={1}
                value={position}
                onChange={(e) => setPosition(e.target.value)}
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <label htmlFor={ids.why} className="text-sm font-medium">
              Justification (required)
            </label>
            <Textarea
              id={ids.why}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              aria-invalid={submitted && trimmed.length < minLength}
              aria-describedby={`${ids.why}-count`}
              placeholder="Why does this need to change?"
            />
            <span id={`${ids.why}-count`} className="text-muted-foreground text-xs">
              {trimmed.length} / at least {minLength} characters
            </span>
          </div>

          {((submitted && problems.length > 0) || serverErrors.length > 0) && (
            <div id={ids.errors} role="alert">
              <ul className="text-destructive grid gap-1 text-sm">
                {(serverErrors.length > 0 ? serverErrors.map((e) => e.message) : problems).map(
                  (p) => (
                    <li key={p}>{p}</li>
                  ),
                )}
              </ul>
            </div>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="override-form" disabled={busy}>
            {field.approval === 'self' ? 'Apply override' : 'Request override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
