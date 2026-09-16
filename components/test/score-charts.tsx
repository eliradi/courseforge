'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface Breakdown {
  label: string;
  correct: number;
  total: number;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'var(--color-chart-3)',
  medium: 'var(--color-chart-4)',
  hard: 'var(--color-chart-5)',
};

function percent(correct: number, total: number): number {
  return total ? Math.round((correct / total) * 100) : 0;
}

/** Accuracy per topic. A radar reads better than 12 bars once topics pile up. */
export function TopicChart({ data }: { data: Breakdown[] }) {
  const rows = data.map((d) => ({
    topic: d.label.length > 18 ? `${d.label.slice(0, 17)}…` : d.label,
    accuracy: percent(d.correct, d.total),
    correct: d.correct,
    total: d.total,
  }));

  if (rows.length < 3) return <TopicBars data={data} />;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={rows} outerRadius="62%" margin={{ top: 8, right: 40, bottom: 8, left: 40 }}>
        <PolarGrid stroke="var(--color-border)" />
        <PolarAngleAxis
          dataKey="topic"
          tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
        />
        <Radar
          name="Accuracy"
          dataKey="accuracy"
          stroke="var(--color-chart-1)"
          fill="var(--color-chart-1)"
          fillOpacity={0.35}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            fontSize: 12,
            color: 'var(--color-popover-foreground)',
          }}
          formatter={(value, _name, item) => {
            const row = item?.payload as (typeof rows)[number] | undefined;
            const suffix = row ? ` (${row.correct}/${row.total})` : '';
            return [`${Number(value)}%${suffix}`, 'Accuracy'];
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function TopicBars({ data }: { data: Breakdown[] }) {
  const rows = data.map((d) => ({
    label: d.label,
    accuracy: percent(d.correct, d.total),
    correct: d.correct,
    total: d.total,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 48)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 12, right: 16 }}>
        <CartesianGrid horizontal={false} stroke="var(--color-border)" />
        <XAxis
          type="number"
          domain={[0, 100]}
          unit="%"
          tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={130}
          tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-muted)' }}
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            fontSize: 12,
            color: 'var(--color-popover-foreground)',
          }}
          formatter={(value, _name, item) => {
            const row = item?.payload as (typeof rows)[number] | undefined;
            const suffix = row ? ` (${row.correct}/${row.total})` : '';
            return [`${Number(value)}%${suffix}`, 'Accuracy'];
          }}
        />
        <Bar dataKey="accuracy" fill="var(--color-chart-1)" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Correct vs incorrect per difficulty band. */
export function DifficultyChart({ data }: { data: Breakdown[] }) {
  const rows = data.map((d) => ({
    label: d.label,
    correct: d.correct,
    incorrect: d.total - d.correct,
    accuracy: percent(d.correct, d.total),
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ left: -16, right: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-muted)' }}
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            fontSize: 12,
            color: 'var(--color-popover-foreground)',
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          // Recharts colours legend labels by series fill, which makes the
          // muted "Incorrect" label unreadable. Force both to body colour.
          formatter={(value) => <span style={{ color: 'var(--color-muted-foreground)' }}>{value}</span>}
        />
        <Bar
          dataKey="correct"
          stackId="a"
          name="Correct"
          fill="var(--color-chart-1)"
          radius={[0, 0, 4, 4]}
        >
          {rows.map((row) => (
            <Cell key={row.label} fill={DIFFICULTY_COLORS[row.label] ?? 'var(--color-chart-1)'} />
          ))}
        </Bar>
        <Bar
          dataKey="incorrect"
          stackId="a"
          name="Incorrect"
          // Muted alone is nearly invisible against the card; the stroke gives
          // the band an edge so an all-wrong bar still reads as data.
          fill="var(--color-muted)"
          stroke="var(--color-border)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
