import { readdirSync, readFileSync } from 'node:fs';

import { buildHybridConfig } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import { ATTACHMENT_KINDS_BY_PLACE } from '../seeds/config/settings';
import type { Tx } from '../src/client';

/**
 * FB-26 (N17-30 to N17-32): the linked re-quote, the expiry recipients and the CER at hand-off in
 * existing environments.
 *
 * - quote.requote rows (KAM own, SalesLeader), provisional.
 * - The five new settings (provisional) and the hand-off place in attachment_kinds_by_place.
 * - G6 Advance also reads cer_proof_ok; the G5 Re-quote help points to the linked re-quote.
 * - An approved or Admin-edited row is left alone; a database with no config is untouched.
 *
 * The migration ran in the global setup (an empty database, then the seed); each test re-runs its data
 * statements in a rolled-back transaction from the state an environment had before it.
 */
const { db } = testDb();
const FILE = readdirSync(new URL('../migrations/', import.meta.url)).find((f) =>
  f.endsWith('_fb26_requote_expiry_handoff.sql'),
)!;
const MIGRATION = readFileSync(new URL(`../migrations/${FILE}`, import.meta.url), 'utf8');
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- FB-26 (N17-30 to N17-32): data.'));
const statements = DATA.split('--> statement-breakpoint').filter((s) => {
  const body = s.replace(/--.*$/gm, '').trim();
  return body !== '' && /^(INSERT|UPDATE)/i.test(body);
});

class Rollback extends Error {}
async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    })
    .catch((err: unknown) => {
      if (!(err instanceof Rollback)) throw err;
    });
}
const runMigration = async (tx: Tx) => {
  for (const s of statements) await tx.execute(sql.raw(s));
};

const NEW_SETTINGS = [
  'linked_requote_allowed_from',
  'validity_notice_recipients',
  'cer_tool_url',
  'cer_template_url',
  'handoff_cer_proof_required',
];
const OLD_G6_ADVANCE = [
  { field: 'handoff_record.cer_status', op: 'oneOf', value: ['approved', 'not_required'] },
  { field: 'handoff_record.completed_at', op: 'present' },
];
const OLD_G5_REQUOTE_HELP =
  'Something changed (scope, volume, resin, terms). It goes back to the affected gate as a new version; nothing is edited silently.';
const { handoff: _h, ...FB24_PLACES } = ATTACHMENT_KINDS_BY_PLACE;

const seed = buildHybridConfig();
const seedOutcome = (gate: string, key: string) =>
  seed.outcomes.find((o) => o.gateKey === gate && o.key === key)!;

/** Before FB-26: no new settings or grants, 0051's file lists, the old G6 rule and G5 help. */
async function preFb26(tx: Tx) {
  await tx.execute(
    sql`delete from app_setting where key in ${sql.raw(`('${NEW_SETTINGS.join("','")}')`)}`,
  );
  await tx.execute(sql`delete from role_permission where permission = 'quote.requote'`);
  await tx.execute(
    sql`update app_setting set value = ${JSON.stringify(FB24_PLACES)}::jsonb where key = 'attachment_kinds_by_place'`,
  );
  await tx.execute(
    sql`update gate_outcome_definition set required_fields = ${JSON.stringify(OLD_G6_ADVANCE)}::jsonb
        where gate_key = 'G6' and key = 'advance'`,
  );
  await tx.execute(
    sql`update gate_outcome_definition set help_text = ${OLD_G5_REQUOTE_HELP}
        where gate_key = 'G5' and key = 'requote'`,
  );
}

const setting = async (tx: Tx, key: string) =>
  (await raw<{ value: unknown }>(tx, sql`select value from app_setting where key = ${key}`))[0]
    ?.value;
const outcome = async (tx: Tx, gate: string, key: string) =>
  (
    await raw<{ required_fields: unknown; help_text: string | null }>(
      tx,
      sql`select required_fields, help_text from gate_outcome_definition where gate_key = ${gate} and key = ${key}`,
    )
  )[0]!;

describe('FB-26 config in a configured environment', () => {
  it('adds the grants, the settings, the hand-off file place, the G6 rule and the G5 help as the seed has them', async () => {
    await rolledBack(async (tx) => {
      await preFb26(tx);
      await runMigration(tx);
      expect(
        await raw(
          tx,
          sql`select role, qualifier, provisional from role_permission where permission = 'quote.requote' order by role`,
        ),
      ).toEqual([
        { role: 'KAM', qualifier: { kind: 'own' }, provisional: true },
        { role: 'SalesLeader', qualifier: null, provisional: true },
      ]);
      expect(await setting(tx, 'linked_requote_allowed_from')).toEqual([
        'closed_expired',
        'open_lapsed',
      ]);
      expect(await setting(tx, 'validity_notice_recipients')).toEqual(['kam', 'g1_decider']);
      expect(await setting(tx, 'cer_tool_url')).toBe('');
      expect(await setting(tx, 'cer_template_url')).toBe('');
      expect(await setting(tx, 'handoff_cer_proof_required')).toBe(false);
      expect(
        (
          await raw<{ n: number }>(
            tx,
            sql`select count(*)::int as n from app_setting where provisional and key in ${sql.raw(`('${NEW_SETTINGS.join("','")}')`)}`,
          )
        )[0]!.n,
      ).toBe(NEW_SETTINGS.length);
      expect(await setting(tx, 'attachment_kinds_by_place')).toEqual(ATTACHMENT_KINDS_BY_PLACE);
      const g6 = await outcome(tx, 'G6', 'advance');
      expect(g6.required_fields).toEqual(seedOutcome('G6', 'advance').requiredFields);
      const g5 = await outcome(tx, 'G5', 'requote');
      expect(g5.help_text).toBe(seedOutcome('G5', 'requote').helpText);
      expect(g5.help_text).toMatch(/After it has expired, start a linked re-quote/);
    });
  });

  it('leaves an Admin-edited or approved row alone', async () => {
    await rolledBack(async (tx) => {
      await preFb26(tx);
      const edited = { intake: ['other'], quote: ['other'] };
      await tx.execute(
        sql`update app_setting set value = ${JSON.stringify(edited)}::jsonb where key = 'attachment_kinds_by_place'`,
      );
      await tx.execute(
        sql`update gate_outcome_definition set approved_at = now() where gate_key = 'G6' and key = 'advance'`,
      );
      await tx.execute(
        sql`update gate_outcome_definition set help_text = 'Our own words' where gate_key = 'G5' and key = 'requote'`,
      );
      await tx.execute(
        sql`insert into app_setting (id, key, value, description, provisional)
            values (gen_random_uuid(), 'cer_tool_url', '"https://cer.example.test"'::jsonb, 'set by an Admin', false)`,
      );
      await runMigration(tx);
      expect(await setting(tx, 'attachment_kinds_by_place')).toEqual(edited);
      expect((await outcome(tx, 'G6', 'advance')).required_fields).toEqual(OLD_G6_ADVANCE);
      expect((await outcome(tx, 'G5', 'requote')).help_text).toBe('Our own words');
      expect(await setting(tx, 'cer_tool_url')).toBe('https://cer.example.test');
    });
  });

  it('is safe to re-run', async () => {
    await rolledBack(async (tx) => {
      await preFb26(tx);
      await runMigration(tx);
      await runMigration(tx);
      expect(
        (
          await raw<{ n: number }>(
            tx,
            sql`select count(*)::int as n from role_permission where permission = 'quote.requote'`,
          )
        )[0]!.n,
      ).toBe(2);
      expect((await outcome(tx, 'G6', 'advance')).required_fields).toEqual(
        seedOutcome('G6', 'advance').requiredFields,
      );
    });
  });

  it('a database with no config yet is untouched (the seed inserts the same values)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from role_permission`);
      await tx.execute(sql`delete from app_setting`);
      await runMigration(tx);
      expect(await raw(tx, sql`select 1 from role_permission`)).toEqual([]);
      expect(await raw(tx, sql`select 1 from app_setting`)).toEqual([]);
    });
  });
});

describe('FB-26 schema', () => {
  it('allows one linked re-quote per quote and one open re-quote draft per quote', async () => {
    const indexes = await raw<{ indexname: string; indexdef: string }>(
      db as unknown as Tx,
      sql`select indexname, indexdef from pg_indexes
          where indexname in ('quote_requoted_from_quote_id_uidx', 'quote_draft_one_open_requote_uidx')
          order by indexname`,
    );
    expect(indexes.map((i) => i.indexname)).toEqual([
      'quote_draft_one_open_requote_uidx',
      'quote_requoted_from_quote_id_uidx',
    ]);
    expect(indexes.every((i) => i.indexdef.startsWith('CREATE UNIQUE INDEX'))).toBe(true);
  });

  it('accepts the versioned cer_proof kind', async () => {
    const [check] = await raw<{ def: string }>(
      db as unknown as Tx,
      sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'attachment_version_check'`,
    );
    expect(check!.def).toContain('cer_proof');
  });
});
