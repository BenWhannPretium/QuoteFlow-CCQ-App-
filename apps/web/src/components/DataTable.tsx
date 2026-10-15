import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Header,
  type Row,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { NativeSelect } from '@/components/ui/input';
import { useIsMobile } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';

import { SkeletonRows } from './Skeletons';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Card layout: this column is the card's title (e.g. the quote number). */
    primary?: boolean;
    /** Card layout: leave this column out. */
    hideOnMobile?: boolean;
    /** Right-align numbers. */
    numeric?: boolean;
  }
}

export interface DataTableProps<T> {
  // TanStack column value types vary per column; `any` is the library's own convention here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  data: T[];
  /** Accessible name for the table (visually hidden). */
  caption: string;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  empty?: ReactNode;
  initialSorting?: SortingState;
  /** Height of the scroll area that keeps the header sticky. */
  maxHeight?: string;
}

/**
 * Sortable table with a sticky header. `onRowClick` is a mouse convenience: also render a <Link> in
 * the primary column so keyboard and screen-reader users can open the row.
 * At ≤ 640 px it renders each row as a card (primary column as
 * the title, the rest as label/value pairs) with a "Sort by" select instead of header buttons.
 */
export function DataTable<T>({
  columns,
  data,
  caption,
  getRowId,
  onRowClick,
  isLoading,
  empty,
  initialSorting = [],
  maxHeight = '70dvh',
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const isMobile = useIsMobile();
  // TanStack Table returns fresh functions each render; the React Compiler skips this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(getRowId ? { getRowId: (row: T) => getRowId(row) } : {}),
  });

  if (isLoading) return <SkeletonRows rows={6} />;
  const rows = table.getRowModel().rows;
  if (rows.length === 0 && empty) return <>{empty}</>;

  return isMobile ? (
    <CardList table={table} rows={rows} caption={caption} onRowClick={onRowClick} />
  ) : (
    <div
      className="bg-card rounded-card shadow-card overflow-auto border"
      style={{ maxHeight }}
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <HeaderCell key={header.id} header={header} />
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn('hover:bg-muted', onRowClick && 'cursor-pointer')}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn(
                    'border-b px-4 py-3 align-middle',
                    cell.column.columnDef.meta?.numeric && 'text-right tabular-nums',
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeaderCell<T>({ header }: { header: Header<T, unknown> }) {
  const sorted = header.column.getIsSorted();
  const canSort = header.column.getCanSort();
  const content = header.isPlaceholder
    ? null
    : flexRender(header.column.columnDef.header, header.getContext());
  const SortIcon =
    sorted === 'asc' ? ArrowUpIcon : sorted === 'desc' ? ArrowDownIcon : ArrowUpDownIcon;
  return (
    <th
      scope="col"
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
      className={cn(
        'bg-muted text-foreground-2 sticky top-0 z-10 border-b px-4 py-2 text-left text-xs font-semibold whitespace-nowrap',
        header.column.columnDef.meta?.numeric && 'text-right',
      )}
    >
      {canSort ? (
        <button
          type="button"
          onClick={header.column.getToggleSortingHandler()}
          className="hover:text-foreground -mx-1 inline-flex min-h-8 items-center gap-1 rounded px-1"
        >
          {content}
          <SortIcon className={cn('size-3.5', !sorted && 'opacity-50')} aria-hidden="true" />
        </button>
      ) : (
        content
      )}
    </th>
  );
}

function CardList<T>({
  table,
  rows,
  caption,
  onRowClick,
}: {
  table: ReturnType<typeof useReactTable<T>>;
  rows: Row<T>[];
  caption: string;
  onRowClick?: ((row: T) => void) | undefined;
}) {
  const sortId = useId();
  const sortable = table.getAllLeafColumns().filter((c) => c.getCanSort());
  const [current] = table.getState().sorting;
  const headerText = (columnId: string) => {
    const header = table.getFlatHeaders().find((h) => h.column.id === columnId);
    const def = header?.column.columnDef.header;
    return typeof def === 'string' ? def : columnId;
  };

  return (
    <div className="grid gap-3">
      {sortable.length > 0 && (
        <div className="flex items-center gap-2">
          <label htmlFor={sortId} className="text-muted-foreground shrink-0 text-sm">
            Sort by
          </label>
          <NativeSelect
            id={sortId}
            value={current ? `${current.id}:${current.desc ? 'desc' : 'asc'}` : ''}
            onChange={(e) => {
              const [id, dir] = e.target.value.split(':');
              table.setSorting(id ? [{ id, desc: dir === 'desc' }] : []);
            }}
          >
            <option value="">Default order</option>
            {sortable.flatMap((c) => [
              <option key={`${c.id}:asc`} value={`${c.id}:asc`}>
                {headerText(c.id)} (ascending)
              </option>,
              <option key={`${c.id}:desc`} value={`${c.id}:desc`}>
                {headerText(c.id)} (descending)
              </option>,
            ])}
          </NativeSelect>
        </div>
      )}
      <ul aria-label={caption} className="grid gap-3">
        {rows.map((row) => {
          const cells = row.getVisibleCells().filter((c) => !c.column.columnDef.meta?.hideOnMobile);
          const primary = cells.find((c) => c.column.columnDef.meta?.primary) ?? cells[0];
          const rest = cells.filter((c) => c !== primary);
          return (
            <li
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn(
                'bg-card rounded-card shadow-card grid gap-3 border p-4',
                onRowClick && 'cursor-pointer',
              )}
            >
              {primary && (
                <div className="font-semibold">
                  {flexRender(primary.column.columnDef.cell, primary.getContext())}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {rest.map((cell) => (
                  <div key={cell.id} className="min-w-0">
                    <dt className="text-muted-foreground text-xs">{headerText(cell.column.id)}</dt>
                    <dd className="text-sm break-words">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
