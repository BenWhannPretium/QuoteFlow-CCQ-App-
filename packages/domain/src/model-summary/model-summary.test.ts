import { describe, expect, it } from 'vitest';

import {
  ERF_COSTING_TEMPLATE_SEED,
  MODEL_SUMMARY_LIMITS_SEED,
  MODEL_SUMMARY_TEMPLATES_SEED,
  PAYBACK_TEMPLATE_SEED,
  extractModelSummary,
  modelSummaryReasonText,
  modelSummaryWarnings,
  parseModelSummaryLimits,
  parseModelSummaryTemplates,
  parseModelSummaryVisible,
  sheetsToRead,
  templateMatches,
  unavailableSummary,
  type CellReading,
  type DefinedNameRef,
  type ModelSummaryTemplate,
  type WorkbookSnapshot,
} from './index';
import { parseSettingValue } from '../config-admin';

/** A small made-up template (synthetic: names and numbers are invented). */
const T: ModelSummaryTemplate = parseModelSummaryTemplates([
  {
    templateId: 'demo',
    label: 'Demo calculator',
    kind: 'roi_model',
    active: true,
    recognise: { sheet: 'Summary', labels: [{ ref: 'A1', contains: 'demo summary' }] },
    fields: [
      {
        key: 'units',
        label: 'Units',
        unit: 'units',
        type: 'number',
        sheet: 'Summary',
        ref: 'B2',
        headline: true,
      },
      {
        key: 'payback',
        label: 'Payback',
        unit: 'years',
        type: 'number',
        sheet: 'Summary',
        ref: 'QF_Payback',
        fallbackRef: 'B3',
        headline: true,
      },
      { key: 'hurdle', label: 'Hurdle', unit: 'years', type: 'number', sheet: 'Inputs', ref: 'C5' },
      { key: 'start', label: 'Start date', unit: 'text', type: 'date', sheet: 'Inputs', ref: 'C6' },
      { key: 'owner', label: 'Owner', unit: 'text', type: 'text', sheet: 'Inputs', ref: 'C7' },
    ],
    warnings: { nonPositive: ['payback'], hurdle: { field: 'payback', limitField: 'hurdle' } },
  },
])[0]!;

const n = (value: number, formula = true): CellReading => ({ kind: 'number', value, formula });
const t = (value: string): CellReading => ({ kind: 'text', value, formula: false });

function snap(
  sheets: Record<string, Record<string, CellReading>>,
  definedNames: DefinedNameRef[] = [],
): WorkbookSnapshot {
  return {
    sheetNames: Object.keys(sheets),
    definedNames,
    cells: new Map(Object.entries(sheets).map(([s, c]) => [s, new Map(Object.entries(c))])),
  };
}

const good = () => ({
  Summary: { A1: t('  DEMO   Summary | snapshot '), B2: n(1000), B3: n(2.5) },
  Inputs: {
    C5: n(3, false),
    C6: { kind: 'date', value: new Date('2026-01-15T00:00:00Z'), formula: false } as CellReading,
    C7: t('Finance'),
  },
});

describe('model summary config', () => {
  it('parses the seeded maps: payback active, the pre-makeover costing map inactive, all provisional', () => {
    const maps = parseModelSummaryTemplates(MODEL_SUMMARY_TEMPLATES_SEED);
    expect(maps.map((m) => [m.templateId, m.kind, m.active, m.provisional])).toEqual([
      ['payback_calculator', 'roi_model', true, true],
      ['erf_costing_pre_makeover', 'cost_model', false, true],
    ]);
    expect(PAYBACK_TEMPLATE_SEED.fields.length).toBeGreaterThanOrEqual(10);
    expect(PAYBACK_TEMPLATE_SEED.fields.length).toBeLessThanOrEqual(14);
    expect(maps.flatMap((m) => m.fields).every((f) => f.proposed)).toBe(true);
    // Every payback field prefers a defined name and falls back to an address.
    expect(
      PAYBACK_TEMPLATE_SEED.fields.every((f) => f.ref.startsWith('QF_') && f.fallbackRef),
    ).toBe(true);
  });

  it('rejects duplicate keys, unknown warning fields, bad refs and duplicate template ids', () => {
    const base = JSON.parse(JSON.stringify(T)) as ModelSummaryTemplate;
    const dupKey = { ...base, fields: [...base.fields, base.fields[0]] };
    expect(() => parseModelSummaryTemplates([dupKey])).toThrow(/duplicate field key units/);
    const badWarn = { ...base, warnings: { nonPositive: ['nope'], hurdle: null } };
    expect(() => parseModelSummaryTemplates([badWarn])).toThrow(/unknown field nope/);
    const badRef = { ...base, fields: [{ ...base.fields[0], ref: 'A1:B2' }] };
    expect(() => parseModelSummaryTemplates([badRef])).toThrow(/A1 address/);
    expect(() => parseModelSummaryTemplates([base, base])).toThrow(/duplicate templateId/);
    expect(parseModelSummaryTemplates(null)).toEqual([]);
  });

  it('validates the limits and the visibility switch, and the console accepts the seeds', () => {
    expect(parseModelSummaryLimits(null)).toEqual(MODEL_SUMMARY_LIMITS_SEED);
    expect(() =>
      parseModelSummaryLimits({ maxBytes: 1, timeoutMs: 5000, maxCells: 1000 }),
    ).toThrow();
    expect(parseModelSummaryVisible(false)).toBe(false);
    expect(() => parseModelSummaryVisible('yes')).toThrow();
    expect(parseSettingValue('model_summary_templates', MODEL_SUMMARY_TEMPLATES_SEED)).toHaveLength(
      2,
    );
    expect(parseSettingValue('model_summary_visible', true)).toBe(true);
    expect(() => parseSettingValue('model_summary_visible', null)).toThrow();
  });
});

describe('template recognition', () => {
  it('matches on the sheet and every label, ignoring case and spacing', () => {
    expect(templateMatches(snap(good()), T)).toBe(true);
    expect(templateMatches(snap({ ...good(), Summary: { A1: t('Other') } }), T)).toBe(false);
    expect(templateMatches(snap({ Inputs: good().Inputs }), T)).toBe(false);
  });

  it('reads only the sheets the active maps need, plus where a defined name points', () => {
    const names: DefinedNameRef[] = [
      { name: 'QF_Payback', sheet: 'Model', ref: 'Z9', multiCell: false },
    ];
    expect([...sheetsToRead([T], 'roi_model', names)].sort()).toEqual([
      'Inputs',
      'Model',
      'Summary',
    ]);
    expect(sheetsToRead([T], 'cost_model', names).size).toBe(0);
    expect(sheetsToRead([ERF_COSTING_TEMPLATE_SEED], 'cost_model', []).size).toBe(0);
  });
});

describe('extractModelSummary', () => {
  it('reads a recognised workbook: numbers, a date, text; complete', () => {
    const r = extractModelSummary(snap(good()), [T], 'roi_model');
    expect(r.status).toBe('complete');
    expect(r.templateId).toBe('demo');
    const by = Object.fromEntries(r.fields.map((f) => [f.key, f]));
    expect(by.units).toMatchObject({ state: 'ok', number: 1000, sheet: 'Summary', ref: 'B2' });
    expect(by.payback).toMatchObject({ state: 'ok', number: 2.5, ref: 'B3', definedName: null });
    expect(by.start!.date!.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(by.owner).toMatchObject({ state: 'ok', text: 'Finance' });
  });

  it('prefers a defined name over the fallback address', () => {
    const s = snap({ ...good(), Model: { Z9: n(4) } }, [
      { name: 'qf_payback', sheet: 'Model', ref: 'Z9', multiCell: false },
    ]);
    const f = extractModelSummary(s, [T], 'roi_model').fields.find((x) => x.key === 'payback')!;
    expect(f).toMatchObject({
      state: 'ok',
      number: 4,
      sheet: 'Model',
      ref: 'Z9',
      definedName: 'qf_payback',
    });
  });

  it('a defined name that is a range or broken falls back; with no fallback it is not found', () => {
    const range = snap(good(), [
      { name: 'QF_Payback', sheet: 'Summary', ref: 'B3', multiCell: true },
    ]);
    expect(extractModelSummary(range, [T], 'roi_model').fields[1]).toMatchObject({
      ref: 'B3',
      state: 'ok',
    });
    const noFallback = parseModelSummaryTemplates([
      {
        ...T,
        fields: [{ ...T.fields[1]!, fallbackRef: undefined }, T.fields[0]!],
        warnings: { nonPositive: [], hurdle: null },
      },
    ]);
    const r = extractModelSummary(snap(good()), noFallback, 'roi_model');
    expect(r.status).toBe('partial');
    expect(r.fields[0]).toMatchObject({ key: 'payback', state: 'not_found', ref: 'QF_Payback' });
  });

  it('carries errors, negatives, blanks and text-that-looks-like-a-number through honestly', () => {
    const s = snap({
      Summary: { A1: t('Demo summary'), B2: t('1,000'), B3: n(-1.2) },
      Inputs: { C5: { kind: 'error', code: '#NUM!', formula: true }, C7: t('   ') },
    });
    const r = extractModelSummary(s, [T], 'roi_model');
    expect(r.status).toBe('complete');
    const by = Object.fromEntries(r.fields.map((f) => [f.key, f]));
    expect(by.units).toMatchObject({ state: 'wrong_type', number: null, text: '1,000' });
    expect(by.payback).toMatchObject({ state: 'ok', number: -1.2 });
    expect(by.hurdle).toMatchObject({ state: 'error', number: null, text: '#NUM!' });
    expect(by.start).toMatchObject({ state: 'blank' });
    expect(by.owner).toMatchObject({ state: 'blank' });
    const codes = modelSummaryWarnings('roi_model', r.fields, T).map((w) => [w.code, w.fieldKey]);
    expect(codes).toEqual([
      ['wrong_type', 'units'],
      ['excel_error', 'hurdle'],
      ['non_positive', 'payback'],
    ]);
  });

  it('an error whose code the reader did not see shows as "error"; a non-finite number is an error', () => {
    const s = snap({
      Summary: {
        A1: t('Demo summary'),
        B2: { kind: 'error', code: null, formula: true },
        B3: n(Number.NaN),
      },
      Inputs: {},
    });
    const by = Object.fromEntries(
      extractModelSummary(s, [T], 'roi_model').fields.map((f) => [f.key, f]),
    );
    expect(by.units).toMatchObject({ state: 'error', text: 'error' });
    expect(by.payback).toMatchObject({ state: 'error', text: 'error' });
  });

  it('flags a payback above the hurdle and a zero payback; a blank headline is flagged', () => {
    const above = snap({ ...good(), Summary: { A1: t('demo summary'), B3: n(4) } });
    const w = modelSummaryWarnings(
      'roi_model',
      extractModelSummary(above, [T], 'roi_model').fields,
      T,
    );
    expect(w.map((x) => x.code).sort()).toEqual(['above_hurdle', 'blank']);
    expect(w.find((x) => x.code === 'blank')!.message).toBe(
      'Units is blank in the workbook. Ask Finance to fill it in.',
    );
    const zero = snap({ ...good(), Summary: { ...good().Summary, B3: n(0) } });
    const z = modelSummaryWarnings(
      'roi_model',
      extractModelSummary(zero, [T], 'roi_model').fields,
      T,
    );
    expect(z.map((x) => x.code)).toEqual(['non_positive']);
    expect(z[0]!.message).toMatch(/is zero in the workbook/);
    // Without the map (an Admin removed it): only the per-field warnings.
    expect(
      modelSummaryWarnings('roi_model', extractModelSummary(zero, [T], 'roi_model').fields, null),
    ).toEqual([]);
  });

  it('not calculated: a formula with no cached value is never computed', () => {
    const nc: CellReading = { kind: 'not_calculated' };
    const s = snap({
      Summary: { A1: t('demo summary'), B2: nc, B3: nc },
      Inputs: { C5: nc, C6: nc, C7: nc },
    });
    const r = extractModelSummary(s, [T], 'roi_model');
    expect(r).toMatchObject({
      status: 'unavailable',
      reason: 'not_calculated',
      templateId: 'demo',
    });
    const partial = snap({ ...good(), Summary: { ...good().Summary, B3: nc } });
    const p = extractModelSummary(partial, [T], 'roi_model');
    expect(p.status).toBe('partial');
    expect(modelSummaryWarnings('roi_model', p.fields, T).map((w) => w.code)).toEqual([
      'not_calculated',
    ]);
  });

  it('all fields missing (sheet gone) is unavailable / fields_not_found', () => {
    const s = snap({ Summary: { A1: t('demo summary') } });
    const sOnly = extractModelSummary(s, [{ ...T, fields: [T.fields[2]!] }], 'roi_model');
    expect(sOnly).toMatchObject({ status: 'unavailable', reason: 'fields_not_found' });
  });

  it('not recognised when an active map exists; quietly not configured when none is active', () => {
    const junk = snap({ Sheet1: { A1: t('hello') } });
    expect(extractModelSummary(junk, [T], 'roi_model')).toEqual({
      status: 'unavailable',
      reason: 'not_recognised',
      templateId: null,
      fields: [],
    });
    expect(extractModelSummary(junk, MODEL_SUMMARY_TEMPLATES_SEED, 'cost_model').status).toBe(
      'not_configured',
    );
    expect(extractModelSummary(junk, [T], 'price_table').status).toBe('not_configured');
    // The inactive costing map is not used even on a workbook it would match.
    const erf = snap({
      Summary: { A13: t('Total'), A15: t('Revenue'), A18: t('CM%'), B13: n(1) },
      'ECE SUMMARY': { C2: t('ECE SUMMARY') },
    });
    expect(templateMatches(erf, ERF_COSTING_TEMPLATE_SEED)).toBe(true);
    expect(extractModelSummary(erf, MODEL_SUMMARY_TEMPLATES_SEED, 'cost_model').status).toBe(
      'not_configured',
    );
  });

  it('keeps numbers too large for numeric(18,4) as text, flagged', () => {
    const s = snap({ ...good(), Summary: { ...good().Summary, B2: n(1e15) } });
    const r = extractModelSummary(s, [T], 'roi_model');
    expect(r.fields[0]).toMatchObject({
      state: 'out_of_range',
      number: null,
      text: '1000000000000000',
    });
  });

  it('a date field reads an Excel serial (a formula date), and text in a date field is flagged', () => {
    const s = snap({ ...good(), Inputs: { ...good().Inputs, C6: n(46037) } });
    const start = extractModelSummary(s, [T], 'roi_model').fields.find((f) => f.key === 'start')!;
    expect(start.date!.toISOString().slice(0, 10)).toBe('2026-01-15');
    const bad = snap({ ...good(), Inputs: { ...good().Inputs, C6: t('next spring') } });
    expect(
      extractModelSummary(bad, [T], 'roi_model').fields.find((f) => f.key === 'start'),
    ).toMatchObject({
      state: 'wrong_type',
      text: 'next spring',
    });
  });
});

describe('reason text', () => {
  it('says why in plain words and never quotes the file', () => {
    expect(modelSummaryReasonText('complete', null)).toBeNull();
    expect(modelSummaryReasonText('not_configured', null)).toMatch(/No summary is set up/);
    for (const reason of [
      'not_xlsx',
      'too_large',
      'unreadable',
      'timed_out',
      'not_recognised',
      'not_calculated',
      'fields_not_found',
    ] as const) {
      expect(modelSummaryReasonText('unavailable', reason)).toBeTruthy();
    }
    expect(unavailableSummary('too_large')).toEqual({
      status: 'unavailable',
      reason: 'too_large',
      templateId: null,
      fields: [],
    });
  });
});
