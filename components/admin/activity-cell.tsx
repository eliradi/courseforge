'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTokens, formatUsd } from '@/lib/ai/pricing';
import type { OperationSnapshot } from '@/lib/db/admin-queries';
import { cn } from '@/lib/utils';

const LABELS: Record<string, string> = {
  catalogCheck: 'Checked',
  retrieval: 'Retrieved',
  courseProfile: 'Profiled',
  testGeneration: 'Tests',
};

const FULL_LABELS: Record<string, string> = {
  catalogCheck: 'Latest catalog method check',
  retrieval: 'Latest course retrieval',
  courseProfile: 'Latest course profiling',
  testGeneration: 'Latest user test generation',
};

/** "3m", "4h", "6d" — the table needs recency at a glance, not a full date. */
function relative(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/*
 * Relative times and locale dates can't be rendered on the server: "10s ago"
 * becomes "9s ago" by the time the client hydrates, and the server's locale
 * isn't the viewer's. ActivityRow renders a deterministic value first and
 * switches after mount.
 */

/** The four tracked operations for one college: when each last ran, and its cost. */
export function ActivityCell({
  operations,
}: {
  operations: Record<string, OperationSnapshot>;
}) {
  const entries = Object.entries(LABELS);
  const anyRun = entries.some(([key]) => operations[key]?.at);

  if (!anyRun) return <span className="text-muted-foreground text-xs">never run</span>;

  return (
    <div className="space-y-0.5">
      {entries.map(([key, label]) => {
        const run = operations[key];
        if (!run?.at) {
          return (
            <div key={key} className="text-muted-foreground/60 flex items-center gap-1.5 text-[11px]">
              <span className="w-[4.2rem] shrink-0">{label}</span>
              <span>—</span>
            </div>
          );
        }

        return (
          <ActivityRow
            key={key}
            label={label}
            fullLabel={FULL_LABELS[key]}
            run={{ ...run, at: run.at }}
          />
        );
      })}
    </div>
  );
}

function ActivityRow({
  label,
  fullLabel,
  run,
}: {
  label: string;
  fullLabel: string;
  run: OperationSnapshot & { at: string };
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Before mount, show the date — deterministic on both sides.
  const when = mounted ? relative(run.at) : run.at.slice(0, 10);
  const exact = mounted ? new Date(run.at).toLocaleString() : run.at.replace('T', ' ').slice(0, 19);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="flex cursor-help items-center gap-1.5 text-[11px] tabular-nums" />
        }
      >
        <span className="text-muted-foreground w-[4.2rem] shrink-0">{label}</span>
        <span className={cn(run.ok === false && 'text-destructive')}>{when}</span>
        {run.ok === false ? <AlertTriangle className="text-destructive size-3" /> : null}
        <span className="text-muted-foreground">{formatUsd(run.costUsd)}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">{fullLabel}</p>
        <p>{exact}</p>
        <p>
          {formatUsd(run.costUsd)} · {formatTokens(run.tokens)} tokens
          {run.ok === false ? ' · the run failed' : ''}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
