import { readdirSync, readFileSync } from 'node:fs';

import { buildHybridConfig } from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import { INTAKE_FIELD_HELP, INTAKE_REDIRECT_MESSAGE } from '../seeds/config/settings';
import { VALUE_LISTS } from '../seeds/config/value-lists';
import type { Tx } from '../src/client';

/**
 * FB-33 (N19-20, N19-21, N19-13 example): the words on screen in existing environments.
 *
 * - The request class "CCQ" is spelled out; the Stock and stock-plus sentences name Salesforce; the
 *   variants help no longer suggests a site scenario.
 * - A row the business approved or an Admin edited is left alone; a database with no config is untouched.
 *
 * The migration ran in the global setup (an empty database, then the seed); each test re-runs its data
 * statements in a rolled-back transaction from the state an environment had before it.
 */
const { db } = testDb();
const FILE = readdirSync(new URL('../migrations/', import.meta.url)).find((f) =>
  f.endsWith('_fb33_words_on_screen.sql'),
)!;
const MIGRATION = readFileSync(new URL(`../migrations/${FILE}`, import.meta.url), 'utf8');
const statements = MIGRATION.split('--> statement-breakpoint').filter((s) => {
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

// The texts before FB-33: what 0028, 0051 and the FB-02 seed left in existing environments.
const OLD_LABEL = 'CCQ (new business + capital/engineering)';
const OLD_REDIRECT =
  'Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application for now. Submit them there.';
const OLD_HELP = {
  request_class:
    'CCQ is new business that needs engineering or capital. Concept / innovation is CCQ work that starts from a render or a photo instead of a drawing. Stock, stock-plus, price inquiries and pack-out evaluations stay in the pricing application.',
  sf_opportunity_id:
    'Every CCQ quote starts from a Salesforce opportunity, so pipeline and outcomes stay linked.',
  quote_variants_note:
    'Variants the customer wants priced, e.g. "0/25/50% PCR; near-site vs ideal-site". Optional.',
};
const OLD_G1_REDIRECT_HELP =
  'Not CCQ work (stock, stock-plus, a price inquiry, capital not tied to a quote). It closes as Redirected so it can take its own path.';

const seedOutcome = buildHybridConfig().outcomes.find(
  (o) => o.gateKey === 'G1' && o.key === 'redirect',
)!;
const seedLabel = VALUE_LISTS.request_class.find(([code]) => code === 'CCQ')![1];

/** Before FB-33: the old words everywhere. */
async function preFb33(tx: Tx) {
  await tx.execute(
    sql`update value_list set label = ${OLD_LABEL} where list_key = 'request_class' and code = 'CCQ'`,
  );
  await tx.execute(
    sql`update app_setting set value = to_jsonb(${OLD_REDIRECT}::text) where key = 'intake_redirect_message'`,
  );
  await tx.execute(
    sql`update app_setting set value = value || ${JSON.stringify(OLD_HELP)}::jsonb where key = 'intake_field_help'`,
  );
  await tx.execute(
    sql`update gate_outcome_definition set help_text = ${OLD_G1_REDIRECT_HELP} where gate_key = 'G1' and key = 'redirect'`,
  );
}

const setting = async (tx: Tx, key: string) =>
  (await raw<{ value: unknown }>(tx, sql`select value from app_setting where key = ${key}`))[0]
    ?.value;
const help = async (tx: Tx) => (await setting(tx, 'intake_field_help')) as Record<string, string>;
const label = async (tx: Tx) =>
  (
    await raw<{ label: string }>(
      tx,
      sql`select label from value_list where list_key = 'request_class' and code = 'CCQ'`,
    )
  )[0]!.label;
const g1Help = async (tx: Tx) =>
  (
    await raw<{ help_text: string | null }>(
      tx,
      sql`select help_text from gate_outcome_definition where gate_key = 'G1' and key = 'redirect'`,
    )
  )[0]!.help_text;

describe('FB-33 words in a configured environment', () => {
  it('the seed holds the new words', () => {
    expect(seedLabel).toBe(
      'Commercial Capital Quote (CCQ): new business that needs engineering or capital',
    );
    expect(INTAKE_REDIRECT_MESSAGE).toMatch(
      /^Stock and stock-plus requests are handled in Salesforce\./,
    );
    expect(INTAKE_REDIRECT_MESSAGE).toContain(
      'Price inquiries and pack-out evaluations stay in the pricing application',
    );
    expect(INTAKE_FIELD_HELP.request_class).toContain(
      'Stock and stock-plus are handled in Salesforce.',
    );
    expect(INTAKE_FIELD_HELP.quote_variants_note).not.toMatch(/site/i);
    expect(seedOutcome.helpText).toContain('handled in Salesforce');
  });

  it('replaces each old text with the seed text', async () => {
    await rolledBack(async (tx) => {
      await preFb33(tx);
      await runMigration(tx);
      expect(await label(tx)).toBe(seedLabel);
      expect(await setting(tx, 'intake_redirect_message')).toBe(INTAKE_REDIRECT_MESSAGE);
      const h = await help(tx);
      expect(h.request_class).toBe(INTAKE_FIELD_HELP.request_class);
      expect(h.sf_opportunity_id).toBe(INTAKE_FIELD_HELP.sf_opportunity_id);
      expect(h.quote_variants_note).toBe(INTAKE_FIELD_HELP.quote_variants_note);
      expect(await g1Help(tx)).toBe(seedOutcome.helpText);
    });
  });

  it('keeps the other help keys and the other request classes as they were', async () => {
    await rolledBack(async (tx) => {
      await preFb33(tx);
      const before = await help(tx);
      const classesBefore = await raw(
        tx,
        sql`select code, label from value_list where list_key = 'request_class' and code <> 'CCQ' order by code`,
      );
      await runMigration(tx);
      const after = await help(tx);
      for (const k of Object.keys(before)) {
        if (k in OLD_HELP) continue;
        expect(after[k], k).toBe(before[k]);
      }
      expect(
        await raw(
          tx,
          sql`select code, label from value_list where list_key = 'request_class' and code <> 'CCQ' order by code`,
        ),
      ).toEqual(classesBefore);
    });
  });

  it('leaves an Admin-edited row alone', async () => {
    await rolledBack(async (tx) => {
      await preFb33(tx);
      await tx.execute(
        sql`update value_list set label = 'Quote (CCQ)' where list_key = 'request_class' and code = 'CCQ'`,
      );
      await tx.execute(
        sql`update app_setting set value = '"Stock goes to the pricing application."'::jsonb where key = 'intake_redirect_message'`,
      );
      await tx.execute(
        sql`update app_setting set value = jsonb_set(value, '{request_class}', '"Our own words"'::jsonb) where key = 'intake_field_help'`,
      );
      await tx.execute(
        sql`update gate_outcome_definition set help_text = 'Our own words' where gate_key = 'G1' and key = 'redirect'`,
      );
      await runMigration(tx);
      expect(await label(tx)).toBe('Quote (CCQ)');
      expect(await setting(tx, 'intake_redirect_message')).toBe(
        'Stock goes to the pricing application.',
      );
      const h = await help(tx);
      expect(h.request_class).toBe('Our own words');
      // A key the Admin did not touch still changes.
      expect(h.quote_variants_note).toBe(INTAKE_FIELD_HELP.quote_variants_note);
      expect(await g1Help(tx)).toBe('Our own words');
    });
  });

  it('leaves an approved row alone', async () => {
    await rolledBack(async (tx) => {
      await preFb33(tx);
      await tx.execute(
        sql`update value_list set approved_at = now() where list_key = 'request_class' and code = 'CCQ'`,
      );
      await tx.execute(
        sql`update app_setting set approved_at = now() where key in ('intake_redirect_message', 'intake_field_help')`,
      );
      await tx.execute(
        sql`update gate_outcome_definition set approved_at = now() where gate_key = 'G1' and key = 'redirect'`,
      );
      await runMigration(tx);
      expect(await label(tx)).toBe(OLD_LABEL);
      expect(await setting(tx, 'intake_redirect_message')).toBe(OLD_REDIRECT);
      expect((await help(tx)).request_class).toBe(OLD_HELP.request_class);
      expect(await g1Help(tx)).toBe(OLD_G1_REDIRECT_HELP);
    });
  });

  it('is safe to re-run', async () => {
    await rolledBack(async (tx) => {
      await preFb33(tx);
      await runMigration(tx);
      await runMigration(tx);
      expect(await label(tx)).toBe(seedLabel);
      expect(await setting(tx, 'intake_redirect_message')).toBe(INTAKE_REDIRECT_MESSAGE);
      expect((await help(tx)).request_class).toBe(INTAKE_FIELD_HELP.request_class);
    });
  });

  it('a database with no config yet is untouched (the seed inserts the same words)', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from value_list where list_key = 'request_class'`);
      await tx.execute(sql`delete from app_setting`);
      await runMigration(tx);
      expect(await raw(tx, sql`select 1 from value_list where list_key = 'request_class'`)).toEqual(
        [],
      );
      expect(await raw(tx, sql`select 1 from app_setting`)).toEqual([]);
    });
  });
});
