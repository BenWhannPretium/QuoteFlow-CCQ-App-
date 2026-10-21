import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AttachmentDownloadResponse,
  AttachmentListResponse,
  AttachmentUploadResponse,
  ATTACHMENT_KIND_VALUES,
  DEV_USER_HEADER,
  IntakeDraft,
  MeResponse,
  QuoteDetail,
  SfOpportunityDetail,
  SubmitIntakeResponse,
  TimelineResponse,
  type IntakeDraftData,
} from '@ccq/contracts';
import { type DbClient } from '@ccq/db';
import { ATTACHMENT_KINDS, type Role } from '@ccq/domain';
import {
  BlobFileStore,
  GraphClient,
  MemoryBlobContainer,
  MockGraphDrive,
  SharePointFileStore,
  createFileStore,
  fakeCredential,
  type FileStore,
} from '@ccq/integrations';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole, personaFor } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp, fileStoreConfig } from '../src/app';
import { LocalLinkSigner } from '../src/services/attachments';
import { testConfig } from '../src/test-utils';

type App = Awaited<ReturnType<typeof buildApp>>;

const problemOf = (res: { json: () => unknown }) =>
  res.json() as { detail: string; code: string; errors: { path: string }[] };

let clock = new Date('2026-10-20T15:00:00Z');
const now = () => clock;
const PDF = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj << >> endobj\n%%EOF\n', 'latin1');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);

/** A multipart body: the text fields first (as the SPA sends them), then the file. */
function multipart(fields: Record<string, string>, file?: { name: string; content: Buffer }) {
  const boundary = `----ccq${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      file.content,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function uploader(app: App) {
  return (
    url: string,
    file: { name: string; content: Buffer } | undefined,
    fields: Record<string, string> = {},
    role: Role = 'KAM',
    scope: 'all' | 'owner' = 'all',
  ) => {
    const body = multipart(
      { kind: 'bottle_drawing', ...(file ? { size: String(file.content.length) } : {}), ...fields },
      file,
    );
    return app.inject({
      method: 'POST',
      url,
      headers: { [DEV_USER_HEADER]: personaFor(role, scope), 'content-type': body.contentType },
      payload: body.payload,
    });
  };
}

const ids: Record<string, string> = {};
async function userId(app: App, role: Role, scope: 'all' | 'owner' = 'all') {
  const key = `${role}:${scope}`;
  ids[key] ??= MeResponse.parse((await asRole(app, role, scope).get('/api/v1/me')).json()).user.id;
  return ids[key];
}

let db: DbClient;
/** What each app gets: the shared client, whose close() is the file's job (afterAll). */
let shared: DbClient;
let dbUrl = '';
let filesRoot = '';

beforeAll(async () => {
  const fresh = await freshSfDatabase('attachments');
  db = fresh.client;
  shared = { ...db, close: () => Promise.resolve() };
  dbUrl = fresh.url;
  filesRoot = await mkdtemp(join(tmpdir(), 'ccq-attach-'));
}, 120_000);
afterAll(async () => {
  await db.close();
  await rm(filesRoot, { recursive: true, force: true });
});

const auditRows = async (entityId: string) =>
  db.db.execute<{
    action: string;
    actor_id: string;
    quote_id: string | null;
    after: Record<string, unknown>;
  }>(
    sql`select action, actor_id, quote_id, after from audit_event where entity_id = ${entityId} order by at, id`,
  );

/** A quote to work on (no live attachments): in INTAKE-or-later, drawing status reset to COMING. */
async function quoteOf(kamCondition: ReturnType<typeof sql>) {
  const [row] = await db.db.execute<{ quote_number: string; id: string }>(sql`
    select q.quote_number, q.id from quote q join app_user u on u.id = q.kam_user_id
    where ${kamCondition} and q.status <> 'closed'
      and not exists (select 1 from attachment a where a.quote_id = q.id and a.removed_at is null)
    order by q.quote_number limit 1`);
  await db.db.execute(sql`update quote set drawing_status = 'COMING' where id = ${row!.id}`);
  return row!;
}

describe('with the local store (FILESTORE_MODE=local)', () => {
  let app: App;
  let upload: ReturnType<typeof uploader>;
  let qn = '';
  let quoteId = '';

  beforeAll(async () => {
    app = await buildApp(
      testConfig({ DATABASE_URL: dbUrl, FILESTORE_LOCAL_DIR: join(filesRoot, 'local') }),
      { db: shared, now },
    );
    await app.ready();
    upload = uploader(app);
    const kamId = await userId(app, 'KAM');
    ({ quote_number: qn, id: quoteId } = await quoteOf(sql`u.id = ${kamId}`));
  });
  afterAll(() => app.close());

  const list = async (role: Role = 'KAM', scope: 'all' | 'owner' = 'all', q = qn) => {
    const res = await asRole(app, role, scope).get(`/api/v1/quotes/${q}/attachments`);
    return { res, body: res.statusCode === 200 ? AttachmentListResponse.parse(res.json()) : null };
  };

  it('kinds agree between contracts and the domain', () => {
    expect([...ATTACHMENT_KIND_VALUES]).toEqual([...ATTACHMENT_KINDS]);
  });

  it('uploads a bottle drawing: stored under /CCQ/{quote_number}/, drawing status set, timeline + audit', async () => {
    const res = await upload(
      `/api/v1/quotes/${qn}/attachments`,
      { name: 'Bottle Drawing: rev 2.pdf', content: PDF },
      { note: 'Rev 2 from the customer' },
    );
    expect(res.statusCode, res.body).toBe(201);
    const body = AttachmentUploadResponse.parse(res.json());
    expect(body.drawingStatus).toEqual({ from: 'COMING', to: 'HAVE_DRAWING' });
    expect(body.item).toMatchObject({
      kind: 'bottle_drawing',
      fileName: 'Bottle Drawing: rev 2.pdf',
      storedName: 'Bottle Drawing_ rev 2.pdf',
      size: PDF.length,
      mime: 'application/pdf',
      note: 'Rev 2 from the customer',
      available: true,
      storage: 'local',
      canRemove: true,
    });
    // On disk in the quote folder, byte for byte.
    expect(
      await readFile(join(filesRoot, 'local', 'CCQ', qn, 'Bottle Drawing_ rev 2.pdf')),
    ).toEqual(PDF);

    const quote = QuoteDetail.parse((await asRole(app, 'KAM').get(`/api/v1/quotes/${qn}`)).json());
    expect(quote.drawingStatus).toBe('HAVE_DRAWING');

    const timeline = TimelineResponse.parse(
      (await asRole(app, 'KAM').get(`/api/v1/quotes/${qn}/timeline?filter=files`)).json(),
    );
    expect(timeline.items[0]).toMatchObject({
      type: 'attachment_uploaded',
      category: 'file',
      payload: { fileName: 'Bottle Drawing: rev 2.pdf', kind: 'bottle_drawing' },
    });

    const audit = await auditRows(body.item.id);
    expect(audit.map((a) => a.action)).toEqual(['upload']);
    expect(audit[0]!.quote_id).toBe(quoteId);
    expect(audit[0]!.after).toMatchObject({
      storage: 'local',
      folder: `CCQ/${qn}`,
      size: PDF.length,
    });
    expect(String(audit[0]!.after.sha256)).toMatch(/^[0-9a-f]{64}$/);
    const [quoteAudit] = await db.db.execute<{ before: unknown; after: unknown }>(
      sql`select before, after from audit_event where entity = 'quote' and entity_id = ${quoteId} and action = 'update' order by at desc limit 1`,
    );
    expect(quoteAudit).toMatchObject({
      before: { drawingStatus: 'COMING' },
      after: { drawingStatus: 'HAVE_DRAWING' },
    });
  });

  it('a second drawing leaves the status alone; other kinds never change it', async () => {
    const res = await upload(`/api/v1/quotes/${qn}/attachments`, {
      name: 'Bottle Drawing: rev 2.pdf',
      content: PDF,
    });
    expect(AttachmentUploadResponse.parse(res.json())).toMatchObject({
      drawingStatus: null,
      item: { storedName: 'Bottle Drawing_ rev 2 (1).pdf' }, // never overwritten
    });
    await db.db.execute(sql`update quote set drawing_status = 'NONE' where id = ${quoteId}`);
    const photo = await upload(
      `/api/v1/quotes/${qn}/attachments`,
      { name: 'IMG_0001.png', content: PNG },
      { kind: 'sample_photo' },
      'Engineer',
    );
    expect(photo.statusCode, photo.body).toBe(201);
    expect(AttachmentUploadResponse.parse(photo.json()).drawingStatus).toBeNull();
    await db.db.execute(
      sql`update quote set drawing_status = 'HAVE_DRAWING' where id = ${quoteId}`,
    );
  });

  it('lists kind, name, size, uploader and date for every quote.read role', async () => {
    for (const role of [
      'KAM',
      'SalesLeader',
      'EngLead',
      'Engineer',
      'Pricing',
      'Approver',
      'Leadership',
      'Admin',
    ] as Role[]) {
      const { res, body } = await list(role);
      expect(res.statusCode, `${role}: ${res.body}`).toBe(200);
      expect(body!.items.map((i) => i.kind)).toEqual([
        'bottle_drawing',
        'bottle_drawing',
        'sample_photo',
      ]);
      expect(body!.items[0]!.uploadedByName).toBeTruthy();
      expect(body!.canUpload).toBe(
        ['KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing'].includes(role),
      );
    }
  });

  it('rejects wrong types, renamed executables, oversize and short bodies with clear errors; nothing stored', async () => {
    const before = (await list()).body!.items.length;
    const url = `/api/v1/quotes/${qn}/attachments`;

    const exe = await upload(url, { name: 'setup.exe', content: EXE });
    expect(exe.statusCode).toBe(422);
    expect(exe.json()).toMatchObject({ code: 'attachment_rejected', errors: [{ path: '/file' }] });
    expect(problemOf(exe).detail).toContain('pdf');

    const renamed = await upload(url, { name: 'drawing.pdf', content: EXE });
    expect(renamed.statusCode).toBe(422);
    expect(problemOf(renamed).detail).toMatch(/not a PDF/);

    const tooBig = await upload(
      url,
      { name: 'a.pdf', content: PDF },
      { size: String(100 * 1024 * 1024 + 1) },
    );
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.json()).toMatchObject({ code: 'file_too_large' });
    expect(problemOf(tooBig).detail).toContain('100 MB');

    const longer = await upload(url, { name: 'a.pdf', content: PDF }, { size: '20' });
    expect(longer.statusCode).toBe(413);
    const shorter = await upload(
      url,
      { name: 'a.pdf', content: PDF },
      { size: String(PDF.length + 10) },
    );
    expect(shorter.statusCode).toBe(422);

    const noKind = await upload(url, { name: 'a.pdf', content: PDF }, { kind: 'invoice' });
    expect(noKind.statusCode).toBe(422);
    expect(problemOf(noKind).errors[0]!.path).toBe('/kind');

    const noFile = await upload(url, undefined, { size: '10' });
    expect(noFile.statusCode).toBe(422);
    const json = await asRole(app, 'KAM').post(url, { kind: 'spec' });
    expect(json.statusCode).toBe(415);

    expect((await list()).body!.items.length).toBe(before);
    const tmp = await readdir(join(filesRoot, 'local', '.tmp')).catch(() => []);
    expect(tmp).toEqual([]);
  });

  it('upload needs attachment.upload: Approver, Leadership and Admin get 403', async () => {
    for (const role of ['Approver', 'Leadership', 'Admin'] as Role[]) {
      const res = await upload(
        `/api/v1/quotes/${qn}/attachments`,
        { name: 'a.pdf', content: PDF },
        {},
        role,
      );
      expect(res.statusCode, role).toBe(403);
    }
  });

  it('downloads: authorized, audited, then a short-lived link (302 or JSON) that serves the bytes', async () => {
    const [item] = (await list()).body!.items;
    const redirect = await asRole(app, 'Pricing').get(`/api/v1/attachments/${item!.id}/download`);
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toMatch(/^\/api\/v1\/files\/local\?t=/);

    const json = AttachmentDownloadResponse.parse(
      (
        await asRole(app, 'Leadership').get(`/api/v1/attachments/${item!.id}/download?format=json`)
      ).json(),
    );
    expect(json.fileName).toBe('Bottle Drawing: rev 2.pdf');
    expect(new Date(json.expiresAt).getTime() - clock.getTime()).toBeLessThanOrEqual(5 * 60_000);

    const file = await app.inject({ method: 'GET', url: json.url });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload).toEqual(PDF);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toContain(
      `filename*=UTF-8''Bottle%20Drawing%3A%20rev%202.pdf`,
    );
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    // A tampered or expired link is refused.
    expect((await app.inject({ method: 'GET', url: `${json.url}x` })).statusCode).toBe(404);
    clock = new Date(clock.getTime() + 6 * 60_000);
    expect((await app.inject({ method: 'GET', url: json.url })).statusCode).toBe(404);

    const audit = await auditRows(item!.id);
    const downloads = audit.filter((a) => a.action === 'download');
    expect(downloads).toHaveLength(2);
    expect(downloads.every((d) => d.quote_id === quoteId)).toBe(true);
  });

  it("an owner-scoped KAM can neither list nor download another KAM's files (404, nothing audited)", async () => {
    const [item] = (await list()).body!.items;
    const ownerKam = await userId(app, 'KAM', 'owner');
    expect(ownerKam).not.toBe(await userId(app, 'KAM'));
    const before = (await auditRows(item!.id)).length;
    expect((await list('KAM', 'owner')).res.statusCode).toBe(404);
    const dl = await asRole(app, 'KAM', 'owner').get(`/api/v1/attachments/${item!.id}/download`);
    expect(dl.statusCode).toBe(404);
    const rm = await asRole(app, 'KAM', 'owner').delete(`/api/v1/attachments/${item!.id}`);
    expect(rm.statusCode).toBe(404);
    expect((await auditRows(item!.id)).length).toBe(before);

    // Their own quote works for them.
    const own = await quoteOf(sql`u.id = ${ownerKam}`);
    const up = await upload(
      `/api/v1/quotes/${own.quote_number}/attachments`,
      { name: 'mine.pdf', content: PDF },
      {},
      'KAM',
      'owner',
    );
    expect(up.statusCode, up.body).toBe(201);
    const mine = AttachmentUploadResponse.parse(up.json()).item;
    expect(
      (await asRole(app, 'KAM', 'owner').get(`/api/v1/attachments/${mine.id}/download?format=json`))
        .statusCode,
    ).toBe(200);
    // …and the full-scope KAM can't upload to a quote they can't see either.
    expect(
      (await upload(`/api/v1/quotes/CCQ-2099-99999/attachments`, { name: 'a.pdf', content: PDF }))
        .statusCode,
    ).toBe(404);
  });

  it('metadata-only rows (synthetic seed) list as unavailable and download as 404', async () => {
    const [seeded] = await db.db.execute<{ id: string }>(
      sql`select id from attachment where storage is null limit 1`,
    );
    const res = await asRole(app, 'Admin').get(`/api/v1/attachments/${seeded!.id}/download`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'file_unavailable' });
  });

  it('remove: the uploader within 24 h or Admin; soft (moved to CCQ/_removed/{qn}/), audited, on the timeline', async () => {
    clock = new Date('2026-10-20T15:30:00Z');
    const up = await upload(
      `/api/v1/quotes/${qn}/attachments`,
      { name: 'spec.pdf', content: PDF },
      { kind: 'spec' },
      'EngLead',
    );
    const item = AttachmentUploadResponse.parse(up.json()).item;

    // Someone else (even with upload rights) may not.
    const other = await asRole(app, 'KAM').delete(`/api/v1/attachments/${item.id}`);
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ code: 'not_removable' });
    // The KAM's list says so too.
    const forKam = (await list()).body!.items.find((i) => i.id === item.id)!;
    expect(forKam).toMatchObject({
      canRemove: false,
      removeBlockedReason: expect.stringContaining('uploaded') as unknown,
    });

    const res = await asRole(app, 'EngLead').delete(`/api/v1/attachments/${item.id}`);
    expect(res.statusCode, res.body).toBe(204);
    expect((await list()).body!.items.map((i) => i.id)).not.toContain(item.id);
    expect(await readFile(join(filesRoot, 'local', 'CCQ', '_removed', qn, 'spec.pdf'))).toEqual(
      PDF,
    );
    expect(
      (await asRole(app, 'EngLead').get(`/api/v1/attachments/${item.id}/download`)).statusCode,
    ).toBe(404);
    expect((await auditRows(item.id)).map((a) => a.action)).toEqual(['upload', 'update']);
    const timeline = TimelineResponse.parse(
      (await asRole(app, 'KAM').get(`/api/v1/quotes/${qn}/timeline?filter=files`)).json(),
    );
    expect(timeline.items[0]).toMatchObject({
      type: 'attachment_removed',
      payload: { fileName: 'spec.pdf' },
    });

    // After 24 h only Admin may remove the KAM's drawing.
    const [kamFile] = (await list()).body!.items;
    clock = new Date('2026-10-22T15:30:00Z');
    expect((await asRole(app, 'KAM').delete(`/api/v1/attachments/${kamFile!.id}`)).statusCode).toBe(
      403,
    );
    expect(
      (await asRole(app, 'Admin').delete(`/api/v1/attachments/${kamFile!.id}`)).statusCode,
    ).toBe(204);
    expect(
      (await asRole(app, 'Admin').delete(`/api/v1/attachments/${kamFile!.id}`)).statusCode,
    ).toBe(404);
  });

  describe('intake drafts', () => {
    let draftId = '';
    let opp = '';

    async function prefill(sfOpportunityId: string): Promise<IntakeDraftData> {
      const sf = SfOpportunityDetail.parse(
        (
          await asRole(app, 'KAM').get(`/api/v1/salesforce/opportunities/${sfOpportunityId}`)
        ).json(),
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
        customer: {
          status: 'existing',
          sfAccountId: sf.account?.id ?? sf.opportunity.accountId,
          name: sf.opportunity.accountName,
        },
        shipTo,
        shipToDefault: shipTo,
        requestClass: 'CCQ',
        productFamily: 'BOTTLE',
        components: ['CONTAINER'],
        market: 'FOOD',
        resin: 'HDPE',
        estAnnualVolume: 750_000,
        drawingStatus: 'COMING',
      };
    }

    beforeAll(async () => {
      clock = new Date('2026-10-23T15:00:00Z');
      const [row] = await db.db.execute<{ id: string }>(sql`
        select s.sf_opportunity_id as id from sf_opportunity_snapshot s
        where not s.is_closed and s.account_id is not null
          and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
        order by s.sf_opportunity_id limit 1`);
      opp = row!.id;
      const res = await asRole(app, 'KAM').post('/api/v1/quotes/drafts', {
        data: await prefill(opp),
      });
      draftId = IntakeDraft.parse(res.json()).id;
    });

    it('uploads into /CCQ/_drafts/{draftId}/ (owner only) and marks the draft as having a drawing', async () => {
      const res = await upload(`/api/v1/quotes/drafts/${draftId}/attachments`, {
        name: 'drawing.pdf',
        content: PDF,
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(AttachmentUploadResponse.parse(res.json()).drawingStatus).toEqual({
        from: 'COMING',
        to: 'HAVE_DRAWING',
      });
      expect(await readdir(join(filesRoot, 'local', 'CCQ', '_drafts', draftId))).toEqual([
        'drawing.pdf',
      ]);
      const draft = IntakeDraft.parse(
        (await asRole(app, 'KAM').get(`/api/v1/quotes/drafts/${draftId}`)).json(),
      );
      expect(draft.data.drawingStatus).toBe('HAVE_DRAWING');
      const photo = await upload(
        `/api/v1/quotes/drafts/${draftId}/attachments`,
        { name: 'sample.png', content: PNG },
        { kind: 'sample_photo' },
      );
      expect(photo.statusCode).toBe(201);

      const listed = AttachmentListResponse.parse(
        (await asRole(app, 'KAM').get(`/api/v1/quotes/drafts/${draftId}/attachments`)).json(),
      );
      expect(listed.items.map((i) => i.fileName)).toEqual(['drawing.pdf', 'sample.png']);
      expect(listed.canUpload).toBe(true);
      expect(listed.items.every((i) => i.canRemove)).toBe(true);

      // Another KAM (SalesLeader holds quote.create too) can't see or add to it; Admin reads only.
      const sl = await upload(
        `/api/v1/quotes/drafts/${draftId}/attachments`,
        { name: 'x.pdf', content: PDF },
        {},
        'SalesLeader',
      );
      expect(sl.statusCode).toBe(404);
      expect(
        (await asRole(app, 'SalesLeader').get(`/api/v1/quotes/drafts/${draftId}/attachments`))
          .statusCode,
      ).toBe(404);
      const admin = AttachmentListResponse.parse(
        (await asRole(app, 'Admin').get(`/api/v1/quotes/drafts/${draftId}/attachments`)).json(),
      );
      expect(admin).toMatchObject({ canUpload: false });
      expect(admin.items).toHaveLength(2);
      const audit = await auditRows(listed.items[0]!.id);
      expect(audit[0]).toMatchObject({ action: 'upload', quote_id: null });
      expect(audit[0]!.after).toMatchObject({ draftId, folder: `CCQ/_drafts/${draftId}` });
    });

    it('submit moves the files to /CCQ/{quote_number}/ and puts them on the timeline', async () => {
      const res = await asRole(app, 'KAM').post(`/api/v1/quotes/drafts/${draftId}/submit`);
      expect(res.statusCode, res.body).toBe(201);
      const submitted = SubmitIntakeResponse.parse(res.json());
      expect(submitted.attachments).toBe(2);
      const folder = join(filesRoot, 'local', 'CCQ', submitted.quoteNumber);
      expect((await readdir(folder)).sort()).toEqual(['drawing.pdf', 'sample.png']);
      await expect(readdir(join(filesRoot, 'local', 'CCQ', '_drafts', draftId))).rejects.toThrow();

      const listed = AttachmentListResponse.parse(
        (
          await asRole(app, 'SalesLeader').get(
            `/api/v1/quotes/${submitted.quoteNumber}/attachments`,
          )
        ).json(),
      );
      expect(listed.items.map((i) => i.fileName)).toEqual(['drawing.pdf', 'sample.png']);
      const [row] = await db.db.execute<{ storage_path: string; draft_id: string }>(
        sql`select storage_path, draft_id from attachment where id = ${listed.items[0]!.id}`,
      );
      expect(row).toEqual({ storage_path: `CCQ/${submitted.quoteNumber}`, draft_id: draftId });
      const quote = QuoteDetail.parse(
        (await asRole(app, 'KAM').get(`/api/v1/quotes/${submitted.quoteNumber}`)).json(),
      );
      expect(quote.drawingStatus).toBe('HAVE_DRAWING');
      const dl = AttachmentDownloadResponse.parse(
        (
          await asRole(app, 'EngLead').get(
            `/api/v1/attachments/${listed.items[0]!.id}/download?format=json`,
          )
        ).json(),
      );
      const bytes = await app.inject({ method: 'GET', url: dl.url });
      expect(bytes.statusCode, bytes.body).toBe(200);
      expect(bytes.rawPayload).toEqual(PDF);
      const timeline = TimelineResponse.parse(
        (
          await asRole(app, 'KAM').get(
            `/api/v1/quotes/${submitted.quoteNumber}/timeline?filter=files`,
          )
        ).json(),
      );
      expect(timeline.items.filter((i) => i.payload.fromDraft === true)).toHaveLength(2);
      // The submitted draft takes no more files.
      const late = await upload(`/api/v1/quotes/drafts/${draftId}/attachments`, {
        name: 'late.pdf',
        content: PDF,
      });
      expect(late.statusCode).toBe(409);
    });

    it('deleting a draft removes its files (soft) and keeps the audit trail', async () => {
      const [row] = await db.db.execute<{ id: string }>(sql`
        select s.sf_opportunity_id as id from sf_opportunity_snapshot s
        where not s.is_closed and s.account_id is not null and s.sf_opportunity_id <> ${opp}
          and not exists (select 1 from quote q where q.sf_opportunity_id = s.sf_opportunity_id and q.status <> 'closed')
        order by s.sf_opportunity_id limit 1`);
      const created = IntakeDraft.parse(
        (
          await asRole(app, 'KAM').post('/api/v1/quotes/drafts', {
            data: { sfOpportunityId: row!.id },
          })
        ).json(),
      );
      const up = await upload(
        `/api/v1/quotes/drafts/${created.id}/attachments`,
        { name: 'gone.pdf', content: PDF },
        { kind: 'spec' },
      );
      const item = AttachmentUploadResponse.parse(up.json()).item;
      expect(
        (await asRole(app, 'KAM').delete(`/api/v1/quotes/drafts/${created.id}`)).statusCode,
      ).toBe(204);
      expect(await readdir(join(filesRoot, 'local', 'CCQ', '_removed', created.id))).toEqual([
        'gone.pdf',
      ]);
      const [att] = await db.db.execute<{ draft_id: string | null; removed_at: Date | null }>(
        sql`select draft_id, removed_at from attachment where id = ${item.id}`,
      );
      expect(att!.draft_id).toBeNull();
      expect(att!.removed_at).not.toBeNull();
      expect((await auditRows(item.id)).map((a) => a.action)).toEqual(['upload', 'update']);
    });
  });
});

describe('the same flow on SharePoint (mock Graph) and Blob (memory), chosen by the store alone', () => {
  const stores: [
    string,
    () => { store: FileStore; folderOf: (qn: string) => Promise<string[]> },
  ][] = [
    [
      'sharepoint',
      () => {
        const drive = new MockGraphDrive({ keepBytes: true });
        const store = new SharePointFileStore(
          new GraphClient({ credential: fakeCredential(), fetch: drive.fetch }),
          { driveId: drive.driveId },
        );
        return {
          store,
          folderOf: async (qn) => (await store.list(`CCQ/${qn}`)).map((f) => f.name),
        };
      },
    ],
    [
      'blob',
      () => {
        const store = new BlobFileStore(new MemoryBlobContainer());
        return {
          store,
          folderOf: async (qn) => (await store.list(`CCQ/${qn}`)).map((f) => f.name),
        };
      },
    ],
  ];

  it.each(stores)('%s: upload → list → download → remove', async (kind, make) => {
    const { store, folderOf } = make();
    const app = await buildApp(testConfig({ DATABASE_URL: dbUrl }), {
      db: shared,
      now,
      fileStore: store,
    });
    await app.ready();
    try {
      clock = new Date('2026-10-24T15:00:00Z');
      const kamId = await userId(app, 'KAM');
      const { quote_number: qn } = await quoteOf(sql`u.id = ${kamId}`);
      const res = await uploader(app)(`/api/v1/quotes/${qn}/attachments`, {
        name: 'Drawing.pdf',
        content: PDF,
      });
      expect(res.statusCode, res.body).toBe(201);
      const item = AttachmentUploadResponse.parse(res.json()).item;
      expect(item.storage).toBe(kind);
      if (kind === 'sharepoint') expect(item.webUrl).toContain(`CCQ/${qn}/Drawing.pdf`);
      expect(await folderOf(qn)).toEqual(['Drawing.pdf']);
      const dl = await asRole(app, 'Approver').get(`/api/v1/attachments/${item.id}/download`);
      expect(dl.statusCode).toBe(302);
      expect(dl.headers.location).toMatch(
        kind === 'sharepoint' ? /download\.mock/ : /blob\.core\.windows\.net.*sp=r/,
      );
      expect((await asRole(app, 'KAM').delete(`/api/v1/attachments/${item.id}`)).statusCode).toBe(
        204,
      );
      expect(await folderOf(qn)).toEqual([]);
      expect((await store.list(`CCQ/_removed/${qn}`)).map((f) => f.name)).toEqual(['Drawing.pdf']);
    } finally {
      await app.close();
    }
  });

  it('a file stored in another store (the mode was switched) answers 503 instead of a broken link', async () => {
    const app = await buildApp(testConfig({ DATABASE_URL: dbUrl }), {
      db: shared,
      now,
      fileStore: new BlobFileStore(new MemoryBlobContainer()),
    });
    await app.ready();
    try {
      const [local] = await db.db.execute<{ id: string }>(
        sql`select id from attachment where storage = 'local' and removed_at is null limit 1`,
      );
      const res = await asRole(app, 'Admin').get(`/api/v1/attachments/${local!.id}/download`);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: 'storage_unavailable' });
    } finally {
      await app.close();
    }
  });

  it('FILESTORE_MODE picks the implementation (configuration only)', () => {
    const signer = new LocalLinkSigner();
    const blob = testConfig({
      FILESTORE_MODE: 'blob',
      BLOB_ACCOUNT_URL: 'https://ccqfiles.blob.core.windows.net',
      BLOB_CONTAINER: 'attachments',
    });
    expect(createFileStore(fileStoreConfig(blob, signer)).kind).toBe('blob');
    const sp = testConfig({ FILESTORE_MODE: 'sharepoint', SP_SITE_ID: 's', SP_DRIVE_ID: 'b!d' });
    expect(fileStoreConfig(sp, signer)).toMatchObject({
      mode: 'sharepoint',
      driveId: 'b!d',
      credential: { kind: 'managed-identity' },
    });
    expect(createFileStore(fileStoreConfig(sp, signer)).kind).toBe('sharepoint');
    expect(createFileStore(fileStoreConfig(testConfig(), signer)).kind).toBe('local');
  });
});
