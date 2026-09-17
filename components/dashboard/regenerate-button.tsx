'use client';

import { ChevronDown, Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { generateTestForSection } from '@/lib/generation-client';
import { QUESTION_COUNTS, type QuestionCount } from '@/lib/question-counts';
import { cn } from '@/lib/utils';

/**
 * Writes a brand-new question set for the same section, at a length the user
 * picks, then opens it. A run can take a few minutes, so the button shows how
 * far it has got.
 */
export function RegenerateButton({
  sectionId,
  currentCount,
  size = 'sm',
  className,
}: {
  sectionId: string;
  /** Length of the test being replaced, marked in the menu. */
  currentCount?: number;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<{ generated: number; target: number } | null>(null);

  async function regenerate(count: QuestionCount) {
    setProgress({ generated: 0, target: count });
    const outcome = await generateTestForSection(sectionId, count, (generated, target) =>
      setProgress({ generated, target }),
    );
    setProgress(null);

    if (outcome.ok && outcome.testSetId) {
      toast.success(`Your new ${count}-question test is ready`);
      router.push(`/test/${outcome.testSetId}`);
      return;
    }
    if (outcome.testSetId && outcome.generated) {
      toast.warning('Generation stopped early — you can resume it from the course’s tests page.');
      router.refresh();
      return;
    }
    toast.error(outcome.error ?? 'Could not generate a new test.');
  }

  if (progress) {
    const percent = Math.round((progress.generated / progress.target) * 100);
    return (
      <Button size={size} disabled className={cn('relative overflow-hidden', className)}>
        {/* Fill behind the label tracks generation progress. */}
        <span
          aria-hidden
          className="bg-primary-foreground/15 absolute inset-y-0 left-0 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
        <Loader2 className="size-3.5 animate-spin" />
        <span className="relative tabular-nums">
          Generating {progress.generated}/{progress.target}
        </span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size={size}
            className={className}
            title="Generate a new set of questions for this section"
          />
        }
      >
        <Sparkles className="size-3.5" />
        Generate new test
        <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>How many questions?</DropdownMenuLabel>
          {QUESTION_COUNTS.map((count) => (
            <DropdownMenuItem key={count} onClick={() => void regenerate(count)}>
              <span className="tabular-nums">{count} questions</span>
              {count === currentCount ? (
                <span className="text-muted-foreground ml-auto text-xs">current</span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
