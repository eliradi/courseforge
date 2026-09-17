'use client';

import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Play,
  Printer,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { startAttempt } from '@/app/actions/attempts';
import { deleteTestSet } from '@/app/actions/test-sets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { createClient } from '@/lib/supabase/client';
import type { CourseSection, TestSet, TestSetStatus } from '@/lib/supabase/types';

const STATUS_STYLES: Record<TestSetStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
  generating: { label: 'Generating', className: 'bg-primary/10 text-primary' },
  complete: {
    label: 'Complete',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive' },
};

export function TestSetCard({
  testSet: initialTestSet,
  section,
  courseTitle,
  isOwner,
}: {
  testSet: TestSet;
  section: CourseSection | undefined;
  courseTitle: string;
  /** Generated tests are shared; only the creator may resume or delete one. */
  isOwner: boolean;
}) {
  const router = useRouter();
  const [testSet, setTestSet] = useState(initialTestSet);
  const [resuming, setResuming] = useState(false);
  const [pending, startTransition] = useTransition();

  const isLive = testSet.status === 'generating' || testSet.status === 'pending';

  // Supabase Realtime drives the progress bar; polling covers the case where
  // Realtime isn't reachable (self-hosted, blocked websockets, …).
  useEffect(() => {
    if (!isLive) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`test_set:${testSet.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'test_sets', filter: `id=eq.${testSet.id}` },
        (payload) => setTestSet(payload.new as TestSet),
      )
      .subscribe();

    const poll = setInterval(async () => {
      const { data } = await supabase.from('test_sets').select('*').eq('id', testSet.id).maybeSingle();
      if (data) setTestSet(data as TestSet);
    }, 5000);

    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [isLive, testSet.id]);

  const resume = useCallback(async () => {
    setResuming(true);
    try {
      const response = await fetch('/api/test-sets/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ testSetId: testSet.id }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({ error: 'Could not resume.' }));
        throw new Error(body.error ?? `Server responded ${response.status}`);
      }

      // Drain the stream so the run isn't cancelled; Realtime updates the UI.
      const reader = response.body.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }

      toast.success('Generation finished');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not resume generation.');
    } finally {
      setResuming(false);
    }
  }, [router, testSet.id]);

  async function take() {
    const result = await startAttempt({ testSetId: testSet.id });
    if (!result.ok || !result.attemptId) {
      toast.error(result.error ?? 'Could not start the test.');
      return;
    }
    router.push(`/test/${testSet.id}?attempt=${result.attemptId}`);
  }

  async function remove() {
    const result = await deleteTestSet({ testSetId: testSet.id });
    if (!result.ok) {
      toast.error(result.error ?? 'Could not delete.');
      return;
    }
    toast.success('Test set deleted');
    router.refresh();
  }

  const status = STATUS_STYLES[testSet.status as TestSetStatus] ?? STATUS_STYLES.pending;
  const percent = Math.round((testSet.question_count / (testSet.target_count || 100)) * 100);

  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{section?.title ?? 'Section removed'}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {courseTitle} · created {new Date(testSet.created_at).toLocaleDateString()}
            {isOwner ? '' : ' · shared by another student'}
          </p>
        </div>

        <Badge className={`${status.className} gap-1.5 border-0`}>
          {testSet.status === 'generating' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : testSet.status === 'complete' ? (
            <CheckCircle2 className="size-3" />
          ) : testSet.status === 'failed' ? (
            <AlertCircle className="size-3" />
          ) : null}
          {status.label}
        </Badge>
      </div>

      {isLive || testSet.status === 'failed' ? (
        <div className="mt-3 space-y-1.5">
          <Progress value={percent} className="h-1.5" />
          <p className="text-muted-foreground text-xs tabular-nums">
            {testSet.question_count}/{testSet.target_count} questions
            {testSet.error ? ` · ${testSet.error}` : ''}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-xs tabular-nums">
          {testSet.question_count} questions
          {testSet.model_used ? ` · ${testSet.model_used}` : ''}
        </p>
      )}

      {testSet.status === 'failed' && !isOwner ? (
        <p className="text-muted-foreground mt-3 text-xs">
          Only the student who started this run can resume it.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {testSet.status === 'complete' ? (
          <>
            <Button size="sm" onClick={() => startTransition(() => void take())} disabled={pending}>
              <Play className="size-3.5" />
              Take test
            </Button>
            <Button size="sm" variant="outline" nativeButton={false} render={<a href={`/test/${testSet.id}/results`} />}>
              Review answers
            </Button>
            <Button
              size="sm"
              variant="outline" nativeButton={false}
              render={<a href={`/api/test-sets/${testSet.id}/export?format=json`} download />}
            >
              <Download className="size-3.5" />
              JSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <a href={`/api/test-sets/${testSet.id}/export?format=html`} target="_blank" rel="noreferrer" />
              }
            >
              <Printer className="size-3.5" />
              Print
            </Button>
          </>
        ) : null}

        {testSet.status === 'failed' && isOwner ? (
          <Button size="sm" onClick={() => void resume()} disabled={resuming}>
            {resuming ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {testSet.question_count > 0 ? 'Resume generation' : 'Retry'}
          </Button>
        ) : null}

        {!isLive && isOwner ? (
          <Button size="sm" variant="ghost" onClick={() => void remove()}>
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  );
}
