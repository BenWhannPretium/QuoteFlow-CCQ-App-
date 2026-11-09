import type { PublicConfigResponse } from '@ccq/contracts';

export type Lists = PublicConfigResponse['valueLists'] | undefined;

const entry = (lists: Lists, list: string, code: string | null) =>
  code ? lists?.[list]?.find((v) => v.code === code) : undefined;

/** A code's label; a "Custom" (meta freeText) value shows its description instead. */
export function factLabel(
  lists: Lists,
  list: string,
  code: string | null,
  custom?: string | null,
): string | null {
  if (!code) return null;
  const e = entry(lists, list, code);
  if (e?.meta.freeText === true) return custom ?? e.label;
  return e?.label ?? code;
}
