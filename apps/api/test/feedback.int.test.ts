import { CreateFeedbackResponse, FeedbackItem, FeedbackListResponse } from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-23 "Report an issue": any MVP role files a report with its page context and an optional
 * screenshot; only Admin lists, views screenshots and triages, every step audited. The route × role
 * gate is in permissions/matrix.int.test.ts; this covers behaviour, RLS and validation.
 */
let db: DbClient;
let app: Awaited<ReturnType<typeof buildApp>>;

/** A 1×1 PNG. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const report = {
  type: 'bug',
  severity: 2,
  description: 'The engineering queue shows the wrong age for held quotes.',
  route: '/quotes/CCQ-2026-00012/engineering',
  quoteNumber: 'CCQ-2026-00012',
  appVersion: 'abc123',
  viewport: '390x844',
};

beforeAll(async () => {
  const fresh = await freshSfDatabase('feedback');
  db = fresh.client;
  app = await buildApp(testConfig({ DATABASE_URL: fresh.url }), { db });
  await app.ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('Report an issue (B-23)', () => {
  let id = '';

  it('a KAM files a report with a screenshot; it is audited', async () => {
    const res = await asRole(app, 'KAM', 'owner').post('/api/v1/feedback', {
      ...report,
      screenshot: { contentType: 'image/png', dataBase64: PNG },
    });
    expect(res.statusCode, res.body).toBe(201);
    id = CreateFeedbackResponse.parse(res.json()).id;
    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.entity, 'feedback'), eq(schema.auditEvent.entityId, id)));
    expect(audit).toMatchObject({ action: 'create', actorRoles: ['KAM'] });
    expect(audit!.after).toMatchObject({ severity: 2, screenshot: true });
  });

  it('a KAM cannot list reports, even their own (403)', async () => {
    expect((await asRole(app, 'KAM', 'owner').get('/api/v1/admin/feedback')).statusCode).toBe(403);
  });

  it('Admin sees the report with its context and a ready GitHub issue', async () => {
    const res = await asRole(app, 'Admin').get('/api/v1/admin/feedback');
    expect(res.statusCode, res.body).toBe(200);
    const item = FeedbackListResponse.parse(res.json()).items.find((i) => i.id === id)!;
    expect(item).toMatchObject({
      type: 'bug',
      severity: 2,
      status: 'new',
      quoteNumber: 'CCQ-2026-00012',
      reporterRoles: 'KAM',
      hasScreenshot: true,
      viewport: '390x844',
    });
    expect(item.issueTitle).toMatch(/^\[Sev-2\]\[bug\] /);
    expect(item.issueMarkdown).toContain('CCQ-2026-00012');
    expect(item.issueMarkdown).not.toContain(item.reporterName);
  });

  it('Admin views the screenshot as an image', async () => {
    const res = await asRole(app, 'Admin').get(`/api/v1/admin/feedback/${id}/screenshot`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.rawPayload.subarray(1, 4).toString()).toBe('PNG');
  });

  it('Admin triages: status, owner, GitHub link and note; audited with before and after', async () => {
    const me = (await asRole(app, 'Admin').get('/api/v1/me')).json<{ user: { id: string } }>().user;
    const res = await asRole(app, 'Admin').patch(`/api/v1/admin/feedback/${id}`, {
      status: 'fixing',
      ownerId: me.id,
      githubIssueUrl: 'https://github.com/BenWhannPretium/QuoteFlow-CCQ-App-/issues/1',
      triageNote: 'Repro on test.',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(FeedbackItem.parse(res.json())).toMatchObject({ status: 'fixing', ownerId: me.id });
    const audits = await db.db
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.entity, 'feedback'), eq(schema.auditEvent.action, 'update')));
    expect(audits.at(-1)!.before).toMatchObject({ status: 'new', ownerId: null });
  });

  it('rejects a non-GitHub issue link, an unknown owner and an empty change', async () => {
    const admin = asRole(app, 'Admin');
    expect(
      (
        await admin.patch(`/api/v1/admin/feedback/${id}`, {
          githubIssueUrl: 'https://evil.example/x',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await admin.patch(`/api/v1/admin/feedback/${id}`, {
          ownerId: '019a0000-0000-7000-8000-00000000dead',
        })
      ).statusCode,
    ).toBe(422);
    expect((await admin.patch(`/api/v1/admin/feedback/${id}`, {})).statusCode).toBe(400);
  });

  it('rejects a screenshot that is not the image it claims to be', async () => {
    const res = await asRole(app, 'Engineer').post('/api/v1/feedback', {
      ...report,
      screenshot: {
        contentType: 'image/png',
        dataBase64: Buffer.from('<svg/>').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(415);
  });

  it('rejects a bad route or quote number', async () => {
    const pricing = asRole(app, 'Pricing');
    expect(
      (await pricing.post('/api/v1/feedback', { ...report, route: 'https://x.test/' })).statusCode,
    ).toBe(400);
    expect(
      (await pricing.post('/api/v1/feedback', { ...report, quoteNumber: 'ERF25-1' })).statusCode,
    ).toBe(400);
  });

  it('the app role has no DELETE on feedback, and RLS is forced', async () => {
    const [row] = await db.db.execute<{ del: boolean; forced: boolean }>(sql`
      select has_table_privilege('ccq_app', 'feedback', 'DELETE') as del,
             relforcerowsecurity as forced from pg_class where relname = 'feedback'`);
    expect(row).toEqual({ del: false, forced: true });
  });
});
