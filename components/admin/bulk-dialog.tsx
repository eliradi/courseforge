'use client';

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Globe,
  Info,
  Layers,
  Loader2,
  MinusCircle,
  PlayCircle,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TraceLine } from '@/components/admin/retrieval-dialog';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatUsd } from '@/lib/ai/pricing';
import type { AdminCollegeRow } from '@/lib/db/admin-queries';
import { cn } from '@/lib/utils';

type JobStatus = 'running' | 'completed' | 'cancelled' | 'interrupted' | 'failed';

interface JobItem {
  collegeId: string;
  name: string;
  rank: number | null;
  position: number;
  status: 'pending' | 'running' | 'ok' | 'failed' | 'skipped';
  summary: string | null;
  costUsd: number;
}

interface JobState {
  id: string;
  status: JobStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  totalCostUsd: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  params: {
    rankFrom: number;
    rankTo: number;
    staleDays: number;
    maxColleges: number;
    departmentLimit: number | null;
    includePartial?: boolean;
  };
  items: JobItem[];
}

type Connection = 'idle' | 'connecting' | 'live' | 'reconnecting';

const STATUS_LABEL: Record<JobStatus, string> = {
  running: 'Running',
  completed: 'Finished',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
  failed: 'Failed',
};

const LEVEL_STYLES: Record<TraceLine['level'], { icon: typeof Info; className: string }> = {
  step: { icon: ChevronRight, className: 'text-foreground' },
  request: { icon: Globe, className: 'text-muted-foreground' },
  info: { icon: Info, className: 'text-muted-foreground' },
  success: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-500' },
  warn: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-500' },
  error: { icon: AlertTriangle, className: 'text-destructive' },
};

const CONSOLE_STYLES: Record<TraceLine['level'], string> = {
  step: 'color:#115388;font-weight:600',
  request: 'color:#64748b',
  info: 'color:#64748b',
  success: 'color:#059669;font-weight:600',
  warn: 'color:#d97706;font-weight:600',
  error: 'color:#dc2626;font-weight:600',
};

/** Universities a run would touch, using the same rule the server applies. */
export function selectCandidates(
  colleges: AdminCollegeRow[],
  staleDays: number,
  rankFrom = 1,
  rankTo = 200,
  includePartial = true,
): AdminCollegeRow[] {
  const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  return colleges.filter((college) => {
    if (college.rank === null) return false;
    if (college.rank < rankFrom || college.rank > rankTo) return false;

    if (college.courseCount === 0) return true;
    if (!college.lastScrapedAt) return true;
    if (new Date(college.lastScrapedAt).getTime() < cutoff) return true;
    return includePartial && college.departmentsSourced < college.departmentCount;
  });
}

export function BulkDialog({
  open,
  onOpenChange,
  colleges,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  colleges: AdminCollegeRow[];
}) {
  const [staleDays, setStaleDays] = useState(30);
  const [rankFrom, setRankFrom] = useState(1);
  const [rankTo, setRankTo] = useState(200);
  const [maxColleges, setMaxColleges] = useState(10);
  const [allDepartments, setAllDepartments] = useState(true);
  const [departmentLimit, setDepartmentLimit] = useState(3);
  const [includePartial, setIncludePartial] = useState(true);

  const [job, setJob] = useState<JobState | null>(null);
  const [showConfig, setShowConfig] = useState(true);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [connection, setConnection] = useState<Connection>('idle');
  const [lines, setLines] = useState<TraceLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const cursorRef = useRef(0);
  const groupOpenRef = useRef(false);

  const rangeValid = rankFrom <= rankTo;
  const candidates = useMemo(
    () =>
      rangeValid ? selectCandidates(colleges, staleDays, rankFrom, rankTo, includePartial) : [],
    [colleges, staleDays, rankFrom, rankTo, rangeValid, includePartial],
  );
  const willRun = Math.min(candidates.length, maxColleges);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setConnection('idle');
    if (groupOpenRef.current) {
      console.groupEnd();
      groupOpenRef.current = false;
    }
  }, []);

  /**
   * Follows a job's progress log. EventSource reconnects on its own after a
   * drop and resends Last-Event-ID, so a network blip resumes the log instead of
   * failing — and the job itself never depended on this connection anyway.
   */
  const follow = useCallback(
    (jobId: string, fromSeq: number) => {
      sourceRef.current?.close();
      cursorRef.current = fromSeq;
      setConnection('connecting');

      if (!groupOpenRef.current) {
        console.groupCollapsed(`%c[Aceversity] Bulk job ${jobId.slice(0, 8)}`, 'color:#115388;font-weight:700');
        groupOpenRef.current = true;
      }

      const source = new EventSource(`/api/admin/bulk-jobs/${jobId}/events?after=${fromSeq}`);
      sourceRef.current = source;

      source.onopen = () => setConnection('live');

      source.onmessage = (message) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }
        if (typeof event.seq === 'number') cursorRef.current = event.seq;

        if (event.type === 'trace') {
          const line = event as unknown as TraceLine;
          setLines((prev) => [...prev.slice(-400), line]);
          console.debug(
            `%c${(line.at / 1000).toFixed(1)}s ${line.message}`,
            CONSOLE_STYLES[line.level] ?? '',
            ...[line.detail].filter(Boolean),
          );
        } else if (event.type === 'college' && event.phase === 'done') {
          console.info(
            `%c${String(event.name)}`,
            event.ok ? 'color:#059669;font-weight:600' : 'color:#dc2626;font-weight:600',
            event.summary,
            formatUsd(Number(event.costUsd ?? 0)),
          );
        } else if (event.type === 'job') {
          const next = event.job as JobState;
          setJob(next);
          if (next.status !== 'running') {
            console.info('%cjob ' + next.status, 'color:#059669;font-weight:700', next);
            closeStream();
          }
        } else if (event.type === 'gone') {
          setError('This job no longer exists.');
          closeStream();
        }
      };

      source.onerror = () => {
        // CLOSED means the server refused us (auth, missing job) — not a blip.
        if (source.readyState === EventSource.CLOSED) {
          setConnection('idle');
          return;
        }
        setConnection('reconnecting');
        console.warn('[Aceversity] connection to the job dropped — reconnecting; the job keeps running.');
      };
    },
    [closeStream],
  );

  // On open, reattach to the latest job if it is still running or was interrupted.
  useEffect(() => {
    if (!open) {
      closeStream();
      return;
    }

    let cancelled = false;
    setLoadingLatest(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch('/api/admin/bulk-jobs/latest', { cache: 'no-store' });
        const body = (await response.json()) as { job: JobState | null };
        if (cancelled) return;

        const latest = body.job;
        if (latest && (latest.status === 'running' || latest.status === 'interrupted')) {
          setJob(latest);
          setShowConfig(false);
          setLines([]);
          if (latest.status === 'running') follow(latest.id, 0);
        } else {
          setJob(latest);
          setShowConfig(true);
        }
      } catch {
        if (!cancelled) setShowConfig(true);
      } finally {
        if (!cancelled) setLoadingLatest(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, follow, closeStream]);

  async function start() {
    setBusy(true);
    setError(null);
    setLines([]);
    try {
      const response = await fetch('/api/admin/bulk-jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          staleDays,
          rankFrom,
          rankTo,
          maxColleges,
          departmentLimit: allDepartments ? null : departmentLimit,
          includePartial,
        }),
      });
      const body = (await response.json()) as { job?: JobState; error?: string };
      if (!response.ok || !body.job) throw new Error(body.error ?? `Server responded ${response.status}`);

      console.info(
        '[Aceversity] bulk job started',
        body.job.id,
        `ranks ${rankFrom}-${rankTo} · stale ${staleDays}d · max ${maxColleges} · ` +
          `${allDepartments ? 'all' : departmentLimit} depts · partial ${includePartial}`,
      );

      setJob(body.job);
      setShowConfig(false);
      if (body.job.status === 'running') follow(body.job.id, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the job.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!job) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/bulk-jobs/${job.id}/cancel`, { method: 'POST' });
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/bulk-jobs/${job.id}/resume`, { method: 'POST' });
      const body = (await response.json()) as { job?: JobState; error?: string };
      if (!response.ok || !body.job) throw new Error(body.error ?? `Server responded ${response.status}`);
      setJob(body.job);
      follow(body.job.id, cursorRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resume the job.');
    } finally {
      setBusy(false);
    }
  }

  function newRun() {
    closeStream();
    setJob(null);
    setLines([]);
    setError(null);
    setShowConfig(true);
  }

  const status = job?.status;
  const running = status === 'running';
  const doneCount = job ? job.items.filter((i) => i.status === 'ok' || i.status === 'failed').length : 0;
  const remaining = job ? job.items.filter((i) => i.status === 'pending' || i.status === 'running').length : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(64rem,calc(100vw-2rem))] flex-col sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-4" />
            Bulk check &amp; retrieve
          </DialogTitle>
          <DialogDescription>
            Checks each university&apos;s catalog method and retrieves courses only where the check
            succeeds. The job runs on the server — closing this dialog or losing the connection
            doesn&apos;t stop it.
          </DialogDescription>
        </DialogHeader>

        {loadingLatest ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Looking for a job in progress…
          </p>
        ) : showConfig ? (
          <div className="space-y-4">
            {job && job.status !== 'running' ? (
              <p className="text-muted-foreground text-xs">
                Last job: {STATUS_LABEL[job.status]} · {job.succeeded} ok, {job.failed} failed of{' '}
                {job.total} · {formatUsd(job.totalCostUsd)}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rank-from">National ranking range</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="rank-from"
                    type="number"
                    min={1}
                    max={200}
                    value={rankFrom}
                    aria-label="Rank from"
                    aria-invalid={!rangeValid}
                    onChange={(e) => setRankFrom(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input
                    id="rank-to"
                    type="number"
                    min={1}
                    max={200}
                    value={rankTo}
                    aria-label="Rank to"
                    aria-invalid={!rangeValid}
                    onChange={(e) => setRankTo(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
                  />
                </div>
                <p className={cn('text-xs', rangeValid ? 'text-muted-foreground' : 'text-destructive')}>
                  {rangeValid
                    ? 'Inclusive. Universities are processed in ranking order.'
                    : 'The starting rank must not be higher than the ending rank.'}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="stale-days">Re-retrieve if older than (days)</Label>
                <Input
                  id="stale-days"
                  type="number"
                  min={0}
                  max={3650}
                  value={staleDays}
                  onChange={(e) => setStaleDays(Math.min(3650, Math.max(0, Number(e.target.value) || 0)))}
                />
                <p className="text-muted-foreground text-xs">
                  0 includes every university, however recently it was retrieved.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="max-colleges">Max universities this run</Label>
                <Input
                  id="max-colleges"
                  type="number"
                  min={1}
                  max={200}
                  value={maxColleges}
                  onChange={(e) => setMaxColleges(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
                />
                <p className="text-muted-foreground text-xs">Each one takes roughly 30–90 seconds.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dept-limit">Departments per university</Label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allDepartments}
                    onChange={(e) => setAllDepartments(e.target.checked)}
                    className="accent-primary size-4"
                  />
                  All departments that still need courses
                </label>
                {allDepartments ? null : (
                  <Input
                    id="dept-limit"
                    type="number"
                    min={0}
                    max={1000}
                    value={departmentLimit}
                    aria-label="Departments per university"
                    onChange={(e) =>
                      setDepartmentLimit(Math.min(1000, Math.max(0, Number(e.target.value) || 0)))
                    }
                  />
                )}
                <p className="text-muted-foreground text-xs">
                  Departments that already have courses are skipped either way.
                  {allDepartments ? '' : ' 0 reads the department list only.'}
                </p>
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={includePartial}
                onChange={(e) => setIncludePartial(e.target.checked)}
                className="accent-primary mt-0.5 size-4"
              />
              <span>
                Include partly retrieved universities
                <span className="text-muted-foreground block text-xs">
                  Universities with current data but some departments still empty — typically from
                  an earlier run limited to a few departments.
                </span>
              </span>
            </label>

            <div className="bg-muted/40 rounded-lg border p-3 text-sm">
              <p>
                <strong className="tabular-nums">{candidates.length}</strong> universities match — ranked{' '}
                {rankFrom}–{rankTo}, with no course data, data older than {staleDays} day
                {staleDays === 1 ? '' : 's'}
                {includePartial ? ', or departments still empty' : ''}.
              </p>
              <p className="text-muted-foreground mt-1">
                {candidates.length > willRun ? (
                  <>
                    This run will process the first <strong className="tabular-nums">{willRun}</strong>{' '}
                    by rank; raise the cap or run again to continue.
                  </>
                ) : (
                  <>
                    All <strong className="tabular-nums">{willRun}</strong> will be processed, in ranking
                    order.
                  </>
                )}
              </p>
            </div>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
        ) : job ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge
                variant={running ? 'secondary' : status === 'completed' ? 'default' : 'outline'}
                className={cn('gap-1.5', status === 'interrupted' && 'border-amber-500/50 text-amber-700 dark:text-amber-400')}
              >
                {running ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : status === 'completed' ? (
                  <CheckCircle2 className="size-3" />
                ) : (
                  <AlertTriangle className="size-3" />
                )}
                {STATUS_LABEL[job.status]}
              </Badge>

              {running && connection === 'reconnecting' ? (
                <Badge variant="outline" className="gap-1.5 border-amber-500/50 text-amber-700 dark:text-amber-400">
                  <WifiOff className="size-3" />
                  Reconnecting — the job is still running
                </Badge>
              ) : null}

              <span className="text-muted-foreground tabular-nums">
                {doneCount}/{job.total} done
              </span>
              <span className="tabular-nums text-emerald-700 dark:text-emerald-500">{job.succeeded} ok</span>
              <span className="text-destructive tabular-nums">{job.failed} failed</span>
              <span className="text-muted-foreground tabular-nums">{formatUsd(job.totalCostUsd)} spent</span>
              <span className="text-muted-foreground tabular-nums">
                ranks {job.params.rankFrom}–{job.params.rankTo}
              </span>
              <span className="text-muted-foreground ml-auto">Full detail is in the browser console.</span>
            </div>

            {status === 'interrupted' ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium">This job stopped unexpectedly.</p>
                <p className="text-muted-foreground mt-0.5">
                  The server running it went away (a restart or crash) after {doneCount} of {job.total}{' '}
                  universities. Everything finished so far is saved — resume to process the remaining{' '}
                  {remaining}.
                </p>
              </div>
            ) : null}

            {status === 'failed' && job.error ? (
              <p className="text-destructive text-sm">{job.error}</p>
            ) : null}

            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[22rem_1fr]">
              <div className="overflow-y-auto rounded-lg border p-2">
                <ol className="space-y-1">
                  {job.items.map((item) => (
                    <li key={item.collegeId} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs">
                      <span className="mt-0.5 shrink-0">
                        {item.status === 'running' && running ? (
                          <Loader2 className="text-primary size-3.5 animate-spin" />
                        ) : item.status === 'ok' ? (
                          <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-500" />
                        ) : item.status === 'failed' ? (
                          <MinusCircle className="text-destructive size-3.5" />
                        ) : (
                          <Circle className="text-muted-foreground/40 size-3.5" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate font-medium',
                            item.status === 'pending' && 'text-muted-foreground',
                          )}
                        >
                          <span className="text-muted-foreground mr-1.5 tabular-nums">#{item.rank}</span>
                          {item.name}
                        </span>
                        {item.summary ? (
                          <span className="text-muted-foreground block break-words">{item.summary}</span>
                        ) : null}
                      </span>
                      {item.status === 'ok' || item.status === 'failed' ? (
                        <span className="text-muted-foreground shrink-0 tabular-nums">{formatUsd(item.costUsd)}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>

              <div
                ref={logRef}
                className="bg-muted/40 min-h-[14rem] overflow-y-auto rounded-lg border p-3 font-mono text-[12px] leading-relaxed"
              >
                {lines.length === 0 ? (
                  <p className="text-muted-foreground">
                    {running
                      ? 'Waiting for events…'
                      : 'No live log for this job in this session — the per-university results are on the left.'}
                  </p>
                ) : (
                  <ol className="space-y-1">
                    {lines.map((line, index) => {
                      const style = LEVEL_STYLES[line.level] ?? LEVEL_STYLES.info;
                      const LineIcon = style.icon;
                      return (
                        <li key={index} className="flex items-start gap-2">
                          <span className="text-muted-foreground w-11 shrink-0 tabular-nums">
                            {(line.at / 1000).toFixed(1)}s
                          </span>
                          <LineIcon className={cn('mt-0.5 size-3 shrink-0', style.className)} />
                          <span className="min-w-0 flex-1">
                            <span className={cn('break-words', style.className)}>{line.message}</span>
                            {line.status !== undefined || line.ms !== undefined ? (
                              <span className="text-muted-foreground ml-2 tabular-nums">
                                {[
                                  line.status !== undefined
                                    ? line.status === 0
                                      ? 'no response'
                                      : `HTTP ${line.status}`
                                    : null,
                                  line.ms !== undefined ? `${line.ms}ms` : null,
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
            </div>

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </>
        ) : null}

        <DialogFooter>
          {showConfig ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void start()} disabled={busy || willRun === 0 || !rangeValid}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Layers className="size-4" />}
                Run on {willRun} universit{willRun === 1 ? 'y' : 'ies'}
              </Button>
            </>
          ) : (
            <>
              {running ? (
                <Button variant="outline" onClick={() => void cancel()} disabled={busy}>
                  Stop after current university
                </Button>
              ) : null}
              {status === 'interrupted' ? (
                <Button onClick={() => void resume()} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
                  Resume ({remaining} left)
                </Button>
              ) : null}
              {!running ? (
                <Button variant="outline" onClick={newRun}>
                  <RefreshCw className="size-4" />
                  New run
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {running ? 'Close — keeps running' : 'Close'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
