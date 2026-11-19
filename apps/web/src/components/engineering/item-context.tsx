import { createContext, useContext, useState, type ReactNode } from 'react';

import { SWITCH_ITEM_UNSAVED_TEXT, itemHasUnsaved, unsavedRegistry } from '@/lib/unsaved-changes';

/**
 * FB-30 (N19-28): the item shown on the Engineering and Capacity tabs of a multi-item quote. Each tab has
 * its own item switcher, kept in step: picking item 2 on one tab shows item 2 on the other, so the
 * engineer's solution and the capacity rows on screen are always for the same item. The state lives on
 * the quote page (both tabs stay mounted, UX-001); it starts again on another quote.
 */
interface ItemState {
  quoteNumber: string;
  active: number;
}

const ItemContext = createContext<{
  state: ItemState;
  setState: (next: ItemState) => void;
} | null>(null);

export function EngineeringItemProvider({
  quoteNumber,
  children,
}: {
  quoteNumber: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<ItemState>({ quoteNumber, active: 0 });
  return <ItemContext.Provider value={{ state, setState }}>{children}</ItemContext.Provider>;
}

/**
 * The item index both tabs show (clamped to the items there are), and `select`, which asks first when
 * the item on screen has unsaved changes on either tab: switching takes that item's cards off both tabs.
 * Without a provider (a tab rendered on its own) the index is the tab's own.
 */
export function useEngineeringItem(
  quoteNumber: string,
  itemIds: readonly string[],
): { index: number; select: (next: number) => void } {
  const shared = useContext(ItemContext);
  const [own, setOwn] = useState<ItemState>({ quoteNumber, active: 0 });
  const state = shared?.state ?? own;
  const setState = shared?.setState ?? setOwn;
  const active = state.quoteNumber === quoteNumber ? state.active : 0;
  const index = Math.min(active, Math.max(0, itemIds.length - 1));
  const select = (next: number) => {
    if (
      next !== index &&
      itemHasUnsaved(unsavedRegistry.cards(quoteNumber), itemIds[index]) &&
      !window.confirm(SWITCH_ITEM_UNSAVED_TEXT)
    ) {
      return;
    }
    setState({ quoteNumber, active: next });
  };
  return { index, select };
}
