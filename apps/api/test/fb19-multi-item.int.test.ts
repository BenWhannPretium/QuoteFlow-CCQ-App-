/**
 * FB-19 (W13-32 to W13-34, F-084, D-005 provisional): multi-item quotes on the server. One quote number,
 * one KAM, one opportunity and one workflow; several items quoted together. Synthetic data only; its own
 * database so the free SF opportunities go further.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AdminSettingsResponse,
  DEV_USER_HEADER,
  EngQueueResponse,
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  ReviewSummary,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  type IntakeDraftData,
  type IntakeItemData,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole, personaFor } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let filesRoot = '';
const clock = new Date('2026-11-16T15:00:00Z');

let free: string[] = [];
const nextFree = () => {
  const id = free.shift();
  if (!id) throw new Error('test ran out of free opportunities');
  return id;
};
const as = (role: Role, scope?: 'all' | 'owner') => asRole(app, role, scope);
const kam = () => as('KAM');
const ids: Record<string, string> = {};
async function userId(role: Role, scope: 'all' | 'owner' = 'all'): Promise<string> {
  const key = `${role}:${scope}`;
  ids[key] ??= MeResponse.parse((await as(role, scope).get('/api/v1/me')).json()).user.id;
  return ids[key];
}
const ok = (res: { statusCode: number; body: string }, status = 200) =>
  expect(res.statusCode, res.body).toBe(status);

const KEY = (n: number) => `0193f2a0-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PDF = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj << >> endobj\n%%EOF\n', 'latin1');

/** The request fields of a complete intake on `sfOpportunityId`. */
async function request(sfOpportunityId: string, role: Role = 'KAM', scope?: 'all' | 'owner') {
  const sf = SfOpportunityDetail.parse(
    (await as(role, scope).get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`)).json(),
  );
  const shipTo = {
    line1: '1 Test St',
    city: 'Testville',
    state: 'MO',
    postal: '63101',
    country: 'US',
  };
  return {
    sfOpportunityId,
    sfOpportunityName: sf.opportunity.name,
    customer: {
      status: 'existing' as const,
      sfAccountId: sf.account?.id ?? sf.opportunity.accountId,
      name: sf.account?.name ?? sf.opportunity.accountName,
    },
    shipTo,
    shipToDefault: shipTo,
    requestClass: 'CCQ',
    market: 'FOOD',
    subMarket: 'FOOD_SNACKS',
    estAnnualRevenue: 300_000,
    quoteNeededBy: '2026-12-15',
  } satisfies IntakeDraftData;
}

/** A complete item (its drawing status says a drawing exists; the minimum spec is filled too). */
const item = (key: string, over: Partial<IntakeItemData> = {}): IntakeItemData => ({
  key,
  label: '16 oz bottle',
  productFamily: 'BOTTLE',
  components: ['CONTAINER'],
  resin: 'HDPE',
  neckDiameter: '38',
  neckFinishType: '400',
  pcrLevel: '0',
  colorType: 'NATURAL',
  heightMm: 180,
  widthOrDiameterMm: 65,
  depthMm: 65,
  gramWeightG: 24,
  packagingType: 'BULK',
  estAnnualVolume: 750_000,
  productNeededBy: '2027-03-01',
  containerSize: '16 oz',
  standardDescription: '16 oz Bottle, HDPE',
  drawingStatus: 'HAVE_DRAWING',
  ...over,
});

/** Three items: a 16 oz, a 24 oz, and a duplicate of the 24 oz at another PCR % (W13-34). */
const threeItems = (): IntakeItemData[] => [
  item(KEY(1)),
  item(KEY(2), {
    label: '24 oz bottle',
    containerSize: '24 oz',
    estAnnualVolume: 600_000,
    gramWeightG: 31,
    productNeededBy: '2027-04-01',
  }),
  item(KEY(3), {
    label: '24 oz bottle 25% PCR',
    containerSize: '24 oz',
    estAnnualVolume: 750_000,
    pcrLevel: '25',
    duplicatedFrom: KEY(2),
  }),
];

async function createDraft(data: IntakeDraftData, role: Role = 'KAM', scope?: 'all' | 'owner') {
  const res = await as(role, scope).post('/api/v1/quotes/drafts', { data });
  ok(res, 201);
  return IntakeDraft.parse(res.json());
}
const submit = (id: string, role: Role = 'KAM', scope?: 'all' | 'owner') =>
  as(role, scope).post(`/api/v1/quotes/drafts/${id}/submit`);

async function submitThree() {
  const draft = await createDraft({ ...(await request(nextFree())), items: threeItems() });
  expect(draft.evaluation.blocking).toEqual([]);
  const res = await submit(draft.id);
  ok(res, 201);
  return { ...SubmitIntakeResponse.parse(res.json()), draft };
}

const items = (quoteId: string) =>
  db.db
    .select()
    .from(schema.quoteItem)
    .where(eq(schema.quoteItem.quoteId, quoteId))
    .orderBy(asc(schema.quoteItem.itemNo));
const detail = async (qn: string, role: Role = 'EngLead') => {
  const res = await as(role).get(`/api/v1/quotes/${qn}`);
  ok(res);
  return QuoteDetail.parse(res.json());
};

async function patchSetting(key: string, value: unknown) {
  const list = await as('Admin').get('/api/v1/admin/config/settings');
  ok(list);
  const current = AdminSettingsResponse.parse(list.json()).items.find((s) => s.key === key)!;
  const res = await as('Admin').patch(`/api/v1/admin/config/settings/${key}`, {
    version: current.version,
    changeReason: 'FB-19 integration test',
    value,
  });
  ok(res);
}

function multipart(fields: Record<string, string>, file: { name: string; content: Buffer }) {
  const boundary = `----ccq${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    file.content,
    Buffer.from('\r\n'),
    Buffer.from(`--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
const uploadDrawing = (url: string, fields: Record<string, string>, role: Role = 'KAM') => {
  const body = multipart(
    { kind: 'bottle_drawing', size: String(PDF.length), ...fields },
    { name: 'drawing.pdf', content: PDF },
  );
  return app.inject({
    method: 'POST',
    url,
    headers: { [DEV_USER_HEADER]: personaFor(role), 'content-type': body.contentType },
    payload: body.payload,
  });
};

beforeAll(async () => {
  const fresh = await freshSfDatabase('fb19_multi_item');
  db = fresh.client;
  filesRoot = await mkdtemp(join(tmpdir(), 'ccq-fb19-'));
  app = await buildApp(
    testConfig({
      DATABASE_URL: fresh.url,
      RATE_LIMIT_MAX: '100000',
      FILESTORE_LOCAL_DIR: join(filesRoot, 'local'),
    }),
    { db, now: () => clock },
  );
  await app.ready();
  const rows = await db.db.execute<{ id: string }>(sql`
    select s.sf_opportunity_id as id from sf_opportunity_snapshot s
    where not s.is_closed and s.account_id is not null
      and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
    order by s.sf_opportunity_id`);
  free = rows.map((r) => r.id);
  expect(free.length).toBeGreaterThanOrEqual(14);
}, 180_000);
afterAll(async () => {
  await app.close();
  await rm(filesRoot, { recursive: true, force: true });
});

describe('W13-32: one quote number, several items, quoted together', () => {
  it('submits three items: the items, the quote mirror, the audit and the summary', async () => {
    const out = await submitThree();
    const rows = await items(out.quoteId);
    expect(rows.map((r) => [r.itemNo, r.label, r.containerSize, r.estAnnualVolume])).toEqual([
      [1, '16 oz bottle', '16 oz', 750_000],
      [2, '24 oz bottle', '24 oz', 600_000],
      [3, '24 oz bottle 25% PCR', '24 oz', 750_000],
    ]);
    // Decision 6: the quote mirrors item 1 and sums the volumes.
    const [q] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
    expect(q).toMatchObject({
      productFamily: 'BOTTLE',
      resin: 'HDPE',
      pcrLevel: '0',
      estAnnualVolume: 2_100_000,
      estAnnualVolumeConfirmed: false,
      productNeededBy: '2027-03-01',
      estAnnualRevenue: 300_000,
    });
    expect(q!.structuredDescription).toMatchObject({
      size: '16 oz',
      standard: '16 oz Bottle, HDPE',
    });
    // Every item's creation is audited; the duplicate names its source (the quote item, not the key).
    const audit = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.quoteId, out.quoteId), eq(schema.auditEvent.entity, 'quote_item')),
      );
    expect(audit).toHaveLength(3);
    const copy = audit.find((a) => (a.after as { itemNo?: number }).itemNo === 3)!;
    expect((copy.after as { duplicatedFrom?: string }).duplicatedFrom).toBe(rows[1]!.id);
    // The submitted draft keeps its items, keyed by the quote item ids.
    const [draft] = await db.db
      .select()
      .from(schema.quoteDraft)
      .where(eq(schema.quoteDraft.id, out.draft.id));
    expect((draft!.data as IntakeDraftData).items!.map((i) => i.key)).toEqual(
      rows.map((r) => r.id),
    );
    // The quote page: the items, the count, "16 oz bottle + 2 more", and the breakdown.
    const d = await detail(out.quoteNumber, 'KAM');
    expect(d.itemCount).toBe(3);
    expect(d.itemsSummary).toBe('16 oz bottle + 2 more');
    expect(d.items.map((i) => i.name)).toEqual([
      'Item 1 (16 oz bottle)',
      'Item 2 (24 oz bottle)',
      'Item 3 (24 oz bottle 25% PCR)',
    ]);
    expect(d.priority.breakdown.find((b) => b.key === 'volume')?.explanation).toMatch(
      /^3 items, 2\.1 M units a year in total: /,
    );
  });

  it('checks the request once and each item, naming the item (and a 422 names it too)', async () => {
    const three = threeItems();
    three[1] = { ...three[1]!, resin: null };
    const draft = await createDraft({ ...(await request(nextFree())), market: null, items: three });
    const resin = draft.evaluation.blocking.filter((b) => b.field === 'resin');
    expect(resin.map((b) => b.item)).toEqual([2]);
    expect(resin[0]!.message).toMatch(/^Item 2 \(24 oz bottle\): /);
    const market = draft.evaluation.blocking.filter((b) => b.field === 'market');
    expect(market.map((b) => b.item)).toEqual([undefined]);
    const res = await submit(draft.id);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ errors: { path: string; item?: number }[] }>().errors).toContainEqual(
      expect.objectContaining({ path: 'resin', item: 2 }),
    );
  });

  it('refuses more items than quote_items_max, and two items with one key (422)', async () => {
    await patchSetting('quote_items_max', 2);
    try {
      const res = await kam().post('/api/v1/quotes/drafts', {
        data: { ...(await request(nextFree())), items: threeItems() },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json<{ code: string }>().code).toBe('invalid_items');
    } finally {
      await patchSetting('quote_items_max', 20);
    }
    const draft = await createDraft({ ...(await request(nextFree())), items: [item(KEY(1))] });
    const dup = await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: { items: [item(KEY(1)), item(KEY(1), { label: 'again' })] },
    });
    expect(dup.statusCode).toBe(422);
  });

  it('a list error on a multi-item draft names the item; a one-item draft reads as before', async () => {
    const draft = await createDraft({ ...(await request(nextFree())), items: threeItems() });
    const bad = await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: {
        items: [
          ...draft.data.items!.slice(0, 2),
          { ...draft.data.items![2]!, resin: 'UNOBTAINIUM' },
        ],
      },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json<{ errors: unknown[] }>().errors).toEqual([
      { path: 'resin', message: 'Pick a resin from the list', item: 3 },
    ]);
  });
});

describe('drawings per item, and Duplicate links the drawings', () => {
  it('a drawing counts for its own item and for the items that link to it; keys become item ids', async () => {
    const data = { ...(await request(nextFree())), items: threeItems() };
    // No drawing yet and no minimum spec on item 2: it blocks; the others do not.
    data.items[1] = { ...data.items[1]!, drawingStatus: 'COMING', heightMm: null };
    data.items[2] = { ...data.items[2]!, drawingStatus: 'COMING', heightMm: null };
    const draft = await createDraft(data);
    expect(
      draft.evaluation.blocking
        .filter((b) => b.code === 'DRAWING_OR_MIN_SPEC_REQUIRED')
        .map((b) => b.item),
    ).toEqual([2, 3]);
    // An unknown item is refused; item 2's drawing goes up with its key.
    const wrong = await uploadDrawing(`/api/v1/quotes/drafts/${draft.id}/attachments`, {
      itemKey: KEY(99),
    });
    expect(wrong.statusCode, wrong.body).toBe(422);
    const up = await uploadDrawing(`/api/v1/quotes/drafts/${draft.id}/attachments`, {
      itemKey: KEY(2),
    });
    ok(up, 201);
    const fileId = up.json<{ item: { id: string; quoteItemId: string } }>().item.id;
    expect(up.json<{ item: { quoteItemId: string } }>().item.quoteItemId).toBe(KEY(2));
    // Item 3 (the duplicate) links to it.
    const linked = await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
      data: {
        items: [
          (
            await IntakeDraft.parseAsync(
              (await kam().get(`/api/v1/quotes/drafts/${draft.id}`)).json(),
            )
          ).data.items![0]!,
          { ...data.items[1], drawingStatus: 'HAVE_DRAWING' },
          { ...data.items[2], linkedDrawingIds: [fileId] },
        ],
      },
    });
    ok(linked);
    expect(IntakeDraft.parse(linked.json()).evaluation.blocking).toEqual([]);
    const res = await submit(draft.id);
    ok(res, 201);
    const out = SubmitIntakeResponse.parse(res.json());
    const rows = await items(out.quoteId);
    const [file] = await db.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.id, fileId));
    expect(file!.quoteItemId).toBe(rows[1]!.id);
    const links = await db.db
      .select()
      .from(schema.quoteItemDrawing)
      .where(eq(schema.quoteItemDrawing.quoteId, out.quoteId));
    expect(links.map((l) => [l.quoteItemId, l.attachmentId])).toEqual([[rows[2]!.id, fileId]]);
  });
});

describe('W13-33: more than one active quote on an opportunity is a setting', () => {
  it('warn (the seed): the KAM sees the open quote and confirms a separate one', async () => {
    const opp = nextFree();
    const first = await submit(
      (await createDraft({ ...(await request(opp)), items: [item(KEY(1))] })).id,
    );
    ok(first, 201);
    const firstNumber = SubmitIntakeResponse.parse(first.json()).quoteNumber;
    const second = await createDraft({
      ...(await request(opp)),
      items: [item(KEY(1), { label: 'hot item' })],
    });
    expect(second.openQuotesMode).toBe('warn');
    expect(second.openQuotes.map((o) => o.quoteNumber)).toEqual([firstNumber]);
    expect(typeof second.openQuotes[0]!.kamName).toBe('string');
    expect(second.openQuoteWarning).toContain(
      `${firstNumber} is already open for this opportunity`,
    );
    // Not confirmed yet: refused, with the open quote named.
    const refused = await submit(second.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: 'active_quote_exists',
      quoteNumber: firstNumber,
      mode: 'warn',
    });
    ok(
      await kam().patch(`/api/v1/quotes/drafts/${second.id}`, {
        data: { separateQuoteConfirmed: true },
      }),
    );
    const done = await submit(second.id);
    ok(done, 201);
    const created = SubmitIntakeResponse.parse(done.json());
    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.quoteId, created.quoteId),
          eq(schema.auditEvent.entity, 'quote'),
          eq(schema.auditEvent.action, 'create'),
        ),
      );
    expect(audit!.after).toMatchObject({ separateFrom: [firstNumber] });
  });

  it('one: refused even when confirmed', async () => {
    await patchSetting('opportunity_active_quotes', 'one');
    try {
      const opp = nextFree();
      ok(
        await submit((await createDraft({ ...(await request(opp)), items: [item(KEY(1))] })).id),
        201,
      );
      const second = await createDraft({
        ...(await request(opp)),
        separateQuoteConfirmed: true,
        items: [item(KEY(1))],
      });
      expect(second.openQuotesMode).toBe('one');
      const res = await submit(second.id);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'active_quote_exists', mode: 'one' });
      // FB-33 (N19-20): the name is spelled out where a KAM is told what blocks the submit.
      expect(JSON.stringify(res.json())).toContain(
        'already has an active Commercial Capital Quote',
      );
    } finally {
      await patchSetting('opportunity_active_quotes', 'warn');
    }
  });

  it("another KAM's quote counts although the caller cannot see it (system context, number and KAM only)", async () => {
    const owner = await userId('KAM', 'owner');
    const [me] = await db.db.select().from(schema.appUser).where(eq(schema.appUser.id, owner));
    // A free synthetic opportunity, owned in Salesforce by the owner-scoped KAM (so they can read it).
    const opp = { id: nextFree() };
    await db.db
      .update(schema.sfOpportunitySnapshot)
      .set({ ownerEmail: me!.email })
      .where(eq(schema.sfOpportunitySnapshot.sfOpportunityId, opp.id));
    // The all-scope KAM opens a quote on it.
    const first = await submit(
      (await createDraft({ ...(await request(opp.id)), items: [item(KEY(1))] })).id,
    );
    ok(first, 201);
    const firstNumber = SubmitIntakeResponse.parse(first.json()).quoteNumber;
    // The owner-scoped KAM cannot read that quote…
    expect((await as('KAM', 'owner').get(`/api/v1/quotes/${firstNumber}`)).statusCode).toBe(404);
    // …but the draft names it (its number and KAM only), and the submit waits for the confirmation.
    const mine = await createDraft(
      { ...(await request(opp.id, 'KAM', 'owner')), items: [item(KEY(1))] },
      'KAM',
      'owner',
    );
    expect(mine.activeQuote).toBeNull();
    expect(mine.openQuotes.map((o) => o.quoteNumber)).toEqual([firstNumber]);
    expect(typeof mine.openQuotes[0]!.kamName).toBe('string');
    expect(Object.keys(mine.openQuotes[0]!).sort()).toEqual(['kamName', 'quoteNumber']);
    expect((await submit(mine.id, 'KAM', 'owner')).statusCode).toBe(409);
  });

  it('two submits at once on one opportunity: one wins under `one` (the transaction lock)', async () => {
    await patchSetting('opportunity_active_quotes', 'one');
    try {
      const opp = nextFree();
      const a = await createDraft({ ...(await request(opp)), items: [item(KEY(1))] });
      const b = await createDraft({ ...(await request(opp)), items: [item(KEY(2))] });
      const results = await Promise.all([submit(a.id), submit(b.id)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      const [n] = await db.db.execute<{ n: number }>(
        sql`select count(*)::int as n from quote where sf_opportunity_id = ${opp} and status <> 'closed'`,
      );
      expect(n!.n).toBe(1);
    } finally {
      await patchSetting('opportunity_active_quotes', 'warn');
    }
  });
});

describe('W13-32/34: Engineering per item; G2 passes only when every item does', () => {
  let qn = '';
  let itemIds: string[] = [];
  const solution = (over: Record<string, unknown> = {}) => ({
    plantCode: 'AURORA',
    machineType: 'EBM',
    cavitation: 8,
    cycleTimeS: 14.5,
    prelimCapitalUsd: 0,
    ...over,
  });
  const row = async (over: Record<string, unknown> = {}) => ({
    site: 'AURORA',
    lineAsset: 'Line 4',
    assumedEffectivenessPct: 70,
    cycleTimeS: 14.5,
    utilizationBeforePct: 62,
    analysisDate: '2026-11-16',
    analystId: await userId('Engineer'),
    ...over,
  });
  const putReview = (body: Record<string, unknown>, role: Role = 'Engineer') =>
    as(role).put(`/api/v1/quotes/${qn}/eng-review`, body);
  const putRows = async (itemId: string | undefined, rows: unknown[], role: Role = 'Engineer') =>
    as(role).put(`/api/v1/quotes/${qn}/capacity-evidence`, { ...(itemId ? { itemId } : {}), rows });

  beforeAll(async () => {
    const out = await submitThree();
    qn = out.quoteNumber;
    itemIds = (await items(out.quoteId)).map((i) => i.id);
    ok(
      await as('SalesLeader').post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
        outcomeKey: 'advance',
      }),
      201,
    );
    ok(
      await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, {
        engineerId: await userId('Engineer'),
      }),
    );
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`));
  });

  it('the tab shows every item with what it still needs; the queue shows the count', async () => {
    const d = await detail(qn);
    expect(d.engineering.items.map((i) => [i.itemNo, i.name, i.annualVolume])).toEqual([
      [1, 'Item 1 (16 oz bottle)', 750_000],
      [2, 'Item 2 (24 oz bottle)', 600_000],
      [3, 'Item 3 (24 oz bottle 25% PCR)', 750_000],
    ]);
    expect(d.engineering.items.every((i) => i.toDo.length > 0)).toBe(true);
    const queue = EngQueueResponse.parse(
      (await as('EngLead').get('/api/v1/queue/engineering')).json(),
    );
    expect(queue.items.find((i) => i.quoteNumber === qn)).toMatchObject({
      itemCount: 3,
      itemsSummary: '16 oz bottle + 2 more',
    });
  });

  it("saves each item's solution and capacity rows on that item only", async () => {
    ok(await putReview(solution({ itemId: itemIds[1], cavitation: 6 })));
    let d = await detail(qn);
    expect(d.engineering.items[1]!.review).toMatchObject({ plantCode: 'AURORA', cavitation: 6 });
    expect(d.engineering.items[0]!.review.plantCode).toBeNull();
    // Omitted: item 1, as a one-item quote has always written.
    ok(await putReview(solution()));
    d = await detail(qn);
    expect(d.engineering.items[0]!.review.cavitation).toBe(8);
    expect(d.engineering.review.cavitation).toBe(8);
    // An item of another quote, or none at all, is refused.
    const wrong = await putReview(solution({ itemId: '0193f2a0-0000-7000-8000-00000000dead' }));
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json<{ errors: { path: string }[] }>().errors[0]!.path).toBe('/itemId');
    // Capacity rows per item; the default allocation and the check use the item's volume.
    ok(await putRows(itemIds[2], [await row()]));
    d = await detail(qn);
    expect(d.engineering.items[2]!.capacityEvidence).toHaveLength(1);
    expect(d.engineering.items[0]!.capacityEvidence).toHaveLength(0);
    ok(await putRows(itemIds[2], [await row({ allocatedAnnualVolume: 100_000 })]));
    d = await detail(qn);
    expect(d.engineering.items[2]!.capacityEvidence).toHaveLength(1);
    expect(d.engineering.items[2]!.allocationWarning).toBeTruthy();
    ok(await putRows(itemIds[2], [await row()]));
  });

  it('the item id does not widen who may write: a KAM and Pricing are refused, the scheduler may save rows', async () => {
    expect((await putReview(solution({ itemId: itemIds[1] }), 'KAM')).statusCode).toBe(403);
    expect((await putReview(solution({ itemId: itemIds[1] }), 'Pricing')).statusCode).toBe(403);
    expect((await putRows(itemIds[1], [await row()], 'Pricing')).statusCode).toBe(403);
  });

  it('G2 and submit-to-lead are refused while one item is incomplete, naming it; then it advances', async () => {
    // Items 1 and 3 complete; item 2 has no capacity row yet.
    ok(await putRows(itemIds[0], [await row()]));
    ok(await putReview(solution({ itemId: itemIds[2] })));
    ok(await as('EngLead').put(`/api/v1/quotes/${qn}/capacity-signoff`, { status: 'approved' }));
    let d = await detail(qn);
    expect(d.engineering.items.map((i) => i.toDo.length)).toEqual([0, 1, 0]);
    const proceed = d.availableActions.find(
      (a) => a.gateKey === 'G2' && a.outcomeKey === 'proceed',
    )!;
    expect(proceed.missing.map((m) => m.message)).toEqual([
      expect.stringMatching(/^Item 2 \(24 oz bottle\): /),
    ]);
    const early = await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/submit`);
    expect(early.statusCode).toBe(422);
    expect(early.body).toContain('Item 2 (24 oz bottle)');
    const refused = await as('EngLead').post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
      outcomeKey: 'proceed',
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toContain('Item 2 (24 oz bottle)');

    // Capital on item 2 only: the BOM is asked for item 2 (any item above the threshold).
    ok(await putReview(solution({ itemId: itemIds[1], prelimCapitalUsd: 50_000 })));
    d = await detail(qn);
    expect(
      d.availableActions
        .find((a) => a.gateKey === 'G2' && a.outcomeKey === 'proceed')!
        .missing.some((m) => /^Item 2 .*BOM/i.test(m.message)),
    ).toBe(true);
    ok(await putReview(solution({ itemId: itemIds[1], prelimCapitalUsd: 0 })));

    ok(await putRows(itemIds[1], [await row()]));
    d = await detail(qn);
    expect(d.engineering.items.map((i) => i.toDo)).toEqual([[], [], []]);
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/submit`));
    const decided = await as('EngLead').post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
      outcomeKey: 'proceed',
    });
    ok(decided, 201);
    // The evidence keeps every item's solution.
    const [g2] = await db.db
      .select()
      .from(schema.gateDecision)
      .where(
        and(eq(schema.gateDecision.gateKey, 'G2'), eq(schema.gateDecision.outcomeKey, 'proceed')),
      )
      .orderBy(asc(schema.gateDecision.decidedAt));
    expect(JSON.stringify(g2!.evidence)).toContain('quote_item_id');
  });

  it('the capacity CSV has an item column; the review summary and the pipeline list the items', async () => {
    const csv = await as('EngLead').get(`/api/v1/quotes/${qn}/capacity-evidence.csv`);
    ok(csv);
    const lines = csv.body.trim().split(/\r?\n/);
    expect(lines[0]).toContain('item');
    expect(lines.slice(1).some((l) => l.includes('Item 2 (24 oz bottle)'))).toBe(true);
    const summary = ReviewSummary.parse(
      (await as('Approver').get(`/api/v1/quotes/${qn}/review-summary`)).json(),
    );
    expect(summary.items.map((i) => [i.itemNo, i.plantLabel, i.machineTypeLabel !== null])).toEqual(
      [
        [1, expect.any(String), true],
        [2, expect.any(String), true],
        [3, expect.any(String), true],
      ],
    );
    const perItem = await as('Admin').get(
      `/api/v1/quotes/export.csv?q=${encodeURIComponent(qn)}&perItem=true`,
    );
    ok(perItem);
    const exported = perItem.body.trim().split(/\r?\n/);
    expect(exported[0]).toContain('Item label');
    expect(exported.filter((l) => l.includes(qn))).toHaveLength(3);
    const plain = await as('Admin').get(`/api/v1/quotes/export.csv?q=${encodeURIComponent(qn)}`);
    expect(
      plain.body
        .trim()
        .split(/\r?\n/)
        .filter((l) => l.includes(qn)),
    ).toHaveLength(1);
  });

  it('analytics_quote_item has a row per item, with no customer data', async () => {
    const rows = await db.db.execute<Record<string, unknown>>(sql`
      select * from analytics_quote_item where quote_number = ${qn} order by item_no`);
    expect(rows.map((r) => [r.item_no, r.item_count, r.est_annual_volume])).toEqual([
      [1, 3, '750000'],
      [2, 3, '600000'],
      [3, 3, '750000'],
    ]);
    expect(Object.keys(rows[0]!).some((k) => /customer|account/.test(k))).toBe(false);
  });
});

describe('W13-32: rework: add, remove and reorder items; removed work is discarded and audited', () => {
  it('the rework draft holds the quote items; removing a worked item discards its work (audited)', async () => {
    const out = await submitThree();
    const qn = out.quoteNumber;
    const before = await items(out.quoteId);
    ok(
      await as('SalesLeader').post(`/api/v1/quotes/${qn}/gates/G1/decisions`, {
        outcomeKey: 'advance',
      }),
      201,
    );
    ok(
      await as('EngLead').post(`/api/v1/quotes/${qn}/assignment`, {
        engineerId: await userId('Engineer'),
      }),
    );
    ok(await as('Engineer').post(`/api/v1/quotes/${qn}/eng-review/accept`));
    // Engineering works item 1 (and accepts: the quote-level field on item 1's row) and item 2.
    ok(
      await as('Engineer').put(`/api/v1/quotes/${qn}/eng-review`, {
        plantCode: 'AURORA',
        machineType: 'EBM',
      }),
    );
    ok(
      await as('Engineer').put(`/api/v1/quotes/${qn}/eng-review`, {
        itemId: before[1]!.id,
        plantCode: 'AURORA',
        machineType: 'EBM',
        cavitation: 4,
      }),
    );
    // Back to the KAM.
    ok(
      await as('EngLead').post(`/api/v1/quotes/${qn}/gates/G2/decisions`, {
        outcomeKey: 'rework',
        reasonCode: 'missing_information',
        note: 'Drop the 24 oz; put the PCR variant first',
      }),
      201,
    );
    const rework = await kam().post(`/api/v1/quotes/${qn}/rework`);
    ok(rework);
    const draft = IntakeDraft.parse(rework.json());
    expect(draft.data.items!.map((i) => i.key)).toEqual(before.map((i) => i.id));
    // Remove item 2, put item 3 first, keep item 1, add a new one.
    const [one, , three] = draft.data.items!;
    ok(
      await kam().patch(`/api/v1/quotes/drafts/${draft.id}`, {
        data: {
          items: [three!, one!, item(KEY(9), { label: '32 oz bottle', containerSize: '32 oz' })],
        },
      }),
    );
    ok(await submit(draft.id), 201);
    const after = await items(out.quoteId);
    expect(after.map((i) => [i.itemNo, i.label])).toEqual([
      [1, '24 oz bottle 25% PCR'],
      [2, '16 oz bottle'],
      [3, '32 oz bottle'],
    ]);
    expect(after[0]!.id).toBe(before[2]!.id);
    expect(after[1]!.id).toBe(before[0]!.id);
    // Item 2's engineering work is gone from the tables and kept in the audit.
    const reviews = await db.db
      .select()
      .from(schema.engReview)
      .where(eq(schema.engReview.quoteId, out.quoteId));
    expect(reviews.some((r) => r.quoteItemId === before[1]!.id)).toBe(false);
    const removal = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.entityId, before[1]!.id),
          eq(schema.auditEvent.entity, 'quote_item'),
        ),
      );
    const removed = removal.find((a) => (a.after as { removed?: boolean }).removed === true)!;
    expect(removed.after).toMatchObject({ removed: true, itemNo: 2, workDiscarded: true });
    expect((removed.before as { engReview: { cavitation: number } }).engReview.cavitation).toBe(4);
    // The quote mirror follows the new item 1; the volume is the new sum.
    const [q] = await db.db.select().from(schema.quote).where(eq(schema.quote.id, out.quoteId));
    expect(q).toMatchObject({ pcrLevel: '25', estAnnualVolume: 750_000 * 3 });
    // The quote-level engineering fields moved to the new item 1's row.
    const primary = reviews.find((r) => r.quoteItemId === after[0]!.id);
    const old = reviews.find((r) => r.quoteItemId === before[0]!.id);
    expect(primary?.acceptedAt ?? null).not.toBeNull();
    expect(old?.acceptedAt ?? null).toBeNull();
  });
});

describe('a single-item quote still runs as before', () => {
  it('an older client sending flat product fields gets one item, mirrored on the quote', async () => {
    const flat = {
      ...(await request(nextFree())),
      ...Object.fromEntries(
        Object.entries(item(KEY(1))).filter(([k]) => k !== 'key' && k !== 'label'),
      ),
    } as IntakeDraftData;
    const draft = await createDraft(flat);
    expect(draft.data.items).toHaveLength(1);
    expect(draft.data).not.toHaveProperty('resin');
    const res = await submit(draft.id);
    ok(res, 201);
    const out = SubmitIntakeResponse.parse(res.json());
    const rows = await items(out.quoteId);
    expect(rows).toHaveLength(1);
    const d = await detail(out.quoteNumber, 'KAM');
    expect(d).toMatchObject({ itemCount: 1, itemsSummary: null, estAnnualVolume: 750_000 });
    expect(d.priority.breakdown.find((b) => b.key === 'volume')?.explanation).not.toMatch(/items/);
  });
});
