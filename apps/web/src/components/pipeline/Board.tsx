import type { BoardCard, BoardColumn, BoardResponse } from '@ccq/contracts';
import {
  CLOSED_LANE_KEY,
  boardMoves,
  dropDenialReason,
  droppableColumns,
  planDrop,
  type DropPlan,
} from '@ccq/domain';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon, GripVerticalIcon, MoveRightIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { GateDecisionDialog } from '@/components/GateDecisionDialog';
import { ScorePill } from '@/components/ScorePill';
import { TierChip } from '@/components/TierChip';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIsMobile, useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';

import { formatCount, formatUsdCompact } from './parts';

interface Pending {
  card: BoardCard;
  plan: DropPlan;
  /** The column the card shows in while the dialog is open (cancel snaps it back). */
  columnKey: string;
}

/**
 * The pipeline board (F-07). One column per stage from config; terminal stages collapse into
 * "Closed (n)". A card can be dragged only onto a column one of its gate actions leads to (the
 * domain's `availableActions`, computed by the API for the caller); the drop opens the gate-decision
 * dialog with that outcome preselected, and cancelling snaps the card back. Drag works with a mouse
 * and the keyboard (space on the grip, arrows, space); on touch the "Move" menu does the same.
 */
export function Board({
  data,
  onToggleClosed,
}: {
  data: BoardResponse;
  onToggleClosed: (show: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const coarse = useMediaQuery('(pointer: coarse)');
  const dragEnabled = !isMobile && !coarse;
  // MouseSensor (not PointerSensor) so a finger never starts a drag: on touch, "Move" opens the dialog.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const terminal = useMemo(
    () => data.columns.filter((c) => c.terminal).map((c) => c.stageKey),
    [data.columns],
  );
  const label = (key: string) =>
    key === CLOSED_LANE_KEY
      ? 'Closed'
      : (data.columns.find((c) => c.stageKey === key)?.label ?? key);
  const gateFor = (stageKey: string) => data.gates.find((g) => g.stageKey === stageKey) ?? null;
  const cards = useMemo(
    () => new Map(data.columns.flatMap((c) => c.cards.map((k) => [k.id, k]))),
    [data.columns],
  );
  const movesOf = (card: BoardCard) => boardMoves(card.actions, card.stageKey);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [denied, setDenied] = useState<{ columnKey: string; message: string } | null>(null);
  useEffect(() => {
    if (!denied) return;
    const t = setTimeout(() => setDenied(null), 6000);
    return () => clearTimeout(t);
  }, [denied]);

  const active = activeId ? cards.get(activeId) : undefined;
  const allowed = active ? droppableColumns(movesOf(active), terminal) : null;
  const reasonFor = (card: BoardCard, columnKey: string) =>
    dropDenialReason({
      fromStageKey: card.stageKey,
      toColumnKey: columnKey,
      status: card.status,
      moves: movesOf(card),
      terminalStageKeys: terminal,
      gate: gateFor(card.stageKey),
      stageLabel: label,
    });

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => {
      const card = cards.get(String(a.id));
      if (!card) return undefined;
      const to = [...droppableColumns(movesOf(card), terminal).keys()]
        .filter((k) => k !== CLOSED_LANE_KEY)
        .map(label);
      return `Picked up ${card.quoteNumber}. It can move to ${to.join(', ') || 'no other column'}.`;
    },
    onDragOver: ({ active: a, over }) => {
      const card = cards.get(String(a.id));
      if (!card || !over) return undefined;
      return reasonFor(card, String(over.id)) ?? `Over ${label(String(over.id))}. Drop to decide.`;
    },
    onDragEnd: ({ active: a, over }) => {
      const card = cards.get(String(a.id));
      if (!card || !over) return `${card?.quoteNumber ?? 'Card'} put back.`;
      return reasonFor(card, String(over.id)) ?? `Dropped on ${label(String(over.id))}.`;
    },
    onDragCancel: ({ active: a }) => `${cards.get(String(a.id))?.quoteNumber ?? 'Card'} put back.`,
  };

  const startMove = (card: BoardCard, columnKey: string) => {
    const plan = planDrop(movesOf(card), terminal, columnKey);
    if (plan) setPending({ card, plan, columnKey });
    else setDenied({ columnKey, message: reasonFor(card, columnKey) ?? '' });
  };

  const onDragStart = (e: DragStartEvent) => {
    setDenied(null);
    setActiveId(String(e.active.id));
  };
  const onDragOver = (e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null);
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    setOverId(null);
    const card = cards.get(String(e.active.id));
    if (!card || !e.over) return;
    const columnKey = String(e.over.id);
    if (columnKey === card.stageKey) return;
    startMove(card, columnKey);
  };

  // While the dialog is open, the card shows in the column it was dropped on.
  const columnCards = (col: { stageKey: string; cards: BoardCard[] }) => {
    const own = col.cards.filter((c) => c.id !== pending?.card.id);
    return pending?.columnKey === col.stageKey ? [pending.card, ...own] : own;
  };

  const open = data.columns.filter((c) => !c.terminal);
  const closedCols = data.columns.filter((c) => c.terminal);
  const lanes: { key: string; label: string; count: number }[] = [
    ...open.map((c) => ({ key: c.stageKey, label: c.label, count: c.count })),
    ...(data.closed.included
      ? closedCols.map((c) => ({ key: c.stageKey, label: c.label, count: c.count }))
      : [{ key: CLOSED_LANE_KEY, label: 'Closed', count: data.closed.count }]),
  ];
  const scroller = useRef<HTMLDivElement>(null);

  const columnProps = (key: string) => ({
    dragging: !!active,
    allowed: !!allowed?.has(key),
    isSource: active?.stageKey === key,
    over: overId === key,
    denial:
      (active && overId === key ? reasonFor(active, key) : null) ??
      (denied?.columnKey === key ? denied.message : null),
  });

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setOverId(null);
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To move a quote, press space on its grip, use the arrow keys to choose a column, and press space to drop or escape to cancel. Dropping opens the gate decision.',
        },
      }}
    >
      {isMobile && (
        <nav aria-label="Stages" className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {lanes.map((l) => (
            <button
              key={l.key}
              type="button"
              className="bg-secondary text-secondary-foreground rounded-pill inline-flex min-h-11 shrink-0 items-center gap-2 px-3 text-sm"
              onClick={() =>
                scroller.current
                  ?.querySelector(`[data-column="${l.key}"]`)
                  ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
              }
            >
              {l.label}
              <span className="font-semibold tabular-nums">{l.count}</span>
            </button>
          ))}
        </nav>
      )}
      <div
        ref={scroller}
        className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:snap-none sm:px-0"
        data-testid="board"
      >
        {open.map((col) => (
          <Column key={col.stageKey} column={col} {...columnProps(col.stageKey)}>
            {columnCards(col).map((card) => (
              <Card
                key={card.id}
                card={card}
                dragEnabled={dragEnabled}
                pending={pending?.card.id === card.id}
                moveTargets={[...droppableColumns(movesOf(card), terminal).entries()]
                  .filter(([k]) => k !== CLOSED_LANE_KEY)
                  .map(([k, m]) => ({ key: k, label: label(k), outcome: m[0]!.outcomeLabel }))}
                onMove={(key) => startMove(card, key)}
              />
            ))}
          </Column>
        ))}
        {data.closed.included ? (
          <>
            {closedCols.map((col) => (
              <Column
                key={col.stageKey}
                column={col}
                {...columnProps(col.stageKey)}
                headerAction={
                  col === closedCols[0] ? (
                    <Button variant="ghost" size="sm" onClick={() => onToggleClosed(false)}>
                      Collapse closed
                    </Button>
                  ) : undefined
                }
              >
                {columnCards(col).map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    dragEnabled={false}
                    pending={false}
                    moveTargets={[]}
                  />
                ))}
              </Column>
            ))}
          </>
        ) : (
          <ClosedLane
            count={data.closed.count}
            totalAmount={data.closed.totalAmount}
            pendingCard={pending?.columnKey === CLOSED_LANE_KEY ? pending.card : null}
            onExpand={() => onToggleClosed(true)}
            {...columnProps(CLOSED_LANE_KEY)}
          />
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? <CardBody card={active} className="shadow-lg ring-2 ring-[var(--ring)]" /> : null}
      </DragOverlay>
      {pending && (
        <GateDecisionDialog
          key={pending.card.id + pending.columnKey}
          open
          gateKey={pending.plan.gateKey}
          quoteNumber={pending.card.quoteNumber}
          initialOutcomeKey={pending.plan.outcomeKey ?? ''}
          initialTargetStageKey={pending.plan.targetStageKey ?? ''}
          onOpenChange={(o) => {
            if (!o) setPending(null);
          }}
          onDecided={() => setPending(null)}
        />
      )}
    </DndContext>
  );
}

interface ColumnState {
  dragging: boolean;
  allowed: boolean;
  isSource: boolean;
  over: boolean;
  denial: string | null;
}

function laneClass(s: ColumnState) {
  return cn(
    'bg-muted/70 rounded-card flex w-[85vw] max-w-sm shrink-0 snap-start flex-col gap-2 border p-2 sm:w-72',
    s.dragging && s.allowed && 'border-primary border-dashed',
    s.dragging && s.allowed && s.over && 'bg-accent ring-ring ring-2',
    s.dragging && !s.allowed && !s.isSource && 'opacity-60',
  );
}

function Column({
  column,
  children,
  headerAction,
  ...state
}: ColumnState & {
  column: BoardColumn;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: column.stageKey });
  const headingId = `col-${column.stageKey}`;
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-column={column.stageKey}
      data-allowed={state.dragging ? String(state.allowed) : undefined}
      className={laneClass(state)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-2 px-1 pt-1">
        <h2 id={headingId} className="text-sm font-semibold">
          {column.label}{' '}
          <span
            className="text-muted-foreground font-normal tabular-nums"
            data-testid="column-count"
          >
            ({column.count})
          </span>
        </h2>
        <span
          className="text-muted-foreground text-xs tabular-nums"
          title="Sum of the Salesforce opportunity amounts"
        >
          {formatUsdCompact(column.totalAmount)}
        </span>
        {headerAction}
      </header>
      <DenialNote text={state.denial} />
      <ol className="grid gap-2" aria-label={`${column.label} quotes`}>
        {children}
      </ol>
      {column.cards.length < column.count && !column.terminal && (
        <p className="text-muted-foreground px-1 text-xs">Showing {column.cards.length}.</p>
      )}
    </section>
  );
}

function DenialNote({ text }: { text: string | null }) {
  return (
    <p
      role="status"
      className={cn(
        'bg-card rounded-md border border-dashed px-2 text-xs',
        text ? 'py-1.5' : 'sr-only',
      )}
      data-testid={text ? 'drop-denied' : undefined}
    >
      {text}
    </p>
  );
}

function ClosedLane({
  count,
  totalAmount,
  pendingCard,
  onExpand,
  ...state
}: ColumnState & {
  count: number;
  totalAmount: number;
  pendingCard: BoardCard | null;
  onExpand: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: CLOSED_LANE_KEY });
  return (
    <section
      ref={setNodeRef}
      aria-label={`Closed, ${count} quotes`}
      data-column={CLOSED_LANE_KEY}
      data-allowed={state.dragging ? String(state.allowed) : undefined}
      className={cn(laneClass(state), 'sm:w-48')}
    >
      <header className="flex items-baseline justify-between gap-2 px-1 pt-1">
        <h2 className="text-sm font-semibold">
          Closed <span className="text-muted-foreground font-normal tabular-nums">({count})</span>
        </h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatUsdCompact(totalAmount)}
        </span>
      </header>
      <DenialNote text={state.denial} />
      {pendingCard && (
        <ol className="grid gap-2">
          <Card card={pendingCard} dragEnabled={false} pending moveTargets={[]} />
        </ol>
      )}
      <Button variant="outline" size="sm" onClick={onExpand} aria-expanded={false}>
        Show closed
        <ChevronRightIcon aria-hidden="true" />
      </Button>
      <p className="text-muted-foreground px-1 text-xs">
        Awarded, lost, declined, expired and redirected quotes.
      </p>
    </section>
  );
}

function Card({
  card,
  dragEnabled,
  pending,
  moveTargets,
  onMove,
}: {
  card: BoardCard;
  dragEnabled: boolean;
  pending: boolean;
  moveTargets: { key: string; label: string; outcome: string }[];
  onMove?: (columnKey: string) => void;
}) {
  const canMove = moveTargets.length > 0;
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: card.id,
    disabled: !dragEnabled || !canMove || pending,
  });
  // Mouse drag from anywhere on the card; keyboard drag from the grip (the card holds links).
  const { onKeyDown, ...mouse } = listeners ?? {};
  return (
    <li
      ref={setNodeRef}
      data-testid="board-card"
      data-quote={card.quoteNumber}
      data-draggable={dragEnabled && canMove ? 'true' : 'false'}
      className={cn(
        isDragging && 'opacity-40',
        pending && 'animate-pulse',
        dragEnabled && canMove && 'cursor-grab',
      )}
      {...(dragEnabled && canMove ? mouse : {})}
    >
      <CardBody
        card={card}
        grip={
          dragEnabled && canMove ? (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLButtonElement> | undefined}
              aria-label={`Move ${card.quoteNumber} (drag)`}
              aria-roledescription="draggable quote"
              className="text-muted-foreground hover:bg-accent -m-1 inline-flex size-8 items-center justify-center rounded"
            >
              <GripVerticalIcon className="size-4" aria-hidden="true" />
            </button>
          ) : null
        }
        actions={
          canMove && onMove ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="sm:min-h-7"
                  aria-label={`Move ${card.quoteNumber} to another stage`}
                  data-testid="card-move"
                >
                  <MoveRightIcon aria-hidden="true" />
                  Move
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                {moveTargets.map((t) => (
                  <DropdownMenuItem key={t.key} onSelect={() => onMove(t.key)}>
                    {t.label} <span className="text-muted-foreground">({t.outcome})</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />
    </li>
  );
}

function CardBody({
  card,
  grip,
  actions,
  className,
}: {
  card: BoardCard;
  grip?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        'bg-card rounded-card ease-machined hover:border-line-strong hover:shadow-lift grid gap-1.5 border p-3 text-sm transition-[box-shadow,border-color,translate] duration-200 hover:-translate-y-px',
        className,
      )}
      aria-label={card.quoteNumber}
    >
      <div className="flex items-center gap-2">
        {grip}
        {card.priorityVisible && card.tier ? (
          <TierChip tier={card.tier} label={card.tierLabel} overridden={card.tierOverridden} />
        ) : (
          !card.priorityVisible && (
            <span className="text-muted-foreground text-xs">Priority hidden</span>
          )
        )}
        {card.priorityVisible && <ScorePill score={card.score} />}
        {card.warnings.length > 0 && (
          <span
            className="bg-warning ml-auto inline-block size-2.5 rounded-full"
            title={card.warnings.join('\n')}
            data-testid="card-warnings"
          >
            <span className="sr-only">Warnings: {card.warnings.join('; ')}</span>
          </span>
        )}
      </div>
      <Link
        to="/quotes/$quoteNumber"
        params={{ quoteNumber: card.quoteNumber }}
        className="text-emphasis w-fit font-mono text-[0.8125rem] font-medium underline-offset-4 hover:underline"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {card.quoteNumber}
      </Link>
      <p className="min-w-0 break-words">{card.accountName ?? 'Unknown account'}</p>
      {card.productSummary && (
        <p className="text-muted-foreground line-clamp-2 text-xs">{card.productSummary}</p>
      )}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {card.estAnnualVolume != null && <span>{formatCount(card.estAnnualVolume)}/yr</span>}
        <span data-testid="time-in-stage">{card.daysInStage}d in stage</span>
        {card.status === 'on_hold' && <span>On hold</span>}
        <span
          className="bg-secondary text-secondary-foreground ml-auto inline-flex size-7 items-center justify-center rounded-full text-[11px] font-semibold"
          title={card.kamName ?? undefined}
          role="img"
          aria-label={`KAM ${card.kamName ?? 'unknown'}`}
        >
          {card.kamInitials}
        </span>
      </div>
      {actions && (
        <div className="flex justify-end" onMouseDown={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </article>
  );
}
