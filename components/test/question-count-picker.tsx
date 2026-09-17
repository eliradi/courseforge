'use client';

import { QUESTION_COUNTS, type QuestionCount } from '@/lib/question-counts';
import { cn } from '@/lib/utils';

/** Segmented control for how many questions a generated test should have. */
export function QuestionCountPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: QuestionCount;
  onChange: (count: QuestionCount) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Questions per test"
      className={cn('bg-muted inline-flex rounded-lg p-0.5', className)}
    >
      {QUESTION_COUNTS.map((count) => (
        <button
          key={count}
          type="button"
          role="radio"
          aria-checked={value === count}
          disabled={disabled}
          onClick={() => onChange(count)}
          className={cn(
            'min-w-9 rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors disabled:opacity-50',
            value === count
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {count}
        </button>
      ))}
    </div>
  );
}
