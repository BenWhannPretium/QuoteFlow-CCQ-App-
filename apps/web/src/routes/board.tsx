import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { RequirePermission } from '@/auth';
import { ErrorState, PageHeader, SkeletonRows } from '@/components';
import { Board } from '@/components/pipeline/Board';
import { NoMatches, PipelineViewTabs } from '@/components/pipeline/parts';
import { PipelineToolbar } from '@/components/pipeline/PipelineToolbar';
import { api } from '@/lib/api';
import { parsePipelineSearch, pipelineApiQuery, type PipelineSearch } from '@/lib/pipeline-search';
import { useDocumentTitle } from '@/shell/useDocumentTitle';

interface BoardSearch extends PipelineSearch {
  /** Show the terminal stages' cards instead of the collapsed "Closed (n)" lane. */
  closed?: boolean | undefined;
}

export const Route = createFileRoute('/board')({
  validateSearch: (raw: Record<string, unknown>): BoardSearch => {
    const { sort: _s, dir: _d, page: _p, ...filters } = parsePipelineSearch(raw);
    return {
      ...filters,
      ...(raw.closed === true || raw.closed === 'true' ? { closed: true } : {}),
    };
  },
  component: BoardPage,
});

/** Pipeline board (F-07): quotes by stage, highest tier first in each column. */
function BoardPage() {
  useDocumentTitle('Pipeline board');
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { closed, ...filters } = search;
  const setSearch = useCallback(
    (next: PipelineSearch) => void navigate({ search: { ...next, closed }, replace: true }),
    [navigate, closed],
  );
  const apiQuery = pipelineApiQuery(filters, { includeClosed: closed ? true : undefined });
  const board = useQuery({
    queryKey: ['pipeline', 'board', apiQuery],
    queryFn: () => api.board(apiQuery),
    placeholderData: (prev) => prev,
  });
  const data = board.data;
  const total = data ? data.columns.reduce((n, c) => n + c.count, 0) : 0;

  return (
    <RequirePermission permission="quote.read">
      <div
        className="grid min-w-0 grid-cols-1 gap-4"
        data-testid="page"
        data-page-title="Pipeline board"
      >
        <PageHeader
          className="mb-0"
          title="Pipeline board"
          eyebrow="Pipeline"
          description="Quotes by stage, highest tier first. Drag a quote to a stage you can decide it into; the gate decision opens to confirm."
        />
        <PipelineViewTabs current="board" search={filters} />
        <PipelineToolbar
          search={filters}
          onChange={setSearch}
          people={data?.filterOptions}
          savedViewsKey="board"
        />
        {board.isPending && <SkeletonRows rows={6} />}
        {board.error && <ErrorState error={board.error} onRetry={() => void board.refetch()} />}
        {data &&
          (total === 0 ? (
            <NoMatches search={filters} onChange={setSearch} />
          ) : (
            <Board
              data={data}
              onToggleClosed={(show) =>
                void navigate({ search: { ...filters, closed: show || undefined }, replace: true })
              }
            />
          ))}
      </div>
    </RequirePermission>
  );
}
