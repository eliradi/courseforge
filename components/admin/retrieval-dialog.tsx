'use client';

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  Globe,
  Info,
  Loader2,
  Radar,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatUsd } from '@/lib/ai/pricing';
import { cn } from '@/lib/utils';

export type RetrievalMode = 'probe' | 'retrieve';

export interface TraceLine {
  level: 'step' | 'request' | 'info' | 'success' | 'warn' | 'error';
  message: string;
  detail?: string;
  at: number;
  ms?: number;
  status?: number;
  bytes?: number;
}

export interface RetrievalOutcome {
  ok: boolean;
  summary: string;
  costUsd?: number;
  elapsedMs?: number;
  platform?: string;
  catalogUrl?: string;
  departmentCount?: number;
  courseCount?: number;
}

const LEVEL_STYLES: Record<TraceLine['level'], { icon: typeof Info; className: string }> = {
  step: { icon: ChevronRight, className: 'text-foreground' },
  request: { icon: Globe, className: 'text-muted-foreground' },
  info: { icon: Info, className: 'text-muted-foreground' },
  success: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-500' },
  warn: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-500' },
  error: { icon: AlertTriangle, className: 'text-destructive' },
};

/** Console styling per level, so a run is scannable in devtools too. */
const CONSOLE_STYLES: Record<TraceLine['level'], string> = {
  step: 'color:#6366f1;font-weight:600',
  request: 'color:#64748b',
  info: 'color:#64748b',
  success: 'color:#059669;font-weight:600',
  warn: 'color:#d97706;font-weight:600',
  error: 'color:#dc2626;font-weight:600',
};

export function RetrievalDialog({
  open,
  onOpenChange,
  mode,
  collegeId,
  collegeName,
  onFinished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RetrievalMode;
  collegeId: string;
  collegeName: string;
  onFinished: (summary: string) => void;
}) {
  const [lines, setLines] = useState<TraceLine[]>([]);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RetrievalOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view while the run streams.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    if (!open) return;

    setLines([]);
    setOutcome(null);
    setError(null);
    setRunning(true);

    // No "already started" guard here: React runs effects twice in dev, and a
    // guard plus abort-on-cleanup cancel each other out — the first run starts
    // the fetch, cleanup aborts it, and the second run skips. Letting each run
    // start its own request and abort the previous one is the pattern that
    // survives both StrictMode and a genuine prop change.
    const controller = new AbortController();
    const collected: TraceLine[] = [];
    const label = `[CourseForge] ${mode === 'probe' ? 'Check method' : 'Retrieve'} · ${collegeName}`;

    // Opened lazily on the first event so an aborted run logs nothing.
    let groupOpen = false;
    const openGroup = () => {
      if (groupOpen) return;
      groupOpen = true;
      console.groupCollapsed(`%c${label}`, 'color:#6366f1;font-weight:700');
      console.info('college id:', collegeId, '· mode:', mode);
    };

    void (async () => {
      try {
        const response = await fetch(`/api/admin/colleges/${collegeId}/retrieve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode, departmentLimit: mode === 'retrieve' ? 3 : 0 }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({ error: 'Request failed' }));
          throw new Error(body.error ?? `Server responded ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const raw = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!raw) continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(raw.slice(6));
            } catch {
              continue;
            }

            if (event.type === 'trace') {
              const line = event as unknown as TraceLine;
              collected.push(line);
              setLines((prev) => [...prev, line]);
              openGroup();

              const timing = [
                line.ms !== undefined ? `${line.ms}ms` : null,
                line.status !== undefined
                  ? line.status === 0
                    ? 'no response'
                    : `HTTP ${line.status}`
                  : null,
                line.bytes !== undefined ? `${(line.bytes / 1024).toFixed(1)}kB` : null,
              ]
                .filter(Boolean)
                .join(' · ');

              console.debug(
                `%c${formatOffset(line.at)} ${line.message}`,
                CONSOLE_STYLES[line.level],
                ...[line.detail, timing].filter(Boolean),
              );
            } else if (event.type === 'done') {
              const payload = event.payload as RetrievalOutcome;
              setOutcome(payload);
              onFinished(`${payload.summary} · ${formatUsd(payload.costUsd ?? 0)}`);
              openGroup();
              console.info('%cresult', 'color:#059669;font-weight:700', payload);
            } else if (event.type === 'error') {
              setError(String(event.message ?? 'The run failed.'));
              openGroup();
              console.error('run failed:', event.message);
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : 'The run failed.';
          setError(message);
          openGroup();
          console.error('run failed:', message);
        }
      } finally {
        if (!controller.signal.aborted) setRunning(false);

        const requests = collected.filter((l) => l.level === 'request');
        if (groupOpen && requests.length) {
          console.table(
            requests.map((r) => ({
              at: formatOffset(r.at),
              request: r.message,
              status: r.status ?? '',
              ms: r.ms ?? '',
              kB: r.bytes ? +(r.bytes / 1024).toFixed(1) : '',
            })),
          );
        }
        if (groupOpen) console.groupEnd();
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, collegeId]);

  const Icon = mode === 'probe' ? Radar : Download;
  const requestCount = lines.filter((l) => l.level === 'request').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(56rem,calc(100vw-2rem))] flex-col sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4" />
            {mode === 'probe' ? 'Checking retrieval method' : 'Retrieving courses'} · {collegeName}
          </DialogTitle>
          <DialogDescription>
            {mode === 'probe'
              ? 'Runs catalog discovery only — no course pages are scraped.'
              : 'Discovers the catalog, scrapes departments, then the first three departments’ course lists.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={running ? 'secondary' : outcome?.ok ? 'default' : 'outline'} className="gap-1.5">
            {running ? (
              <Loader2 className="size-3 animate-spin" />
            ) : outcome?.ok ? (
              <CheckCircle2 className="size-3" />
            ) : (
              <AlertTriangle className="size-3" />
            )}
            {running ? 'Running' : outcome?.ok ? 'Complete' : error ? 'Failed' : 'Stopped'}
          </Badge>
          <span className="text-muted-foreground tabular-nums">{lines.length} events</span>
          <span className="text-muted-foreground tabular-nums">{requestCount} requests</span>
          {outcome?.costUsd !== undefined ? (
            <span className="text-muted-foreground tabular-nums">
              {formatUsd(outcome.costUsd)} AI cost
            </span>
          ) : null}
          {outcome?.elapsedMs ? (
            <span className="text-muted-foreground tabular-nums">
              {(outcome.elapsedMs / 1000).toFixed(1)}s
            </span>
          ) : null}
          <span className="text-muted-foreground ml-auto">Full detail is in the browser console.</span>
        </div>

        <div
          ref={logRef}
          className="bg-muted/40 min-h-[16rem] flex-1 overflow-y-auto rounded-lg border p-3 font-mono text-[12px] leading-relaxed"
        >
          {lines.length === 0 ? (
            <p className="text-muted-foreground">Starting…</p>
          ) : (
            <ol className="space-y-1">
              {lines.map((line, index) => {
                const style = LEVEL_STYLES[line.level] ?? LEVEL_STYLES.info;
                const LineIcon = style.icon;
                return (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-muted-foreground w-12 shrink-0 tabular-nums">
                      {formatOffset(line.at)}
                    </span>
                    <LineIcon className={cn('mt-0.5 size-3 shrink-0', style.className)} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('break-words', style.className)}>{line.message}</span>
                      {line.status !== undefined || line.ms !== undefined || line.bytes ? (
                        <span className="text-muted-foreground ml-2 tabular-nums">
                          {[
                            // Status 0 means the request never reached a server.
                            line.status !== undefined
                              ? line.status === 0
                                ? 'no response'
                                : `HTTP ${line.status}`
                              : null,
                            line.ms !== undefined ? `${line.ms}ms` : null,
                            line.bytes ? `${(line.bytes / 1024).toFixed(1)}kB` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                      {line.detail ? (
                        <span className="text-muted-foreground block break-all">{line.detail}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : outcome ? (
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <ArrowRight className="size-3.5" />
            {outcome.summary}
            {outcome.catalogUrl ? (
              <a
                href={outcome.catalogUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                {outcome.catalogUrl}
              </a>
            ) : null}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {running ? 'Run in background' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatOffset(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
