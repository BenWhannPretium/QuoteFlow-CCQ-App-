import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@/lib/utils';

/**
 * Chart primitives on the Pretium data palette (tokens.css `--dv-*`): green for data, copper for emphasis,
 * a one-hue ramp for ordered stages. Thin marks, 4px rounded bar ends on the baseline, a 2px surface gap
 * between stacked segments, recessive grid, and a hover tooltip on every mark. Two measures with different
 * scales are two charts (small multiples), never a dual axis.
 */
export const COLORS = {
  primary: 'var(--dv-primary)',
  secondary: 'var(--dv-secondary)',
  emphasis: 'var(--dv-emphasis)',
  ramp: [
    'var(--dv-ramp-1)',
    'var(--dv-ramp-2)',
    'var(--dv-ramp-3)',
    'var(--dv-ramp-4)',
    'var(--dv-ramp-5)',
  ],
} as const;

export interface Series {
  key: string;
  label: string;
  color: string;
  /** Lines only: a dashed line for the secondary statistic (p75). */
  dashed?: boolean;
}

const AXIS = { fill: 'var(--dv-axis)', fontSize: 12 } as const;
const TOOLTIP_STYLE = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  color: 'var(--foreground)',
  fontSize: 12,
  boxShadow: 'var(--pf-shadow)',
} as const;

/** The legend: always present for two or more series, in text, so identity is never colour alone. */
export function Legend({ series }: { series: readonly Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="text-foreground-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0 w-4 border-t-2"
            style={{ borderColor: s.color, borderTopStyle: s.dashed ? 'dashed' : 'solid' }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

type Row = Record<string, string | number | null>;

export interface BarsProps {
  data: Row[];
  /** The category field. */
  xKey: string;
  series: Series[];
  /** `horizontal` puts categories on the y axis (long labels, ranked lists). */
  orientation?: 'columns' | 'horizontal';
  stacked?: boolean;
  height?: number;
  format?: (v: number) => string;
  xFormat?: (v: string) => string;
  /** Label every bar with its value (single-series ranked lists only). */
  labels?: boolean;
  /** Fixed 0–1 axis for rates. */
  unit?: boolean;
  onBarClick?: (row: Row) => void;
  /** Category axis width when horizontal. */
  categoryWidth?: number;
}

export function Bars({
  data,
  xKey,
  series,
  orientation = 'columns',
  stacked = false,
  height = 240,
  format = (v) => String(v),
  xFormat = (v) => v,
  labels = false,
  unit = false,
  onBarClick,
  categoryWidth = 120,
}: BarsProps) {
  const horizontal = orientation === 'horizontal';
  const h = horizontal ? Math.max(height, data.length * 34 + 30) : height;
  return (
    <div className="grid gap-2">
      <div
        style={{ height: h }}
        className={cn('w-full', onBarClick && '[&_.recharts-bar-rectangle]:cursor-pointer')}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout={horizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 8, right: horizontal ? 36 : 8, bottom: 0, left: 0 }}
            barCategoryGap={horizontal ? 10 : '24%'}
          >
            <CartesianGrid stroke="var(--dv-grid)" vertical={horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis
                  type="number"
                  tick={AXIS}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={format}
                  {...(unit ? { domain: [0, 1] as [number, number] } : {})}
                />
                <YAxis
                  type="category"
                  dataKey={xKey}
                  tick={AXIS}
                  tickLine={false}
                  axisLine={false}
                  width={categoryWidth}
                  tickFormatter={xFormat}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey={xKey}
                  tick={AXIS}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--dv-grid)' }}
                  tickFormatter={xFormat}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <YAxis
                  tick={AXIS}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={format}
                  {...(unit ? { domain: [0, 1] as [number, number] } : {})}
                />
              </>
            )}
            <Tooltip
              cursor={{ fill: 'var(--dv-grid)', opacity: 0.45 }}
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) => [typeof value === 'number' ? format(value) : value, name]}
              labelFormatter={(label) => xFormat(String(label))}
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                {...(stacked ? { stackId: 'a', stroke: 'var(--card)', strokeWidth: 2 } : {})}
                radius={
                  stacked
                    ? i === series.length - 1
                      ? [4, 4, 0, 0]
                      : 0
                    : horizontal
                      ? [0, 4, 4, 0]
                      : [4, 4, 0, 0]
                }
                maxBarSize={horizontal ? 22 : 40}
                isAnimationActive={false}
                {...(onBarClick
                  ? { onClick: (d: unknown) => onBarClick((d as { payload: Row }).payload) }
                  : {})}
              >
                {labels && (
                  <LabelList
                    dataKey={s.key}
                    position="right"
                    formatter={(v: unknown) => (typeof v === 'number' ? format(v) : '')}
                    style={{ fill: 'var(--foreground-2)', fontSize: 12 }}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend series={series} />
    </div>
  );
}

export interface TrendProps {
  data: Row[];
  xKey: string;
  series: Series[];
  height?: number;
  format?: (v: number) => string;
  xFormat?: (v: string) => string;
  unit?: boolean;
}

export function Trend({
  data,
  xKey,
  series,
  height = 220,
  format = (v) => String(v),
  xFormat = (v) => v,
  unit = false,
}: TrendProps) {
  return (
    <div className="grid gap-2">
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--dv-grid)" vertical={false} />
            <XAxis
              dataKey={xKey}
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: 'var(--dv-grid)' }}
              tickFormatter={xFormat}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={format}
              allowDecimals={false}
              {...(unit ? { domain: [0, 1] as [number, number] } : {})}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ stroke: 'var(--dv-axis)', strokeWidth: 1 }}
              formatter={(value, name) => [typeof value === 'number' ? format(value) : value, name]}
              labelFormatter={(label) => xFormat(String(label))}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                dot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)', fill: s.color }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend series={series} />
    </div>
  );
}

/** Small multiples: the same chart repeated per slice, in a grid that stacks to one column on a phone. */
export function SmallMultiples({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>;
}
