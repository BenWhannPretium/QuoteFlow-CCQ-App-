import { SlidersHorizontalIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface FilterGroup {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export type FilterValue = Record<string, string[]>;

export const activeFilterCount = (value: FilterValue) =>
  Object.values(value).reduce((n, v) => n + v.length, 0);

/**
 * PRD F-07 compact filter pattern: one "Filters" button with a count, opening checkbox groups.
 * Options should come from config value lists, never hard-coded.
 */
export function FiltersPopover({
  groups,
  value,
  onChange,
  label = 'Filters',
  extra,
  count: countOverride,
  onClear,
}: {
  groups: FilterGroup[];
  value: FilterValue;
  onChange: (next: FilterValue) => void;
  label?: string;
  /** Inputs that aren't checkbox groups (B-14: aging, close-date range), shown above the groups. */
  extra?: ReactNode;
  /** The active count when `extra` holds filters too (default: checked boxes). */
  count?: number;
  /** "Clear all" when `extra` holds filters too (default: uncheck every box). */
  onClear?: () => void;
}) {
  const count = countOverride ?? activeFilterCount(value);
  const baseId = useId();

  const toggle = (group: string, option: string, checked: boolean) => {
    const current = value[group] ?? [];
    const nextValues = checked ? [...current, option] : current.filter((v) => v !== option);
    const next = { ...value };
    if (nextValues.length) next[group] = nextValues;
    else delete next[group];
    onChange(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* The name comes from the content ("Filters 1 active"), so it contains the visible text. */}
        <Button variant="outline" size="sm">
          <SlidersHorizontalIcon aria-hidden="true" />
          {label}
          {count > 0 && (
            <>
              {' '}
              <span className="bg-primary text-primary-foreground rounded-pill min-w-5 px-1.5 text-xs">
                {count}
              </span>
              <span className="sr-only"> active</span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="grid max-h-[min(70dvh,var(--radix-popover-content-available-height))] gap-4 overflow-y-auto pb-0">
        {extra}
        {groups.map((group) => (
          <fieldset key={group.key} className="grid gap-1">
            <legend className="mb-1 text-sm font-semibold">{group.label}</legend>
            {group.options.map((option) => {
              const id = `${baseId}-${group.key}-${option.value}`;
              return (
                <label
                  key={option.value}
                  htmlFor={id}
                  className="hover:bg-accent flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm sm:min-h-9"
                >
                  <input
                    id={id}
                    type="checkbox"
                    className="accent-[var(--primary)] size-4"
                    checked={(value[group.key] ?? []).includes(option.value)}
                    onChange={(e) => toggle(group.key, option.value, e.target.checked)}
                  />
                  {option.label}
                </label>
              );
            })}
          </fieldset>
        ))}
        <div className="bg-popover sticky bottom-0 flex justify-between gap-2 border-t py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={count === 0}
            onClick={() => (onClear ? onClear() : onChange({}))}
          >
            Clear all
          </Button>
          <PopoverClose asChild>
            <Button variant="primary" size="sm">
              Done
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}
