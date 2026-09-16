import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Designed empty/error state — never a bare string on a blank page. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'default',
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: 'default' | 'destructive';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center',
        variant === 'destructive' && 'border-destructive/40 bg-destructive/5',
        className,
      )}
    >
      <div
        className={cn(
          'mb-4 flex size-12 items-center justify-center rounded-full',
          variant === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-5" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? (
        <div className="text-muted-foreground mt-1.5 max-w-md text-sm">{description}</div>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
