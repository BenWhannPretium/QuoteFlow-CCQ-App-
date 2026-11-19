import { type EngineeringDetail, type EquipmentBomView, type QuoteDetail } from '@ccq/contracts';
import {
  ATTACHMENT_MAX_BYTES,
  PREFORM_NUMBER_MAX_LENGTH,
  TWO_STEP_FREIGHT_NOTE_MAX_LENGTH,
  TWO_STEP_PLANT_MACHINE_TYPES_SEED,
  parseTwoStepPlantMachineTypes,
  plantsRunning,
  type TwoStepPlantMachineTypes,
  PACK_OUT_FIELDS,
  PACK_OUT_LABELS,
} from '@ccq/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UploadIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { AttachmentDownloadLink, attachmentsQueryKey } from '@/components/attachments/Attachments';
import { UploadFormats, acceptFor } from '@/components/attachments/UploadFormats';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { usePublicConfig } from '@/config/public-config';
import { api, isApiError, uploadAttachment } from '@/lib/api';
import { useSyncedForm } from '@/lib/synced-form';
import { absoluteTime } from '@/lib/time';
import { toast } from '@/lib/toast';
import { useReportUnsaved } from '@/lib/unsaved-changes';

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
import { quoteQueryKey } from '../GateDecisionDialog';
import { KeyValueGrid } from '../KeyValueGrid';
import { CostEstimateReadOnly, CostTotalsGrid } from './EngineeringCostCards';
import { timelineQueryKey } from '../Overrides';

/**
 * FB-06: the pieces of the Engineering tab that are not the solution form itself.
 * - Equipment BOM (F-058, D-033): an upload of the Engineering Program Office workbook or its one-page
 *   CSR BOM, versioned; Pricing and Final Review see the latest.
 * - Two-step process and pack-out (F-024, F-025): small inputs Pricing reads when it costs.
 * - Legacy notes: the two free-text fields the BOM upload replaced, read-only.
 */

// ── Equipment BOM ────────────────────────────────────────────────────────────────────────────────

/** The latest BOM file: name (downloadable), version, uploader and date. Read-only. */
export function EquipmentBomLine({ bom }: { bom: EquipmentBomView }) {
  const file = bom.current;
  if (!file) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="bom-none">
        No equipment BOM uploaded yet.
      </p>
    );
  }
  return (
    <div className="grid gap-0.5 text-sm" data-testid="bom-current">
      <p className="flex flex-wrap items-center gap-x-2">
        <span className="bg-secondary text-foreground rounded-pill px-2 py-0.5 text-xs font-semibold">
          v{file.version} · current
        </span>
        <span className="min-w-0 break-all">
          {file.available ? (
            <AttachmentDownloadLink id={file.id} fileName={file.fileName} />
          ) : (
            file.fileName
          )}
        </span>
      </p>
      <p className="text-muted-foreground text-xs">
        {file.uploadedByName ?? 'Someone'} · {absoluteTime(file.uploadedAt)}
        {bom.versions.length > 1 ? ` · ${bom.versions.length} versions` : ''}
      </p>
    </div>
  );
}

/** Earlier versions, newest first (kept and downloadable). */
function BomHistory({ bom }: { bom: EquipmentBomView }) {
  const earlier = bom.versions.filter((f) => !f.current);
  if (earlier.length === 0) return null;
  return (
    <details className="text-xs" data-testid="bom-history">
      <summary className="text-muted-foreground cursor-pointer">
        Earlier versions ({earlier.length})
      </summary>
      <ul className="mt-1 grid gap-1">
        {earlier.map((f) => (
          <li key={f.id}>
            v{f.version} ·{' '}
            {f.available ? <AttachmentDownloadLink id={f.id} fileName={f.fileName} /> : f.fileName}{' '}
            · {f.uploadedByName ?? 'Someone'} · {absoluteTime(f.uploadedAt)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function BomUpload({ quoteNumber, replace }: { quoteNumber: string; replace: boolean }) {
  const id = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const label = replace ? 'Upload a new version' : 'Upload the equipment BOM';
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error({ title: 'The file is too large', description: 'The limit is 100 MB.' });
      return;
    }
    setProgress(0);
    uploadAttachment({ quoteNumber }, file, { kind: 'equipment_bom' }, setProgress)
      .promise.then((res) => {
        toast.success({
          title: `Equipment BOM version ${res.item.version ?? 1} uploaded`,
          description: res.item.fileName,
        });
        return Promise.all([
          qc.invalidateQueries({ queryKey: quoteQueryKey(quoteNumber) }),
          qc.invalidateQueries({ queryKey: attachmentsQueryKey({ quoteNumber }) }),
          qc.invalidateQueries({ queryKey: timelineQueryKey(quoteNumber) }),
        ]);
      })
      .catch((err: unknown) =>
        toast.error({
          title: 'The upload was not accepted',
          description: (isApiError(err) && err.problem.detail) || 'Please try again.',
        }),
      )
      .finally(() => {
        setProgress(null);
        if (input.current) input.current.value = '';
      });
  };
  return (
    <div className="grid gap-1">
      <input
        ref={input}
        id={id}
        type="file"
        accept={acceptFor('equipment_bom')}
        className="sr-only"
        aria-label={label}
        aria-describedby={hintId}
        tabIndex={-1}
        data-testid="upload-equipment_bom"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={progress !== null}
        onClick={() => input.current?.click()}
      >
        <UploadIcon />
        {progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : label}
      </Button>
      {/* FB-27 (N17-24): the formats and size limit the server checks. */}
      <UploadFormats kind="equipment_bom" id={hintId} />
    </div>
  );
}

export function EquipmentBomCard({ quote }: { quote: QuoteDetail }) {
  const eng = quote.engineering;
  const bom = eng.equipmentBom;
  return (
    <Card data-testid="equipment-bom">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Equipment BOM</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-muted-foreground text-sm">
          Upload the equipment list for this quote: the Engineering Program Office project workbook,
          or its one-page summary (the CSR BOM). A rough estimate is fine at this stage; the
          detailed list comes after the capital request is approved. Mark each line C (capital) or P
          (customer paid). QuoteFlow stores the file and its versions. It does not read the numbers
          in it.
        </p>
        <EquipmentBomLine bom={bom} />
        {bom.requiredForCapital && !bom.current && eng.inQueue && (
          <p className="bg-secondary rounded-md px-3 py-2 text-sm" data-testid="bom-required">
            {bom.requiredWhenText}.
          </p>
        )}
        <BomHistory bom={bom} />
        {bom.canUpload && (
          <BomUpload quoteNumber={quote.quoteNumber} replace={bom.current !== null} />
        )}
      </CardContent>
    </Card>
  );
}

// ── Legacy notes ─────────────────────────────────────────────────────────────────────────────────

/** The two free-text fields the equipment BOM upload replaced. Read-only; shown only when there is text. */
export function LegacyNotes({ review }: { review: EngineeringDetail['review'] }) {
  if (
    !review.downstreamEquipmentNotes &&
    !review.equipmentBomNotes &&
    // FB-22 (N17-12): two more retired boxes, shown read-only when they hold an old value.
    !review.technicalConceptNotes &&
    !review.supplyChainNotes
  ) {
    return null;
  }
  return (
    <Card data-testid="legacy-notes">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Legacy notes</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-muted-foreground text-sm">
          Written in boxes the form no longer has (the equipment BOM is now an upload; Technical
          concept and Supply chain are no longer asked). Kept for the record; they can no longer be
          edited.
        </p>
        <KeyValueGrid
          items={[
            {
              id: 'legacy-downstream',
              label: 'Downstream equipment',
              value: review.downstreamEquipmentNotes,
            },
            { id: 'legacy-bom', label: 'Equipment BOM', value: review.equipmentBomNotes },
            {
              id: 'legacy-concept',
              label: 'Technical concept',
              value: review.technicalConceptNotes,
            },
            { id: 'legacy-supply-chain', label: 'Supply chain', value: review.supplyChainNotes },
          ]}
        />
      </CardContent>
    </Card>
  );
}

// ── Two-step process and pack-out ────────────────────────────────────────────────────────────────

/** The read-only lines of the two groups (empty groups are left out). */
export function pricingInputItems(
  review: EngineeringDetail['review'],
  plantLabel: (code: string | null) => string | null,
  /**
   * FB-23: the Engineering and Quoting tabs show the pack-out in its own grid (`PackOutGrid`), so they
   * leave the counts out here; Final Review still lists them (until its FB-23 summary is added).
   */
  { packOut = true }: { packOut?: boolean } = {},
) {
  const items: { id: string; label: string; value: string | null }[] = [
    {
      id: 'two-step',
      label: 'Two-step process',
      value: review.twoStep ? 'Yes' : null,
    },
  ];
  if (review.twoStep) {
    items.push(
      { id: 'preform-plant', label: 'Preform plant', value: plantLabel(review.preformPlantCode) },
      { id: 'blow-plant', label: 'Blow plant', value: plantLabel(review.blowPlantCode) },
      { id: 'preform-number', label: 'Preform number', value: review.preformNumber },
      { id: 'two-step-freight', label: 'Freight between plants', value: review.twoStepFreightNote },
    );
  }
  if (packOut) {
    for (const f of PACK_OUT_FIELDS) {
      const v = review[f];
      items.push({
        id: `pack-${f}`,
        label: PACK_OUT_LABELS[f],
        value: v === null ? null : v.toLocaleString('en-US'),
      });
    }
  }
  return items.filter((i) => i.value !== null);
}

export function PricingInputsReadOnly({ review }: { review: EngineeringDetail['review'] }) {
  const { data: config } = usePublicConfig();
  const plantLabel = (code: string | null) =>
    code ? (config?.valueLists.plant?.find((v) => v.code === code)?.label ?? code) : null;
  const items = pricingInputItems(review, plantLabel, { packOut: false });
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">Not a two-step process.</p>;
  }
  return <KeyValueGrid items={items} />;
}

interface ExtrasForm {
  twoStep: boolean;
  preformPlantCode: string;
  blowPlantCode: string;
  preformNumber: string;
  twoStepFreightNote: string;
}

const extrasForm = (r: EngineeringDetail['review']): ExtrasForm => ({
  twoStep: r.twoStep,
  preformPlantCode: r.preformPlantCode ?? '',
  blowPlantCode: r.blowPlantCode ?? '',
  preformNumber: r.preformNumber ?? '',
  twoStepFreightNote: r.twoStepFreightNote ?? '',
});

/**
 * FB-16 (W13-13): `runs` narrows the picker to the plants that run one of those machine types (the
 * preform plant: INJ - PREFORM; the blow plant: RHB or ISBM; `two_step_plant_machine_types`). A saved
 * plant outside the narrowed list stays visible, so an old quote does not lose it.
 */
function PlantSelect({
  id,
  value,
  runs = [],
  onChange,
}: {
  id: string;
  value: string;
  runs?: readonly string[];
  onChange: (v: string) => void;
}) {
  const { data: config } = usePublicConfig();
  const active = config?.valueLists.plant ?? [];
  const options = plantsRunning(active, runs);
  const retired = value !== '' && !active.some((v) => v.code === value);
  const outside =
    value !== '' && !retired && !options.some((v) => v.code === value)
      ? active.find((v) => v.code === value)
      : undefined;
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {retired && (
        <option value={value}>
          {`${config?.retiredValues?.plant?.[value] ?? value} (no longer offered)`}
        </option>
      )}
      {outside && <option value={value}>{`${outside.label} (does not run this step)`}</option>}
      {options.map((v) => (
        <option key={v.code} value={v.code}>
          {v.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/** A malformed setting falls back to the seed here; the server reports it when something is saved. */
function settingOr<T>(parse: (input: unknown) => T, input: unknown, fallback: T): T {
  try {
    return parse(input);
  } catch {
    return fallback;
  }
}

/** FB-16 (W13-14): the labels of machine types, for the plant pickers' hints ("Plants that run …"). */
const namesOf = (codes: readonly string[], list: readonly { code: string; label: string }[]) =>
  codes.map((c) => list.find((v) => v.code === c)?.label ?? c).join(' or ');

/**
 * F-024 (two-step, D-007 open: a simple checkbox, provisional) and F-025 (pack-out, A-014 not yet
 * confirmed by Engineering: optional whole numbers, provisional). Pricing reads both (T-008).
 */
export function PricingInputsCard({
  quote,
  refresh,
  itemId,
}: {
  /** FB-19: the item whose two-step process and pack-out these are (item 1 when omitted). */
  itemId?: string | undefined;
  quote: QuoteDetail;
  refresh: (detail?: EngineeringDetail) => Promise<unknown>;
}) {
  const eng = quote.engineering;
  const { data: config } = usePublicConfig();
  const initial = extrasForm(eng.review);
  // Untouched fields follow the server; only what is typed and not saved differs from `initial`.
  const [form, setForm] = useSyncedForm(initial);
  const [errors, setErrors] = useState<ServerError[]>([]);
  // FB-16 (W13-13, W13-14): both rules are settings (provisional), read from the public config.
  const twoStepPlants: TwoStepPlantMachineTypes = settingOr(
    parseTwoStepPlantMachineTypes,
    config?.settings.two_step_plant_machine_types,
    TWO_STEP_PLANT_MACHINE_TYPES_SEED,
  );
  // Bailey (2026-11-12): say it beside the button, where the eye already is (the toast is easy to miss).
  // FB-18 (W13-30): the shared `SaveStatus` ("Progress saved"), as on every other Save button.
  const machineTypes = config?.valueLists.machine_type ?? [];
  const status = useSaved(`two-step:${quote.quoteNumber}:${itemId ?? ''}`);
  const set = <K extends keyof ExtrasForm>(k: K, v: ExtrasForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const k of Object.keys(form) as (keyof ExtrasForm)[]) {
        if (form[k] === initial[k]) continue;
        const v = form[k];
        if (typeof v === 'boolean') body[k] = v;
        else {
          const t = v.trim();
          body[k] = t === '' ? null : t;
        }
      }
      // FB-19: the two-step process and the pack-out are the item's.
      return api.updateEngReview(quote.quoteNumber, itemId ? { ...body, itemId } : body);
    },
    onSuccess: async (detail) => {
      setErrors([]);
      setForm(
        extrasForm((itemId && detail.items.find((i) => i.id === itemId)?.review) || detail.review),
      );
      await refresh(detail);
      status.markSaved();
      toast.success({ title: 'Two-step process saved' });
    },
    onError: (err) => setErrors(problemErrors(err)),
  });
  const changed = (Object.keys(form) as (keyof ExtrasForm)[]).some((k) => form[k] !== initial[k]);
  // UX-001: typed and not saved. Not while the card is read-only (locked, or submitted to the lead).
  useReportUnsaved(quote.quoteNumber, `two-step:${itemId ?? ''}`, eng.canEdit && changed);

  const title = (
    <CardHeader>
      <CardTitle>
        <h2 className="text-base font-semibold">Two-step process</h2>
      </CardTitle>
      {/* FB-16 (W13-15): part of the engineer's work; the production scheduler does not edit it. */}
      <p className="text-muted-foreground text-xs">Engineer’s part</p>
    </CardHeader>
  );
  if (!eng.canEdit) {
    return (
      <Card data-testid="pricing-inputs">
        {title}
        <CardContent>
          <PricingInputsReadOnly review={eng.review} />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="pricing-inputs">
      {title}
      <CardContent>
        <form
          className="grid gap-4"
          noValidate
          data-testid="pricing-inputs-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <p className="text-muted-foreground text-sm">
            Pricing reads this when it costs the quote. Optional.
          </p>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-5"
              data-testid="two-step"
              checked={form.twoStep}
              onChange={(e) => set('twoStep', e.target.checked)}
            />
            Two-step process (a preform made first, then blown)
          </label>
          {form.twoStep && (
            <div className="grid gap-4 sm:grid-cols-2" data-testid="two-step-details">
              <Field
                label="Preform plant"
                hint={
                  twoStepPlants.preform.length > 0
                    ? `Plants that run ${namesOf(twoStepPlants.preform, machineTypes)}`
                    : undefined
                }
                error={errorFor(errors, 'preformPlantCode')}
              >
                {(id) => (
                  <PlantSelect
                    id={id}
                    value={form.preformPlantCode}
                    runs={twoStepPlants.preform}
                    onChange={(v) => set('preformPlantCode', v)}
                  />
                )}
              </Field>
              <Field
                label="Blow plant"
                hint={
                  twoStepPlants.blow.length > 0
                    ? `Plants that run ${namesOf(twoStepPlants.blow, machineTypes)}`
                    : undefined
                }
                error={errorFor(errors, 'blowPlantCode')}
              >
                {(id) => (
                  <PlantSelect
                    id={id}
                    value={form.blowPlantCode}
                    runs={twoStepPlants.blow}
                    onChange={(v) => set('blowPlantCode', v)}
                  />
                )}
              </Field>
              <Field
                label="Preform number"
                hint={`Up to ${PREFORM_NUMBER_MAX_LENGTH} characters`}
                error={errorFor(errors, 'preformNumber')}
              >
                {(id) => (
                  <Input
                    id={id}
                    maxLength={PREFORM_NUMBER_MAX_LENGTH}
                    value={form.preformNumber}
                    onChange={(e) => set('preformNumber', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Freight between the plants"
                hint={`A note for Pricing, up to ${TWO_STEP_FREIGHT_NOTE_MAX_LENGTH} characters`}
                error={errorFor(errors, 'twoStepFreightNote')}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    maxLength={TWO_STEP_FREIGHT_NOTE_MAX_LENGTH}
                    value={form.twoStepFreightNote}
                    onChange={(e) => set('twoStepFreightNote', e.target.value)}
                  />
                )}
              </Field>
            </div>
          )}
          <FormErrors errors={errors.filter((e) => !e.path.match(/^\/\w+$/))} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!changed || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save two-step process'}
            </Button>
            <SaveStatus {...saveStatusOf(save, status.saved && !changed)} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * FB-06 (T-008): what Engineering gave Pricing, on the Quoting tab: the equipment BOM file (version,
 * uploader, date), and per item the two-step process. FB-23 (N18-03 to N18-10): per item, the mold lead
 * time, the cost lines with a value and their totals (with the customer tooling price), labor and the
 * pack-out with its calculated figures. Read-only.
 */
export function EngineeringInputsCard({ quote }: { quote: QuoteDetail }) {
  const eng = quote.engineering;
  const items =
    eng.items.length > 0
      ? eng.items.map((i) => ({ id: i.id, name: i.name, review: i.review }))
      : [{ id: 'quote', name: null, review: eng.review }];
  return (
    <Card data-testid="quoting-from-engineering">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">From engineering</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Equipment BOM</p>
          <EquipmentBomLine bom={eng.equipmentBom} />
        </div>
        {items.map((item) => (
          <section
            key={item.id}
            className="grid gap-3 border-t pt-3"
            aria-label={item.name ?? 'Engineering inputs'}
            data-testid="quoting-engineering-item"
          >
            {items.length > 1 && <h3 className="text-sm font-semibold">{item.name}</h3>}
            <PricingInputsReadOnly review={item.review} />
            <CostEstimateReadOnly review={item.review} />
          </section>
        ))}
        {eng.costTotals && items.length > 1 && (
          <section
            className="grid gap-2 border-t pt-3"
            aria-label="All items"
            data-testid="quoting-cost-totals-quote"
          >
            <h3 className="text-sm font-semibold">All items</h3>
            <CostTotalsGrid totals={eng.costTotals} testId="cost-totals-quote" />
          </section>
        )}
      </CardContent>
    </Card>
  );
}
