import type { IntakeAddress, IntakeDraftData } from '@ccq/contracts';
import {
  activeFollowUps,
  COMPONENT_FOLLOW_UP_FIELDS,
  INTAKE_TEXT_LIMITS,
  isDeliveredPrice,
  isNonStandardPaymentTerms,
  todayInCentral,
  type ComponentFollowUpField,
  type IntakeEvaluation,
} from '@ccq/domain';
import { CheckCircle2Icon, PencilIcon, Undo2Icon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { AttachmentsPanel } from '@/components/attachments/Attachments';
import { FundingHelp } from '@/components/commercial/FundingHelp';
import { NON_STANDARD_TERMS_TEXT } from '@/components/intake/CommercialInputs';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { RETIRED_SUFFIX } from '@/lib/value-label';

import {
  FIELD_META,
  formatAddress,
  formatDate,
  formatUsd,
  isCustom,
  issueLabel,
  issueStep,
  marketLabel,
  neckLabel,
  suggestedDescription,
  valueLabel,
  type WizardConfig,
} from './model';
import { Field, Notice, ReadOnlyValue, Reveal, Section, SfTag } from './ui';

export interface StepProps {
  data: IntakeDraftData;
  update: (patch: Partial<IntakeDraftData>) => void;
  cfg: WizardConfig;
  evaluation: IntakeEvaluation;
  /** FB-02 (T-009): the opportunity's close date from the latest Salesforce sync (read-only). */
  sfCloseDate?: string | null | undefined;
  /** FB-02 (F-016): a bottle or competitor drawing is attached. */
  hasDrawing?: boolean;
}

const fid = (field: string) => `intake-${field.replace(/[._]/g, '-')}`;

/**
 * DR-kam-sales-leader-18: after "Fix" moves to a step, put focus on the field to fix (its control, or
 * the first control of its group). Tries for a moment while the step renders. The first field of a
 * comma-joined requirement ("est_annual_volume,est_annual_revenue") is the one focused.
 */
export function focusIntakeField(field: string, tries = 20) {
  const id = fid(field.split(',')[0]!.trim());
  const el =
    document.getElementById(id) ?? document.querySelector<HTMLElement>(`[data-field="${id}"]`);
  const target =
    el && !el.matches('input, select, textarea, button')
      ? (el.querySelector<HTMLElement>('input, select, textarea, button') ?? el)
      : el;
  if (target) {
    target.focus();
    target.scrollIntoView({ block: 'center' });
  } else if (tries > 0) {
    requestAnimationFrame(() => focusIntakeField(field, tries - 1));
  }
}

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

/** YYYY-MM-DD of the day after `iso` (for the date pickers' `min`). */
const isoDayAfter = (iso: string) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** A blocking issue shown under its field (role=alert so it is announced when it appears). */
function FieldError({ issue }: { issue: { message: string } | undefined }) {
  if (!issue) return null;
  return (
    <p role="alert" className="text-destructive text-xs font-medium">
      {issue.message}
    </p>
  );
}

function Select({
  id,
  listKey,
  value,
  onChange,
  cfg,
  placeholder = 'Choose…',
  invalid,
  filter,
  disabled,
}: {
  id: string;
  listKey: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  cfg: WizardConfig;
  placeholder?: string;
  invalid?: boolean;
  /** FB-12: offer only the entries this accepts (the sub-markets of the chosen market). */
  filter?: (e: WizardConfig['lists'][string][number]) => boolean;
  disabled?: boolean;
}) {
  const options = (cfg.lists[listKey] ?? []).filter((e) => !filter || filter(e));
  // A code that has been taken off the list (a rework of a quote on a retired market) stays selectable
  // as it is, marked "(no longer offered)"; the KAM can pick a current one instead.
  const retiredLabel =
    value &&
    !options.some((e) => e.code === value) &&
    !(cfg.lists[listKey] ?? []).some((e) => e.code === value)
      ? (cfg.retired[listKey]?.[value] ?? value)
      : undefined;
  return (
    <NativeSelect
      id={id}
      aria-describedby={`${id}-help`}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(nullIfBlank(e.target.value))}
    >
      <option value="">{placeholder}</option>
      {retiredLabel !== undefined && (
        <option value={value!}>{`${retiredLabel}${RETIRED_SUFFIX}`}</option>
      )}
      {options.map((e) => (
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
  const customer = data.customer ?? { status: 'existing' as const };
  const notYetCustomer = customer.status === 'not_yet_established';
  const hasDefault = Boolean(formatAddress(data.shipToDefault));
  const [editingShipTo, setEditingShipTo] = useState(
    !hasDefault || Boolean(data.shipToOverrideReason),
  );
  const reasonBlocking = evaluation.blocking.some((b) => b.code === 'SHIP_TO_REASON_REQUIRED');
  const noAccount = evaluation.blocking.find((b) => b.code === 'SF_ACCOUNT_REQUIRED');

  const setShipTo = (key: keyof IntakeAddress, value: string) =>
    update({ shipTo: { ...(data.shipTo ?? {}), [key]: nullIfBlank(value) } });

  return (
    <div className="grid gap-4">
      {/* FB-02 (F-007, D-011): the customer is the opportunity's Salesforce Account; nothing is typed. */}
      <Section title="Customer" action={<SfTag />}>
        {noAccount ? (
          <Notice tone="blocking" testId="no-sf-account">
            {noAccount.message}
          </Notice>
        ) : (
          <div className="grid gap-1">
            <p className="font-semibold" data-testid="customer-name">
              {customer.name}
            </p>
            <p className="text-muted-foreground text-xs">
              The Salesforce Account on the opportunity. New accounts start in Salesforce.
            </p>
          </div>
        )}
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5"
            data-testid="not-yet-customer"
            aria-describedby={`${fid('customer')}-help`}
            checked={notYetCustomer}
            onChange={(e) =>
              update({
                customer: {
                  ...customer,
                  status: e.target.checked ? 'not_yet_established' : 'existing',
                },
              })
            }
          />
          Not yet a Pretium customer (no ERP account)
        </label>
        {cfg.help.customer && (
          <p id={`${fid('customer')}-help`} className="text-muted-foreground text-xs">
            {cfg.help.customer}
          </p>
        )}
      </Section>

      {/* FB-02 (F-017, D-012): Engineering picks the plant with this as input. */}
      <Section
        title="Ship / fill destination"
        action={
          hasDefault && !editingShipTo ? (
            <Button variant="outline" size="sm" onClick={() => setEditingShipTo(true)}>
              <PencilIcon aria-hidden /> Change destination
            </Button>
          ) : undefined
        }
      >
        {cfg.help.ship_to && <p className="text-muted-foreground text-xs">{cfg.help.ship_to}</p>}
        {!editingShipTo ? (
          <p data-testid="ship-to" className="flex flex-wrap items-center gap-2 text-sm">
            <span>{formatAddress(data.shipTo)}</span>
            <SfTag />
            <span className="text-muted-foreground block w-full text-xs">
              The Salesforce Account&apos;s shipping address.
            </span>
          </p>
        ) : (
          <div className="grid gap-4">
            {hasDefault && (
              <p className="text-muted-foreground text-sm" data-testid="ship-to-original">
                From Salesforce: {formatAddress(data.shipToDefault)}
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
                    <Undo2Icon aria-hidden /> Use the Salesforce address
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

/** A short text field shown only when it applies (a Custom value, a checkbox), required while shown. */
function ConditionalText({
  when,
  field,
  value,
  onChange,
  cfg,
  evaluation,
  max,
  label,
  placeholder,
}: {
  when: boolean;
  field: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  cfg: WizardConfig;
  evaluation: IntakeEvaluation;
  max: number;
  label?: string;
  placeholder?: string;
}) {
  const issue = evaluation.blocking.find((b) => b.field === field);
  return (
    <Reveal when={when}>
      <Field {...meta(cfg, field)} {...(label ? { label } : {})} required>
        <Input
          id={fid(field)}
          aria-describedby={`${fid(field)}-help`}
          aria-invalid={issue ? true : undefined}
          aria-required
          maxLength={max}
          placeholder={placeholder}
          value={value ?? ''}
          onChange={(e) => onChange(nullIfBlank(e.target.value))}
        />
        {issue?.code === 'INVALID_VALUE' && <FieldError issue={issue} />}
      </Field>
    </Reveal>
  );
}

/**
 * A field Salesforce filled in is an ordinary field the KAM can change (Ben, 2026-11-13). The note says
 * what Salesforce has and, once it is changed, offers the way back. Nothing is written to Salesforce.
 */
function SfValueNote({
  value,
  changed,
  onReset,
  testId,
}: {
  value: ReactNode;
  changed: boolean;
  onReset: () => void;
  testId: string;
}) {
  return (
    <p
      className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
      data-testid={testId}
    >
      <SfTag />
      {changed ? (
        <>
          <span>Salesforce has {value}.</span>
          <Button variant="link" size="sm" className="h-auto min-h-0 px-0" onClick={onReset}>
            Use the Salesforce value
          </Button>
        </>
      ) : (
        <span>Change it here if it is wrong. Salesforce is not updated.</span>
      )}
    </p>
  );
}

/** F-011 / F-055: resin (pre-filled when SF supplied it), customer-specified grade, PCR %. */
function ResinFields({ data, update, cfg, evaluation }: StepProps) {
  const sf = data.sfPrefill ?? {};
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field {...meta(cfg, 'resin')}>
          <Select
            id={fid('resin')}
            listKey="resin"
            value={data.resin}
            onChange={(v) =>
              update({
                resin: v,
                // FB-09: the grade is the "Other" detail; keep it for a customer-specified resin.
                ...(isCustom(cfg, 'resin', v) || data.resinCustomerSpecified === true
                  ? {}
                  : { resinGrade: null }),
              })
            }
            cfg={cfg}
          />
          {sf.resin && (
            <SfValueNote
              testId="sf-resin"
              value={valueLabel(cfg, 'resin', sf.resin)}
              changed={data.resin !== sf.resin}
              onReset={() => update({ resin: sf.resin ?? null })}
            />
          )}
        </Field>
        <Field {...meta(cfg, 'pcr_level')}>
          <Select
            id={fid('pcr_level')}
            listKey="pcr_level"
            value={data.pcrLevel}
            onChange={(v) =>
              update({
                pcrLevel: v,
                ...(isCustom(cfg, 'pcr_level', v) ? {} : { pcrLevelOther: null }),
              })
            }
            cfg={cfg}
          />
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          id={fid('resin_customer_specified')}
          type="checkbox"
          className="size-5"
          aria-describedby={`${fid('resin_customer_specified')}-help`}
          checked={data.resinCustomerSpecified === true}
          onChange={(e) =>
            update(
              e.target.checked
                ? { resinCustomerSpecified: true }
                : {
                    resinCustomerSpecified: false,
                    ...(isCustom(cfg, 'resin', data.resin) ? {} : { resinGrade: null }),
                  },
            )
          }
        />
        Customer-specified resin
      </label>
      {cfg.help.resin_customer_specified && (
        <p
          id={`${fid('resin_customer_specified')}-help`}
          className="text-muted-foreground -mt-3 text-xs"
        >
          {cfg.help.resin_customer_specified}
        </p>
      )}
      <ConditionalText
        when={data.resinCustomerSpecified === true || isCustom(cfg, 'resin', data.resin)}
        field="resin_grade"
        {...(isCustom(cfg, 'resin', data.resin)
          ? { label: 'Customer-specified resin and grade' }
          : {})}
        value={data.resinGrade}
        onChange={(v) => update({ resinGrade: v })}
        cfg={cfg}
        evaluation={evaluation}
        max={120}
        placeholder="e.g. LyondellBasell Pro-fax 6331"
      />
      <ConditionalText
        when={isCustom(cfg, 'pcr_level', data.pcrLevel)}
        field="pcr_level_other"
        value={data.pcrLevelOther}
        onChange={(v) => update({ pcrLevelOther: v })}
        cfg={cfg}
        evaluation={evaluation}
        max={120}
        placeholder="e.g. 35%"
      />
    </div>
  );
}

const NECK_LISTS = [
  { list: 'neck_diameter', key: 'neckDiameter', custom: 'neckDiameterCustom' },
  { list: 'neck_finish_type', key: 'neckFinishType', custom: 'neckFinishTypeCustom' },
  { list: 'neck_special_feature', key: 'neckSpecialFeature', custom: 'neckSpecialFeatureCustom' },
] as const;

/** F-010: neck diameter, finish and (optional) special feature; Custom reveals a description. */
function NeckFields({ data, update, cfg, evaluation }: StepProps) {
  const sf = data.sfPrefill ?? {};
  const fromSf = Boolean(sf.neckDiameter && sf.neckFinishType);
  return (
    <fieldset className="grid gap-4" data-field={fid('neck')}>
      <legend className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-medium">Neck</legend>
      <div className="grid gap-4 sm:grid-cols-3">
        {NECK_LISTS.map((n) => (
          <Field key={n.list} {...meta(cfg, n.list)}>
            <Select
              id={fid(n.list)}
              listKey={n.list}
              value={data[n.key]}
              placeholder={n.list === 'neck_special_feature' ? 'None' : 'Choose…'}
              onChange={(v) =>
                update({
                  [n.key]: v,
                  // Leaving Custom clears its description (it no longer applies).
                  ...(isCustom(cfg, n.list, v) ? {} : { [n.custom]: null }),
                })
              }
              cfg={cfg}
            />
          </Field>
        ))}
      </div>
      {fromSf && (
        <SfValueNote
          testId="sf-neck"
          value={neckLabel(cfg, {
            neckDiameter: sf.neckDiameter,
            neckFinishType: sf.neckFinishType,
            neckFinishTypeCustom: sf.neckFinishTypeCustom,
          })}
          changed={
            data.neckDiameter !== sf.neckDiameter || data.neckFinishType !== sf.neckFinishType
          }
          onReset={() =>
            update({
              neckDiameter: sf.neckDiameter ?? null,
              neckDiameterCustom: null,
              neckFinishType: sf.neckFinishType ?? null,
              neckFinishTypeCustom: sf.neckFinishTypeCustom ?? null,
            })
          }
        />
      )}
      {NECK_LISTS.map((n) => (
        <ConditionalText
          key={n.custom}
          when={isCustom(cfg, n.list, data[n.key])}
          field={`${n.list}_custom`}
          value={data[n.custom]}
          onChange={(v) => update({ [n.custom]: v })}
          cfg={cfg}
          evaluation={evaluation}
          max={120}
        />
      ))}
    </fieldset>
  );
}

/** F-023: color (Custom reveals a description) and an additives note. */
function ColorFields({ data, update, cfg, evaluation }: StepProps) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field {...meta(cfg, 'color_type')}>
          <Select
            id={fid('color_type')}
            listKey="color_type"
            value={data.colorType}
            onChange={(v) =>
              update({
                colorType: v,
                ...(isCustom(cfg, 'color_type', v) ? {} : { colorDescription: null }),
              })
            }
            cfg={cfg}
          />
        </Field>
        <Field {...meta(cfg, 'additive')}>
          <Select
            id={fid('additive')}
            listKey="additive"
            value={data.additive}
            onChange={(v) => update({ additive: v })}
            cfg={cfg}
          />
        </Field>
      </div>
      {/* FB-09: for "Other" the note is the required, customer-specified additive; otherwise it stays optional. */}
      {isCustom(cfg, 'additive', data.additive) ? (
        <ConditionalText
          when
          field="additives"
          label="Customer-specified additive"
          value={data.additives}
          onChange={(v) => update({ additives: v })}
          cfg={cfg}
          evaluation={evaluation}
          max={200}
          placeholder="e.g. UV inhibitor, grade and supplier"
        />
      ) : (
        <Field {...meta(cfg, 'additives')}>
          <Input
            id={fid('additives')}
            aria-describedby={`${fid('additives')}-help`}
            maxLength={200}
            placeholder="e.g. UV inhibitor"
            value={data.additives ?? ''}
            onChange={(e) => update({ additives: nullIfBlank(e.target.value) })}
          />
        </Field>
      )}
      <ConditionalText
        when={isCustom(cfg, 'color_type', data.colorType)}
        field="color_description"
        value={data.colorDescription}
        onChange={(v) => update({ colorDescription: v })}
        cfg={cfg}
        evaluation={evaluation}
        max={120}
        placeholder="e.g. Pantone 286 C blue"
      />
    </div>
  );
}

/** F-013: draft keys of the component follow-up fields. */
const FOLLOW_UP_KEYS = {
  liner_spec: 'linerSpec',
  labels_purchased_by: 'labelsPurchasedBy',
  decoration_type: 'decorationType',
  decoration_print_colors: 'decorationPrintColors',
} as const satisfies Record<ComponentFollowUpField, keyof IntakeDraftData>;

/** F-013: the picked components' follow-ups, required while shown. */
function ComponentFollowUps({ data, update, cfg, evaluation }: StepProps) {
  const active = activeFollowUps(data.components, cfg.intake.componentFollowUps);
  const on = (f: ComponentFollowUpField) => active.includes(f);
  const issue = (f: string) => evaluation.blocking.find((b) => b.field === f);
  return (
    <div className="grid gap-4" data-testid="component-follow-ups">
      <ConditionalText
        when={on('liner_spec')}
        field="liner_spec"
        value={data.linerSpec}
        onChange={(v) => update({ linerSpec: v })}
        cfg={cfg}
        evaluation={evaluation}
        max={120}
        placeholder="e.g. induction seal, foam"
      />
      <Reveal when={on('labels_purchased_by')}>
        <Field {...meta(cfg, 'labels_purchased_by')} required>
          <Select
            id={fid('labels_purchased_by')}
            listKey="labels_purchased_by"
            value={data.labelsPurchasedBy}
            onChange={(v) => update({ labelsPurchasedBy: v })}
            cfg={cfg}
            invalid={Boolean(issue('labels_purchased_by'))}
          />
        </Field>
      </Reveal>
      <Reveal when={on('decoration_type') || on('decoration_print_colors')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {on('decoration_type') && (
            <Field {...meta(cfg, 'decoration_type')} required>
              <Select
                id={fid('decoration_type')}
                listKey="decoration_type"
                value={data.decorationType}
                onChange={(v) => update({ decorationType: v })}
                cfg={cfg}
                invalid={Boolean(issue('decoration_type'))}
              />
            </Field>
          )}
          {on('decoration_print_colors') && (
            <Field {...meta(cfg, 'decoration_print_colors')} required>
              <Input
                id={fid('decoration_print_colors')}
                aria-describedby={`${fid('decoration_print_colors')}-help`}
                aria-invalid={issue('decoration_print_colors') ? true : undefined}
                type="number"
                inputMode="numeric"
                min={1}
                max={12}
                step={1}
                value={data.decorationPrintColors ?? ''}
                onChange={(e) =>
                  update({
                    decorationPrintColors: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
              {issue('decoration_print_colors')?.code === 'INVALID_VALUE' && (
                <FieldError issue={issue('decoration_print_colors')} />
              )}
            </Field>
          )}
        </div>
      </Reveal>
    </div>
  );
}

/** F-085: an optional bid / program reference. A plain reference: it links nothing. */
function BidReferenceField({ data, update, cfg, evaluation }: StepProps) {
  const issue = evaluation.blocking.find((b) => b.field === 'bid_reference');
  return (
    <Field {...meta(cfg, 'bid_reference')} label="Bid / program reference (optional)">
      <Input
        id={fid('bid_reference')}
        aria-describedby={`${fid('bid_reference')}-help`}
        aria-invalid={issue ? true : undefined}
        maxLength={INTAKE_TEXT_LIMITS.bid_reference}
        placeholder="e.g. RFP-2026-114"
        value={data.bidReference ?? ''}
        onChange={(e) => update({ bidReference: nullIfBlank(e.target.value) })}
      />
      <FieldError issue={issue} />
    </Field>
  );
}

/** F-063 (dunnage only): returnable (multi-trip) dunnage; unticked means single-trip. */
function DunnageField({ data, update, cfg }: StepProps) {
  return (
    <div className="grid gap-1.5">
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          id={fid('returnable_dunnage')}
          type="checkbox"
          className="size-5"
          data-testid="returnable-dunnage"
          aria-describedby={`${fid('returnable_dunnage')}-help`}
          checked={data.returnableDunnage === true}
          onChange={(e) => update({ returnableDunnage: e.target.checked })}
        />
        Customer wants returnable (multi-trip) dunnage
      </label>
      {cfg.help.returnable_dunnage && (
        <p id={`${fid('returnable_dunnage')}-help`} className="text-muted-foreground -mt-1 text-xs">
          {cfg.help.returnable_dunnage}
        </p>
      )}
    </div>
  );
}

/**
 * FB-11 (D-032, F-080): what Pricing needs before costing: the payment terms the customer asks for,
 * whether the customer funds any tooling, and delivered or FOB with the freight. Every field is optional;
 * a blank is an amber warning on the review. Payment terms and tooling funding are two separate things.
 */
function CommercialInputsFields({ data, update, cfg, evaluation }: StepProps) {
  const entries = cfg.lists.tooling_funding_model ?? [];
  const fundingDefault = entries.find((e) => e.meta.defaultAtIntake === true)?.code ?? null;
  const funding = data.toolingFundingModel ?? fundingDefault;
  const fundingEntry = entries.find((e) => e.code === funding);
  const nonStandard = isNonStandardPaymentTerms(
    data.requestedPaymentTerms,
    cfg.intake.standardPaymentTerms,
  );
  const delivered = isDeliveredPrice(data.priceBasis, cfg.intake.deliveredPriceBasisCodes);
  const freightIssue = evaluation.blocking.find((b) => b.field === 'freight_special_arrangements');

  // The funding answer starts at the list's default ("Not discussed") and is stored with the draft.
  useEffect(() => {
    if (data.toolingFundingModel == null && fundingDefault) {
      update({ toolingFundingModel: fundingDefault });
    }
  }, [data.toolingFundingModel, fundingDefault, update]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field {...meta(cfg, 'requested_payment_terms')}>
          <Select
            id={fid('requested_payment_terms')}
            listKey="requested_payment_terms"
            value={data.requestedPaymentTerms}
            onChange={(v) =>
              update({
                requestedPaymentTerms: v,
                ...(isCustom(cfg, 'requested_payment_terms', v)
                  ? {}
                  : { requestedPaymentTermsOther: null }),
              })
            }
            cfg={cfg}
          />
        </Field>
        <Field {...meta(cfg, 'tooling_funding_model')}>
          <NativeSelect
            id={fid('tooling_funding_model')}
            aria-describedby={`${fid('tooling_funding_model')}-help`}
            value={funding ?? ''}
            onChange={(e) => update({ toolingFundingModel: nullIfBlank(e.target.value) })}
          >
            {entries.map((e) => (
              <option key={e.code} value={e.code}>
                {e.label}
              </option>
            ))}
          </NativeSelect>
          <FundingHelp options={entries} className="pb-0" />
        </Field>
      </div>
      <ConditionalText
        when={isCustom(cfg, 'requested_payment_terms', data.requestedPaymentTerms)}
        field="requested_payment_terms_other"
        value={data.requestedPaymentTermsOther}
        onChange={(v) => update({ requestedPaymentTermsOther: v })}
        cfg={cfg}
        evaluation={evaluation}
        max={INTAKE_TEXT_LIMITS.custom_description}
        placeholder="e.g. Net 75, paid on receipt of goods"
      />
      {nonStandard && (
        <Notice tone="warning" testId="payment-terms-nonstandard">
          {NON_STANDARD_TERMS_TEXT}
        </Notice>
      )}
      {fundingEntry?.meta.taxHint === true && cfg.help.tooling_funding_tax_hint && (
        <Notice tone="info" testId="funding-tax-hint">
          {cfg.help.tooling_funding_tax_hint}
        </Notice>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field {...meta(cfg, 'price_basis')}>
          <Select
            id={fid('price_basis')}
            listKey="price_basis"
            value={data.priceBasis}
            onChange={(v) =>
              update({
                priceBasis: v,
                // Freight only applies to a delivered price: switching away clears it.
                ...(isDeliveredPrice(v, cfg.intake.deliveredPriceBasisCodes)
                  ? {}
                  : { freightType: null, freightSpecialArrangements: null }),
              })
            }
            cfg={cfg}
          />
        </Field>
        <Reveal when={delivered}>
          <Field {...meta(cfg, 'freight_type')}>
            <Select
              id={fid('freight_type')}
              listKey="freight_type"
              value={data.freightType}
              onChange={(v) => update({ freightType: v })}
              cfg={cfg}
            />
          </Field>
        </Reveal>
      </div>
      <Reveal when={delivered}>
        <Field {...meta(cfg, 'freight_special_arrangements')}>
          <Input
            id={fid('freight_special_arrangements')}
            aria-describedby={`${fid('freight_special_arrangements')}-help`}
            aria-invalid={freightIssue ? true : undefined}
            maxLength={INTAKE_TEXT_LIMITS.freight_special_arrangements}
            placeholder="e.g. drop trailer at the customer dock"
            value={data.freightSpecialArrangements ?? ''}
            onChange={(e) => update({ freightSpecialArrangements: nullIfBlank(e.target.value) })}
          />
          <FieldError issue={freightIssue} />
        </Field>
      </Reveal>
    </div>
  );
}

/** F-015: modify an existing mold; reveals the mold / part number and what changes. */
function MoldFields({ data, update, cfg, evaluation }: StepProps) {
  const on = data.modifyExistingMold === true;
  const issue = (f: string) => evaluation.blocking.find((b) => b.field === f);
  return (
    <div className="grid gap-4">
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          id={fid('modify_existing_mold')}
          type="checkbox"
          className="size-5"
          data-testid="modify-existing-mold"
          aria-describedby={`${fid('modify_existing_mold')}-help`}
          checked={on}
          onChange={(e) =>
            update(
              e.target.checked
                ? { modifyExistingMold: true }
                : { modifyExistingMold: false, existingMoldRef: null, moldChangeDescription: null },
            )
          }
        />
        Modify an existing mold
      </label>
      {cfg.help.modify_existing_mold && (
        <p
          id={`${fid('modify_existing_mold')}-help`}
          className="text-muted-foreground -mt-3 text-xs"
        >
          {cfg.help.modify_existing_mold}
        </p>
      )}
      <ConditionalText
        when={on}
        field="existing_mold_ref"
        value={data.existingMoldRef}
        onChange={(v) => update({ existingMoldRef: v })}
        cfg={cfg}
        evaluation={evaluation}
        max={60}
        placeholder="e.g. M-10421"
      />
      <Reveal when={on}>
        <Field {...meta(cfg, 'mold_change_description')} required>
          <Textarea
            id={fid('mold_change_description')}
            aria-describedby={`${fid('mold_change_description')}-help`}
            aria-invalid={issue('mold_change_description') ? true : undefined}
            aria-required
            maxLength={500}
            placeholder="e.g. finish change 28-410 → 28-400"
            value={data.moldChangeDescription ?? ''}
            onChange={(e) => update({ moldChangeDescription: nullIfBlank(e.target.value) })}
            className="min-h-16"
          />
        </Field>
        <Notice tone="info">
          Attach the reference drawing or a photo of the part in step 4 (Drawing and files).
        </Notice>
      </Reveal>
    </div>
  );
}

const DIMENSIONS = [
  { field: 'height_mm', key: 'heightMm', unit: 'mm' },
  { field: 'width_or_diameter_mm', key: 'widthOrDiameterMm', unit: 'mm' },
  { field: 'depth_mm', key: 'depthMm', unit: 'mm' },
  { field: 'gram_weight_g', key: 'gramWeightG', unit: 'g' },
] as const;

/** F-016: dimensions and gram weight (part of the minimum spec when there is no drawing). */
function DimensionFields({ data, update, cfg, evaluation }: StepProps) {
  return (
    <fieldset className="grid gap-2" data-field={fid('dimensions')}>
      <legend className="mb-1.5 text-sm font-medium">Dimensions</legend>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {DIMENSIONS.map((d) => {
          const issue = evaluation.blocking.find(
            (b) => b.field === d.field && b.code === 'INVALID_VALUE',
          );
          return (
            <Field key={d.field} {...meta(cfg, d.field)}>
              <div className="relative">
                <DecimalInput
                  id={fid(d.field)}
                  value={data[d.key]}
                  invalid={Boolean(issue)}
                  onChange={(v) => update({ [d.key]: v })}
                />
                <span
                  aria-hidden
                  className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs"
                >
                  {d.unit}
                </span>
              </div>
              <FieldError issue={issue} />
            </Field>
          );
        })}
      </div>
      {cfg.help.dimensions && (
        <p className="text-muted-foreground text-xs">{cfg.help.dimensions}</p>
      )}
    </fieldset>
  );
}

/** A decimal number field (mm, g): what was typed while focused, the value otherwise. */
function DecimalInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  invalid?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const text = editing ?? (value == null ? '' : String(value));
  return (
    <Input
      id={id}
      aria-describedby={`${id}-help`}
      aria-invalid={invalid || undefined}
      inputMode="decimal"
      className="pr-9"
      value={text}
      onFocus={() => setEditing(text)}
      onBlur={() => setEditing(null)}
      onChange={(e) => {
        setEditing(e.target.value);
        const clean = e.target.value.replace(/[,\s]/g, '');
        const n = Number(clean);
        onChange(clean === '' || Number.isNaN(n) ? null : n);
      }}
    />
  );
}

export function ProductStep({ data, update, cfg, evaluation, sfCloseDate }: StepProps) {
  const invalidIssue = (field: string) =>
    evaluation.blocking.find((b) => b.code === 'INVALID_VALUE' && b.field === field);
  const invalid = (field: string) => Boolean(invalidIssue(field));
  const tomorrow = isoDayAfter(todayInCentral(new Date()));
  // F-008: what the opportunity's SF product spec supplied is read-only (fix it in Salesforce).
  const sf = data.sfPrefill ?? {};
  const variantsMax = cfg.intake.variantsNoteMaxLength;
  const placeholder = evaluation.warnings.find((w) => w.code === 'VOLUME_PLACEHOLDER');
  const belowMinimum = evaluation.warnings.find((w) => w.code === 'BELOW_PLATFORM_MINIMUM');
  // F-067: a class other than CCQ shows where it goes instead, and Submit stays disabled.
  const notAllowed = evaluation.blocking.find((b) => b.code === 'REQUEST_CLASS_NOT_ALLOWED');
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
    const components = (cfg.lists.component ?? []).map((e) => e.code).filter((c) => set.has(c));
    // F-013: a deselected component's follow-ups are cleared.
    const active = activeFollowUps(components, cfg.intake.componentFollowUps);
    const cleared = Object.fromEntries(
      COMPONENT_FOLLOW_UP_FIELDS.filter((f) => !active.includes(f)).map((f) => [
        FOLLOW_UP_KEYS[f],
        null,
      ]),
    );
    update({ components, ...cleared });
  };

  const revenueChanged =
    data.estAnnualRevenueSf != null && data.estAnnualRevenue !== data.estAnnualRevenueSf;

  return (
    <div className="grid gap-4">
      <Section title="Request">
        <Field {...meta(cfg, 'request_class')}>
          <Select
            id={fid('request_class')}
            listKey="request_class"
            value={data.requestClass}
            onChange={(v) => update({ requestClass: v })}
            cfg={cfg}
            invalid={Boolean(notAllowed)}
          />
          {notAllowed && (
            <div role="alert">
              <Notice tone="blocking" testId="request-class-redirect">
                {notAllowed.message}
              </Notice>
            </div>
          )}
        </Field>
        <BidReferenceField data={data} update={update} cfg={cfg} evaluation={evaluation} />
        <MoldFields data={data} update={update} cfg={cfg} evaluation={evaluation} />
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
            {sf.containerSize && (
              <SfValueNote
                testId="sf-container-size"
                value={sf.containerSize}
                changed={data.containerSize !== sf.containerSize}
                onReset={() => update({ containerSize: sf.containerSize ?? null })}
              />
            )}
          </Field>
          <Field {...meta(cfg, 'market')}>
            <Select
              id={fid('market')}
              listKey="market"
              value={data.market}
              // FB-12: a sub-market that does not belong to the new market is cleared (the server does too).
              onChange={(v) =>
                update({
                  market: v,
                  subMarket:
                    data.subMarket && cfg.intake.subMarketMarkets[data.subMarket] === v
                      ? data.subMarket
                      : null,
                })
              }
              cfg={cfg}
            />
          </Field>
          {/* FB-12 (F-073): optional; only the chosen market's sub-markets. It sets the strategic-fit score. */}
          <Field {...meta(cfg, 'sub_market')}>
            <Select
              id={fid('sub_market')}
              listKey="sub_market"
              value={data.subMarket}
              onChange={(v) => update({ subMarket: v })}
              cfg={cfg}
              disabled={!data.market}
              placeholder={data.market ? 'Choose…' : 'Choose a market first'}
              filter={(e) => e.meta.market === data.market}
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
        <ComponentFollowUps data={data} update={update} cfg={cfg} evaluation={evaluation} />
        <ResinFields data={data} update={update} cfg={cfg} evaluation={evaluation} />
        <NeckFields data={data} update={update} cfg={cfg} evaluation={evaluation} />
        <ColorFields data={data} update={update} cfg={cfg} evaluation={evaluation} />
        <DimensionFields data={data} update={update} cfg={cfg} evaluation={evaluation} />
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
        {/* FB-09 (F-012, F-019; D-016 default): "Other" is for customer-dictated packaging, so the note is
            required and the KAM is asked to attach the customer's document. The cap applies to new edits;
            an older, longer note stays readable with a warning. */}
        {(() => {
          const other = isCustom(cfg, 'packaging_type', data.packagingType);
          const cap = cfg.intake.freeTextMaxLength;
          const length = (data.packagingNotes ?? '').length;
          const issue = evaluation.blocking.find((b) => b.field === 'packaging_notes');
          return (
            <Field
              {...meta(cfg, 'packaging_notes')}
              {...(other ? { label: 'Customer-specified packaging (describe)' } : {})}
              {...(other ? { required: true } : {})}
            >
              <Textarea
                id={fid('packaging_notes')}
                aria-describedby={`${fid('packaging_notes')}-help`}
                aria-invalid={issue ? true : undefined}
                placeholder="Pallet pattern, case count, labelling, max height…"
                maxLength={cap}
                value={data.packagingNotes ?? ''}
                onChange={(e) => update({ packagingNotes: nullIfBlank(e.target.value) })}
                className="min-h-16"
              />
              {other && (
                <p
                  className="text-muted-foreground mt-1 text-xs"
                  data-testid="packaging-other-hint"
                >
                  Other is for packaging the customer dictates. Attach the customer&apos;s packaging
                  document under "Drawing and other files" on the next step.
                </p>
              )}
              {length > cap && (
                <p
                  className="mt-1 text-xs text-amber-700"
                  role="status"
                  data-testid="packaging-over-cap"
                >
                  This note is {length} characters; new edits are limited to {cap}. Shorten it when
                  you next change it.
                </p>
              )}
              {issue?.code === 'INVALID_VALUE' && <FieldError issue={issue} />}
            </Field>
          );
        })()}
        <DunnageField data={data} update={update} cfg={cfg} evaluation={evaluation} />
      </Section>

      <Section title="Commercial inputs for Pricing">
        <CommercialInputsFields data={data} update={update} cfg={cfg} evaluation={evaluation} />
      </Section>

      <Section title="Volume, value and timing">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            {...meta(cfg, 'est_annual_volume')}
            label="Estimated annual volume (units)"
            note={
              placeholder || belowMinimum ? (
                <div className="grid gap-2">
                  {placeholder && (
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
                  )}
                  {belowMinimum && (
                    // FB-10 (F-066): a warning only. Submit stays available.
                    <span data-testid="guardrail-warning">{belowMinimum.message}</span>
                  )}
                </div>
              ) : undefined
            }
          >
            <NumberInput
              id={fid('est_annual_volume')}
              value={data.estAnnualVolume}
              onChange={(v) => update({ estAnnualVolume: v, estAnnualVolumeConfirmed: false })}
            />
            {sf.estAnnualVolume != null && (
              <SfValueNote
                testId="sf-volume"
                value={sf.estAnnualVolume.toLocaleString()}
                changed={data.estAnnualVolume !== sf.estAnnualVolume}
                onReset={() =>
                  update({
                    estAnnualVolume: sf.estAnnualVolume ?? null,
                    estAnnualVolumeConfirmed: false,
                  })
                }
              />
            )}
          </Field>
          <Field {...meta(cfg, 'est_annual_revenue')} label="Estimated annual revenue (USD)">
            <NumberInput
              id={fid('est_annual_revenue')}
              value={data.estAnnualRevenue}
              onChange={(v) => update({ estAnnualRevenue: v })}
            />
            {data.estAnnualRevenueSf != null && (
              <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                Salesforce amount: {formatUsd(data.estAnnualRevenueSf)} <SfTag />
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
          <ReadOnlyValue
            id={fid('sf_close_date')}
            label="Salesforce close date (updates with Salesforce)"
            value={sfCloseDate ? formatDate(sfCloseDate) : 'Not set in Salesforce'}
            testId="sf-close-date"
          />
          <Field {...meta(cfg, 'quote_needed_by')}>
            <Input
              id={fid('quote_needed_by')}
              aria-describedby={`${fid('quote_needed_by')}-help`}
              aria-invalid={invalid('quote_needed_by') || undefined}
              type="date"
              min={tomorrow}
              value={data.quoteNeededBy ?? ''}
              onChange={(e) => update({ quoteNeededBy: nullIfBlank(e.target.value) })}
            />
            <FieldError issue={invalidIssue('quote_needed_by')} />
          </Field>
          <Field
            {...meta(cfg, 'product_needed_by')}
            label="Product needed by (best estimate of launch need)"
          >
            <Input
              id={fid('product_needed_by')}
              aria-describedby={`${fid('product_needed_by')}-help`}
              aria-invalid={invalid('product_needed_by') || undefined}
              type="date"
              min={data.quoteNeededBy ?? tomorrow}
              value={data.productNeededBy ?? ''}
              onChange={(e) => update({ productNeededBy: nullIfBlank(e.target.value) })}
            />
            <FieldError issue={invalidIssue('product_needed_by')} />
          </Field>
        </div>
      </Section>

      <Section title="Quote variants">
        <Field
          {...meta(cfg, 'quote_variants_note')}
          label={`Quote variants requested (optional, up to ${variantsMax} characters)`}
        >
          <Textarea
            id={fid('quote_variants_note')}
            aria-describedby={`${fid('quote_variants_note')}-help ${fid('quote_variants_note')}-count`}
            maxLength={variantsMax}
            placeholder="e.g. price at 0/25/50% PCR; near-site vs ideal-site"
            value={data.quoteVariantsNote ?? ''}
            onChange={(e) => update({ quoteVariantsNote: nullIfBlank(e.target.value) })}
            className="min-h-16"
          />
          <p id={`${fid('quote_variants_note')}-count`} className="text-muted-foreground text-xs">
            {(data.quoteVariantsNote ?? '').length} / {variantsMax}
          </p>
        </Field>
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

/**
 * F-016 (D-018): which path lets the quote advance, a drawing or the minimum spec, and what is
 * missing. Announced politely when it changes (an upload or a field filled in).
 */
function DrawingOrSpec({
  evaluation,
  cfg,
  hasDrawing,
  goTo,
}: {
  evaluation: IntakeEvaluation;
  cfg: WizardConfig;
  hasDrawing: boolean;
  goTo: (step: number, field?: string) => void;
}) {
  const blocked = evaluation.blocking.find((b) => b.code === 'DRAWING_OR_MIN_SPEC_REQUIRED');
  const missing = blocked?.missing ?? [];
  return (
    <div
      aria-live="polite"
      data-testid="drawing-or-spec"
      data-state={hasDrawing ? 'drawing' : blocked ? 'missing' : 'spec'}
    >
      {hasDrawing ? (
        <Notice tone="info">
          <span className="inline-flex items-center gap-2 font-semibold">
            <CheckCircle2Icon aria-hidden className="text-primary size-4" /> Drawing attached
          </span>{' '}
          The minimum spec is not required.
        </Notice>
      ) : blocked ? (
        <Notice tone="blocking">
          <p className="font-semibold">Attach a drawing, or complete the minimum spec</p>
          <p className="text-sm">
            Engineering needs a bottle or competitor drawing to quote. Without one, fill in:
          </p>
          <ul className="mt-1 grid gap-1">
            {missing.map((f) => (
              <li key={f} className="flex flex-wrap items-center gap-x-2">
                <span data-testid="min-spec-missing">{FIELD_META[f]?.label ?? f}</span>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto min-h-0 px-0"
                  onClick={() => goTo(FIELD_META[f]?.step ?? 3, f)}
                >
                  Fix
                </Button>
              </li>
            ))}
          </ul>
        </Notice>
      ) : (
        <Notice tone="info">
          <span className="inline-flex items-center gap-2 font-semibold">
            <CheckCircle2Icon aria-hidden className="text-primary size-4" /> Minimum spec complete
          </span>{' '}
          No drawing attached:{' '}
          {cfg.intake.minSpecFields.length > 0
            ? 'the quote can advance on the spec'
            : 'none required'}
          , but it may take longer.
        </Notice>
      )}
    </div>
  );
}

export function ReviewStep({
  data,
  update,
  cfg,
  evaluation,
  sfCloseDate,
  hasDrawing = false,
  goTo,
  draftId,
}: StepProps & { goTo: (step: number, field?: string) => void; draftId: string }) {
  const drawingMissing = evaluation.warnings.find((w) => w.code === 'DRAWING_MISSING');
  const rfpIssue = evaluation.blocking.find(
    (b) => b.field === 'rfp_link' && b.code === 'INVALID_VALUE',
  );
  const other = evaluation.warnings.filter((w) => w.code !== 'ENRICH');
  const enrich = evaluation.warnings.filter((w) => w.code === 'ENRICH');
  const label = (list: string, code: string | null | undefined) =>
    valueLabel(cfg, list, code) || '—';

  const active = activeFollowUps(data.components, cfg.intake.componentFollowUps);
  const followUpRows: [string, string | null | undefined][] = [
    ...(active.includes('liner_spec')
      ? [['Liner spec', data.linerSpec] as [string, string | null | undefined]]
      : []),
    ...(active.includes('labels_purchased_by')
      ? [
          ['Labels purchased by', label('labels_purchased_by', data.labelsPurchasedBy)] as [
            string,
            string,
          ],
        ]
      : []),
    ...(active.includes('decoration_type')
      ? [['Decoration', label('decoration_type', data.decorationType)] as [string, string]]
      : []),
    ...(active.includes('decoration_print_colors')
      ? [['Print colors', data.decorationPrintColors?.toString()] as [string, string | undefined]]
      : []),
  ];
  const rows: { step: number; title: string; items: [string, string | null | undefined][] }[] = [
    {
      step: 1,
      title: 'Opportunity',
      items: [['Salesforce opportunity', data.sfOpportunityName]],
    },
    {
      step: 2,
      title: 'Customer & destination',
      items: [
        [
          'Customer',
          data.customer?.name
            ? `${data.customer.name} (${data.customer.status === 'existing' ? 'Pretium customer' : 'not yet a Pretium customer'})`
            : null,
        ],
        ['Ship / fill destination', formatAddress(data.shipTo)],
        ...(data.shipToOverrideReason
          ? ([['Destination changed because', data.shipToOverrideReason]] as [string, string][])
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
        ...followUpRows,
        ['Market', marketLabel(cfg, data) ?? '—'],
        // DR-kam-sales-leader-19: a resin typed under "Other" shows as typed.
        [
          'Resin',
          isCustom(cfg, 'resin', data.resin)
            ? (data.resinGrade ?? label('resin', data.resin))
            : label('resin', data.resin),
        ],
        [
          'Customer-specified resin',
          data.resinCustomerSpecified ? (data.resinGrade ?? 'Yes') : 'No',
        ],
        [
          'PCR %',
          isCustom(cfg, 'pcr_level', data.pcrLevel)
            ? (data.pcrLevelOther ?? 'Other')
            : label('pcr_level', data.pcrLevel),
        ],
        ['Neck', neckLabel(cfg, data) || null],
        [
          'Color',
          isCustom(cfg, 'color_type', data.colorType)
            ? (data.colorDescription ?? 'Custom')
            : label('color_type', data.colorType),
        ],
        [
          'Additives',
          [
            ...new Set(
              [
                isCustom(cfg, 'additive', data.additive) ? null : label('additive', data.additive),
                data.additives,
              ].filter((v) => v && v !== '—'),
            ),
          ].join(' · ') || null,
        ],
        [
          'Dimensions',
          [
            data.heightMm != null ? `H ${data.heightMm} mm` : null,
            data.widthOrDiameterMm != null ? `W/Ø ${data.widthOrDiameterMm} mm` : null,
            data.depthMm != null ? `D ${data.depthMm} mm` : null,
            data.gramWeightG != null ? `${data.gramWeightG} g` : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        ],
        [
          'Modify an existing mold',
          data.modifyExistingMold
            ? [data.existingMoldRef, data.moldChangeDescription].filter(Boolean).join(': ') || 'Yes'
            : 'No',
        ],
        ['Packaging', label('packaging_type', data.packagingType)],
        ['Packaging requirements', data.packagingNotes],
        ['Dunnage', data.returnableDunnage ? 'Returnable (multi-trip)' : 'Single-trip'],
        [
          'Payment terms requested',
          isCustom(cfg, 'requested_payment_terms', data.requestedPaymentTerms)
            ? (data.requestedPaymentTermsOther ?? 'Other')
            : data.requestedPaymentTerms
              ? `${label('requested_payment_terms', data.requestedPaymentTerms)}${
                  isNonStandardPaymentTerms(
                    data.requestedPaymentTerms,
                    cfg.intake.standardPaymentTerms,
                  )
                    ? ` (${NON_STANDARD_TERMS_TEXT})`
                    : ''
                }`
              : null,
        ],
        ['Customer funds any tooling', label('tooling_funding_model', data.toolingFundingModel)],
        [
          'Delivered or FOB',
          data.priceBasis
            ? [
                label('price_basis', data.priceBasis),
                isDeliveredPrice(data.priceBasis, cfg.intake.deliveredPriceBasisCodes)
                  ? [label('freight_type', data.freightType), data.freightSpecialArrangements]
                      .filter((p) => p && p !== '—')
                      .join(': ')
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : null,
        ],
        ['Bid / program reference', data.bidReference],
        [
          'Annual volume',
          data.estAnnualVolume != null ? `${data.estAnnualVolume.toLocaleString()} units` : null,
        ],
        ['Annual revenue', data.estAnnualRevenue != null ? formatUsd(data.estAnnualRevenue) : null],
        ['Salesforce close date', sfCloseDate ? formatDate(sfCloseDate) : null],
        ['Quote needed by', data.quoteNeededBy ? formatDate(data.quoteNeededBy) : null],
        ['Product needed by', data.productNeededBy ? formatDate(data.productNeededBy) : null],
        ['Quote variants requested', data.quoteVariantsNote],
        ['Customer RFP / portal link', data.rfpLink],
        [
          'Drawing or minimum spec',
          hasDrawing
            ? 'Drawing attached'
            : evaluation.blocking.some((b) => b.code === 'DRAWING_OR_MIN_SPEC_REQUIRED')
              ? 'Missing: attach a drawing or complete the minimum spec'
              : 'Minimum spec complete (no drawing)',
        ],
        ['Standard description', data.standardDescription],
        ['Description', data.description],
      ],
    },
  ];

  return (
    <div className="grid gap-4">
      <Section title="Drawing and files">
        <DrawingOrSpec evaluation={evaluation} cfg={cfg} hasDrawing={hasDrawing} goTo={goTo} />
        <Field
          {...meta(cfg, 'drawing_status')}
          label="Drawing status"
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
        {/* F-014: the customer's RFP or bid portal (https only). */}
        <Field {...meta(cfg, 'rfp_link')} label="Customer RFP / portal link (optional)">
          <Input
            id={fid('rfp_link')}
            type="url"
            inputMode="url"
            aria-describedby={`${fid('rfp_link')}-help`}
            aria-invalid={rfpIssue ? true : undefined}
            maxLength={500}
            placeholder="https://"
            value={data.rfpLink ?? ''}
            onChange={(e) => update({ rfpLink: nullIfBlank(e.target.value) })}
          />
          <FieldError issue={rfpIssue} />
        </Field>
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
                    onClick={() => goTo(issueStep(b), b.field)}
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
                    onClick={() => goTo(issueStep(w), w.field)}
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
