import { and, desc, eq } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { first } from './_util';
import { g4Signoff, termsExceptionRequest } from '../schema/index';

// ── FB-08 (T-007): payment-terms exception requests ────────────────────────────────────────────

export type TermsExceptionRequest = typeof termsExceptionRequest.$inferSelect;

/** The quote's latest request (the one `quote.terms_exception_status` mirrors), if any. */
export const getLatestTermsException = async (
  db: DbOrTx,
  quoteId: string,
): Promise<TermsExceptionRequest | undefined> =>
  first(
    await db
      .select()
      .from(termsExceptionRequest)
      .where(eq(termsExceptionRequest.quoteId, quoteId))
      .orderBy(desc(termsExceptionRequest.requestedAt), desc(termsExceptionRequest.id))
      .limit(1),
  );

export const listTermsExceptions = (db: DbOrTx, quoteId: string) =>
  db
    .select()
    .from(termsExceptionRequest)
    .where(eq(termsExceptionRequest.quoteId, quoteId))
    .orderBy(desc(termsExceptionRequest.requestedAt), desc(termsExceptionRequest.id));

export async function insertTermsException(
  db: DbOrTx,
  values: typeof termsExceptionRequest.$inferInsert,
): Promise<TermsExceptionRequest> {
  const [row] = await db.insert(termsExceptionRequest).values(values).returning();
  return row!;
}

/** Close the pending request without a decision (`withdrawn` or `superseded`). */
export async function closePendingTermsExceptions(
  db: DbOrTx,
  quoteId: string,
  status: 'withdrawn' | 'superseded',
  at: Date,
): Promise<number> {
  const rows = await db
    .update(termsExceptionRequest)
    .set({ status, closedAt: at, updatedAt: at })
    .where(
      and(eq(termsExceptionRequest.quoteId, quoteId), eq(termsExceptionRequest.status, 'pending')),
    )
    .returning({ id: termsExceptionRequest.id });
  return rows.length;
}

/** Record the decision on a pending request. Returns undefined if it was no longer pending. */
export async function decideTermsException(
  db: DbOrTx,
  id: string,
  values: {
    status: 'approved' | 'rejected';
    decidedBy: string;
    decidedAt: Date;
    rationale: string;
  },
): Promise<TermsExceptionRequest | undefined> {
  return first(
    await db
      .update(termsExceptionRequest)
      .set({ ...values, updatedAt: values.decidedAt })
      .where(and(eq(termsExceptionRequest.id, id), eq(termsExceptionRequest.status, 'pending')))
      .returning(),
  );
}

// ── FB-08 (F-082, off): extra Final Review sign-offs ───────────────────────────────────────────

export type G4SignoffRow = typeof g4Signoff.$inferSelect;

/** The sign-offs given on this quote version. */
export const listG4Signoffs = (db: DbOrTx, quoteId: string, quoteVersion: number) =>
  db
    .select()
    .from(g4Signoff)
    .where(and(eq(g4Signoff.quoteId, quoteId), eq(g4Signoff.quoteVersion, quoteVersion)))
    .orderBy(g4Signoff.signedAt);

export async function insertG4Signoff(
  db: DbOrTx,
  values: typeof g4Signoff.$inferInsert,
): Promise<G4SignoffRow> {
  const [row] = await db.insert(g4Signoff).values(values).returning();
  return row!;
}
