import { loadSyntheticFixture } from '../salesforce/fixtures/index';

/**
 * A synthetic pricing-app export with the **real** column headers and the legacy data's quirks, for
 * local dev, seeds and tests (CLAUDE.md rule 8: no real data in the repo). Customers are the SF
 * fixture's synthetic accounts, so the seeded quotes find history by customer name, and every SF
 * opportunity with an ERF number gets an ERF with that number. Deterministic.
 *
 * Quirks reproduced: estimates written as 0 for "blank" (always for FY23+ volume), net capital mostly
 * 0, old "EP" ERF numbers, a duplicated request number, free-text comments, SPRs ending Oct 2025.
 */

type Row = Record<string, string | number | null>;

export interface SyntheticExport {
  erf: Row[];
  bpr: Row[];
  spr: Row[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const stamp = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)} 10:15:00.000`;

/** A date in fiscal year `fy` (Oct–Sep, named by the year it ends), plus `days`. */
function dateIn(r: Rng, fy: number, days = 0): string {
  const month = r.int(1, 12);
  const d = new Date(
    Date.UTC(month >= 10 ? fy - 1 : fy, month - 1, r.int(1, 28)) + days * 86_400_000,
  );
  return stamp(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const MARKETS = ['Food & Beverage', 'Personal Care', 'Household Chemical', 'Pharma', 'Industrial'];
const PROCESSES = ['EBM', 'IBM', 'ISBM', 'IM'];
const RESINS = ['HDPE', 'PET', 'PP', 'LDPE'];
const PLANTS = [
  ['CHI', 'Chicago'],
  ['KCK', 'Kansas City'],
  ['SEY', 'Seymour'],
  ['RCH', 'Richmond'],
] as const;
const ITEMS = [
  '32oz HDPE Round 38-400',
  '1 gal HDPE F-style',
  '16oz PET Boston Round 28-410',
  '64oz LDPE Cylinder',
  '8oz PP Jar 70-400',
];
const PEOPLE = ['Synthetic Seller A', 'Synthetic Seller B', 'Synthetic Seller C'];
const ENGINEERS = ['Synthetic Engineer A', 'Synthetic Engineer B'];
const COMMENTS = [
  'Customer wants samples before PO (synthetic note).',
  'Resin index adjustment quarterly (synthetic note).',
  'Tooling to be amortised over year one (synthetic note).',
];

function common(r: Rng, id: number, number: string, fy: number, customer: string | null) {
  const [code, name] = r.pick(PLANTS);
  return {
    Request_ID: id,
    Request_Number: number,
    Request_Sequence: id % 1000,
    Fiscal_Year: fy,
    Customer: customer,
    Product_Description: r.pick(ITEMS),
    Sales_Person: r.pick(PEOPLE),
    Sales_Person_Email: null,
    Market: r.pick(MARKETS),
    Process: r.pick(PROCESSES),
    Resin: r.pick(RESINS),
    Plant_Code: code,
    Plant_Name: name,
    Comments: r.chance(0.6) ? r.pick(COMMENTS) : null,
    Created_Date: dateIn(r, fy),
  };
}

function erfRow(r: Rng, id: number, number: string, fy: number, customer: string | null): Row {
  const outcome = r.pick(['open', 'accepted', 'rejected', 'abandoned', 'hold'] as const);
  const submitted = dateIn(r, fy);
  const blankVolume = fy >= 2023 || r.chance(0.1);
  const blankRevenue = r.chance(fy >= 2026 ? 0.45 : 0.12);
  return {
    ...common(r, id, number, fy, customer),
    Display_Status: {
      open: 'Proposal Submitted',
      accepted: 'Customer Accepted',
      rejected: 'Customer Rejected',
      abandoned: 'Abandoned',
      hold: 'On Hold',
    }[outcome],
    Is_Open: outcome === 'open' || outcome === 'hold' ? 1 : 0,
    Is_Abandoned: outcome === 'abandoned' ? 1 : 0,
    Is_Customer_Accepted: outcome === 'accepted' ? 1 : 0,
    Is_Customer_Rejected: outcome === 'rejected' ? 1 : 0,
    Is_Corp_Sales_Rejected: 0,
    Is_On_Hold: outcome === 'hold' ? 1 : 0,
    Priority: r.int(1, 10),
    Product_Class: r.pick(['New', 'Existing', 'Modification']),
    Channel: r.chance(0.5) ? r.pick(['Direct', 'Distribution']) : null,
    Machine: r.pick(['Bekum 304', 'Uniloy 350', 'Nissei ASB-70']),
    Lead_Engineer: r.pick(ENGINEERS),
    Est_Revenue: blankRevenue ? 0 : r.int(40, 2_500) * 1_000,
    Est_Volume: blankVolume ? 0 : r.int(100, 20_000) * 1_000,
    Est_Net_Capital: r.chance(0.8) ? 0 : r.int(50, 900) * 1_000,
    Decision_Type:
      outcome === 'accepted'
        ? 'Customer Accepted'
        : outcome === 'rejected'
          ? 'Customer Rejected'
          : null,
    Decision_By: outcome === 'accepted' || outcome === 'rejected' ? r.pick(PEOPLE) : null,
    Decision_Date: outcome === 'accepted' || outcome === 'rejected' ? dateIn(r, fy, 60) : null,
    Decision_Reason: outcome === 'rejected' ? r.pick(['Price', 'Timing', 'Capacity']) : null,
    Engineering_Comments: r.chance(0.2) ? 'Needs a new mould base (synthetic note).' : null,
    Price_Confirmation: r.chance(0.5)
      ? 'Confirmed at the quarterly resin index (synthetic).'
      : null,
    Attachment_Count: r.int(0, 6),
    Sales_Submitted_Date: submitted,
    Engineer_Assigned_Date: dateIn(r, fy, 5),
    ECE_Complete_Approved_Date: r.chance(0.8) ? dateIn(r, fy, 20) : null,
    Price_Confirmed_Date: r.chance(0.7) ? dateIn(r, fy, 35) : null,
    Proposal_Submitted_Date: r.chance(0.5) ? dateIn(r, fy, 45) : null,
    Finalized_Contract_Date: outcome === 'accepted' ? dateIn(r, fy, 90) : null,
    Days_Submitted_To_Engineer_Assigned: r.int(1, 20),
    Days_Submitted_To_ECE_Approved: r.int(10, 60),
    Days_Submitted_To_Price_Confirmed: r.chance(0.7) ? r.int(20, 120) : null,
    Days_First_To_Last_Status: r.int(20, 400),
  };
}

/** The synthetic export (fresh copy). */
export function syntheticPricingExport(): SyntheticExport {
  const r = rng(20_261_022);
  const sf = loadSyntheticFixture();
  const accountName = new Map(sf.accounts.map((a) => [String(a.Id), String(a.Name)]));
  const erf: Row[] = [];
  const bpr: Row[] = [];
  const spr: Row[] = [];
  let id = 100_000;
  let seq = 1;

  // An ERF for every SF opportunity that carries an ERF number (so seeded refs resolve).
  for (const o of sf.opportunities) {
    const n = typeof o.ERF_Number__c === 'string' ? o.ERF_Number__c.trim() : '';
    if (!n) continue;
    const customer =
      ((o.Account as Record<string, unknown> | undefined)?.Name as string | undefined) ??
      accountName.get(String(o.AccountId)) ??
      null;
    erf.push(erfRow(r, id++, n, 2026, customer));
  }
  for (const a of sf.accounts) {
    const customer = String(a.Name);
    // History in the export's own numbering: ERF<yy>-<seq>, and EP<yy>-<seq> before FY2010.
    for (let i = r.int(0, 3); i > 0; i--) {
      const fy = r.int(2008, 2026);
      const prefix = fy < 2010 ? 'EP' : 'ERF';
      erf.push(erfRow(r, id++, `${prefix}${pad(fy % 100)}-${pad(seq++, 3)}`, fy, customer));
    }
    for (let i = r.int(0, 4); i > 0; i--) {
      const fy = r.int(2012, 2026);
      const price = r.chance(0.06) ? 0 : r.int(80, 900) / 1000;
      bpr.push({
        ...common(r, id++, `BPR${pad(fy % 100)}-${pad(seq++, 4)}`, fy, customer),
        Display_Status: r.chance(0.9) ? 'Price Updated in Oracle' : 'Abandoned',
        Is_Open: 0,
        Is_Abandoned: 0,
        Is_Workflow_Complete: 1,
        BPR_Type: r.pick(['New Item', 'Price Change']),
        Item_Number: `SYN-${r.int(10_000, 99_999)}`,
        Packout: `${r.int(50, 400)} per case`,
        Price_Agreed_To: price,
        Est_Revenue: r.chance(0.3) ? 0 : r.int(10, 900) * 1_000,
        Est_Volume: r.chance(0.35) ? 0 : r.int(50, 9_000) * 1_000,
        Sales_Submitted_Date: dateIn(r, fy),
        Price_Confirmed_Date: dateIn(r, fy, 4),
        Price_Updated_In_Oracle_Date: dateIn(r, fy, 9),
        Days_Submitted_To_Price_Confirmed: r.int(1, 12),
        CS_Setup_Text: r.chance(0.5) ? 'Set up on the existing item (synthetic).' : null,
        Abandoned_Reason: null,
      });
    }
    if (r.chance(0.5)) {
      for (let i = r.int(1, 3); i > 0; i--) {
        const fy = r.int(2010, 2025);
        const current = r.int(100, 900) / 1000;
        spr.push({
          ...common(r, id++, `SPR${pad(fy % 100)}-${pad(seq++, 3)}`, fy, customer),
          Created_Date: fy === 2025 ? stamp(2025, 10, 15) : dateIn(r, fy),
          Display_Status: r.pick(['Price Confirmed', 'Abandoned', 'Customer Accepted']),
          Is_Open: 0,
          Is_Abandoned: 0,
          Is_Customer_Accepted: r.chance(0.4) ? 1 : 0,
          Is_Customer_Rejected: 0,
          Is_Corp_Sales_Rejected: 0,
          Is_On_Hold: 0,
          SPR_Type: r.pick(['Stock', 'Distributor']),
          Item_Number: `SYN-${r.int(10_000, 99_999)}`,
          Competitor_Name: r.chance(0.3) ? 'Competitor (synthetic)' : null,
          Competitive_Offer: null,
          Current_Price: current,
          Target_Price: r.chance(0.2) ? 0 : Math.round(current * 900) / 1000,
          Est_Annual_Revenue: r.chance(0.2) ? null : r.int(5, 400) * 1_000,
          Est_Annual_Unit_Volume: r.int(10, 900) * 1_000,
          Decision_Type: null,
          Decision_By: null,
          Decision_Date: null,
          Decision_Reason: null,
        });
      }
    }
  }
  // The real export repeats a few request numbers (different Request_IDs): keep one such case.
  const dup = erf.find((e) => String(e.Request_Number).startsWith('ERF'));
  if (dup) erf.push({ ...dup, Request_ID: id++, Comments: 'Re-entered request (synthetic).' });
  return { erf, bpr, spr };
}

/** The synthetic export as workbook sheets, named like the real file. */
export const syntheticExportSheets = (x: SyntheticExport = syntheticPricingExport()) => [
  { name: 'BPR Export', rows: x.bpr },
  { name: 'ERF Export', rows: x.erf },
  { name: 'SPR Export', rows: x.spr },
];
