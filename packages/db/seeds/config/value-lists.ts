import { upsertConfig } from './_upsert';
import type { DbOrTx } from '../../src/client';
import type { ValueListKey } from '../../src/schema/enums';
import { valueList } from '../../src/schema/index';

type Entry = [code: string, label: string, meta?: Record<string, unknown>];

/**
 * Value lists from the ERF Template Rev D (2026-03-17). All provisional until confirmed at M4
 * (Jim Zweifel, Danielle Leu).
 */
export const VALUE_LISTS: Record<ValueListKey, Entry[]> = {
  process_type: [
    ['EBM', 'EBM'],
    ['RHB', 'RHB'],
    ['IBM', 'IBM'],
    ['IMM', 'IMM'],
    ['IMM_PREFORM', 'IMM Preform'],
    ['ISBM', 'ISBM'],
    ['ASSEMBLY', 'Assembly'],
    ['OTHER', 'Other'],
  ],
  // TODO(M4): the ERF template has 11 resins; replace with the exact template list from Danielle Leu.
  resin: [
    ['HDPE', 'HDPE'],
    ['PET', 'PET'],
    ['PP', 'PP'],
    ['LDPE', 'LDPE'],
    ['PCR_HDPE', 'PCR-HDPE'],
    ['PCR_PET', 'PCR-PET'],
    ['PETG', 'PETG'],
    ['PVC', 'PVC'],
    ['PS', 'PS'],
    ['BIO_RESIN', 'Bio-resin'],
    ['OTHER', 'Other'],
  ],
  // TODO(M4): placeholder markets; confirm the list.
  market: [
    ['FOOD', 'Food'],
    ['BEVERAGE', 'Beverage'],
    ['NUTRITION', 'Nutrition/Supplements'],
    ['PERSONAL_CARE', 'Personal Care'],
    ['HOUSEHOLD_CHEMICAL', 'Household Chemical'],
    ['PHARMA_HEALTH', 'Pharma/Health'],
    ['INDUSTRIAL_CHEMICAL', 'Industrial/Chemical'],
    ['PET', 'Pet'],
  ],
  product_family: [
    ['BOTTLE', 'Bottle'],
    ['JAR', 'Jar'],
    ['CLOSURE', 'Closure'],
    ['PREFORM', 'Preform'],
    ['CANISTER_TUB', 'Canister/Tub'],
    ['HANDLEWARE', 'Handleware'],
    ['OTHER', 'Other'],
  ],
  component: [
    ['CONTAINER', 'Container'],
    ['CLOSURE', 'Closure'],
    ['LINER', 'Liner'],
    ['LABEL', 'Label'],
    ['OTHER', 'Other'],
  ],
  request_class: [
    ['CCQ', 'CCQ (new business + capital/engineering)'],
    ['STOCK', 'Stock / stock-plus'],
    ['PRICE_INQUIRY', 'Price inquiry / RFP check'],
    ['OTHER_CAPITAL', 'Other capital'],
  ],
  // meta.hasDrawing: the intake's "quotes without a drawing take longer" nudge is silent for these.
  drawing_status: [
    ['HAVE_DRAWING', 'Have drawing', { hasDrawing: true }],
    ['COMING', 'Coming'],
    ['SAMPLE_ONLY', 'Sample only'],
    ['NONE', 'None (quote will take longer)'],
  ],
  // Free-text capable: choosing OTHER lets the KAM type the finish.
  neck_finish: [
    ['28-410', '28-410'],
    ['38-400', '38-400'],
    ['89-400', '89-400'],
    ['110-400', '110-400'],
    ['120-DC', '120 DC'],
    ['OTHER', 'Other', { freeText: true }],
  ],
  packaging_type: [
    ['BULK', 'Bulk'],
    ['BAGGED', 'Bagged'],
    ['TRAYED', 'Trayed'],
    ['PALLETIZED_CUSTOM', 'Palletized-custom'],
    ['OTHER', 'Other'],
  ],
  // TODO(M4): load the ~29 plants from the ERF template.
  plant: [
    ['PLANT_01', 'Placeholder plant 01'],
    ['PLANT_02', 'Placeholder plant 02'],
    ['PLANT_03', 'Placeholder plant 03'],
  ],
  // TODO(M4): placeholder machine types for Engineering Review; confirm with Jim Zweifel.
  machine_type: [
    ['EBM_SHUTTLE', 'EBM shuttle'],
    ['EBM_WHEEL', 'EBM wheel'],
    ['IBM_PRESS', 'IBM press'],
    ['ISBM_1STEP', 'ISBM single-stage'],
    ['ISBM_2STEP', 'ISBM two-stage'],
    ['INJECTION_PRESS', 'Injection press'],
    ['OTHER', 'Other'],
  ],
};

export function valueListRows() {
  return Object.entries(VALUE_LISTS).flatMap(([listKey, entries]) =>
    entries.map(([code, label, meta], i) => ({
      listKey: listKey as ValueListKey,
      code,
      label,
      sort: (i + 1) * 10,
      active: true,
      meta: meta ?? {},
      provisional: true,
    })),
  );
}

export const seedValueLists = (db: DbOrTx) =>
  upsertConfig(db, valueList, valueListRows(), ['listKey', 'code']);
