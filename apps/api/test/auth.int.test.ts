import { randomUUID } from 'node:crypto';

import { createDb, schema, type DbClient } from '@ccq/db';
import { findUserByEntraOid, listUserRoles, setUserScope, upsertUser } from '@ccq/db/repos';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { devIdentity } from '../src/auth/dev';
import { createIdentityService, createPgDirectory, SIGN_IN_WINDOW_MS } from '../src/auth/directory';
import type { Identity } from '../src/auth/identity';
import { entraTestEnv, testKeys } from '../src/auth/test-jwt';
import { testConfig } from '../src/test-utils';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://ccq:ccq@localhost:5432/ccq_test';
let db: DbClient;

beforeAll(() => {
  db = createDb(url);
});
afterAll(async () => {
  await db.close();
});

const entraIdentity = (roles: Identity['roles'], oid = randomUUID()): Identity => ({
  oid,
  upn: `${oid}@pretium.example`,
  displayName: 'Test User',
  email: `${oid}@pretium.example`,
  roles,
});

const signIns = (userId: string) =>
  db.db
    .select()
    .from(schema.auditEvent)
    .where(and(eq(schema.auditEvent.actorId, userId), eq(schema.auditEvent.action, 'sign_in')));

describe('Postgres user directory', () => {
  it('upserts app_user by oid and syncs user_role to the token (removing stale roles)', async () => {
    const dir = createPgDirectory(db.db);
    const who = entraIdentity(['KAM', 'Pricing']);
    const first = await dir.provision(who);
    expect(await listUserRoles(db.db, first.userId)).toEqual(
      expect.arrayContaining(['KAM', 'Pricing']),
    );

    const second = await dir.provision({ ...who, displayName: 'Renamed', roles: ['Pricing'] });
    expect(second.userId).toBe(first.userId);
    expect(await listUserRoles(db.db, first.userId)).toEqual(['Pricing']);
    const row = await findUserByEntraOid(db.db, who.oid);
    expect(row).toMatchObject({ displayName: 'Renamed' });
    expect(row?.lastSeenAt).toBeInstanceOf(Date);
  });

  it('defaults scope to all, and uses a stored user_scope when present', async () => {
    const dir = createPgDirectory(db.db);
    const who = entraIdentity(['KAM']);
    expect((await dir.provision(who)).scope).toEqual({ type: 'all' });
    const user = await findUserByEntraOid(db.db, who.oid);
    await setUserScope(db.db, user!.id, { type: 'region', values: ['West'] });
    expect((await dir.provision(who)).scope).toEqual({ type: 'region', values: ['West'] });
  });

  it('dev personas get their persona scope and keep a seeded profile', async () => {
    const dir = createPgDirectory(db.db);
    const who = devIdentity('engineer-owner');
    const user = await dir.provision(who);
    expect(user.roles).toEqual(['Engineer']);
    expect(user.scope).toEqual({ type: 'owner' });
    await upsertUser(db.db, {
      entraOid: who.oid,
      upn: 'seeded@example.com',
      displayName: 'Seeded Name',
      email: 'seeded@example.com',
    });
    expect(await dir.provision(who)).toMatchObject({ displayName: 'Seeded Name' });
  });

  it('refuses a deactivated user', async () => {
    const dir = createPgDirectory(db.db);
    const who = entraIdentity(['Admin']);
    const user = await dir.provision(who);
    await db.db
      .update(schema.appUser)
      .set({ active: false })
      .where(eq(schema.appUser.id, user.userId));
    await expect(dir.provision(who)).rejects.toMatchObject({ status: 403 });
  });

  it('writes one sign_in audit per 8 hours, across service instances', async () => {
    const dir = createPgDirectory(db.db);
    const who = entraIdentity(['Leadership']);
    const a = createIdentityService(dir);
    const user = await a.resolve(who, { ip: '10.1.2.3', userAgent: 'vitest', requestId: 'req-1' });
    await a.resolve(who, {});
    // A second API instance (fresh in-memory memo) still sees the row in the database.
    await createIdentityService(dir).resolve(who, {});
    const rows = await signIns(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorRoles: ['Leadership'],
      entity: 'app_user',
      entityId: user.userId,
      ip: '10.1.2.3',
      userAgent: 'vitest',
      requestId: 'req-1',
    });

    // Eight hours on, the next request is a new session.
    const later = createIdentityService(dir, {
      now: () => new Date(Date.now() + SIGN_IN_WINDOW_MS + 60_000),
    });
    await later.resolve(who, {});
    expect(await signIns(user.userId)).toHaveLength(2);
  });

  it('reports boolean app settings as camelCased feature flags', async () => {
    await db.db
      .insert(schema.appSetting)
      .values({ key: 'b04_test_flag', value: true, description: 'test' })
      .onConflictDoNothing();
    const flags = await createPgDirectory(db.db).featureFlags();
    expect(flags).toMatchObject({ b04TestFlag: true });
  });
});

describe('API with Entra tokens against Postgres', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let keys: Awaited<ReturnType<typeof testKeys>>;

  beforeAll(async () => {
    keys = await testKeys();
    app = await buildApp(testConfig({ DATABASE_URL: url, ...entraTestEnv }), {
      db: createDb(url),
      entraKeySet: keys.keySet,
    });
    app.get('/api/v1/test-context', { config: { permission: 'authenticated' } }, (req) =>
      app.withTx(req, async (tx) => {
        const [row] = await tx.execute<{
          user_id: string;
          roles: string;
          scope_type: string;
          role: string;
        }>(
          sql`select current_setting('app.user_id', true) as user_id,
                     current_setting('app.roles', true) as roles,
                     current_setting('app.scope_type', true) as scope_type,
                     current_user as role`,
        );
        return row;
      }),
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /me provisions the user from the token and audits the sign-in', async () => {
    const oid = randomUUID();
    const token = await keys.sign({ oid, roles: ['CCQ.EngLead', 'CCQ.Admin'] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: { id: string }; roles: string[] }>();
    expect(body.roles).toEqual(['Admin', 'EngLead']);
    expect(await findUserByEntraOid(db.db, oid)).toMatchObject({ id: body.user.id });
    expect(await signIns(body.user.id)).toHaveLength(1);
  });

  it('withTx sets the RLS context and runs as ccq_app', async () => {
    const oid = randomUUID();
    const token = await keys.sign({ oid, roles: ['CCQ.KAM', 'CCQ.Pricing'] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/test-context',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const user = await findUserByEntraOid(db.db, oid);
    expect(res.json()).toEqual({
      user_id: user!.id,
      roles: 'KAM,Pricing',
      scope_type: 'all',
      role: 'ccq_app',
    });
  });

  it('no-role tokens are refused before anything is written', async () => {
    const oid = randomUUID();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${await keys.sign({ oid, roles: [] })}` },
    });
    expect(res.statusCode).toBe(403);
    expect(await findUserByEntraOid(db.db, oid)).toBeUndefined();
  });
});
