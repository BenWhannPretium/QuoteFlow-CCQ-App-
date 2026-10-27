import {
  ActivateScoringResponse,
  AdminReasonCodesResponse,
  AdminScoringResponse,
  AdminSettingsResponse,
  AdminUsersResponse,
  AdminValueListsResponse,
  AdminWorkflowResponse,
  ConnectorHealthResponse,
  DecisionLogResponse,
  MeResponse,
  PublicConfigResponse,
  ScoringPreviewResponse,
} from '@ccq/contracts';
import { schema, type DbClient } from '@ccq/db';
import type { Role } from '@ccq/domain';
import { and, eq, ne, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { asRole } from './permissions/asRole';
import { freshSfDatabase } from './sf-helpers';
import { buildApp } from '../src/app';
import { testConfig } from '../src/test-utils';

/**
 * B-19 admin configuration console (CR-51): every write needs a change reason, is versioned (stale
 * → 409), validated by the domain and audited as config_change (the decision log); Leadership reads,
 * only Admin writes; scoring activation rescores open quotes only.
 */
let db: DbClient;
let url: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-02T15:00:00Z');
const WHY = 'Bailey approved at the M4 config review';

const as = (role: Role) => asRole(app, role);
const admin = () => as('Admin');

const configChanges = async () =>
  (
    await db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.action, 'config_change'))
  )[0]!.n;

async function reasonCodes() {
  const res = await admin().get('/api/v1/admin/config/reason-codes');
  expect(res.statusCode, res.body).toBe(200);
  return AdminReasonCodesResponse.parse(res.json()).items;
}
async function valueLists() {
  const res = await admin().get('/api/v1/admin/config/value-lists');
  expect(res.statusCode, res.body).toBe(200);
  return AdminValueListsResponse.parse(res.json()).items;
}
async function settings() {
  const res = await admin().get('/api/v1/admin/config/settings');
  expect(res.statusCode, res.body).toBe(200);
  return AdminSettingsResponse.parse(res.json()).items;
}
const setting = async (key: string) => (await settings()).find((s) => s.key === key)!;
async function workflow() {
  const res = await admin().get('/api/v1/admin/config/workflow');
  expect(res.statusCode, res.body).toBe(200);
  return AdminWorkflowResponse.parse(res.json());
}
async function scoring() {
  const res = await admin().get('/api/v1/admin/config/scoring');
  expect(res.statusCode, res.body).toBe(200);
  return AdminScoringResponse.parse(res.json());
}
async function publicConfig() {
  const res = await as('KAM').get('/api/v1/config/public');
  expect(res.statusCode, res.body).toBe(200);
  return PublicConfigResponse.parse(res.json());
}
async function decisionLog(query = '') {
  const res = await as('Leadership').get(`/api/v1/admin/config/decision-log${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return DecisionLogResponse.parse(res.json()).items;
}

beforeAll(async () => {
  const fresh = await freshSfDatabase('admin_config');
  db = fresh.client;
  url = fresh.url;
  app = await buildApp(testConfig({ DATABASE_URL: url }), { db, now: () => clock });
  await app.ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  clock = new Date(clock.getTime() + 60_000);
});

describe('access', () => {
  it('Leadership reads every screen but cannot change anything', async () => {
    for (const path of [
      'value-lists',
      'reason-codes',
      'workflow',
      'settings',
      'scoring',
      'decision-log',
    ]) {
      const res = await as('Leadership').get(`/api/v1/admin/config/${path}`);
      expect(res.statusCode, `${path}: ${res.body}`).toBe(200);
    }
    expect((await as('Leadership').get('/api/v1/admin/users')).statusCode).toBe(200);
    const [code] = await reasonCodes();
    const res = await as('Leadership').patch(`/api/v1/admin/config/reason-codes/${code!.id}`, {
      version: code!.version,
      changeReason: WHY,
      label: 'Nope',
    });
    expect(res.statusCode).toBe(403);
  });

  it('other roles get 403, even to read', async () => {
    for (const role of ['KAM', 'SalesLeader', 'EngLead', 'Pricing', 'Approver'] as Role[]) {
      expect((await as(role).get('/api/v1/admin/config/settings')).statusCode).toBe(403);
    }
  });
});

describe('every write needs a change reason and is audited', () => {
  it('rejects a write without a reason and writes nothing', async () => {
    const before = await configChanges();
    const [code] = await reasonCodes();
    for (const changeReason of [undefined, '', '   ', 'no']) {
      const res = await admin().patch(`/api/v1/admin/config/reason-codes/${code!.id}`, {
        version: code!.version,
        label: 'Renamed',
        ...(changeReason !== undefined ? { changeReason } : {}),
      });
      expect(res.statusCode, String(changeReason)).toBe(400);
    }
    expect(await configChanges()).toBe(before);
    expect((await reasonCodes()).find((r) => r.id === code!.id)!.label).toBe(code!.label);
  });

  it('renames a reason code: version bump, audit row, public config, decision log', async () => {
    const code = (await reasonCodes()).find((r) => r.context === 'lost' && r.active)!;
    const before = await configChanges();
    const res = await admin().patch(`/api/v1/admin/config/reason-codes/${code.id}`, {
      version: code.version,
      changeReason: WHY,
      label: 'Lost on price (customer budget)',
      approved: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: code.id, version: code.version + 1 });

    const after = (await reasonCodes()).find((r) => r.id === code.id)!;
    expect(after.label).toBe('Lost on price (customer budget)');
    expect(after.approval.provisional).toBe(false);
    expect(after.approval.approvedByName).toBeTruthy();
    expect(after.approval.approvedAt).toBe(clock.toISOString());

    expect(await configChanges()).toBe(before + 1);
    const [audit] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.action, 'config_change'), eq(schema.auditEvent.entityId, code.id)),
      );
    expect(audit).toMatchObject({ entity: 'reason_code', changeReason: WHY });
    expect(audit!.before).toMatchObject({ label: code.label, provisional: true });
    expect(audit!.after).toMatchObject({ label: 'Lost on price (customer budget)' });

    const pub = await publicConfig();
    expect(pub.reasonCodes.find((r) => r.code === code.code && r.context === 'lost')!.label).toBe(
      'Lost on price (customer budget)',
    );

    const [entry] = await decisionLog('?entity=reason_code');
    expect(entry).toMatchObject({
      subject: `Reason code: lost/${code.code}`,
      changeReason: WHY,
      at: clock.toISOString(),
    });
    expect(entry!.actorName).toBeTruthy();
    expect(entry!.changes).toEqual(
      expect.arrayContaining([
        { path: 'label', before: code.label, after: 'Lost on price (customer budget)' },
        { path: 'provisional', before: true, after: false },
      ]),
    );
  });

  it('409 on a stale version, and the row is unchanged', async () => {
    const code = (await reasonCodes()).find((r) => r.context === 'lost')!;
    const ok = await admin().patch(`/api/v1/admin/config/reason-codes/${code.id}`, {
      version: code.version,
      changeReason: WHY,
      label: 'First writer',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const stale = await admin().patch(`/api/v1/admin/config/reason-codes/${code.id}`, {
      version: code.version,
      changeReason: WHY,
      label: 'Second writer',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'stale_version', currentVersion: code.version + 1 });
    expect((await reasonCodes()).find((r) => r.id === code.id)!.label).toBe('First writer');
  });

  it('adds and reorders reason codes', async () => {
    const created = await admin().post('/api/v1/admin/config/reason-codes', {
      context: 'decline',
      code: 'capacity',
      label: 'No capacity in the network',
      changeReason: WHY,
    });
    expect(created.statusCode, created.body).toBe(201);
    const dup = await admin().post('/api/v1/admin/config/reason-codes', {
      context: 'decline',
      code: 'capacity',
      label: 'Again',
      changeReason: WHY,
    });
    expect(dup.statusCode).toBe(409);

    const decline = (await reasonCodes()).filter((r) => r.context === 'decline');
    expect(decline.at(-1)!.code).toBe('capacity');
    expect(decline.at(-1)!.approval.provisional).toBe(true);
    const reversed = [...decline].reverse();
    const res = await admin().put('/api/v1/admin/config/reason-codes/decline/order', {
      items: reversed.map((r) => ({ id: r.id, version: r.version })),
      changeReason: WHY,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await reasonCodes()).filter((r) => r.context === 'decline').map((r) => r.code)).toEqual(
      reversed.map((r) => r.code),
    );
    const [entry] = await decisionLog('?entity=reason_code');
    expect(entry!.subject).toBe('Reason code: decline (order)');
  });

  it('refuses to deactivate the last active code an outcome requires (domain validator)', async () => {
    const stop = (await reasonCodes()).filter((r) => r.context === 'stop' && r.active);
    expect(stop.length).toBeGreaterThan(0);
    let refused = false;
    for (const code of stop) {
      const res = await admin().patch(`/api/v1/admin/config/reason-codes/${code.id}`, {
        version: code.version,
        changeReason: WHY,
        active: false,
      });
      if (res.statusCode === 422) {
        expect(res.json()).toMatchObject({ code: 'invalid_config' });
        expect(res.json<{ detail: string }>().detail).toMatch(/no active codes/);
        refused = true;
        break;
      }
      expect(res.statusCode, res.body).toBe(200);
    }
    expect(refused).toBe(true);
    // Put them back for the other tests.
    for (const code of (await reasonCodes()).filter((r) => r.context === 'stop' && !r.active)) {
      await admin().patch(`/api/v1/admin/config/reason-codes/${code.id}`, {
        version: code.version,
        changeReason: WHY,
        active: true,
      });
    }
  });
});

describe('value lists', () => {
  it('asks for confirmation before deactivating a value open quotes use; they keep it', async () => {
    const [used] = await db.db
      .select({ resin: schema.quote.resin })
      .from(schema.quote)
      .where(and(ne(schema.quote.status, 'closed'), sql`${schema.quote.resin} is not null`))
      .limit(1);
    const resin = used!.resin!;
    const entry = (await valueLists()).find((v) => v.listKey === 'resin' && v.code === resin)!;
    const first = await admin().patch(`/api/v1/admin/config/value-lists/${entry.id}`, {
      version: entry.version,
      changeReason: WHY,
      active: false,
    });
    expect(first.statusCode).toBe(409);
    const inUse = first.json<{ code: string; count: number }>();
    expect(inUse.code).toBe('value_in_use');
    expect(inUse.count).toBeGreaterThan(0);

    const confirmed = await admin().patch(`/api/v1/admin/config/value-lists/${entry.id}`, {
      version: entry.version,
      changeReason: WHY,
      active: false,
      confirmInUse: true,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const [still] = await db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.quote)
      .where(eq(schema.quote.resin, resin));
    expect(still!.n).toBeGreaterThan(0);
    const pub = await publicConfig();
    expect(pub.valueLists.resin!.some((v) => v.code === resin)).toBe(false);
  });

  it('adds an entry (provisional) and renames it', async () => {
    const res = await admin().post('/api/v1/admin/config/value-lists', {
      listKey: 'market',
      code: 'PET_CARE',
      label: 'Pet care',
      changeReason: WHY,
    });
    expect(res.statusCode, res.body).toBe(201);
    const entry = (await valueLists()).find((v) => v.code === 'PET_CARE')!;
    expect(entry).toMatchObject({ listKey: 'market', active: true, version: 1 });
    expect(entry.approval.provisional).toBe(true);
    const rename = await admin().patch(`/api/v1/admin/config/value-lists/${entry.id}`, {
      version: 1,
      changeReason: WHY,
      label: 'Pet care & animal health',
    });
    expect(rename.statusCode, rename.body).toBe(200);
    expect(
      (await publicConfig()).valueLists.market!.find((v) => v.code === 'PET_CARE')!.label,
    ).toBe('Pet care & animal health');
    const bad = await admin().post('/api/v1/admin/config/value-lists', {
      listKey: 'not_a_list',
      code: 'X',
      label: 'X',
      changeReason: WHY,
    });
    expect(bad.statusCode).toBe(422);
  });
});

describe('app settings', () => {
  it('changes the validity default through the domain validator', async () => {
    const s = await setting('validity_days_default');
    for (const value of [0, 30.5, null, '45']) {
      const res = await admin().patch('/api/v1/admin/config/settings/validity_days_default', {
        version: s.version,
        changeReason: WHY,
        value,
      });
      expect(res.statusCode, JSON.stringify(value)).toBe(422);
    }
    const res = await admin().patch('/api/v1/admin/config/settings/validity_days_default', {
      version: s.version,
      changeReason: WHY,
      value: 45,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await publicConfig()).settings.validity_days_default).toBe(45);
    const [entry] = await decisionLog('?entity=app_setting');
    expect(entry).toMatchObject({
      subject: 'Setting: validity_days_default',
      changeReason: WHY,
      changes: [{ path: 'value', before: 30, after: 45 }],
    });
  });

  it('lists every setting with an editor', async () => {
    const all = await settings();
    expect(all.find((s) => s.key === 'eng_queue_aging_days')!.editor).toBe('agingDays');
    expect(all.find((s) => s.key === 'g4_tier_rules')!).toMatchObject({ nullable: true });
    expect(all.find((s) => s.key === 'overridable_fields')!.editor).toBe('overridableFields');
  });

  it('g1_enabled flips the G1 and SUBMIT gates, confirming when quotes wait at G1', async () => {
    const wf = await workflow();
    expect(wf.g1Enabled!.value).toBe(true);
    const waiting = (
      await db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.quote)
        .where(
          and(
            eq(schema.quote.stageKey, 'INTAKE'),
            ne(schema.quote.status, 'closed'),
            sql`${schema.quote.submittedAt} is not null`,
          ),
        )
    )[0]!.n;
    const off = { version: wf.g1Enabled!.version, changeReason: WHY, value: false };
    if (waiting > 0) {
      const res = await admin().patch('/api/v1/admin/config/settings/g1_enabled', off);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'confirmation_required', waiting });
    }
    const res = await admin().patch('/api/v1/admin/config/settings/g1_enabled', {
      ...off,
      confirm: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    let gates = (await workflow()).gates;
    expect(gates.find((g) => g.key === 'G1')!.enabled).toBe(false);
    expect(gates.find((g) => g.key === 'SUBMIT')!.enabled).toBe(true);
    expect((await publicConfig()).gates.find((g) => g.key === 'G1')!.enabled).toBe(false);

    const back = await admin().patch('/api/v1/admin/config/settings/g1_enabled', {
      version: wf.g1Enabled!.version + 1,
      changeReason: WHY,
      value: true,
    });
    expect(back.statusCode, back.body).toBe(200);
    gates = (await workflow()).gates;
    expect(gates.find((g) => g.key === 'G1')!.enabled).toBe(true);
    expect(gates.find((g) => g.key === 'SUBMIT')!.enabled).toBe(false);
  });

  it('marks a setting approved without changing its value', async () => {
    const s = await setting('kam_can_see_peer_scores');
    const res = await admin().patch('/api/v1/admin/config/settings/kam_can_see_peer_scores', {
      version: s.version,
      changeReason: WHY,
      approved: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = await setting('kam_can_see_peer_scores');
    expect(after.value).toBe(s.value);
    expect(after.approval.provisional).toBe(false);
  });
});

describe('workflow labels and rules', () => {
  it('edits a stage label and help text; public config follows', async () => {
    const stage = (await workflow()).stages.find((s) => s.key === 'ENG_REVIEW')!;
    const res = await admin().patch('/api/v1/admin/config/stages/ENG_REVIEW', {
      version: stage.version,
      changeReason: WHY,
      label: 'Upfront Engineering',
      helpText: 'Feasibility, process and preliminary capital.',
    });
    expect(res.statusCode, res.body).toBe(200);
    const pub = (await publicConfig()).stages.find((s) => s.key === 'ENG_REVIEW')!;
    expect(pub).toMatchObject({
      label: 'Upfront Engineering',
      helpText: 'Feasibility, process and preliminary capital.',
    });
  });

  it('validates gate rules with the DSL schema before saving', async () => {
    const gate = (await workflow()).gates.find((g) => g.key === 'G2')!;
    const bad = await admin().patch('/api/v1/admin/config/gates/G2', {
      version: gate.version,
      changeReason: WHY,
      requiredFields: [{ field: 'process_type', op: 'exists' }],
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json<{ errors: unknown[] }>().errors.length).toBeGreaterThan(0);
    const rules = [
      ...gate.requiredFields,
      { anyOf: [{ field: 'eng_review.process_type', op: 'present' }] },
    ];
    const ok = await admin().patch('/api/v1/admin/config/gates/G2', {
      version: gate.version,
      changeReason: WHY,
      requiredFields: rules,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await workflow()).gates.find((g) => g.key === 'G2')!.requiredFields).toEqual(rules);
  });

  it('refuses to make a closing outcome skip its reason code', async () => {
    const wf = await workflow();
    const closing = wf.outcomes.find((o) => o.gateKey === 'G5' && o.key === 'lost')!;
    const res = await admin().patch(
      `/api/v1/admin/config/gates/${closing.gateKey}/outcomes/${closing.key}`,
      { version: closing.version, changeReason: WHY, requiresReasonCode: false },
    );
    expect(res.statusCode).toBe(422);
    const toggle = await admin().patch(
      `/api/v1/admin/config/gates/${closing.gateKey}/outcomes/${closing.key}`,
      { version: closing.version, changeReason: WHY, requiresNote: !closing.requiresNote },
    );
    expect(toggle.statusCode, toggle.body).toBe(200);
  });
});

describe('scoring model versions', () => {
  const allOnVolume = (attributes: unknown[]) =>
    attributes.map((a) => {
      const attr = a as { key: string };
      return { ...attr, weight: attr.key === 'volume' ? 1 : 0 };
    });

  it('drafts, previews, activates and rescores open quotes only', async () => {
    const before = await scoring();
    const active = before.versions.find((v) => v.status === 'active')!;
    expect(before.versions.some((v) => v.status === 'draft')).toBe(false);

    const created = await admin().post('/api/v1/admin/config/scoring/draft', {
      changeReason: WHY,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(
      (await admin().post('/api/v1/admin/config/scoring/draft', { changeReason: WHY })).statusCode,
    ).toBe(409);
    let draft = (await scoring()).versions.find((v) => v.status === 'draft')!;
    expect(draft.modelVersion).toBe(active.modelVersion + 1);
    expect(draft.model).toEqual(active.model);

    // Weights must sum to 1.
    const half = draft.model.attributes.map((a) => ({ ...(a as object), weight: 0.01 }));
    const bad = await admin().put('/api/v1/admin/config/scoring/draft', {
      version: draft.version,
      changeReason: WHY,
      model: { ...draft.model, attributes: half },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json<{ detail: string }>().detail).toMatch(/sum to 1/);

    const model = { ...draft.model, attributes: allOnVolume(draft.model.attributes) };
    const preview = await as('Leadership').post('/api/v1/admin/config/scoring/preview', { model });
    expect(preview.statusCode, preview.body).toBe(200);
    const p = ScoringPreviewResponse.parse(preview.json());
    expect(p.rows).toHaveLength(50);
    expect(p.activeVersion).toBe(active.modelVersion);
    expect(p.summary.tierChanges).toBeGreaterThan(0);

    const saved = await admin().put('/api/v1/admin/config/scoring/draft', {
      version: draft.version,
      changeReason: WHY,
      model,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    draft = (await scoring()).versions.find((v) => v.status === 'draft')!;

    // The draft is not used to score anything yet.
    expect((await publicConfig()).tiers.length).toBeGreaterThan(0);
    const closedBefore = await db.db
      .select({
        id: schema.quote.id,
        score: schema.quote.priorityScore,
        version: schema.quote.scoringModelVersion,
        breakdown: schema.quote.priorityBreakdown,
      })
      .from(schema.quote)
      .where(eq(schema.quote.status, 'closed'));
    expect(closedBefore.length).toBeGreaterThan(0);
    const evidenceBefore = await db.db
      .select({ id: schema.gateDecision.id, evidence: schema.gateDecision.evidence })
      .from(schema.gateDecision);
    const openCount = (
      await db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.quote)
        .where(ne(schema.quote.status, 'closed'))
    )[0]!.n;
    const eventsBefore = (
      await db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.activityEvent)
        .where(sql`${schema.activityEvent.payload}->>'trigger' = 'model_change'`)
    )[0]!.n;
    expect(eventsBefore).toBe(0);

    const activated = await admin().post('/api/v1/admin/config/scoring/draft/activate', {
      version: draft.version,
      changeReason: 'Volume-led ranking agreed at M4',
    });
    expect(activated.statusCode, activated.body).toBe(200);
    const body = ActivateScoringResponse.parse(activated.json());
    expect(body.rescoreQueued).toBe(openCount);
    expect(body.version).toMatchObject({ status: 'active', effectiveFrom: clock.toISOString() });
    await app.adminConfig.rescore.flush();

    // Open quotes: all on the new version.
    const open = await db.db
      .select({ version: schema.quote.scoringModelVersion })
      .from(schema.quote)
      .where(
        and(ne(schema.quote.status, 'closed'), sql`${schema.quote.priorityScore} is not null`),
      );
    expect(open.every((q) => q.version === draft.modelVersion)).toBe(true);
    // Closed quotes and gate-decision snapshots: untouched.
    const closedAfter = await db.db
      .select({
        id: schema.quote.id,
        score: schema.quote.priorityScore,
        version: schema.quote.scoringModelVersion,
        breakdown: schema.quote.priorityBreakdown,
      })
      .from(schema.quote)
      .where(eq(schema.quote.status, 'closed'));
    expect(closedAfter).toEqual(closedBefore);
    expect(
      await db.db
        .select({ id: schema.gateDecision.id, evidence: schema.gateDecision.evidence })
        .from(schema.gateDecision),
    ).toEqual(evidenceBefore);

    // One activity event per changed tier, and a summary row in the decision log.
    const events = (
      await db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.activityEvent)
        .where(sql`${schema.activityEvent.payload}->>'trigger' = 'model_change'`)
    )[0]!.n;
    const [summary] = await decisionLog('?entity=scoring_model');
    expect(summary!.subject).toBe(`Scoring model: v${draft.modelVersion} rescore`);
    const tierChanges = summary!.changes.find((c) => c.path === 'tierChanges')!.after as number;
    expect(events).toBe(tierChanges);
    expect(tierChanges).toBeGreaterThan(0);
    expect(summary!.changes.find((c) => c.path === 'failed')!.after).toBe(0);

    const after = await scoring();
    expect(after.versions.find((v) => v.modelVersion === draft.modelVersion)!.status).toBe(
      'active',
    );
    expect(after.versions.find((v) => v.modelVersion === active.modelVersion)!.status).toBe(
      'superseded',
    );
    // Old versions are read-only: there is no draft to write to.
    const write = await admin().put('/api/v1/admin/config/scoring/draft', {
      version: 1,
      changeReason: WHY,
      model,
    });
    expect(write.statusCode).toBe(404);
  });

  it('discards a draft', async () => {
    expect(
      (await admin().post('/api/v1/admin/config/scoring/draft', { changeReason: WHY })).statusCode,
    ).toBe(201);
    const draft = (await scoring()).versions.find((v) => v.status === 'draft')!;
    const res = await admin().post('/api/v1/admin/config/scoring/draft/discard', {
      version: draft.version,
      changeReason: 'Not needed after all',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await scoring()).versions.some((v) => v.status === 'draft')).toBe(false);
  });
});

describe('users and scope', () => {
  it('lists users with Entra roles and sets a scope (versioned, audited)', async () => {
    const me = MeResponse.parse((await as('KAM').get('/api/v1/me')).json());
    const list = await as('Leadership').get('/api/v1/admin/users');
    const body = AdminUsersResponse.parse(list.json());
    const kam = body.items.find((u) => u.id === me.user.id)!;
    expect(kam.roles).toEqual(['KAM']);

    const res = await admin().put(`/api/v1/admin/users/${kam.id}/scope`, {
      version: kam.scopeVersion,
      changeReason: WHY,
      type: 'region',
      values: ['West'],
    });
    expect(res.statusCode, res.body).toBe(200);
    const stale = await admin().put(`/api/v1/admin/users/${kam.id}/scope`, {
      version: kam.scopeVersion,
      changeReason: WHY,
      type: 'all',
    });
    expect(stale.statusCode).toBe(409);
    const updated = AdminUsersResponse.parse(
      (await admin().get('/api/v1/admin/users')).json(),
    ).items.find((u) => u.id === kam.id)!;
    expect(updated.scope).toEqual({ type: 'region', values: ['West'] });
    // The new scope applies on the KAM's next request (the identity cache was cleared).
    const after = MeResponse.parse((await as('KAM').get('/api/v1/me')).json());
    expect(after.scope).toEqual({ type: 'region', values: ['West'] });

    const needsValues = await admin().put(`/api/v1/admin/users/${kam.id}/scope`, {
      version: updated.scopeVersion,
      changeReason: WHY,
      type: 'region',
      values: [],
    });
    expect(needsValues.statusCode).toBe(400);
    const restore = await admin().put(`/api/v1/admin/users/${kam.id}/scope`, {
      version: updated.scopeVersion,
      changeReason: WHY,
      type: 'all',
    });
    expect(restore.statusCode, restore.body).toBe(200);
  });
});

describe('integrations and the decision log', () => {
  it('reports connector health per source', async () => {
    const res = await as('Leadership').get('/api/v1/admin/integrations/health');
    expect(res.statusCode, res.body).toBe(200);
    const { items } = ConnectorHealthResponse.parse(res.json());
    expect(items.map((i) => i.source)).toEqual([
      'salesforce',
      'pricing',
      'sharepoint',
      'mail',
      'fabric',
    ]);
    expect(items.find((i) => i.source === 'salesforce')!.mode).toBe('fake');
  });

  it('pages the decision log newest first and exports it (audited)', async () => {
    const page1 = await as('Leadership').get('/api/v1/admin/config/decision-log?limit=3');
    const body = DecisionLogResponse.parse(page1.json());
    expect(body.items).toHaveLength(3);
    expect(body.nextCursor).toBeTruthy();
    const ats = body.items.map((i) => i.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    const page2 = DecisionLogResponse.parse(
      (
        await as('Leadership').get(
          `/api/v1/admin/config/decision-log?limit=3&cursor=${body.nextCursor}`,
        )
      ).json(),
    );
    expect(page2.items[0]!.at <= body.items[2]!.at).toBe(true);
    expect(body.items.every((i) => i.changeReason)).toBe(true);

    const csv = await as('Leadership').get('/api/v1/admin/config/decision-log/export.csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body.split('\r\n')[0]).toBe('When (UTC),Who,Email,What,Why,Changes');
    expect(csv.body).toContain('Setting: validity_days_default');
    expect(csv.body).toContain('value: 30 → 45');
    const [exported] = await db.db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.entity, 'decision_log'));
    expect(exported).toMatchObject({ action: 'export' });
  });
});

describe('server config cache', () => {
  it('serves /config/public from cache and drops it on an admin change', async () => {
    const cached = await buildApp(testConfig({ DATABASE_URL: url, CONFIG_CACHE_SECONDS: '300' }), {
      db,
      now: () => clock,
    });
    await cached.ready();
    try {
      const get = async () =>
        PublicConfigResponse.parse(
          (await asRole(cached, 'KAM').get('/api/v1/config/public')).json(),
        );
      const before = await get();
      // A direct DB change is not seen while cached…
      await db.sql`update stage_definition set label = 'Hidden by cache' where key = 'QUOTING'`;
      expect((await get()).stages.find((s) => s.key === 'QUOTING')!.label).toBe(
        before.stages.find((s) => s.key === 'QUOTING')!.label,
      );
      // …but an admin change through the API clears the cache.
      const stage = AdminWorkflowResponse.parse(
        (await asRole(cached, 'Admin').get('/api/v1/admin/config/workflow')).json(),
      ).stages.find((s) => s.key === 'QUOTING')!;
      const res = await asRole(cached, 'Admin').patch('/api/v1/admin/config/stages/QUOTING', {
        version: stage.version,
        changeReason: WHY,
        label: 'Pricing',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((await get()).stages.find((s) => s.key === 'QUOTING')!.label).toBe('Pricing');
    } finally {
      await cached.close();
    }
  });
});
