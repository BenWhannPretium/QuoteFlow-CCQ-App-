import type { IntakeAddress, IntakeDraftData } from '@ccq/contracts';
import type { IntakeEvaluation } from '@ccq/domain';
import { PencilIcon, Undo2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { AttachmentsPanel } from '@/components/attachments/Attachments';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';

import {
  FIELD_META,
  formatAddress,
  formatDate,
  formatUsd,
  issueLabel,
  issueStep,
  suggestedDescription,
  valueLabel,
  type WizardConfig,
} from './model';
import { Field, Notice, Pill, Section } from './ui';

export interface StepProps {
  data: IntakeDraftData;
  update: (patch: Partial<IntakeDraftData>) => void;
  cfg: WizardConfig;
  evaluation: IntakeEvaluation;
}

const fid = (field: string) => `intake-${field.replace(/[._]/g, '-')}`;

/** Field props from config: label, "why we ask" help and the required marker. */
function meta(cfg: WizardConfig, field: string) {
  return {
    id: fid(field),
    label: FIELD_META[field]?.label ?? field,
    help: cfg.help[field],
    required: cfg.requiredFields.has(field),
  };
}

const nullIfBlank = (v: string) => (v.trim() === '' ? null : v);

function Select({
  id,
  listKey,
  value,
  onChange,
  cfg,
  placeholder = 'Choose…',
}: {
  id: string;
  listKey: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  cfg: WizardConfig;
  placeholder?: string;
}) {
  return (
    <NativeSelect
      id={id}
      aria-describedby={`${id}-help`}
      value={value ?? ''}
      onChange={(e) => onChange(nullIfBlank(e.target.value))}
    >
      <option value="">{placeholder}</option>
      {(cfg.lists[listKey] ?? []).map((e) => (
        <option key={e.code} value={e.code}>
          {e.label}
        </option>
      ))}
    </NativeSelect>
  );
}

// ── Step 2: customer and ship-to ─────────────────────────────────────────────────────────────────

const ADDRESS_PARTS: { key: keyof IntakeAddress; label: string; autoComplete: string }[] = [
  { key: 'line1', label: 'Street', autoComplete: 'street-address' },
  { key: 'city', label: 'City', autoComplete: 'address-level2' },
  { key: 'state', label: 'State / region', autoComplete: 'address-level1' },
  { key: 'postal', label: 'Postal code', autoComplete: 'postal-code' },
  { key: 'country', label: 'Country', autoComplete: 'country-name' },
];

export function CustomerStep({ data, update, cfg, evaluation }: StepProps) {
  const customer = data.customer ?? { status: 'not_yet_established' as const };
  const isNew = customer.status === 'not_yet_established';
  // The SF account the opportunity came with, so "new customer" can be undone.
  const [sfAccount] = useState(() => (customer.status === 'existing' ? customer : null));
  const hasDefault = Boolean(formatAddress(data.shipToDefault));
  const [editingShipTo, setEditingShipTo] = useState(
    !hasDefault || Boolean(data.shipToOverrideReason),
  );
  const reasonBlocking = evaluation.blocking.some((b) => b.code === 'SHIP_TO_REASON_REQUIRED');

  const setNew = (on: boolean) => {
    if (on) {
      update({
        customer: {
          status: 'not_yet_established',
          sfAccountId: null,
          name: customer.status === 'existing' ? '' : (customer.name ?? ''),
        },
      });
    } else if (sfAccount) {
      update({ customer: sfAccount });
    }
  };
  const setCustomer = (patch: Partial<NonNullable<IntakeDraftData['customer']>>) =>
    update({ customer: { ...customer, ...patch } });
  const setShipTo = (key: keyof IntakeAddress, value: string) =>
    update({ shipTo: { ...(data.shipTo ?? {}), [key]: nullIfBlank(value) } });

  return (
    <div className="grid gap-4">
      <Section
        title="Customer"
        action={
          <Pill
            className={
              isNew ? 'bg-warning text-warning-foreground' : 'bg-primary text-primary-foreground'
            }
          >
            {isNew ? 'Not yet established' : 'Existing customer'}
          </Pill>
        }
      >
        {!isNew && (
          <div className="grid gap-1">
            <p className="font-semibold" data-testid="customer-name">
              {customer.name}
            </p>
            <p className="text-muted-foreground text-xs">From the Salesforce account.</p>
          </div>
        )}
        {(sfAccount || !isNew) && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={isNew}
              onChange={(e) => setNew(e.target.checked)}
            />
            This is a new customer, not yet established with Pretium
          </label>
        )}
        {isNew && (
          <div className="grid gap-4">
            <Notice tone="info">
              Just the basics: no account request or credit check is needed to quote.
            </Notice>
            <Field {...meta(cfg, 'customer.name')} help={cfg.help.customer}>
              <Input
                id={fid('customer.name')}
                value={customer.name ?? ''}
                onChange={(e) => setCustomer({ name: e.target.value })}
                autoComplete="organization"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={fid('customer.location')} label="Location (city, state / country)">
                <Input
                  id={fid('customer.location')}
                  value={customer.location ?? ''}
                  onChange={(e) => setCustomer({ location: e.target.value })}
                />
              </Field>
              <Field id={fid('customer.contact_name')} label="Contact name">
                <Input
                  id={fid('customer.contact_name')}
                  value={customer.contactName ?? ''}
                  onChange={(e) => setCustomer({ contactName: e.target.value })}
                  autoComplete="name"
                />
              </Field>
              <Field id={fid('customer.contact_email')} label="Contact email">
                <Input
                  id={fid('customer.contact_email')}
                  type="email"
                  value={customer.contactEmail ?? ''}
                  onChange={(e) => setCustomer({ contactEmail: e.target.value })}
                  autoComplete="email"
                />
              </Field>
              <Field id={fid('customer.contact_phone')} label="Contact phone">
                <Input
                  id={fid('customer.contact_phone')}
                  type="tel"
                  value={customer.contactPhone ?? ''}
                  onChange={(e) => setCustomer({ contactPhone: e.target.value })}
                  autoComplete="tel"
                />
              </Field>
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Ship-to / fill location"
        action={
          hasDefault && !editingShipTo ? (
            <Button variant="outline" size="sm" onClick={() => setEditingShipTo(true)}>
              <PencilIcon aria-hidden /> Change ship-to
            </Button>
          ) : undefined
        }
      >
        {cfg.help.ship_to && <p className="text-muted-foreground text-xs">{cfg.help.ship_to}</p>}
        {!editingShipTo ? (
          <p data-testid="ship-to" className="text-sm">
            {formatAddress(data.shipTo)}
            <span className="text-muted-foreground block text-xs">
              Default from the customer record.
            </span>
          </p>
        ) : (
          <div className="grid gap-4">
            {hasDefault && (
              <p className="text-muted-foreground text-sm" data-testid="ship-to-original">
                Original: {formatAddress(data.shipToDefault)}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {ADDRESS_PARTS.map((p) => (
                <Field
                  key={p.key}
                  id={fid(`ship_to.${p.key}`)}
                  label={p.label}
                  required={cfg.requiredFields.has(`ship_to.${p.key}`)}
                >
                  <Input
                    id={fid(`ship_to.${p.key}`)}
                    value={data.shipTo?.[p.key] ?? ''}
                    onChange={(e) => setShipTo(p.key, e.target.value)}
                    autoComplete={`shipping ${p.autoComplete}`}
                  />
                </Field>
              ))}
            </div>
            {hasDefault && (
              <>
                <Field {...meta(cfg, 'ship_to_override_reason')} required>
                  <Textarea
                    id={fid('ship_to_override_reason')}
                    aria-describedby={`${fid('ship_to_override_reason')}-help`}
                    aria-invalid={reasonBlocking || undefined}
                    value={data.shipToOverrideReason ?? ''}
                    onChange={(e) => update({ shipToOverrideReason: nullIfBlank(e.target.value) })}
                    className="min-h-16"
                  />
                </Field>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      update({ shipTo: data.shipToDefault ?? null, shipToOverrideReason: null });
                      setEditingShipTo(false);
                    }}
                  >
                    <Undo2Icon aria-hidden /> Use the default ship-to
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Step 3: product and volume ───────────────────────────────────────────────────────────────────

function NumberInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
}) {
  // While focused, show exactly what was typed; otherwise the value (so outside changes show).
  const [editing, setEditing] = useState<string | null>(null);
  const text = editing ?? (value == null ? '' : String(value));
  return (
    <Input
      id={id}
      aria-describedby={`${id}-help`}
      inputMode="numeric"
      value={text}
      onFocus={() => setEditing(text)}
      onBlur={() => setEditing(null)}
      onChange={(e) => {
        setEditing(e.target.value);
        const clean = e.target.value.replace(/[,\s$]/g, '');
        const n = Number(clean);
        onChange(clean === '' || Number.isNaN(n) ? null : n);
      }}
    />
  );
}

export function ProductStep({ data, update, cfg, evaluation }: StepProps) {
  const neckEntry = cfg.lists.neck_finish?.find((e) => e.code === data.neckFinish);
  const placeholder = evaluation.warnings.find((w) => w.code === 'VOLUME_PLACEHOLDER');
  const redirect = evaluation.warnings.find((w) => w.code === 'REQUEST_CLASS_REDIRECT');
  const suggestion = suggestedDescription(data, cfg);

  // Keep the standard description in step with the suggestion until the KAM edits it.
  const lastSuggestion = useRef(suggestion);
  useEffect(() => {
    const current = data.standardDescription ?? '';
    if (
      suggestion !== lastSuggestion.current &&
      (current === '' || current === lastSuggestion.current)
    ) {
      update({ standardDescription: nullIfBlank(suggestion) });
    }
    lastSuggestion.current = suggestion;
  }, [suggestion, data.standardDescription, update]);

  const toggleComponent = (code: string, on: boolean) => {
    const set = new Set(data.components ?? []);
    if (on) set.add(code);
    else set.delete(code);
    update({
      components: (cfg.lists.component ?? []).map((e) => e.code).filter((c) => set.has(c)),
    });
  };

  const revenueChanged =
    data.estAnnualRevenueSf != null && data.estAnnualRevenue !== data.estAnnualRevenueSf;

  return (
    <div className="grid gap-4">
      <Section title="Request">
        <Field {...meta(cfg, 'request_class')} note={redirect ? redirect.message : undefined}>
          <Select
            id={fid('request_class')}
            listKey="request_class"
            value={data.requestClass}
            onChange={(v) => update({ requestClass: v })}
            cfg={cfg}
          />
        </Field>
      </Section>

      <Section title="Product">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field {...meta(cfg, 'product_family')}>
            <Select
              id={fid('product_family')}
              listKey="product_family"
              value={data.productFamily}
              onChange={(v) => update({ productFamily: v })}
              cfg={cfg}
            />
          </Field>
          <Field {...meta(cfg, 'container_size')}>
            <Input
              id={fid('container_size')}
              aria-describedby={`${fid('container_size')}-help`}
              placeholder="e.g. 16 oz"
              value={data.containerSize ?? ''}
              onChange={(e) => update({ containerSize: nullIfBlank(e.target.value) })}
            />
          </Field>
          <Field {...meta(cfg, 'resin')}>
            <Select
              id={fid('resin')}
              listKey="resin"
              value={data.resin}
              onChange={(v) => update({ resin: v })}
              cfg={cfg}
            />
          </Field>
          <Field {...meta(cfg, 'market')}>
            <Select
              id={fid('market')}
              listKey="market"
              value={data.market}
              onChange={(v) => update({ market: v })}
              cfg={cfg}
            />
          </Field>
        </div>
        <fieldset className="grid gap-1.5" data-field={fid('components')}>
          <legend className="mb-1.5 text-sm font-medium">{FIELD_META.components!.label}</legend>
          <div className="flex flex-wrap gap-2">
            {(cfg.lists.component ?? []).map((e) => {
              const on = (data.components ?? []).includes(e.code);
              return (
                <label
                  key={e.code}
                  className="border-line-strong has-[:checked]:bg-primary has-[:checked]:text-primary-foreground rounded-pill flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm sm:min-h-9"
                >
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={on}
                    onChange={(ev) => toggleComponent(e.code, ev.target.checked)}
                  />
                  {e.label}
                </label>
              );
            })}
          </div>
          {cfg.help.components && (
            <p className="text-muted-foreground text-xs">{cfg.help.components}</p>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field {...meta(cfg, 'neck_finish')}>
            <Select
              id={fid('neck_finish')}
              listKey="neck_finish"
              value={data.neckFinish}
              onChange={(v) => update({ neckFinish: v })}
              cfg={cfg}
            />
          </Field>
          {neckEntry?.meta.freeText === true && (
            <Field id={fid('neck_finish_other')} label="Describe the neck finish">
              <Input
                id={fid('neck_finish_other')}
                value={data.neckFinishOther ?? ''}
                onChange={(e) => update({ neckFinishOther: nullIfBlank(e.target.value) })}
              />
            </Field>
          )}
        </div>
      </Section>

      <Section title="Packaging">
        <Field {...meta(cfg, 'packaging_type')}>
          <Select
            id={fid('packaging_type')}
            listKey="packaging_type"
            value={data.packagingType}
            onChange={(v) => update({ packagingType: v })}
            cfg={cfg}
          />
        </Field>
        <Field {...meta(cfg, 'packaging_notes')}>
          <Textarea
            id={fid('packaging_notes')}
            aria-describedby={`${fid('packaging_notes')}-help`}
            placeholder="Pallet pattern, case count, labelling, max height…"
            value={data.packagingNotes ?? ''}
            onChange={(e) => update({ packagingNotes: nullIfBlank(e.target.value) })}
            className="min-h-16"
          />
        </Field>
      </Section>

      <Section title="Volume, value and timing">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            {...meta(cfg, 'est_annual_volume')}
            label="Estimated annual volume (units)"
            note={
              placeholder ? (
                <div className="grid gap-2" data-testid="volume-confirm">
                  <span>{placeholder.message}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => update({ estAnnualVolumeConfirmed: true })}
                  >
                    Yes, that’s the real volume
                  </Button>
                </div>
              ) : undefined
            }
          >
            <NumberInput
              id={fid('est_annual_volume')}
              value={data.estAnnualVolume}
              onChange={(v) => update({ estAnnualVolume: v, estAnnualVolumeConfirmed: false })}
            />
          </Field>
          <Field {...meta(cfg, 'est_annual_revenue')} label="Estimated annual revenue (USD)">
            <NumberInput
              id={fid('est_annual_revenue')}
              value={data.estAnnualRevenue}
              onChange={(v) => update({ estAnnualRevenue: v })}
            />
            {data.estAnnualRevenueSf != null && (
              <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                Salesforce amount: {formatUsd(data.estAnnualRevenueSf)}
                {revenueChanged && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto min-h-0 px-0"
                    onClick={() => update({ estAnnualRevenue: data.estAnnualRevenueSf ?? null })}
                  >
                    Use the Salesforce amount
                  </Button>
                )}
              </p>
            )}
          </Field>
          <Field {...meta(cfg, 'expected_close_date')}>
            <Input
              id={fid('expected_close_date')}
              aria-describedby={`${fid('expected_close_date')}-help`}
              type="date"
              value={data.expectedCloseDate ?? ''}
              onChange={(e) => update({ expectedCloseDate: nullIfBlank(e.target.value) })}
            />
          </Field>
        </div>
      </Section>

      <Section title="Description">
        <Field {...meta(cfg, 'standard_description')}>
          <Input
            id={fid('standard_description')}
            aria-describedby={`${fid('standard_description')}-help`}
            value={data.standardDescription ?? ''}
            onChange={(e) => update({ standardDescription: nullIfBlank(e.target.value) })}
          />
          {suggestion && suggestion !== data.standardDescription && (
            <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              Suggested: {suggestion}
              <Button
                variant="link"
                size="sm"
                className="h-auto min-h-0 px-0"
                onClick={() => update({ standardDescription: suggestion })}
              >
                Use suggestion
              </Button>
            </p>
          )}
        </Field>
        <Field {...meta(cfg, 'description')} label="Anything else (free text)">
          <Textarea
            id={fid('description')}
            aria-describedby={`${fid('description')}-help`}
            value={data.description ?? ''}
            onChange={(e) => update({ description: nullIfBlank(e.target.value) })}
          />
        </Field>
      </Section>
    </div>
  );
}

// ── Step 4: drawing, notes and review ────────────────────────────────────────────────────────────

export function ReviewStep({
  data,
  update,
  cfg,
  evaluation,
  goTo,
  draftId,
}: StepProps & { goTo: (step: number) => void; draftId: string }) {
  const drawingMissing = evaluation.warnings.find((w) => w.code === 'DRAWING_MISSING');
  const other = evaluation.warnings.filter((w) => w.code !== 'ENRICH');
  const enrich = evaluation.warnings.filter((w) => w.code === 'ENRICH');
  const label = (list: string, code: string | null | undefined) =>
    valueLabel(cfg, list, code) || '—';
  const neck =
    cfg.lists.neck_finish?.find((e) => e.code === data.neckFinish)?.meta.freeText === true
      ? data.neckFinishOther
      : label('neck_finish', data.neckFinish);

  const rows: { step: number; title: string; items: [string, string | null | undefined][] }[] = [
    {
      step: 1,
      title: 'Opportunity',
      items: [['Salesforce opportunity', data.sfOpportunityName]],
    },
    {
      step: 2,
      title: 'Customer & ship-to',
      items: [
        [
          'Customer',
          data.customer?.name
            ? `${data.customer.name} (${data.customer.status === 'existing' ? 'existing' : 'not yet established'})`
            : null,
        ],
        ['Ship-to', formatAddress(data.shipTo)],
        ...(data.shipToOverrideReason
          ? ([['Ship-to changed because', data.shipToOverrideReason]] as [string, string][])
          : []),
      ],
    },
    {
      step: 3,
      title: 'Product & volume',
      items: [
        ['Request class', label('request_class', data.requestClass)],
        ['Product family', label('product_family', data.productFamily)],
        ['Components', (data.components ?? []).map((c) => label('component', c)).join(', ')],
        ['Market', label('market', data.market)],
        ['Resin', label('resin', data.resin)],
        ['Neck finish', neck],
        ['Packaging', label('packaging_type', data.packagingType)],
        ['Packaging requirements', data.packagingNotes],
        [
          'Annual volume',
          data.estAnnualVolume != null ? `${data.estAnnualVolume.toLocaleString()} units` : null,
        ],
        ['Annual revenue', data.estAnnualRevenue != null ? formatUsd(data.estAnnualRevenue) : null],
        ['Expected close', data.expectedCloseDate ? formatDate(data.expectedCloseDate) : null],
        ['Standard description', data.standardDescription],
        ['Description', data.description],
      ],
    },
  ];

  return (
    <div className="grid gap-4">
      <Section title="Drawing and notes">
        <Field
          {...meta(cfg, 'drawing_status')}
          note={drawingMissing ? drawingMissing.message : undefined}
        >
          <Select
            id={fid('drawing_status')}
            listKey="drawing_status"
            value={data.drawingStatus}
            onChange={(v) => update({ drawingStatus: v })}
            cfg={cfg}
          />
        </Field>
        {/* B-16: files wait in the draft's folder and move to the quote's on submit. */}
        <AttachmentsPanel
          target={{ draftId }}
          heading="Drawing and other files"
          headingLevel={3}
          onDrawingStatus={(code) => update({ drawingStatus: code })}
        />
        <Field {...meta(cfg, 'comments_for_engineering')}>
          <Textarea
            id={fid('comments_for_engineering')}
            aria-describedby={`${fid('comments_for_engineering')}-help`}
            value={data.commentsForEngineering ?? ''}
            onChange={(e) => update({ commentsForEngineering: nullIfBlank(e.target.value) })}
          />
        </Field>
      </Section>

      <section aria-labelledby="review-heading" className="grid gap-4">
        <h2 id="review-heading" className="font-display text-xl">
          Review
        </h2>

        {evaluation.blocking.length > 0 && (
          <Notice tone="blocking" testId="blocking-list">
            <p className="font-semibold">Needed before you can submit</p>
            <ul className="mt-1 grid gap-1">
              {evaluation.blocking.map((b) => (
                <li key={`${b.code}:${b.field}`} className="flex flex-wrap items-center gap-x-2">
                  <span>
                    {b.code === 'MISSING_FIELD' ? `${issueLabel(b)} is required` : b.message}
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto min-h-0 px-0"
                    onClick={() => goTo(issueStep(b))}
                  >
                    Fix
                  </Button>
                </li>
              ))}
            </ul>
          </Notice>
        )}

        {(other.length > 0 || enrich.length > 0) && (
          <Notice tone="warning" testId="warning-list">
            <p className="font-semibold">Engineering may ask about this</p>
            <ul className="mt-1 grid gap-1">
              {other.map((w) => (
                <li key={`${w.code}:${w.field}`}>{w.message}</li>
              ))}
              {enrich.map((w) => (
                <li key={`${w.code}:${w.field}`} className="flex flex-wrap items-center gap-x-2">
                  <span>{issueLabel(w)} is blank.</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-warning-foreground h-auto min-h-0 px-0"
                    onClick={() => goTo(issueStep(w))}
                  >
                    Add it
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs">You can still submit.</p>
          </Notice>
        )}

        {rows.map((r) => (
          <Section
            key={r.step}
            title={r.title}
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goTo(r.step)}
                aria-label={`Edit ${r.title}`}
              >
                <PencilIcon aria-hidden /> Edit
              </Button>
            }
          >
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
              {r.items.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-words">{v && v.trim() ? v : '—'}</dd>
                </div>
              ))}
            </dl>
          </Section>
        ))}
      </section>
    </div>
  );
}
