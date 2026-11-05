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
  // FB-02 (F-013): meta.followUps = the fields a picked component asks for (required while picked,
  // cleared when not). Decoration added. Bailey: Pretium's component list isn't final (V-090).
  component: [
    ['CONTAINER', 'Container'],
    ['CLOSURE', 'Closure'],
    ['LINER', 'Liner', { followUps: ['liner_spec'] }],
    ['LABEL', 'Label', { followUps: ['labels_purchased_by'] }],
    ['DECORATION', 'Decoration', { followUps: ['decoration_type', 'decoration_print_colors'] }],
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
  // Retired by FB-02 (F-010): kept, inactive, so older quotes still show their label. The neck is now
  // neck_diameter + neck_finish_type + neck_special_feature (migration 0026 split the stored values).
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
  // FB-02 (F-010): Jim Zweifel's neck lists (Field Inventory, Nov 5; V-073, A-001). "Custom" (meta
  // freeText) needs a short description. All provisional.
  neck_diameter: [
    ...[
      '13',
      '15',
      '18',
      '20',
      '22',
      '24',
      '28',
      '30',
      '33',
      '35',
      '38',
      '40',
      '53',
      '58',
      '60',
    ].map((d): Entry => [d, `${d} mm`]),
    ...['63', '66', '70', '75', '83', '89', '100', '110', '120', '135', '155'].map((d): Entry => [
      d,
      `${d} mm`,
    ]),
    ['409', '409 (120 mm snap)'],
    ['605D', '605D (155 mm snap)'],
    ['CUSTOM', 'Custom', { freeText: true }],
  ],
  neck_finish_type: [
    ['400', '400'],
    ['410', '410'],
    ['415', '415'],
    ['485', '485'],
    ['CRC', 'CRC'],
    ['BERICAP', 'BeriCap'],
    ['DBJ', 'DBJ'],
    ['DEEP_SKIRT', 'Deep Skirt'],
    ['J_CAP', 'J-Cap'],
    ['JIGGER', 'Jigger'],
    ['KERR', 'Kerr'],
    ['PANO', 'Pano'],
    ['PCO_1810', 'PCO-1810'],
    ['PCO_1881', 'PCO-1881 (Super Shorty)'],
    ['RATCHET', 'Ratchet'],
    ['ROPP', 'ROPP'],
    ['SNAP', 'Snap'],
    ['CUSTOM', 'Custom', { freeText: true }],
  ],
  neck_special_feature: [
    ['CT', 'CT (continuous thread)'],
    ['MULTI_LEAD', 'Multi Lead'],
    ['TAMPER_EVIDENT', 'Tamper Evident'],
    ['VENTED', 'Vented'],
    ['CUSTOM', 'Custom', { freeText: true }],
  ],
  // FB-02 (F-055): standard PCR levels Engineering and Supply Chain agreed as a starting point.
  pcr_level: [
    ['0', '0%'],
    ['25', '25%'],
    ['50', '50%'],
    ['100', '100%'],
  ],
  // FB-02 (F-023, Kyle Arnold, Tania Nazario): Custom needs a short description.
  color_type: [
    ['NATURAL', 'Natural'],
    ['CUSTOM', 'Custom color', { freeText: true }],
  ],
  // FB-02 (F-013): who buys the labels.
  labels_purchased_by: [
    ['CUSTOMER', 'Customer'],
    ['PRETIUM', 'Pretium'],
  ],
  // FB-02 (F-013): decoration methods (Bailey: Pretium's component list isn't final, V-090).
  decoration_type: [
    ['SILK_SCREEN', 'Silk screen'],
    ['HOT_STAMP', 'Hot stamp'],
    ['SHRINK_SLEEVE', 'Shrink sleeve'],
    ['OTHER', 'Other'],
  ],
  // B-26 (future-state deck slide 12): how the tooling / capital is funded. Provisional.
  tooling_funding_model: [
    ['COMPANY_FUNDED', 'Company-funded'],
    ['CUSTOMER_FUNDED', 'Customer-funded'],
    ['ZERO_CER', '$0 CER'],
    ['AMORTIZED', 'Amortized'],
  ],
};

/** Lists kept only for history: their rows are seeded inactive (nobody can pick them). */
export const RETIRED_VALUE_LISTS: ReadonlySet<ValueListKey> = new Set(['neck_finish']);

export function valueListRows() {
  return Object.entries(VALUE_LISTS).flatMap(([listKey, entries]) =>
    entries.map(([code, label, meta], i) => ({
      listKey: listKey as ValueListKey,
      code,
      label,
      sort: (i + 1) * 10,
      active: !RETIRED_VALUE_LISTS.has(listKey as ValueListKey),
      meta: meta ?? {},
      provisional: true,
    })),
  );
}

export const seedValueLists = (db: DbOrTx) =>
  upsertConfig(db, valueList, valueListRows(), ['listKey', 'code']);
