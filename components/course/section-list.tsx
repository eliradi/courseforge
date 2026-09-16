'use client';

import { ListChecks, Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { CourseSection, SectionSource, TestSet } from '@/lib/supabase/types';

const SOURCE_LABELS: Record<SectionSource, string> = {
  textbook_toc: 'from textbook contents',
  syllabus: 'from syllabus',
  ai_derived: 'AI-derived outline',
};

interface QueueItem {
  sectionId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  generated: number;
  message?: string;
}

export function SectionList({
  sections,
  sectionSource,
  existingSets,
  signedIn,
  aiEnabled,
}: {
  sections: CourseSection[];
  sectionSource: SectionSource | null;
  existingSets: TestSet[];
  signedIn: boolean;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);

  const completeBySection = new Map(
    existingSets.filter((s) => s.status === 'complete').map((s) => [s.course_section_id, s]),
  );

  /** Streams one section's generation run, updating its row as batches land. */
  async function generateOne(sectionId: string): Promise<boolean> {
    setQueue((prev) =>
      prev.map((item) => (item.sectionId === sectionId ? { ...item, status: 'running' } : item)),
    );

    try {
      const response = await fetch('/api/test-sets/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseSectionId: sectionId }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({ error: 'Generation failed' }));
        throw new Error(body.error ?? `Server responded ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let ok = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let event: { type: string; message?: string; payload?: { generated?: number; status?: string } };
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (event.type === 'progress') {
            const match = event.message?.match(/(\d+)\s*\/\s*100/);
            setQueue((prev) =>
              prev.map((item) =>
                item.sectionId === sectionId
                  ? {
                      ...item,
                      message: event.message,
                      generated: match ? Number(match[1]) : item.generated,
                    }
                  : item,
              ),
            );
          } else if (event.type === 'done') {
            ok = event.payload?.status === 'complete';
            setQueue((prev) =>
              prev.map((item) =>
                item.sectionId === sectionId
                  ? {
                      ...item,
                      status: ok ? 'done' : 'failed',
                      generated: event.payload?.generated ?? item.generated,
                      message: ok ? 'Complete' : 'Partly generated — you can resume it',
                    }
                  : item,
              ),
            );
          } else if (event.type === 'error') {
            setQueue((prev) =>
              prev.map((item) =>
                item.sectionId === sectionId
                  ? { ...item, status: 'failed', message: event.message }
                  : item,
              ),
            );
            return false;
          }
        }
      }

      return ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      setQueue((prev) =>
        prev.map((item) =>
          item.sectionId === sectionId ? { ...item, status: 'failed', message } : item,
        ),
      );
      return false;
    }
  }

  async function run(sectionIds: string[]) {
    setBusy(true);
    setQueue(sectionIds.map((sectionId) => ({ sectionId, status: 'queued', generated: 0 })));

    let succeeded = 0;
    // Sequential on purpose — one generation run at a time keeps cost and rate
    // limits predictable, and the queue stays legible.
    for (const sectionId of sectionIds) {
      const ok = await generateOne(sectionId);
      if (ok) succeeded++;
    }

    setBusy(false);
    router.refresh();

    if (succeeded === sectionIds.length) {
      toast.success(
        succeeded === 1 ? 'Test ready — 100 questions' : `${succeeded} tests ready`,
        { description: 'Open the test dashboard to take them.' },
      );
    } else {
      toast.warning(`${succeeded} of ${sectionIds.length} tests completed`, {
        description: 'Failed sections kept their questions and can be resumed.',
      });
    }
  }

  const disabledReason = !signedIn
    ? 'Sign in to generate tests'
    : !aiEnabled
      ? 'Set AI_GATEWAY_API_KEY to enable generation'
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {sections.length} sections
          {sectionSource ? ` · ${SOURCE_LABELS[sectionSource]}` : ''}
        </p>

        <Button
          size="sm"
          disabled={busy || Boolean(disabledReason)}
          title={disabledReason ?? undefined}
          onClick={() => void run(sections.map((s) => s.id))}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Create tests for all sections
        </Button>
      </div>

      {disabledReason ? (
        <p className="text-muted-foreground text-xs">{disabledReason}.</p>
      ) : null}

      <ol className="space-y-3">
        {sections.map((section, index) => {
          const queued = queue.find((q) => q.sectionId === section.id);
          const existing = completeBySection.get(section.id);

          return (
            <li key={section.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">
                    <span className="text-muted-foreground mr-2 font-mono text-xs tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {section.title}
                  </h3>

                  {section.topics.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {section.topics.map((topic) => (
                        <Badge key={topic} variant="secondary" className="text-[11px] font-normal">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {existing ? (
                    <Button
                      size="sm"
                      variant="outline" nativeButton={false}
                      render={<a href={`/test/${existing.id}`} />}
                    >
                      View existing
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    variant={existing ? 'ghost' : 'outline'}
                    disabled={busy || Boolean(disabledReason)}
                    title={disabledReason ?? undefined}
                    onClick={() => void run([section.id])}
                  >
                    {queued?.status === 'running' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ListChecks className="size-3.5" />
                    )}
                    {existing ? 'Generate fresh' : 'Create test (100 Qs)'}
                  </Button>
                </div>
              </div>

              {queued && queued.status !== 'queued' ? (
                <div className="mt-3 space-y-1.5">
                  <Progress value={queued.generated} max={100} className="h-1.5" />
                  <p
                    className={`text-xs ${
                      queued.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                    }`}
                  >
                    {queued.message ?? `${queued.generated}/100 questions`}
                  </p>
                </div>
              ) : queued?.status === 'queued' ? (
                <p className="text-muted-foreground mt-3 text-xs">Waiting in queue…</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
