'use client';

import { Loader2, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { startAttempt } from '@/app/actions/attempts';
import { Button } from '@/components/ui/button';

/** Opens a fresh attempt against a test the user has already taken. */
export function RetakeButton({ testSetId }: { testSetId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function retake() {
    startTransition(async () => {
      const result = await startAttempt({ testSetId });
      if (!result.ok || !result.attemptId) {
        toast.error(result.error ?? 'Could not start the test.');
        return;
      }
      router.push(`/test/${testSetId}?attempt=${result.attemptId}`);
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={retake} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
      Retake
    </Button>
  );
}
