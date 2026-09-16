'use client';

import { Check, Loader2, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { toggleFavorite } from '@/app/actions/favorites';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Target = { collegeId: string } | { courseId: string };

/**
 * Star (colleges) / check (courses) toggle.
 *
 * Optimistic: the icon flips immediately and rolls back if the action fails, so
 * starring a row in a 200-item list never feels laggy.
 */
export function FavoriteToggle({
  target,
  initialFavorited,
  signedIn,
  label,
  size = 'default',
  className,
}: {
  target: Target;
  initialFavorited: boolean;
  signedIn: boolean;
  /** What is being favourited, for the tooltip and screen readers. */
  label: string;
  size?: 'default' | 'sm';
  className?: string;
}) {
  const router = useRouter();
  const isCourse = 'courseId' in target;
  const [saved, setSaved] = useState(initialFavorited);
  const [optimistic, setOptimistic] = useOptimistic(saved);
  const [pending, startTransition] = useTransition();

  const Icon = isCourse ? Check : Star;
  const iconSize = size === 'sm' ? 'size-3.5' : 'size-4';

  function activate(event: React.MouseEvent | React.KeyboardEvent) {
    // Rows in the picker and the course table are themselves clickable.
    event.preventDefault();
    event.stopPropagation();

    if (!signedIn) {
      router.push(`/auth/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    startTransition(async () => {
      setOptimistic(!optimistic);
      const result = await toggleFavorite(target);

      if (!result.ok) {
        toast.error(result.error ?? 'Could not update your favourites.');
        return;
      }

      setSaved(Boolean(result.favorited));
      router.refresh();
    });
  }

  const verb = optimistic ? 'Remove from' : 'Add to';

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-pressed={optimistic}
            aria-label={`${verb} favourites: ${label}`}
            onClick={activate}
            // cmdk selects an item on pointer-down, so the star has to claim the
            // event before the row ever sees it.
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-md transition-colors',
              size === 'sm' ? 'size-6' : 'size-7',
              optimistic
                ? 'text-amber-500 hover:text-amber-600'
                : 'text-muted-foreground/50 hover:text-foreground hover:bg-muted',
              className,
            )}
          />
        }
      >
        {pending ? (
          <Loader2 className={cn(iconSize, 'animate-spin')} />
        ) : (
          <Icon className={cn(iconSize, optimistic && !isCourse && 'fill-current')} />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {signedIn ? `${verb} favourites` : 'Sign in to save favourites'}
      </TooltipContent>
    </Tooltip>
  );
}
