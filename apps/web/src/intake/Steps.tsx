import {
  ITEM_LABEL_MAX,
  itemDecorationTypes,
  type IntakeAddress,
  type IntakeDraftData,
  type IntakeItemData,
} from '@ccq/contracts';
import {
  activeFollowUps,
  INTAKE_TEXT_LIMITS,
  isDeliveredPrice,
  isNonStandardPaymentTerms,
  isSharedFunding,
  shipToChanged,
  TERMS_DOCUMENT_REQUIRED_TEXT,
  todayInCentral,
  type ComponentFollowUpField,
  type IntakeEvaluation,
} from '@ccq/domain';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { AttachmentsPanel } from '@/components/attachments/Attachments';
import { FinanceReviewLine, FundingHelp } from '@/components/commercial/FundingHelp';
import { RequiredKey } from '@/components/forms';
import {
  answerText,
  stockHoldText,
  useNonStandardTermsText,
  useTermsTier,
} from '@/components/intake/CommercialInputs';
import { ConceptBadge } from '@/components/intake/ConceptBadge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { revealCollapsed } from '@/lib/collapse';
import { RETIRED_SUFFIX } from '@/lib/value-label';

import {
  componentTogglePatch,
  draftItemName,
  FIELD_META,
  formatAddress,
  formatDate,
  formatUsd,
  isCustom,
  issueLabel,
  issueStep,
  issueTextIn,
  listEntry,
  marketLabel,
  neckLabel,
  suggestedDescription,
  sfSuggestionsForSpec,
  valueLabel,
  type WizardConfig,
} from './model';
import { ShipToSourceNote } from './ShipToSource';
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
  /** FB-24 (N17-03): a sample photo / render is attached (a concept's file rule). */
  hasRender?: boolean;
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
  if (target && tries > 0 && revealCollapsed(target)) {
    // Its section was collapsed: focus once it is shown.
    requestAnimationFrame(() => focusIntakeField(field, tries - 1));
  } else if (target) {
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

/** FB-24 (N17-05): the standard description's limit, as the contract's `standardDescription: text(500)`. */
const STANDARD_DESCRIPTION_MAX = 500;

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
  // FB-15 (W13-01 c, e): a stored code the filter hides still shows as itself, never as "Choose…" or as
  // the first option while the data keeps the other code.
  const hiddenEntry =
    value && !options.some((e) => e.code === value)
      ? (cfg.lists[listKey] ?? []).find((e) => e.code === value)
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
      {hiddenEntry && (
        <option value={hiddenEntry.code}>{`${hiddenEntry.label} (not offered here)`}</option>
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
  // FB-15 (W13-01 d): a changed destination opens with its reason box, so "Fix" has a field to land on.
  const [editingShipTo, setEditingShipTo] = useState(
    !hasDefault ||
      Boolean(data.shipToOverrideReason) ||
      shipToChanged(data.shipTo, data.shipToDefault),
  );
  // FB-15 (W13-01 d): the required parts the Salesforce address left blank (e.g. no state) are asked for
  // even while the address is shown read-only. Filling a blank needs no reason.
  const blankRequiredParts = ADDRESS_PARTS.filter(
    (p) =>
      cfg.requiredFields.has(`ship_to.${p.key}`) && !(data.shipToDefault?.[p.key] ?? '').trim(),
  );
  const reasonBlocking = evaluation.blocking.some((b) => b.code === 'SHIP_TO_REASON_REQUIRED');
  const noAccount = evaluation.blocking.find((b) => b.code === 'SF_ACCOUNT_REQUIRED');

  const setShipTo = (key: keyof IntakeAddress, value: string) =>
    update({ shipTo: { ...(data.shipTo ?? {}), [key]: nullIfBlank(value) } });

  return (
    <div className="grid gap-4">
      {/* FB-02 (F-007, D-011): the customer is the opportunity's Salesforce Account; nothing is typed. */}
      <RequiredKey />
      <Section title="Customer" action={<SfTag />}>
        {noAccount ? (
          <div id={fid('customer.sf_account_id')} tabIndex={-1}>
            <Notice tone="blocking" testId="no-sf-account">
              {noAccount.message}
            </Notice>
          </div>
        ) : (
          <div className="grid gap-1">
            <p
              className="font-semibold"
              data-testid="customer-name"
              id={fid('customer.name')}
              tabIndex={-1}
            >
              {customer.name}
            </p>
            <p className="text-muted-foreground text-xs">
              The Salesforce Account on the opportunity. New accounts start in Salesforce.
            </p>
          </div>
        )}
        <label className="flex min-h-11 w-fit items-center gap-3 text-sm">
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
          <p id={`${fid('customer')}-help`} className="text-muted-foreground pl-8 text-xs">
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
        {/* FB-24 (N17-01): where the address came from, and the opportunity's own free-text ship-to. */}
        <ShipToSourceNote
          source={data.shipToSource ?? (hasDefault ? 'account' : null)}
          sfShipToLocations={data.sfShipToLocations ?? null}
        />
        {!editingShipTo ? (
          <div className="grid gap-4">
            <p data-testid="ship-to" className="flex flex-wrap items-center gap-2 text-sm">
              <span>{formatAddress(data.shipTo)}</span>
              <SfTag />
            </p>
            {blankRequiredParts.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2" data-testid="ship-to-missing-parts">
                <p className="text-muted-foreground text-xs sm:col-span-2">
                  Salesforce has no{' '}
                  {blankRequiredParts.map((p) => p.label.toLowerCase()).join(' or ')} for this
                  address. Add it here; Salesforce is not updated.
                </p>
                {blankRequiredParts.map((p) => (
                  <Field key={p.key} id={fid(`ship_to.${p.key}`)} label={p.label} required>
                    <Input
                      id={fid(`ship_to.${p.key}`)}
                      value={data.shipTo?.[p.key] ?? ''}
                      onChange={(e) => setShipTo(p.key, e.target.value)}
                      autoComplete={`shipping ${p.autoComplete}`}
                    />
                  </Field>
                ))}
              </div>
            )}
          </div>
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
  invalid,
}: {
  id: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  /** UX-017: the server refused the value (its message is shown under the field). */
  invalid?: boolean;
}) {
  // While focused, show exactly what was typed; otherwise the value (so outside changes show).
  const [editing, setEditing] = useState<string | null>(null);
  // Not focused, a figure reads with separators and at most two decimals (Salesforce sends 29465.408).
  const text =
    editing ?? (value == null ? '' : value.toLocaleString('en-US', { maximumFractionDigits: 2 }));
  return (
    <Input
      id={id}
      aria-describedby={`${id}-help`}
      aria-invalid={invalid || undefined}
      inputMode="numeric"
      value={text}
      onFocus={() => setEditing(value == null ? '' : String(value))}
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

/** FB-15 (W13-07): a color offered only for some resins (`meta.resins`, the stock colors). */
const colorForResin = (
  e: WizardConfig['lists'][string][number] | undefined,
  resin: string | null | undefined,
) => {
  const resins = e?.meta.resins;
  return !Array.isArray(resins) || !resin || (resins as unknown[]).includes(resin);
};

/** FB-15 (W13-04): what Salesforce sent that is not on the list, so the KAM knows why it is blank. */
function SfUnmatched({ text, testId }: { text: string | null | undefined; testId: string }) {
  if (!text) return null;
  return (
    <p
      className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
      data-testid={testId}
    >
      <SfTag />
      <span>Salesforce has “{text}”, which is not on the list. Pick the closest.</span>
    </p>
  );
}

/** F-011 / F-055: resin (pre-filled when SF supplied it), customer-specified grade, PCR %. */
function ResinFields({
  data,
  update,
  cfg,
  evaluation,
  onNote,
}: StepProps & { onNote: (note: string | null) => void }) {
  const sf = data.sfPrefill ?? {};
  const sfSpec = data.sfProductSpecs?.[0];
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field {...meta(cfg, 'resin')}>
          <Select
            id={fid('resin')}
            listKey="resin"
            value={data.resin}
            onChange={(v) => {
              // FB-15 (W13-07): a stock color the new resin doesn't offer is cleared, with a note.
              const color = listEntry(cfg, 'color_type', data.colorType);
              const clearColor = Boolean(color) && !colorForResin(color, v);
              onNote(
                clearColor
                  ? `Color cleared: ${color!.label} is not offered for ${valueLabel(cfg, 'resin', v)}.`
                  : null,
              );
              update({
                resin: v,
                // FB-09: the grade is the "Other" detail; keep it for a customer-specified resin.
                ...(isCustom(cfg, 'resin', v) || data.resinCustomerSpecified === true
                  ? {}
                  : { resinGrade: null }),
                ...(clearColor ? { colorType: null } : {}),
              });
            }}
            cfg={cfg}
          />
          {!sf.resin && sfSpec?.resin && (
            <SfUnmatched text={sfSpec.resin} testId="sf-resin-unmatched" />
          )}
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
      <label className="flex min-h-11 w-fit items-center gap-3 text-sm">
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
          className="text-muted-foreground -mt-3 pl-8 text-xs"
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
  const sfNeckText = data.sfProductSpecs?.[0]?.neckFinish;
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
      {!fromSf && <SfUnmatched text={sfNeckText} testId="sf-neck-unmatched" />}
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
  const sf = data.sfPrefill ?? {};
  // FB-32 (N19-04): "Salesforce says X, Use this", only with the setting on and only for an exact list
  // entry this resin offers. It fills nothing by itself. Once taken it is an ordinary "from Salesforce" value.
  const specId = (data as { sfProductSpecId?: string | null }).sfProductSpecId;
  const sfSpec = specId ? data.sfProductSpecs?.find((p) => p.id === specId) : undefined;
  const hint = sfSuggestionsForSpec(sfSpec, cfg).find(
    (s) =>
      s.quoteflowField === 'colorType' &&
      colorForResin(listEntry(cfg, 'color_type', s.code), data.resin),
  );
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field {...meta(cfg, 'color_type')}>
          <Select
            id={fid('color_type')}
            listKey="color_type"
            // FB-15 (W13-07): a stock color shows only for the resins it is made for.
            filter={(e) => colorForResin(e, data.resin)}
            value={data.colorType}
            onChange={(v) =>
              update({
                colorType: v,
                ...(isCustom(cfg, 'color_type', v) ? {} : { colorDescription: null }),
              })
            }
            cfg={cfg}
          />
          {hint && !sf.colorType && data.colorType !== hint.code && (
            <p
              className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
              data-testid="sf-color-suggestion"
            >
              <span>
                {hint.sfLabel} in Salesforce says “{hint.sfText}”.
              </span>
              <Button
                variant="link"
                size="sm"
                className="h-auto min-h-0 px-0"
                onClick={() =>
                  update({
                    colorType: hint.code,
                    colorDescription: null,
                    sfPrefill: { ...sf, colorType: hint.code },
                  })
                }
              >
                Use this
              </Button>
            </p>
          )}
          {sf.colorType && (
            <SfValueNote
              testId="sf-color"
              value={valueLabel(cfg, 'color_type', sf.colorType)}
              changed={data.colorType !== sf.colorType}
              onReset={() => update({ colorType: sf.colorType ?? null, colorDescription: null })}
            />
          )}
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

/** FB-24 (N17-02): the item's decoration types (an older draft's single code reads as one). */
const decorationTypesOf = (data: IntakeDraftData): string[] => itemDecorationTypes(data);

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
      <Reveal when={on('decoration_types') || on('decoration_print_colors')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {on('decoration_types') && (
            <DecorationTypesField
              data={data}
              update={update}
              cfg={cfg}
              invalid={Boolean(issue('decoration_types'))}
            />
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
      <ConditionalText
        when={
          on('decoration_types') &&
          decorationTypesOf(data).some((c) => isCustom(cfg, 'decoration_type', c))
        }
        field="decoration_type_other"
        label="Describe the decoration"
        value={data.decorationTypeOther}
        onChange={(v) => update({ decorationTypeOther: v })}
        cfg={cfg}
        evaluation={evaluation}
        max={cfg.intake.otherDescriptionMaxLength}
        placeholder="e.g. in-mold label"
      />
    </div>
  );
}

/**
 * FB-24 (N17-02): the decoration types as checkboxes (an item can be silk screened and shrink sleeved).
 * "Other" keeps its one description; unticking the last Other clears it. The old single code is dropped.
 */
function DecorationTypesField({
  data,
  update,
  cfg,
  invalid,
}: Pick<StepProps, 'data' | 'update' | 'cfg'> & { invalid: boolean }) {
  const picked = decorationTypesOf(data);
  const toggle = (code: string, on: boolean) => {
    const set = new Set(picked);
    if (on) set.add(code);
    else set.delete(code);
    const next = (cfg.lists.decoration_type ?? []).map((e) => e.code).filter((c) => set.has(c));
    update({
      decorationTypes: next,
      decorationType: undefined,
      ...(next.some((c) => isCustom(cfg, 'decoration_type', c))
        ? {}
        : { decorationTypeOther: null }),
    });
  };
  const m = meta(cfg, 'decoration_types');
  return (
    <fieldset
      className="grid gap-1.5"
      data-field={fid('decoration_types')}
      aria-describedby={cfg.help.decoration_types ? `${fid('decoration_types')}-help` : undefined}
      aria-invalid={invalid || undefined}
    >
      <legend className="mb-1.5 text-sm font-medium">
        {m.label}{' '}
        <span className="text-destructive" aria-hidden>
          *
        </span>
        <span className="sr-only"> (required)</span>
      </legend>
      <div className="flex flex-wrap gap-2" data-testid="decoration-types">
        {(cfg.lists.decoration_type ?? []).map((e) => (
          <label
            key={e.code}
            className="border-line-strong has-[:checked]:bg-primary has-[:checked]:text-primary-foreground rounded-pill flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm sm:min-h-9"
          >
            <input
              type="checkbox"
              className="size-4"
              checked={picked.includes(e.code)}
              onChange={(ev) => toggle(e.code, ev.target.checked)}
            />
            {e.label}
          </label>
        ))}
      </div>
      {cfg.help.decoration_types && (
        <p id={`${fid('decoration_types')}-help`} className="text-muted-foreground text-xs">
          {cfg.help.decoration_types}
        </p>
      )}
    </fieldset>
  );
}

/**
 * FB-24 (N18-02, D4): a Yes / No / Not known yet answer as radios (null = not known yet). A fieldset with
 * a legend, so a screen reader reads the question with each choice.
 */
function AnswerRadios({
  field,
  legend,
  value,
  onChange,
  help,
}: {
  field: string;
  legend: string;
  value: boolean | null | undefined;
  onChange: (v: boolean | null) => void;
  help?: string | undefined;
}) {
  const name = useId();
  const choices: [boolean | null, string][] = [
    [true, 'Yes'],
    [false, 'No'],
    [null, 'Not known yet'],
  ];
  return (
    <fieldset
      className="grid gap-1.5"
      data-field={fid(field)}
      data-testid={`answer-${field}`}
      aria-describedby={help ? `${fid(field)}-help` : undefined}
    >
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {choices.map(([v, text]) => (
          <label key={text} className="flex min-h-11 w-fit items-center gap-2 text-sm sm:min-h-9">
            <input
              type="radio"
              name={name}
              className="size-4 accent-[var(--primary)]"
              checked={(value ?? null) === v}
              onChange={() => onChange(v)}
            />
            {text}
          </label>
        ))}
      </div>
      {help && (
        <p id={`${fid(field)}-help`} className="text-muted-foreground text-xs">
          {help}
        </p>
      )}
    </fieldset>
  );
}

/**
 * FB-24 (Ben's decision D4, provisional placement; Faron Ipox): holding bottles for a customer is an extra
 * cost Pricing needs to know. The customer's ask, so the KAM records it. All optional. FB-31 (N19-10,
 * Sarah Brennan): asked in the contract's words, inventory and safety stock requirements ("subtle
 * training"); the fields (stock_hold_*) are unchanged.
 */
function StockHoldFields({ data, update, cfg, evaluation }: StepProps) {
  const yes = data.stockHoldRequested === true;
  const weeksIssue = evaluation.blocking.find((b) => b.field === 'stock_hold_weeks');
  const noteIssue = evaluation.blocking.find((b) => b.field === 'stock_hold_note');
  const max = INTAKE_TEXT_LIMITS.stock_hold_note;
  return (
    <div className="grid gap-4" data-testid="stock-hold">
      <AnswerRadios
        field="stock_hold_requested"
        legend="Does the customer have inventory or safety stock requirements?"
        value={data.stockHoldRequested}
        help={cfg.help.stock_hold_requested}
        onChange={(v) =>
          update({
            stockHoldRequested: v,
            // How long and the note apply only to a yes.
            ...(v === true ? {} : { stockHoldWeeks: null, stockHoldNote: null }),
          })
        }
      />
      <Reveal when={yes}>
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field id={fid('stock_hold_weeks')} label="For how long (weeks)">
            <NumberInput
              id={fid('stock_hold_weeks')}
              value={data.stockHoldWeeks}
              invalid={Boolean(weeksIssue)}
              onChange={(v) => update({ stockHoldWeeks: v })}
            />
            <FieldError issue={weeksIssue} />
          </Field>
          <Field id={fid('stock_hold_note')} label={`Note (optional, up to ${max} characters)`}>
            <Textarea
              id={fid('stock_hold_note')}
              aria-describedby={`${fid('stock_hold_note')}-count`}
              aria-invalid={noteIssue ? true : undefined}
              maxLength={max}
              placeholder="e.g. a minimum inventory, or two months of safety stock at the plant"
              value={data.stockHoldNote ?? ''}
              onChange={(e) => update({ stockHoldNote: nullIfBlank(e.target.value) })}
              className="min-h-16"
            />
            <p id={`${fid('stock_hold_note')}-count`} className="text-muted-foreground text-xs">
              {(data.stockHoldNote ?? '').length} / {max}
            </p>
            <FieldError issue={noteIssue} />
          </Field>
        </div>
      </Reveal>
    </div>
  );
}

/** F-085: an optional bid / program reference. A plain reference: it links nothing. */
function BidReferenceField({ data, update, cfg, evaluation }: StepProps) {
  const issue = evaluation.blocking.find((b) => b.field === 'bid_reference');
  return (
    <Field {...meta(cfg, 'bid_reference')}>
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
    <div className="grid content-start gap-1.5">
      <label className="flex min-h-11 w-fit items-center gap-3 text-sm">
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
        <p
          id={`${fid('returnable_dunnage')}-help`}
          className="text-muted-foreground -mt-1 pl-8 text-xs"
        >
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
  const termsTier = useTermsTier(data.requestedPaymentTerms);
  const nonStandardText = useNonStandardTermsText(data.requestedPaymentTerms);
  const delivered = isDeliveredPrice(data.priceBasis, cfg.intake.deliveredPriceBasisCodes);
  const freightIssue = evaluation.blocking.find((b) => b.field === 'freight_special_arrangements');
  // FB-15 (W13-03): freight "Other" makes the special arrangements required.
  const freightOther = delivered && isCustom(cfg, 'freight_type', data.freightType);
  // FB-15 (W13-09): Shared funding asks for the customer's share (optional).
  const shared = isSharedFunding(funding, cfg.intake.sharedFundingCodes);
  const shareIssue = evaluation.blocking.find((b) => b.field === 'customer_share_pct');

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
          {/* FB-15 (W13-01 c): the shared Select, so a stored code that is no longer offered shows as
              "(no longer offered)" instead of as the first option while the data keeps the old code. */}
          <Select
            id={fid('tooling_funding_model')}
            listKey="tooling_funding_model"
            value={funding}
            onChange={(v) =>
              update({
                toolingFundingModel: v,
                ...(isSharedFunding(v, cfg.intake.sharedFundingCodes)
                  ? {}
                  : { customerSharePct: null }),
              })
            }
            cfg={cfg}
          />
          <FundingHelp options={entries} className="pb-0" />
          <FinanceReviewLine code={funding} options={entries} />
        </Field>
        <Reveal when={shared}>
          <Field {...meta(cfg, 'customer_share_pct')}>
            <div className="relative">
              <DecimalInput
                id={fid('customer_share_pct')}
                value={data.customerSharePct}
                invalid={Boolean(shareIssue)}
                onChange={(v) => update({ customerSharePct: v })}
              />
              <span
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs"
              >
                %
              </span>
            </div>
            <FieldError issue={shareIssue} />
          </Field>
        </Reveal>
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
      {/* FB-31 (N19-07): says who must approve it (terms_exception_routes) and, where the tier says so,
          that a supporting document is needed. */}
      {nonStandard && (
        <Notice tone="warning" testId="payment-terms-nonstandard">
          {nonStandardText}
          {termsTier.documentRequired && (
            <span className="block" data-testid="payment-terms-document-required">
              {TERMS_DOCUMENT_REQUIRED_TEXT}
            </span>
          )}
        </Notice>
      )}
      {fundingEntry?.meta.taxHint === true && cfg.help.tooling_funding_tax_hint && (
        <Notice tone="info" testId="funding-tax-hint">
          {cfg.help.tooling_funding_tax_hint}
        </Notice>
      )}
      {/* FB-24 (N18-02): the KAM's answer is written to the field the Commercial terms panel edits, so
          Final Review sees it. Optional here; FB-25 makes it required at Final Review. */}
      <AnswerRadios
        field="tooling_commitment"
        legend="Will the customer commit to the tooling?"
        value={data.toolingCommitment}
        help={cfg.help.tooling_commitment}
        onChange={(v) => update({ toolingCommitment: v })}
      />
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
            {/* Bailey (2026-11-12): "Other" says where to describe it, like every other "Other". */}
            {freightOther && (
              <p className="text-muted-foreground text-xs" data-testid="freight-other-prompt">
                Describe the freight type under “Special freight arrangements” below.
              </p>
            )}
          </Field>
        </Reveal>
      </div>
      <Reveal when={delivered}>
        <Field
          {...meta(cfg, 'freight_special_arrangements')}
          {...(freightOther ? { required: true } : {})}
        >
          <Input
            id={fid('freight_special_arrangements')}
            aria-describedby={`${fid('freight_special_arrangements')}-help`}
            aria-invalid={freightIssue ? true : undefined}
            aria-required={freightOther || undefined}
            maxLength={INTAKE_TEXT_LIMITS.freight_special_arrangements}
            placeholder="e.g. drop trailer at the customer dock"
            value={data.freightSpecialArrangements ?? ''}
            onChange={(e) => update({ freightSpecialArrangements: nullIfBlank(e.target.value) })}
          />
          {freightIssue?.code === 'INVALID_VALUE' && <FieldError issue={freightIssue} />}
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
      <label className="flex min-h-11 w-fit items-center gap-3 text-sm">
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
          className="text-muted-foreground -mt-3 pl-8 text-xs"
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

const SUB_MARKET_CLEARED =
  'Sub-market cleared: it belongs to another market. Pick one of this market’s.';

/**
 * FB-19 (W13-32 to W13-34): what step 3 needs to show the items and act on them. The wizard owns the
 * items (they are part of the draft) and which one is open.
 */
export interface ItemsProps {
  items: readonly IntakeItemData[];
  /** The open item (0-based). */
  selected: number;
  onSelect: (index: number) => void;
  /** Blocking issues per item, by index (the list's "n to do"). */
  issueCounts: readonly number[];
  /** `quote_items_max`. */
  itemsMax: number;
  onAdd: () => void;
  /** Adds one item per Salesforce product specification not used yet. */
  onAddFromSalesforce: () => void;
  /** How many Salesforce product specifications are not an item yet. */
  unusedSfSpecs: number;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, to: number) => void;
}

/** FB-19 (W13-32): the Items list: one row per item with its key facts, and the item actions. */
function ItemsPanel({ cfg, ...p }: ItemsProps & { cfg: WizardConfig }) {
  const full = p.items.length >= p.itemsMax;
  return (
    <Section
      title="Items"
      action={
        <span className="text-muted-foreground text-xs" data-testid="item-count">
          {p.items.length} {p.items.length === 1 ? 'item' : 'items'}
        </span>
      }
    >
      <p className="text-muted-foreground text-xs">
        Everything quoted together goes in one quote: add an item for each product (or each variant,
        such as another PCR % or another plant). Each item has its own product fields above. Fill
        one in completely, then duplicate it and change only what differs.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={full}
          onClick={() => p.onDuplicate(p.selected)}
          data-testid="duplicate-item"
        >
          <CopyIcon aria-hidden /> Duplicate this item
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={full}
          onClick={p.onAdd}
          data-testid="add-item"
        >
          <PlusIcon aria-hidden /> Add another item
        </Button>
        {p.unusedSfSpecs > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={full}
            onClick={p.onAddFromSalesforce}
            data-testid="add-from-salesforce"
          >
            <PlusIcon aria-hidden /> Add from Salesforce products ({p.unusedSfSpecs})
          </Button>
        )}
        {full && (
          <span className="text-muted-foreground text-xs" role="status">
            A quote can hold up to {p.itemsMax} items. Put the rest in a separate quote.
          </span>
        )}
      </div>
      <ol className="grid gap-2" data-testid="items-list" aria-label="Items">
        {p.items.map((item, i) => {
          const open = i === p.selected;
          const todo = p.issueCounts[i] ?? 0;
          const facts = [
            valueLabel(cfg, 'product_family', item.productFamily) || null,
            item.containerSize ?? null,
            item.estAnnualVolume != null ? `${item.estAnnualVolume.toLocaleString()} / yr` : null,
            item.productNeededBy ? `needed by ${formatDate(item.productNeededBy)}` : null,
          ].filter(Boolean);
          return (
            <li
              key={item.key}
              data-testid="item-row"
              data-open={open || undefined}
              className={`grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${open ? 'border-primary bg-accent/40' : ''}`}
            >
              <button
                type="button"
                className="grid min-w-0 gap-0.5 text-left"
                aria-current={open ? 'true' : undefined}
                onClick={() => p.onSelect(i)}
              >
                <span className="text-sm font-semibold break-words">
                  Item {i + 1}
                  {item.label ? `: ${item.label}` : ''}
                  {open && <span className="text-primary ml-2 text-xs">(open above)</span>}
                </span>
                <span className="text-muted-foreground text-xs break-words">
                  {facts.length > 0 ? facts.join(' · ') : 'Nothing entered yet'}
                </span>
                <span
                  className={`text-xs font-medium ${todo === 0 ? 'text-primary' : 'text-destructive'}`}
                  data-testid="item-status"
                >
                  {todo === 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2Icon aria-hidden className="size-3.5" /> Complete
                    </span>
                  ) : (
                    `${todo} to do`
                  )}
                </span>
              </button>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move item ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => p.onMove(i, i - 1)}
                >
                  <ArrowUpIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move item ${i + 1} down`}
                  disabled={i === p.items.length - 1}
                  onClick={() => p.onMove(i, i + 1)}
                >
                  <ArrowDownIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={p.items.length <= 1}
                  onClick={() => p.onRemove(i)}
                  aria-label={`Remove item ${i + 1}`}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/**
 * FB-19 (W13-32): one item's product fields (decision 3). `data` is the item's view (the request with
 * the item's fields on top) and `update` routes each key to the item or the request. Keyed by the item,
 * so its local state (the suggestion tracker, the color note) starts over when another item opens.
 */
function ItemFields({
  data,
  update,
  cfg,
  evaluation,
  itemNo,
  itemCount,
}: StepProps & { itemNo: number; itemCount: number }) {
  // FB-19: the item's own name (the view is the request with the item's fields on top).
  const label = (data as { label?: string | null }).label ?? null;
  const invalidIssue = (field: string) =>
    evaluation.blocking.find((b) => b.code === 'INVALID_VALUE' && b.field === field);
  const invalid = (field: string) => Boolean(invalidIssue(field));
  const tomorrow = isoDayAfter(todayInCentral(new Date()));
  const sf = data.sfPrefill ?? {};
  const [colorNote, setColorNote] = useState<string | null>(null);
  const placeholder = evaluation.warnings.find((w) => w.code === 'VOLUME_PLACEHOLDER');
  const belowMinimum = evaluation.warnings.find((w) => w.code === 'BELOW_PLATFORM_MINIMUM');
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

  // F-013: a deselected component's follow-ups are cleared (see componentTogglePatch).
  const toggleComponent = (code: string, on: boolean) =>
    update(componentTogglePatch(data, code, on, cfg));

  return (
    <div className="grid gap-4" data-testid="item-fields" data-item={itemNo}>
      {/* FB-24 (N18-01): the KAM's "you are here": which item these fields belong to. */}
      <div
        className="border-primary bg-accent/40 rounded-md border-l-4 px-4 py-3"
        data-testid="item-heading"
      >
        <h3 className="font-display text-lg font-semibold break-words" id="item-fields-heading">
          Item {itemNo}
          {itemCount > 1 ? ` of ${itemCount}` : ''}
          {label ? `: ${label}` : ''}
        </h3>
        <p className="text-muted-foreground text-xs">
          {itemCount > 1
            ? 'You are filling in this item. Switch items in the Items box below.'
            : 'Fill in this item completely, then duplicate it or add another below.'}
        </p>
      </div>
      <Section title="Item">
        <Field
          id={fid('label')}
          label="Item name (optional, e.g. 16 oz bottle)"
          help={`A short name everyone sees in the item lists. Up to ${ITEM_LABEL_MAX} characters.`}
          required={false}
        >
          <Input
            id={fid('label')}
            aria-describedby={`${fid('label')}-help`}
            maxLength={ITEM_LABEL_MAX}
            placeholder="e.g. 16 oz bottle"
            value={label ?? ''}
            onChange={(e) =>
              update({ label: nullIfBlank(e.target.value) } as Partial<IntakeDraftData>)
            }
          />
          {/* FB-32 (B1): item 1's name from the product specification, while the KAM has not typed one. */}
          {sf.label && (
            <SfValueNote
              testId="sf-label"
              value={`“${sf.label}”`}
              changed={label !== sf.label}
              onReset={() => update({ label: sf.label ?? null } as Partial<IntakeDraftData>)}
            />
          )}
        </Field>
        <MoldFields data={data} update={update} cfg={cfg} evaluation={evaluation} />
      </Section>

      <Section title="Product">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field {...meta(cfg, 'product_family')}>
            <Select
              id={fid('product_family')}
              listKey="product_family"
              value={data.productFamily}
              onChange={(v) =>
                update({
                  productFamily: v,
                  // FB-15 (W13-03): unpicking Other clears its description.
                  ...(isCustom(cfg, 'product_family', v) ? {} : { productFamilyOther: null }),
                })
              }
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
        </div>
        <fieldset className="grid content-start gap-1.5" data-field={fid('components')}>
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
        <ConditionalText
          when={isCustom(cfg, 'product_family', data.productFamily)}
          field="product_family_other"
          label="Describe the product family"
          value={data.productFamilyOther}
          onChange={(v) => update({ productFamilyOther: v })}
          cfg={cfg}
          evaluation={evaluation}
          max={cfg.intake.otherDescriptionMaxLength}
          placeholder="e.g. squeeze tube"
        />
        <ConditionalText
          when={(data.components ?? []).some((c) => isCustom(cfg, 'component', c))}
          field="component_other"
          label="Describe the other component"
          value={data.componentOther}
          onChange={(v) => update({ componentOther: v })}
          cfg={cfg}
          evaluation={evaluation}
          max={cfg.intake.otherDescriptionMaxLength}
          placeholder="e.g. measuring cup"
        />
        <ComponentFollowUps data={data} update={update} cfg={cfg} evaluation={evaluation} />
        <ResinFields
          data={data}
          update={update}
          cfg={cfg}
          evaluation={evaluation}
          onNote={setColorNote}
        />
        <NeckFields data={data} update={update} cfg={cfg} evaluation={evaluation} />
        {colorNote && (
          <Notice tone="warning" testId="color-cleared">
            {colorNote}
          </Notice>
        )}
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
      </Section>

      <Section title="Volume and need-by">
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
              invalid={invalid('est_annual_volume')}
              onChange={(v) => update({ estAnnualVolume: v, estAnnualVolumeConfirmed: false })}
            />
            <FieldError issue={invalidIssue('est_annual_volume')} />
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

      <Section title="Description">
        <Field {...meta(cfg, 'standard_description')}>
          <Input
            id={fid('standard_description')}
            aria-describedby={`${fid('standard_description')}-help ${fid('standard_description')}-count`}
            maxLength={STANDARD_DESCRIPTION_MAX}
            value={data.standardDescription ?? ''}
            onChange={(e) => update({ standardDescription: nullIfBlank(e.target.value) })}
          />
          {/* FB-24 (N17-05): the limit the server holds, counted as the KAM types. */}
          <p id={`${fid('standard_description')}-count`} className="text-muted-foreground text-xs">
            {(data.standardDescription ?? '').length} / {STANDARD_DESCRIPTION_MAX}
          </p>
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
      </Section>
    </div>
  );
}

export function ProductStep({
  data,
  update,
  cfg,
  evaluation,
  sfCloseDate,
  items,
}: StepProps & { items: ItemsProps }) {
  const invalidIssue = (field: string) =>
    evaluation.blocking.find((b) => b.code === 'INVALID_VALUE' && b.field === field);
  const invalid = (field: string) => Boolean(invalidIssue(field));
  const tomorrow = isoDayAfter(todayInCentral(new Date()));
  // FB-15: a value cleared because it no longer fits (a sub-market of another market) says so, instead of
  // silently showing "Choose…".
  const subMarketParent = data.subMarket ? cfg.intake.subMarketMarkets[data.subMarket] : undefined;
  const subMarketMismatch = Boolean(
    data.subMarket && subMarketParent !== undefined && subMarketParent !== data.market,
  );
  // FB-15 (W13-01 e): a stored sub-market of another market (or with no market, e.g. a rework of an older
  // quote) is cleared when the step opens, with a note. A change made here clears it in the market's onChange.
  const [marketNote, setMarketNote] = useState<string | null>(() =>
    subMarketMismatch ? SUB_MARKET_CLEARED : null,
  );
  useEffect(() => {
    if (subMarketMismatch) update({ subMarket: null });
  }, [subMarketMismatch, update]);
  const variantsMax = cfg.intake.variantsNoteMaxLength;
  // F-067: a class other than CCQ shows where it goes instead, and Submit stays disabled.
  const notAllowed = evaluation.blocking.find((b) => b.code === 'REQUEST_CLASS_NOT_ALLOWED');
  // FB-24 (N17-03): a concept / innovation request (a class exempt from the minimum spec).
  const concept = Boolean(
    data.requestClass && cfg.intake.minSpecExemptClasses.includes(data.requestClass),
  );
  const conceptIssue = evaluation.blocking.find((b) => b.field === 'concept_assumptions');
  const revenueChanged =
    data.estAnnualRevenueSf != null && data.estAnnualRevenue !== data.estAnnualRevenueSf;
  const open = items.items[items.selected];

  return (
    <div className="grid gap-4">
      <RequiredKey />
      {/* FB-15 (W13-04): why nothing was pre-filled from Salesforce. */}
      {data.sfProductSpecsStatus === 'none' && (
        <Notice tone="info" testId="sf-no-product-details">
          Salesforce has no product details for this opportunity. Fill these in from the
          customer&apos;s request.
        </Notice>
      )}
      {data.sfProductSpecsStatus === 'unavailable' && (
        <Notice tone="warning" testId="sf-product-details-unavailable">
          Salesforce could not be reached when the opportunity was picked, so no product details
          were pre-filled. Fill these in from the customer&apos;s request.
        </Notice>
      )}
      {/* FB-19 (decision 2): the request is entered once for every item. */}
      <Section title="Request" action={concept ? <ConceptBadge /> : undefined}>
        <Field {...meta(cfg, 'request_class')}>
          <Select
            id={fid('request_class')}
            listKey="request_class"
            value={data.requestClass}
            onChange={(v) =>
              update({
                requestClass: v,
                // FB-24 (N17-03): the assumptions belong to a concept request only.
                ...(v && cfg.intake.minSpecExemptClasses.includes(v)
                  ? {}
                  : { conceptAssumptions: null }),
              })
            }
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
        {/* FB-24 (N17-03, Bailey Schmitt, Jordan): a concept starts from a render, not a drawing. The
            dimensions stay on screen, optional; the quote states what it assumes. */}
        <Reveal when={concept}>
          <div className="grid gap-3" data-testid="concept-fields">
            <Notice tone="info" testId="concept-note">
              Concept request: the dimensions and the rest of the minimum spec are optional. Add the
              customer&apos;s render or photo (or a drawing) on the last step, and say what the
              quote assumes. Engineering may take a best estimate.
            </Notice>
            <Field {...meta(cfg, 'concept_assumptions')} required>
              <Textarea
                id={fid('concept_assumptions')}
                aria-describedby={`${fid('concept_assumptions')}-help ${fid('concept_assumptions')}-count`}
                aria-invalid={conceptIssue ? true : undefined}
                maxLength={INTAKE_TEXT_LIMITS.concept_assumptions}
                placeholder="e.g. 16 oz round, about 30 g, HDPE natural, one-colour silk screen; pack-out and cycle estimated"
                value={data.conceptAssumptions ?? ''}
                onChange={(e) => update({ conceptAssumptions: nullIfBlank(e.target.value) })}
                className="min-h-24"
              />
              <p
                id={`${fid('concept_assumptions')}-count`}
                className="text-muted-foreground text-xs"
              >
                {(data.conceptAssumptions ?? '').length} /{' '}
                {INTAKE_TEXT_LIMITS.concept_assumptions.toLocaleString('en-US')}
              </p>
              {conceptIssue?.code === 'INVALID_VALUE' && <FieldError issue={conceptIssue} />}
            </Field>
          </div>
        </Reveal>
        <BidReferenceField data={data} update={update} cfg={cfg} evaluation={evaluation} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field {...meta(cfg, 'market')}>
            <Select
              id={fid('market')}
              listKey="market"
              value={data.market}
              // FB-12: a sub-market that does not belong to the new market is cleared (the server does too).
              onChange={(v) => {
                const keep = data.subMarket && cfg.intake.subMarketMarkets[data.subMarket] === v;
                setMarketNote(data.subMarket && !keep ? SUB_MARKET_CLEARED : null);
                update({ market: v, subMarket: keep ? data.subMarket : null });
              }}
              cfg={cfg}
            />
          </Field>
          {/* FB-12 (F-073): only the chosen market's sub-markets. It sets the strategic-fit score.
              FB-15 (W13-02): required (provisional config). */}
          <Field
            {...meta(cfg, 'sub_market')}
            note={
              marketNote ? <span data-testid="sub-market-cleared">{marketNote}</span> : undefined
            }
          >
            <Select
              id={fid('sub_market')}
              listKey="sub_market"
              value={data.subMarket}
              onChange={(v) => {
                setMarketNote(null);
                update({ subMarket: v });
              }}
              cfg={cfg}
              disabled={!data.market}
              placeholder={data.market ? 'Choose…' : 'Choose a market first'}
              filter={(e) => e.meta.market === data.market}
            />
          </Field>
        </div>
      </Section>

      <Section title="Commercial inputs for Pricing">
        <CommercialInputsFields data={data} update={update} cfg={cfg} evaluation={evaluation} />
        <DunnageField data={data} update={update} cfg={cfg} evaluation={evaluation} />
        <StockHoldFields data={data} update={update} cfg={cfg} evaluation={evaluation} />
      </Section>

      <Section title="Value and timing">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field {...meta(cfg, 'est_annual_revenue')} label="Estimated annual revenue (USD)">
            <NumberInput
              id={fid('est_annual_revenue')}
              value={data.estAnnualRevenue}
              invalid={invalid('est_annual_revenue')}
              onChange={(v) => update({ estAnnualRevenue: v })}
            />
            {/* UX-017: a figure the server refuses (out of range) says so here, not only in the footer. */}
            <FieldError issue={invalidIssue('est_annual_revenue')} />
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
            placeholder="e.g. price at 0, 25 and 50% PCR"
            value={data.quoteVariantsNote ?? ''}
            onChange={(e) => update({ quoteVariantsNote: nullIfBlank(e.target.value) })}
            className="min-h-16"
          />
          <p id={`${fid('quote_variants_note')}-count`} className="text-muted-foreground text-xs">
            {(data.quoteVariantsNote ?? '').length} / {variantsMax}
          </p>
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

      {/* FB-24 (N18-01, Bailey Schmitt): fill one item completely, then duplicate it or add another. The
          item's fields come first, the Items box after them. */}
      {open && (
        <ItemFields
          key={open.key}
          data={data}
          update={update}
          cfg={cfg}
          evaluation={evaluation}
          itemNo={items.selected + 1}
          itemCount={items.items.length}
        />
      )}
      <ItemsPanel {...items} cfg={cfg} />
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
  concept = false,
  hasRender = false,
}: {
  evaluation: IntakeEvaluation;
  cfg: WizardConfig;
  hasDrawing: boolean;
  goTo: (step: number, field?: string) => void;
  /** FB-24 (N17-03): a concept request needs a render, a photo or a drawing; the spec is optional. */
  concept?: boolean;
  hasRender?: boolean;
}) {
  const blocked = evaluation.blocking.find((b) => b.code === 'DRAWING_OR_MIN_SPEC_REQUIRED');
  const missing = blocked?.missing ?? [];
  if (concept) {
    const needed = evaluation.blocking.find((b) => b.code === 'RENDER_OR_DRAWING_REQUIRED');
    return (
      <div
        aria-live="polite"
        data-testid="drawing-or-spec"
        id={fid('drawing_or_render')}
        tabIndex={-1}
        data-state={needed ? 'render-missing' : 'render'}
      >
        {needed ? (
          <Notice tone="blocking">
            <p className="font-semibold">{needed.message}</p>
            <p className="text-sm">
              A concept quote starts from the customer&apos;s render or photo. Add it below as
              &ldquo;Sample photo / render&rdquo;, or attach a drawing. The minimum spec is
              optional.
            </p>
          </Notice>
        ) : (
          <Notice tone="info">
            <span className="inline-flex items-center gap-2 font-semibold">
              <CheckCircle2Icon aria-hidden className="text-primary size-4" />
              {hasDrawing ? 'Drawing attached' : hasRender ? 'Render or photo attached' : 'On file'}
            </span>{' '}
            The minimum spec is optional for a concept request.
          </Notice>
        )}
      </div>
    );
  }
  return (
    <div
      aria-live="polite"
      data-testid="drawing-or-spec"
      // FB-15: the target of the "Drawing or minimum spec" Fix link.
      id={fid('drawing_or_min_spec')}
      tabIndex={-1}
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

/** FB-19 (W13-32): what step 4 needs for the items: whose drawings are shown, and each item's view. */
export interface ReviewItemsProps {
  items: readonly IntakeItemData[];
  /** The item whose drawings, drawing status and minimum spec are shown (0-based). */
  selected: number;
  onSelect: (index: number) => void;
  hasDrawingFor: (item: IntakeItemData, index: number) => boolean;
  /** The selected item's view (the request with its fields on top) and its update. */
  itemData: IntakeDraftData;
  updateItem: (patch: Partial<IntakeDraftData>) => void;
  /** The request's issues and the selected item's. */
  itemEvaluation: IntakeEvaluation;
  /** Item names by key ("Item 2 (24 oz bottle)"), for the files list. */
  itemNames: Readonly<Record<string, string>>;
}

type ReviewRow = [string, string | null | undefined];

/** One item's rows on the review step (decision 3: the product fields). */
function itemReviewRows(data: IntakeDraftData, cfg: WizardConfig, drawing: string): ReviewRow[] {
  const label = (list: string, code: string | null | undefined) =>
    valueLabel(cfg, list, code) || '—';
  const active = activeFollowUps(data.components, cfg.intake.componentFollowUps);
  const followUpRows: ReviewRow[] = [
    ...(active.includes('liner_spec') ? [['Liner spec', data.linerSpec] as ReviewRow] : []),
    ...(active.includes('labels_purchased_by')
      ? [['Labels purchased by', label('labels_purchased_by', data.labelsPurchasedBy)] as ReviewRow]
      : []),
    ...(active.includes('decoration_types')
      ? [
          [
            'Decoration',
            decorationTypesOf(data)
              .map((c) =>
                isCustom(cfg, 'decoration_type', c)
                  ? (data.decorationTypeOther ?? 'Other')
                  : label('decoration_type', c),
              )
              .join(', ') || null,
          ] as ReviewRow,
        ]
      : []),
    ...(active.includes('decoration_print_colors')
      ? [['Print colors', data.decorationPrintColors?.toString()] as ReviewRow]
      : []),
  ];
  return [
    // FB-15 (W13-03): an "Other" shows what the KAM described.
    [
      'Product family',
      isCustom(cfg, 'product_family', data.productFamily)
        ? `Other: ${data.productFamilyOther ?? '—'}`
        : label('product_family', data.productFamily),
    ],
    ['Container size', data.containerSize],
    [
      'Components',
      (data.components ?? [])
        .map((c) =>
          isCustom(cfg, 'component', c)
            ? `Other: ${data.componentOther ?? '—'}`
            : label('component', c),
        )
        .join(', '),
    ],
    ...followUpRows,
    // DR-kam-sales-leader-19: a resin typed under "Other" shows as typed.
    [
      'Resin',
      isCustom(cfg, 'resin', data.resin)
        ? (data.resinGrade ?? label('resin', data.resin))
        : label('resin', data.resin),
    ],
    ['Customer-specified resin', data.resinCustomerSpecified ? (data.resinGrade ?? 'Yes') : 'No'],
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
    [
      'Annual volume',
      data.estAnnualVolume != null ? `${data.estAnnualVolume.toLocaleString()} units` : null,
    ],
    ['Product needed by', data.productNeededBy ? formatDate(data.productNeededBy) : null],
    ['Drawing or minimum spec', drawing],
    ['Standard description', data.standardDescription],
  ];
}

export function ReviewStep({
  data,
  update,
  cfg,
  evaluation,
  sfCloseDate,
  hasRender,
  goTo,
  draftId,
  items,
}: StepProps & {
  goTo: (step: number, field?: string, item?: number) => void;
  draftId: string;
  items: ReviewItemsProps;
}) {
  const many = items.items.length > 1;
  const selectedItem = items.items[items.selected];
  const selectedNo = items.selected + 1;
  const hasDrawing = selectedItem ? items.hasDrawingFor(selectedItem, items.selected) : false;
  const drawingMissing = items.itemEvaluation.warnings.find((w) => w.code === 'DRAWING_MISSING');
  const rfpIssue = evaluation.blocking.find(
    (b) => b.field === 'rfp_link' && b.code === 'INVALID_VALUE',
  );
  const other = evaluation.warnings.filter((w) => w.code !== 'ENRICH');
  const enrich = evaluation.warnings.filter((w) => w.code === 'ENRICH');
  const text = issueTextIn(data);
  const label = (list: string, code: string | null | undefined) =>
    valueLabel(cfg, list, code) || '—';
  // FB-31 (N19-07): who must approve a non-standard request (terms_exception_routes).
  const reviewNonStandardText = useNonStandardTermsText(data.requestedPaymentTerms);
  const pickerId = useId();

  const drawingText = (item: IntakeItemData, index: number) =>
    items.hasDrawingFor(item, index)
      ? 'Drawing attached'
      : data.requestClass && cfg.intake.minSpecExemptClasses.includes(data.requestClass)
        ? hasRender
          ? 'Render or photo attached (concept: the minimum spec is optional)'
          : "Missing: add the customer's render or photo, or a drawing"
        : evaluation.blocking.some(
              (b) => b.code === 'DRAWING_OR_MIN_SPEC_REQUIRED' && (b.item ?? 1) === index + 1,
            )
          ? 'Missing: attach a drawing or complete the minimum spec'
          : 'Minimum spec complete (no drawing)';

  const rows: { step: number; title: string; item?: number; items: ReviewRow[] }[] = [
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
          ? ([['Destination changed because', data.shipToOverrideReason]] as ReviewRow[])
          : []),
      ],
    },
    {
      step: 3,
      title: 'Request',
      items: [
        ['Request class', label('request_class', data.requestClass)],
        // FB-24 (N17-03): a concept states what it assumes.
        ...(data.requestClass && cfg.intake.minSpecExemptClasses.includes(data.requestClass)
          ? ([['Concept assumptions', data.conceptAssumptions]] as ReviewRow[])
          : []),
        ['Market', marketLabel(cfg, data) ?? '—'],
        // FB-24 (N17-10): the answer, unmistakably.
        ['Returnable dunnage', data.returnableDunnage === true ? 'Yes' : 'No'],
        // FB-24 (N18-02, D4).
        ['Customer commits to the tooling', answerText(data.toolingCommitment)],
        [
          'Inventory or safety stock requirements',
          [stockHoldText(data), data.stockHoldRequested === true ? data.stockHoldNote : null]
            .filter(Boolean)
            .join(' · '),
        ],
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
                    ? ` (${reviewNonStandardText})`
                    : ''
                }`
              : null,
        ],
        [
          'Customer funds any tooling',
          // FB-15 (W13-09): Shared shows the customer's share; Pretium covers the rest.
          isSharedFunding(data.toolingFundingModel, cfg.intake.sharedFundingCodes) &&
          data.customerSharePct != null
            ? `${label('tooling_funding_model', data.toolingFundingModel)}: customer ${data.customerSharePct}%, Pretium ${Math.round((100 - data.customerSharePct) * 10) / 10}%`
            : label('tooling_funding_model', data.toolingFundingModel),
        ],
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
        ['Customer bid / RFP reference', data.bidReference],
        ['Annual revenue', data.estAnnualRevenue != null ? formatUsd(data.estAnnualRevenue) : null],
        ['Salesforce close date', sfCloseDate ? formatDate(sfCloseDate) : null],
        ['Quote needed by', data.quoteNeededBy ? formatDate(data.quoteNeededBy) : null],
        ['Quote variants requested', data.quoteVariantsNote],
        ['Customer RFP / portal link', data.rfpLink],
        ['Description', data.description],
      ],
    },
    // FB-19 (W13-32): one block per item.
    ...items.items.map((item, i) => ({
      step: 3,
      item: i + 1,
      title: many ? draftItemName(item, i) : 'Product & volume',
      items: itemReviewRows({ ...data, ...item }, cfg, drawingText(item, i)),
    })),
  ];

  return (
    <div className="grid gap-4">
      <RequiredKey />
      <Section title="Drawing and files">
        {/* FB-19 (W13-32): drawings belong to an item; the minimum spec is checked per item. */}
        {many && (
          <div className="grid content-start gap-1.5" data-testid="drawing-item-picker">
            <label htmlFor={pickerId} className="text-sm font-medium">
              Drawings for
            </label>
            <NativeSelect
              id={pickerId}
              value={String(items.selected)}
              onChange={(e) => items.onSelect(Number(e.target.value))}
            >
              {items.items.map((item, i) => (
                <option key={item.key} value={i}>
                  {draftItemName(item, i)}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <DrawingOrSpec
          evaluation={items.itemEvaluation}
          cfg={cfg}
          hasDrawing={hasDrawing}
          goTo={(step, field) => goTo(step, field, many ? selectedNo : undefined)}
          concept={Boolean(
            data.requestClass && cfg.intake.minSpecExemptClasses.includes(data.requestClass),
          )}
          hasRender={hasRender ?? false}
        />
        <Field
          {...meta(cfg, 'drawing_status')}
          label={
            many
              ? `Drawing status (${draftItemName(selectedItem!, items.selected)})`
              : 'Drawing status'
          }
          note={drawingMissing ? drawingMissing.message : undefined}
        >
          <Select
            id={fid('drawing_status')}
            listKey="drawing_status"
            value={items.itemData.drawingStatus}
            onChange={(v) => items.updateItem({ drawingStatus: v })}
            cfg={cfg}
          />
        </Field>
        {/* B-16: files wait in the draft's folder and move to the quote's on submit. */}
        <AttachmentsPanel
          target={{ draftId }}
          heading="Drawing and other files"
          headingLevel={3}
          onDrawingStatus={(code) => items.updateItem({ drawingStatus: code })}
          itemKey={selectedItem?.key ?? null}
          {...(many ? { itemNames: items.itemNames } : {})}
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
                <li
                  key={`${b.code}:${b.field}:${b.item ?? ''}`}
                  className="flex flex-wrap items-center gap-x-2"
                >
                  <span>{text(b)}</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto min-h-0 px-0"
                    onClick={() => goTo(issueStep(b), b.field, b.item)}
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
                <li key={`${w.code}:${w.field}:${w.item ?? ''}`}>{w.message}</li>
              ))}
              {enrich.map((w) => (
                <li
                  key={`${w.code}:${w.field}:${w.item ?? ''}`}
                  className="flex flex-wrap items-center gap-x-2"
                >
                  <span>
                    {w.item !== undefined
                      ? `${draftItemName(items.items[w.item - 1] ?? { key: '' }, w.item - 1)}: `
                      : ''}
                    {issueLabel(w)} is blank.
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-warning-foreground h-auto min-h-0 px-0"
                    onClick={() => goTo(issueStep(w), w.field, w.item)}
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
            key={`${r.step}:${r.item ?? ''}`}
            title={r.title}
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goTo(r.step, undefined, r.item)}
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
