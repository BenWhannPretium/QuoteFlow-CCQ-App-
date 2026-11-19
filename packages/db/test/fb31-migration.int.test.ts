import { readdirSync, readFileSync } from 'node:fs';

import {
  G4_ADDITIONAL_APPROVALS_SEED,
  G4_ADDITIONAL_APPROVALS_SEED_FB08,
  TERMS_EXCEPTION_ROUTES_SEED,
} from '@ccq/domain';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { raw, testDb } from './helpers';
import {
  G4_ADDITIONAL_APPROVALS_DESCRIPTION,
  G4_ADDITIONAL_APPROVALS_DESCRIPTION_FB31,
  G4_REQUIRED_CHECKS_DESCRIPTION,
  G4_REQUIRED_CHECKS_DESCRIPTION_FB31,
  INTAKE_FIELD_HELP,
  STANDARD_PAYMENT_TERMS_DESCRIPTION_FB31,
  STOCK_HOLD_HELP_FB24,
  TERMS_EXCEPTION_ROUTES_DESCRIPTION,
} from '../seeds/config/settings';
import {
  AMORTIZED_HELP,
  COMPANY_FUNDED_HELP,
  CUSTOMER_FUNDED_HELP,
  FB31_FUNDING_HELP,
  FB31_FUNDING_LABELS,
  NOT_DISCUSSED_HELP,
} from '../seeds/config/value-lists';
import type { Tx } from '../src/client';

/**
 * FB-31 (N19-07, N19-08, N19-10): migration 0057 in existing environments.
 *
 * - The senior payment-terms grant (Leadership), terms_exception_routes (a provisional guess), and the
 *   routing of the requests pending now.
 * - The four funding labels and help, the amortized flag, $0 CER and Shared retired, the amortized
 *   finance-review sign-off, the descriptions and the stock help text.
 * - An approved or Admin-edited row is left alone; a database with no config is untouched; re-runs are
 *   no-ops.
 *
 * The migration ran in the global setup (an empty database, then the seed); each test re-runs its data
 * statements in a rolled-back transaction from the state an environment had before it.
 */
const { db } = testDb();
const FILE = readdirSync(new URL('../migrations/', import.meta.url)).find((f) =>
  f.endsWith('_fb31_commercial_terms_governance.sql'),
)!;
const MIGRATION = readFileSync(new URL(`../migrations/${FILE}`, import.meta.url), 'utf8');
const DATA = MIGRATION.slice(MIGRATION.indexOf('-- FB-31 (N19-07, N19-08, N19-10): data.'));
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

const OLD_LABELS: Record<string, string> = {
  CUSTOMER_FUNDED: 'Customer-funded',
  AMORTIZED: 'Amortized',
  COMPANY_FUNDED: 'Company-funded',
  NOT_DISCUSSED: 'Not discussed',
};
const OLD_HELP: Record<string, string> = {
  CUSTOMER_FUNDED: CUSTOMER_FUNDED_HELP,
  AMORTIZED: AMORTIZED_HELP,
  COMPANY_FUNDED: COMPANY_FUNDED_HELP,
  NOT_DISCUSSED: NOT_DISCUSSED_HELP,
};
const OLD_STANDARD_TERMS_DESCRIPTION =
  'FB-11 (F-080, D-032, A-012 decided Nov 9): the requested_payment_terms codes that count as standard. Any other request is flagged "Non-standard: Pricing will review" on the intake and the quote. Net 15 and Net 30 are both standard (Gemma Cebolla, Nov 9); still marked provisional until an Admin approves it.';

/** Before FB-31: no grant or routes, 0051's funding list and texts, FB-08's sign-off rule. */
async function preFb31(tx: Tx) {
  await tx.execute(
    sql`delete from role_permission where permission = 'terms.exception.decide.senior'`,
  );
  await tx.execute(sql`delete from app_setting where key = 'terms_exception_routes'`);
  for (const [code, label] of Object.entries(OLD_LABELS)) {
    await tx.execute(sql`update value_list
      set label = ${label}, meta = (meta - 'requiresFinanceReview') || jsonb_build_object('helpText', ${OLD_HELP[code]!}::text)
      where list_key = 'tooling_funding_model' and code = ${code}`);
  }
  await tx.execute(sql`update value_list set active = true
    where list_key = 'tooling_funding_model' and code in ('ZERO_CER', 'SHARED')`);
  await tx.execute(sql`update app_setting
    set value = ${JSON.stringify(G4_ADDITIONAL_APPROVALS_SEED_FB08)}::jsonb, description = ${G4_ADDITIONAL_APPROVALS_DESCRIPTION}
    where key = 'g4_additional_approvals'`);
  await tx.execute(sql`update app_setting set description = ${G4_REQUIRED_CHECKS_DESCRIPTION}
    where key = 'g4_required_checks'`);
  await tx.execute(sql`update app_setting set description = ${OLD_STANDARD_TERMS_DESCRIPTION}
    where key = 'standard_payment_terms'`);
  await tx.execute(sql`update app_setting
    set value = jsonb_set(value, '{stock_hold_requested}', to_jsonb(${STOCK_HOLD_HELP_FB24}::text))
    where key = 'intake_field_help'`);
}

/** Two pending requests (Net 45 and Net 60) and one decided (Net 90), as before FB-31. */
async function pendingRequests(tx: Tx) {
  const [q] = await raw<{ id: string; kam: string }>(
    tx,
    sql`select id, kam_user_id as kam from quote order by quote_number limit 1`,
  );
  const insert = (code: string, status: string, at: string) =>
    tx.execute(sql`insert into terms_exception_request
      (id, quote_id, quote_version, payment_terms_code, status, requested_by, requested_at,
       decided_by, decided_at, rationale)
      values (gen_random_uuid(), ${q!.id}, 1, ${code}, ${status}, ${q!.kam}, ${at}::timestamptz,
       ${status === 'approved' ? q!.kam : null}, ${status === 'approved' ? at : null}::timestamptz,
       ${status === 'approved' ? 'ok' : null})`);
  await insert('NET_45', 'pending', '2026-11-18T10:00:00Z');
  await insert('NET_60', 'pending', '2026-11-18T11:00:00Z');
  await insert('NET_90', 'approved', '2026-11-18T12:00:00Z');
  return q!.id;
}

const setting = async (tx: Tx, key: string) =>
  (
    await raw<{ value: unknown; description: string }>(
      tx,
      sql`select value, description from app_setting where key = ${key}`,
    )
  )[0];
const funding = async (tx: Tx) =>
  Object.fromEntries(
    (
      await raw<{
        code: string;
        label: string;
        active: boolean;
        provisional: boolean;
        meta: Record<string, unknown>;
      }>(
        tx,
        sql`select code, label, active, provisional, meta from value_list where list_key = 'tooling_funding_model'`,
      )
    ).map((r) => [r.code, r]),
  );

describe('FB-31 config in a configured environment', () => {
  it('adds the grant and the routes, relabels and retires funding, and switches on the amortized review', async () => {
    await rolledBack(async (tx) => {
      await preFb31(tx);
      await runMigration(tx);
      expect(
        await raw(
          tx,
          sql`select role, qualifier, provisional from role_permission where permission = 'terms.exception.decide.senior'`,
        ),
      ).toEqual([{ role: 'Leadership', qualifier: null, provisional: true }]);
      const routes = await setting(tx, 'terms_exception_routes');
      expect(routes!.value).toEqual(TERMS_EXCEPTION_ROUTES_SEED);
      expect(routes!.description).toBe(TERMS_EXCEPTION_ROUTES_DESCRIPTION);

      const by = await funding(tx);
      for (const code of Object.keys(OLD_LABELS) as (keyof typeof FB31_FUNDING_LABELS)[]) {
        expect(by[code]!.label, code).toBe(FB31_FUNDING_LABELS[code]);
        expect(by[code]!.meta.helpText, code).toBe(FB31_FUNDING_HELP[code]);
        expect(by[code]!.active).toBe(true);
      }
      expect(by.AMORTIZED!.meta.requiresFinanceReview).toBe(true);
      expect(by.NOT_DISCUSSED!.meta.defaultAtIntake).toBe(true);
      expect(by.ZERO_CER!.active).toBe(false);
      expect(by.SHARED!.active).toBe(false);

      const approvals = await setting(tx, 'g4_additional_approvals');
      expect(approvals!.value).toEqual(G4_ADDITIONAL_APPROVALS_SEED);
      expect(approvals!.description).toBe(G4_ADDITIONAL_APPROVALS_DESCRIPTION_FB31);
      expect((await setting(tx, 'g4_required_checks'))!.description).toBe(
        G4_REQUIRED_CHECKS_DESCRIPTION_FB31,
      );
      expect((await setting(tx, 'standard_payment_terms'))!.description).toBe(
        STANDARD_PAYMENT_TERMS_DESCRIPTION_FB31,
      );
      expect(
        ((await setting(tx, 'intake_field_help'))!.value as Record<string, string>)
          .stock_hold_requested,
      ).toBe(INTAKE_FIELD_HELP.stock_hold_requested);
    });
  });

  it('routes the requests pending now from the routes; decided ones keep null', async () => {
    await rolledBack(async (tx) => {
      await preFb31(tx);
      const quoteId = await pendingRequests(tx);
      await runMigration(tx);
      const rows = await raw<{
        code: string;
        status: string;
        perm: string | null;
        doc: boolean | null;
      }>(
        tx,
        sql`select payment_terms_code as code, status, approver_permission as perm, document_required as doc
            from terms_exception_request where quote_id = ${quoteId} order by requested_at`,
      );
      expect(rows).toEqual([
        { code: 'NET_45', status: 'pending', perm: 'terms.exception.decide', doc: false },
        { code: 'NET_60', status: 'pending', perm: 'terms.exception.decide.senior', doc: true },
        { code: 'NET_90', status: 'approved', perm: null, doc: null },
      ]);
    });
  });

  it('routes pending requests from an Admin’s routes already in place', async () => {
    await rolledBack(async (tx) => {
      await preFb31(tx);
      const quoteId = await pendingRequests(tx);
      const mine = [
        {
          codes: ['NET_120'],
          approverPermission: 'terms.exception.decide.senior',
          approverLabel: 'the CFO',
          documentRequired: true,
        },
        {
          codes: ['NET_45', 'NET_60'],
          approverPermission: 'terms.exception.decide',
          approverLabel: 'the pricing lead',
          documentRequired: false,
        },
      ];
      await tx.execute(sql`insert into app_setting (id, key, value, description, provisional)
        values (gen_random_uuid(), 'terms_exception_routes', ${JSON.stringify(mine)}::jsonb, 'set by an Admin', false)`);
      await runMigration(tx);
      expect((await setting(tx, 'terms_exception_routes'))!.value).toEqual(mine);
      const perms = await raw<{ perm: string | null }>(
        tx,
        sql`select approver_permission as perm from terms_exception_request
            where quote_id = ${quoteId} and status = 'pending' order by requested_at`,
      );
      expect(perms.map((p) => p.perm)).toEqual([
        'terms.exception.decide',
        'terms.exception.decide',
      ]);
    });
  });

  it('leaves an Admin-edited or approved row alone', async () => {
    await rolledBack(async (tx) => {
      await preFb31(tx);
      await tx.execute(sql`update value_list set label = 'Customer pays (our words)'
        where list_key = 'tooling_funding_model' and code = 'CUSTOMER_FUNDED'`);
      await tx.execute(sql`update value_list set approved_at = now()
        where list_key = 'tooling_funding_model' and code in ('AMORTIZED', 'ZERO_CER')`);
      await tx.execute(sql`update value_list set meta = meta || '{"helpText":"Our own help"}'::jsonb
        where list_key = 'tooling_funding_model' and code = 'COMPANY_FUNDED'`);
      const edited = {
        rules: G4_ADDITIONAL_APPROVALS_SEED_FB08.rules.map((r) => ({ ...r, active: true })),
      };
      await tx.execute(sql`update app_setting set value = ${JSON.stringify(edited)}::jsonb
        where key = 'g4_additional_approvals'`);
      await tx.execute(sql`update app_setting
        set value = jsonb_set(value, '{stock_hold_requested}', '"Our own stock help"'::jsonb)
        where key = 'intake_field_help'`);
      await runMigration(tx);
      const by = await funding(tx);
      expect(by.CUSTOMER_FUNDED!.label).toBe('Customer pays (our words)');
      // Approved: the label, the flag and the active state stay.
      expect(by.AMORTIZED!.label).toBe('Amortized');
      expect(by.AMORTIZED!.meta.requiresFinanceReview).toBeUndefined();
      expect(by.ZERO_CER!.active).toBe(true);
      // Not approved and unedited: still retired.
      expect(by.SHARED!.active).toBe(false);
      expect(by.COMPANY_FUNDED!.meta.helpText).toBe('Our own help');
      expect(by.COMPANY_FUNDED!.label).toBe(FB31_FUNDING_LABELS.COMPANY_FUNDED);
      expect((await setting(tx, 'g4_additional_approvals'))!.value).toEqual(edited);
      expect(
        ((await setting(tx, 'intake_field_help'))!.value as Record<string, string>)
          .stock_hold_requested,
      ).toBe('Our own stock help');
    });
  });

  it('is safe to re-run', async () => {
    await rolledBack(async (tx) => {
      await preFb31(tx);
      await runMigration(tx);
      await runMigration(tx);
      expect(
        (
          await raw<{ n: number }>(
            tx,
            sql`select count(*)::int as n from role_permission where permission = 'terms.exception.decide.senior'`,
          )
        )[0]!.n,
      ).toBe(1);
      expect((await setting(tx, 'g4_additional_approvals'))!.value).toEqual(
        G4_ADDITIONAL_APPROVALS_SEED,
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

describe('FB-31 schema', () => {
  it('accepts the versioned payment_terms_approval kind and the two approver permissions only', async () => {
    const defs = await raw<{ name: string; def: string }>(
      db as unknown as Tx,
      sql`select conname as name, pg_get_constraintdef(oid) as def from pg_constraint
          where conname in ('attachment_version_check', 'attachment_kind_check',
            'terms_exception_request_approver_permission_check', 'role_permission_permission_check')
          order by conname`,
    );
    const by = Object.fromEntries(defs.map((d) => [d.name, d.def]));
    expect(by.attachment_kind_check).toContain('payment_terms_approval');
    expect(by.attachment_version_check).toContain('payment_terms_approval');
    expect(by.role_permission_permission_check).toContain('terms.exception.decide.senior');
    expect(by.terms_exception_request_approver_permission_check).toContain(
      'terms.exception.decide.senior',
    );
  });
});
