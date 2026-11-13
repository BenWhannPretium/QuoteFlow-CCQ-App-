import { upsertConfig } from './_upsert';
import {
  MACHINE_TYPES,
  PLANT_LIST_APPROVED_AT,
  PLANT_LIST_APPROVER,
  PLANTS,
  plantCode,
  RETIRED_MACHINE_TYPES,
  RETIRED_PLANTS,
} from './plants';
import type { DbOrTx } from '../../src/client';
import type { ValueListKey } from '../../src/schema/enums';
import { valueList } from '../../src/schema/index';

export const ZERO_CER_HELP =
  'Follows the standard quoting process. The capital is reimbursed by the customer as a lump sum or through amortization, and is approved after award like company-funded capital. At purchasing, the customer invoice or contract goes with the mold PO.';
// FB-15 (W13-09): the customer's share is now its own field ("Customer share %"). Provisional wording.
export const SHARED_HELP =
  "Pretium and the customer each pay part. Enter the customer's share; Pretium covers the rest.";
// Bailey Schmitt (2026-11-12): every funding option is explained, Amortized above all. Provisional wording.
export const COMPANY_FUNDED_HELP = 'Pretium pays for the tooling.';
export const CUSTOMER_FUNDED_HELP = 'The customer pays for the tooling up front.';
export const AMORTIZED_HELP =
  'The customer pays for the tooling over time: its cost is spread across an agreed volume and added to the piece price, instead of being paid up front.';

/** FB-11 (F-080, Gemma Cebolla): the sales-tax and contract note shown when the customer funds tooling. */
export const NOT_DISCUSSED_HELP =
  'The customer has not said whether it will pay for any of the tooling or capital. Leave this if it has not come up; you can change it later on the Commercial panel.';

type Entry = [code: string, label: string, meta?: Record<string, unknown>];

/** FB-12 (Melanie Rasche, 2026-11-09): who approved the market list; recorded in `meta.approvedByName`. */
export const MARKET_APPROVER = 'Melanie Rasche';
export const MARKET_APPROVED_AT = new Date('2026-11-09T18:00:00Z');

/** The five retired market codes (kept inactive) and the market they became (markets.md, "Old market codes"). */
export const RETIRED_MARKETS = [
  'NUTRITION',
  'HOUSEHOLD_CHEMICAL',
  'PHARMA_HEALTH',
  'INDUSTRIAL_CHEMICAL',
  'PET',
] as const;

/** The 30 sub-markets: [market code, sub-market code, label], in markets.md order. */
export const SUB_MARKETS: readonly [market: string, code: string, label: string][] = [
  ['FOOD', 'FOOD_CONDIMENTS', 'Condiments, Sauces & Dressings'],
  ['FOOD', 'FOOD_FERMENTED', 'Fermented Foods'],
  ['FOOD', 'FOOD_HONEY_SWEETENERS', 'Honey & Sweeteners'],
  ['FOOD', 'FOOD_SNACKS', 'Snacks & Confections'],
  ['FOOD', 'FOOD_NUT_BUTTERS', 'Nut Butters & Spreads'],
  ['FOOD', 'FOOD_OILS', 'Oils'],
  ['FOOD', 'FOOD_SPICES', 'Spices, Seasonings & Extracts'],
  ['BEVERAGE', 'BEV_NON_ALCOHOLIC', 'Non-Alcoholic'],
  ['BEVERAGE', 'BEV_SPIRITS_MIXERS', 'Spirits & Mixers'],
  ['NUTRITION_WELLNESS', 'NW_LIQUID_SUPPLEMENTS', 'Liquid Supplements'],
  ['NUTRITION_WELLNESS', 'NW_NUTRITIONAL_POWDERS', 'Nutritional Powders'],
  ['NUTRITION_WELLNESS', 'NW_READY_TO_DRINK', 'Ready-to-Drink'],
  ['NUTRITION_WELLNESS', 'NW_VMS', 'VMS'],
  ['OTC_HEALTH', 'OTC_CONSUMER_HEALTH', 'Consumer Health'],
  ['CLINICAL', 'CLIN_LIFE_SCIENCES', 'Life Sciences'],
  ['CLINICAL', 'CLIN_SPECIMEN_CONTAINERS', 'Specimen Containers'],
  ['CLINICAL', 'CLIN_SWABS', 'Swabs'],
  ['CLINICAL', 'CLIN_HISTOLOGY', 'Histology'],
  ['CLINICAL', 'CLIN_TUBES_VIALS', 'Tubes & Vials'],
  ['PERSONAL_CARE', 'PC_BATH_SHOWER', 'Bath & Shower'],
  ['PERSONAL_CARE', 'PC_HAIR', 'Hair Care'],
  ['PERSONAL_CARE', 'PC_SKIN', 'Skin Care'],
  ['HOME_CARE', 'HC_CLEANING', 'Cleaning Supplies'],
  ['HOME_CARE', 'HC_PEST_CONTROL', 'Pest Control'],
  ['HOME_CARE', 'HC_LAWN_GARDEN', 'Lawn & Garden'],
  ['HOME_CARE', 'HC_NON_CORE', 'Non-Core'],
  ['HOME_CARE', 'HC_PET_CARE', 'Pet Care'],
  ['AUTO_COMMERCIAL_CHEMICAL', 'ACC_AUTO_CARE', 'Auto Care'],
  ['AUTO_COMMERCIAL_CHEMICAL', 'ACC_AG_CROP', 'Ag & Crop Management'],
  ['AUTO_COMMERCIAL_CHEMICAL', 'ACC_COMMERCIAL_CHEMICAL', 'Commercial Chemical'],
];

/**
 * Value lists from the ERF Template Rev D (2026-03-17). All provisional until confirmed at M4
 * (Jim Zweifel, Danielle Leu), except product family and resin, which Danielle Leu approved on
 * 2026-11-09 (FB-09, APPROVED_VALUE_LISTS), the markets (Melanie Rasche, FB-12), and the plants and
 * machine types (Jim Zweifel, 2026-11-10, FB-13).
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
  // FB-09: Danielle Leu's list (2026-11-09), approved by her. PCR content lives in pcr_level now.
  resin: [
    ['PET', 'PET'],
    ['HDPE', 'HDPE'],
    ['PP', 'PP'],
    ['LDPE', 'LDPE'],
    ['PS', 'PS'],
    ['OTHER', 'Other', { freeText: true }],
  ],
  // FB-12 (F-020, D-004): Melanie Rasche's market list (Director of Market Development, 2026-11-09;
  // Danielle Leu passed the question to her). Approved, in her order. The five retired codes are kept
  // inactive so old quotes still show their label (`INACTIVE_VALUES`); migration 0037 deactivates them.
  market: [
    ['FOOD', 'Food'],
    ['BEVERAGE', 'Beverage'],
    ['NUTRITION_WELLNESS', 'Nutrition & Wellness'],
    ['OTC_HEALTH', 'OTC Health'],
    ['CLINICAL', 'Clinical'],
    ['PERSONAL_CARE', 'Personal Care'],
    ['HOME_CARE', 'Home Care'],
    ['AUTO_COMMERCIAL_CHEMICAL', 'Auto & Commercial Chemical'],
    // Retired by FB-12 (old placeholder list); see `MARKET_OLD_TO_NEW` for where each one went.
    ['NUTRITION', 'Nutrition/Supplements'],
    ['HOUSEHOLD_CHEMICAL', 'Household Chemical'],
    ['PHARMA_HEALTH', 'Pharma/Health'],
    ['INDUSTRIAL_CHEMICAL', 'Industrial/Chemical'],
    ['PET', 'Pet'],
  ],
  // FB-12 (F-073, D-004): the sub-market under a market, in Melanie Rasche's order (2026-11-09). `meta.market`
  // is the parent market code. PROVISIONAL until she answers the open questions in
  // docs/build-guide/feedback/inputs/markets.md (Sun Care not listed; what Home Care > Non-Core means;
  // Histology and Tubes & Vials are not on the 9-box). The points live in the scoring model, not here.
  sub_market: SUB_MARKETS.map(([market, code, label]): Entry => [code, label, { market }]),
  product_family: [
    ['BOTTLE', 'Bottle'],
    ['JAR', 'Jar'],
    ['CLOSURE', 'Closure'],
    ['PREFORM', 'Preform'],
    ['CANISTER_TUB', 'Canister/Tub'],
    ['HANDLEWARE', 'Handleware'],
    // FB-15 (W13-03): "Other" asks what it is. Only this behaviour flag is new: the approved values are unchanged.
    ['OTHER', 'Other', { freeText: true }],
  ],
  // FB-02 (F-013): meta.followUps = the fields a picked component asks for (required while picked,
  // cleared when not). Decoration added. Bailey: Pretium's component list isn't final (V-090).
  component: [
    ['CONTAINER', 'Container'],
    ['CLOSURE', 'Closure'],
    ['LINER', 'Liner', { followUps: ['liner_spec'] }],
    ['LABEL', 'Label', { followUps: ['labels_purchased_by'] }],
    ['DECORATION', 'Decoration', { followUps: ['decoration_type', 'decoration_print_colors'] }],
    // FB-15 (W13-03): "Other" asks what the component is.
    ['OTHER', 'Other', { freeText: true }],
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
  // neck_diameter + neck_finish_type + neck_special_feature (migration 0028 split the stored values).
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
    // FB-09 (F-012, D-016 default): reserved for customer-dictated packaging; the note is then required.
    ['OTHER', 'Other', { freeText: true }],
  ],
  // FB-13 (F-057): the 22 locations exactly as Jim Zweifel sent them (2026-11-10), approved. `meta.machineTypes`
  // is the machine-type codes at that location (data, not code). The three placeholders are kept inactive so
  // old quotes still show their label (`INACTIVE_VALUES`); migration 0039 deactivates them in existing
  // environments.
  plant: [
    ...PLANTS.map((p): Entry => [plantCode(p.name), p.name, { machineTypes: [...p.machineTypes] }]),
    ['PLANT_01', 'Placeholder plant 01'],
    ['PLANT_02', 'Placeholder plant 02'],
    ['PLANT_03', 'Placeholder plant 03'],
  ],
  // FB-13 (F-057): Jim Zweifel's machine types (2026-11-10), approved, labels as sent. The old placeholders
  // are kept inactive (EBM_WHEEL since FB-03).
  machine_type: [
    ...MACHINE_TYPES.map(([code, label]): Entry => [code, label]),
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
    ['0', '0% / Virgin'],
    ['25', '25%'],
    ['30', '30%'],
    ['50', '50%'],
    ['100', '100%'],
    ['OTHER', 'Other', { freeText: true }],
  ],
  // FB-09: Danielle Leu's additive list (2026-11-09). Provisional: no named owner yet (ask Bailey).
  additive: [
    ['NONE', 'None'],
    ['UV', 'UV'],
    ['BARRIER', 'Barrier'],
    ['ANTISTAT', 'Antistat'],
    ['IMPACT_MODIFIER', 'Impact Modifier'],
    // FB-15 (W13-08, Zachary Cairns): provisional; Engineering confirms it is an additive (W13-W7).
    ['FLUORINATION', 'Fluorination'],
    ['OTHER', 'Other', { freeText: true }],
  ],
  // FB-02 (F-023, Kyle Arnold, Tania Nazario): Custom needs a short description.
  // FB-15 (W13-07, Zachary Cairns): the stock colorants by resin. `meta.resins`: offered only for those resins.
  // HDPE and PP for now (provisional); PET stock colors wait for Seamus's list (W13-W5).
  color_type: [
    ['NATURAL', 'Natural'],
    ['STOCK_WHITE', 'Stock white', { resins: ['HDPE', 'PP'] }],
    ['STOCK_BLACK', 'Stock black', { resins: ['HDPE', 'PP'] }],
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
    // FB-15 (W13-03): "Other" asks what the decoration is.
    ['OTHER', 'Other', { freeText: true }],
  ],
  // B-26 (future-state deck slide 12): how the tooling / capital is funded. Provisional.
  tooling_funding_model: [
    ['COMPANY_FUNDED', 'Company-funded', { helpText: COMPANY_FUNDED_HELP }],
    ['CUSTOMER_FUNDED', 'Customer-funded', { helpText: CUSTOMER_FUNDED_HELP, taxHint: true }],
    // FB-04 (F-022, D-023): Oleg Yarovinski's definition. meta.helpText shows as an (i) next to the option.
    [
      'ZERO_CER',
      '$0 CER (customer-reimbursed capital)',
      { helpText: ZERO_CER_HELP, taxHint: true },
    ],
    ['AMORTIZED', 'Amortized', { helpText: AMORTIZED_HELP, taxHint: true }],
    // FB-04 (V-055, D-003 open): provisional until the terms structure is decided.
    // FB-15 (W13-09): `customerShare` asks for the optional "Customer share %" (provisional).
    [
      'SHARED',
      'Shared (company and customer)',
      { helpText: SHARED_HELP, taxHint: true, customerShare: true },
    ],
    // FB-11 (F-080, D-032): intake only asks WHETHER the customer funds any tooling (not how much or how).
    // `defaultAtIntake`: preselected in the wizard and stored when the KAM doesn't change it.
    ['NOT_DISCUSSED', 'Not discussed', { helpText: NOT_DISCUSSED_HELP, defaultAtIntake: true }],
  ],
  // FB-11 (F-080, Gemma Cebolla, D-032): the payment terms the customer asks for. Provisional (A-012).
  requested_payment_terms: [
    ['NET_15', 'Net 15'],
    ['NET_30', 'Net 30'],
    ['NET_45', 'Net 45'],
    ['NET_60', 'Net 60'],
    ['NET_90', 'Net 90'],
    ['NET_120', 'Net 120'],
    ['OTHER', 'Other', { freeText: true }],
  ],
  // FB-11 (F-080): `delivered` marks the price basis the freight fields apply to.
  price_basis: [
    ['FOB_PLANT', 'FOB Pretium plant'],
    ['DELIVERED', 'Delivered', { delivered: true }],
  ],
  // FB-08 (D-029, Gemma Cebolla, Nov 6): how customer-funded tooling is paid. No quarterly installments.
  // `milestones` (percent + trigger, summing to 100) is shown on the quote; provisional.
  tooling_payment_terms: [
    [
      'UPFRONT',
      'Upfront (100% at the order)',
      { milestones: [{ percent: 100, trigger: 'At the order' }] },
    ],
    [
      'SPLIT_50_50',
      '50/50: at the order and at qualification',
      {
        milestones: [
          { percent: 50, trigger: 'At the order' },
          { percent: 50, trigger: 'At qualification' },
        ],
      },
    ],
    ['AMORTIZED_PER_PIECE', 'Amortized into the per-piece price', { milestones: [] }],
  ],
  // FB-08 (F-068, V-054): who owns the mold. Provisional (D-003).
  mold_ownership: [
    ['PRETIUM', 'Pretium'],
    ['CUSTOMER', 'Customer'],
    ['SHARED', 'Shared (Pretium and customer)'],
  ],
  // FB-11 (F-080): drop trailers and T-bars are costly (Gemma Cebolla); T-bars are rare but very expensive.
  freight_type: [
    ['FLATBED', 'Flatbed'],
    ['VAN', 'Van'],
    ['DROP_TRAILER', 'Drop trailer'],
    ['T_BAR', 'T-bar'],
    // FB-15 (W13-03, Bailey Schmitt): "Other" makes "Special freight arrangements" required.
    ['OTHER', 'Other', { freeText: true }],
  ],
};

/** Lists kept only for history: their rows are seeded inactive (nobody can pick them). */
export const RETIRED_VALUE_LISTS: ReadonlySet<ValueListKey> = new Set(['neck_finish']);

/**
 * Entries kept for old quotes but not offered (`active = false`). FB-03 (F-057): the EBM wheel is gone
 * from the machine type list (migration 0027). FB-13 (F-057): the placeholder plants and machine types
 * (migration 0039).
 */
const INACTIVE_VALUES: ReadonlySet<string> = new Set([
  ...RETIRED_MACHINE_TYPES.map((code) => `machine_type:${code}`),
  ...RETIRED_PLANTS.map((code) => `plant:${code}`),
  // FB-12 (F-020): the retired market codes. Migration 0037 deactivates them in existing environments.
  ...RETIRED_MARKETS.map((code) => `market:${code}`),
]);

/**
 * FB-09: lists a named owner has signed off. Danielle Leu approved product family and resin on 2026-11-09
 * (docs/build-guide/feedback/inputs/value-lists-danielle.md). Migration 0036 does the same in existing
 * environments. `approved_by` is a user id (FK), so the owner's name is kept in `meta.approvedByName`. PCR and additive stay provisional until their owner confirms.
 */
export const APPROVED_VALUE_LISTS: Partial<
  Record<ValueListKey, { approvedByName: string; approvedAt: Date }>
> = {
  product_family: { approvedByName: 'Danielle Leu', approvedAt: new Date('2026-11-09T00:00:00Z') },
  resin: { approvedByName: 'Danielle Leu', approvedAt: new Date('2026-11-09T00:00:00Z') },
};

export function valueListRows() {
  return Object.entries(VALUE_LISTS).flatMap(([listKey, entries]) =>
    entries.map(([code, label, meta], i) => ({
      listKey: listKey as ValueListKey,
      code,
      label,
      sort: (i + 1) * 10,
      active:
        !RETIRED_VALUE_LISTS.has(listKey as ValueListKey) &&
        !INACTIVE_VALUES.has(`${listKey}:${code}`),
      // `approved_by` is a user id (FK to app_user), so the owner's name goes in meta until that user exists.
      meta: {
        ...(meta ?? {}),
        ...(ownerApproval(listKey, code)
          ? { approvedByName: ownerApproval(listKey, code)!.approvedByName }
          : {}),
      },
      // FB-09: product family and resin (Danielle Leu). FB-12: the active markets (Melanie Rasche).
      // FB-13: the active plants and machine types (Jim Zweifel). Everything else is provisional.
      ...(ownerApproval(listKey, code)
        ? { provisional: false, approvedAt: ownerApproval(listKey, code)!.approvedAt }
        : { provisional: true }),
    })),
  );
}

/**
 * The 8 active markets are approved by Melanie Rasche. `approved_by` is a user id (FK to app_user) and she
 * is not an app user, so her name is kept in `meta.approvedByName` and `approved_by` stays null.
 */
function isApprovedMarket(listKey: string, code: string): boolean {
  return listKey === 'market' && !INACTIVE_VALUES.has(`market:${code}`);
}

/** FB-13: the active plants and machine types are approved by Jim Zweifel (the placeholders stay as they are). */
function isApprovedPlantOrMachine(listKey: string, code: string): boolean {
  return (
    (listKey === 'plant' || listKey === 'machine_type') &&
    !INACTIVE_VALUES.has(`${listKey}:${code}`)
  );
}

/** Who signed off this entry's list, if anyone: FB-09's APPROVED_VALUE_LISTS, FB-12's markets, FB-13's plants. */
function ownerApproval(
  listKey: string,
  code: string,
): { approvedByName: string; approvedAt: Date } | null {
  const list = APPROVED_VALUE_LISTS[listKey as ValueListKey];
  if (list) return list;
  if (isApprovedPlantOrMachine(listKey, code)) {
    return { approvedByName: PLANT_LIST_APPROVER, approvedAt: PLANT_LIST_APPROVED_AT };
  }
  return isApprovedMarket(listKey, code)
    ? { approvedByName: MARKET_APPROVER, approvedAt: MARKET_APPROVED_AT }
    : null;
}

export const seedValueLists = (db: DbOrTx) =>
  upsertConfig(db, valueList, valueListRows(), ['listKey', 'code']);
