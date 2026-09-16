'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ProgressPoint {
  date: string;
  percentage: number;
  label: string;
}

/** Score over time, newest on the right, with the running average for reference. */
export function ProgressChart({ points }: { points: ProgressPoint[] }) {
  const rows = points.map((point, index) => ({
    ...point,
    index: index + 1,
    shortDate: new Date(point.date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    }),
  }));

  const average = Math.round(
    rows.reduce((sum, row) => sum + row.percentage, 0) / Math.max(1, rows.length),
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          dataKey="shortDate"
          tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis
          domain={[0, 100]}
          unit="%"
          tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <ReferenceLine
          y={average}
          stroke="var(--color-muted-foreground)"
          strokeDasharray="4 4"
          label={{
            value: `avg ${average}%`,
            position: 'insideTopRight',
            fill: 'var(--color-muted-foreground)',
            fontSize: 11,
          }}
        />
        <Tooltip
          cursor={{ stroke: 'var(--color-border)' }}
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            fontSize: 12,
            color: 'var(--color-popover-foreground)',
          }}
          formatter={(value) => [`${Number(value)}%`, 'Score']}
          labelFormatter={(_label, payload) => {
            const row = payload?.[0]?.payload as (typeof rows)[number] | undefined;
            if (!row) return '';
            return `${row.label} · ${new Date(row.date).toLocaleDateString()}`;
          }}
        />
        <Line
          type="monotone"
          dataKey="percentage"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          dot={{ r: 3, fill: 'var(--color-chart-1)' }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
