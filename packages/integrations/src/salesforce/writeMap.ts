/**
 * FB-29 (N19-01, D-16w): the write allow-list, the ONLY place the Salesforce fields QuoteFlow may write
 * are named. Writer-side on purpose: it is not part of `fieldMap.ts` (the reader's map, which drives the
 * describe, the SELECTs and the figure ban) and never joins `MAPPED_OBJECTS`.
 *
 * Every entry here must be approved by the Salesforce owner and granted to the write user by IT (edit
 * access on that field and nothing else). Until then the write-back is switched off. The `sf_writeback_map`
 * setting may only name fields listed here, so a typo or a figure cannot be configured, and the writer
 * refuses anything else at the call.
 *
 * Never a price, cost, margin, revenue or capital field (writeMap.test.ts fails on one), never an Account
 * (CLAUDE.md rule 7), never a create or a delete.
 *
 * Waiting on the Salesforce owner (docs/build-guide/10-salesforce-writeback.md): the API names of any custom
 * fields for the CCQ quote number, its link and the QuoteFlow stage. None is listed until it is confirmed.
 */
export const SF_WRITE_ALLOW_LIST: Readonly<Record<'Opportunity', readonly string[]>> = {
  // The standard stage field (verified as the reader's `OPPORTUNITY_FIELDS.stage`).
  Opportunity: ['StageName'],
};

/** Whether `object.field` may be written. */
export function isWritableSfField(objectName: string, field: string): boolean {
  return (
    Object.hasOwn(SF_WRITE_ALLOW_LIST, objectName) &&
    SF_WRITE_ALLOW_LIST[objectName as keyof typeof SF_WRITE_ALLOW_LIST].includes(field)
  );
}
