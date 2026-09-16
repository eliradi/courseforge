'use client';

import { AlertTriangle, RefreshCw, Wand2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { ScrapeProgress } from '@/components/college/scrape-progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useScrapeStream } from '@/hooks/use-scrape-stream';

/**
 * Fills in whatever a course profile is missing — summary, textbooks, sections —
 * showing each step as it happens.
 *
 * Never forced: data already in the database is kept, so pressing this to get a
 * course ready for a test doesn't re-scrape the catalog entry.
 */
export function CourseBuilder({
  courseId,
  autoStart,
  label = 'Complete this course profile',
}: {
  courseId: string;
  autoStart: boolean;
  label?: string;
}) {
  const router = useRouter();
  const stream = useScrapeStream<unknown>(`/api/courses/${courseId}/build`);

  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void build({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  async function build(body: Record<string, unknown>) {
    const result = await stream.run(body);
    if (result) {
      toast.success('Course profile updated');
      router.refresh();
    }
  }

  if (stream.running) {
    return <ScrapeProgress steps={stream.steps} title="Building the course profile" />;
  }

  if (stream.error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>We couldn&apos;t finish this profile</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{stream.error.message}</p>
          <Button size="sm" variant="outline" onClick={() => void build({})}>
            <RefreshCw className="size-3.5" />
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void build({})}>
      <Wand2 className="size-3.5" />
      {label}
    </Button>
  );
}
