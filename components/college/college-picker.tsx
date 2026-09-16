'use client';

import { BookOpen, Check, ChevronsUpDown, Loader2, Search, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { FavoriteToggle } from '@/components/favorite-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { catalogProvenance, describeDiscovery, formatCount } from '@/lib/catalog-source';
import type { CollegeStats } from '@/lib/db/queries';
import type { CatalogPlatform, CatalogSource, College } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

export interface CollegeOption extends College {
  stats: CollegeStats | null;
  favorited: boolean;
}

export function CollegePicker({
  colleges,
  signedIn,
}: {
  colleges: CollegeOption[];
  signedIn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = useMemo(
    () => colleges.find((c) => c.id === selectedId) ?? null,
    [colleges, selectedId],
  );

  const indexedCount = useMemo(
    () => colleges.filter((c) => (c.stats?.courseCount ?? 0) > 0).length,
    [colleges],
  );

  function choose(college: College) {
    setSelectedId(college.id);
    setOpen(false);
    startTransition(() => router.push(`/college/${college.id}`));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            aria-label="Search for a college"
            className="h-14 w-full justify-between px-4 text-base font-normal shadow-sm"
            disabled={pending}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-3">
          {pending ? (
            <Loader2 className="text-muted-foreground size-5 shrink-0 animate-spin" />
          ) : (
            <Search className="text-muted-foreground size-5 shrink-0" />
          )}
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.name : 'Search all 200 colleges…'}
          </span>
        </span>
        <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[min(40rem,calc(100vw-2rem))] p-0">
        <Command
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Type a college, state, or abbreviation…" />

          {indexedCount > 0 ? (
            <p className="text-muted-foreground border-b px-3 py-2 text-xs">
              <span className="bg-primary/60 mr-1.5 inline-block size-1.5 rounded-full align-middle" />
              {indexedCount} {indexedCount === 1 ? 'college is' : 'colleges are'} already indexed —
              those open instantly.
            </p>
          ) : null}

          <CommandList className="max-h-[24rem]">
            <CommandEmpty className="py-8 text-center text-sm">
              No college matches that search.
            </CommandEmpty>
            <CommandGroup>
              {colleges.map((college) => (
                <CollegeRow
                  key={college.id}
                  college={college}
                  selected={selectedId === college.id}
                  signedIn={signedIn}
                  onSelect={() => choose(college)}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CollegeRow({
  college,
  selected,
  signedIn,
  onSelect,
}: {
  college: CollegeOption;
  selected: boolean;
  signedIn: boolean;
  onSelect: () => void;
}) {
  const courseCount = college.stats?.courseCount ?? 0;
  const indexed = courseCount > 0;
  const attempts = college.stats?.attemptsTaken ?? 0;
  // Both columns are plain `text` in Postgres; the app owns the narrower union.
  const provenance = catalogProvenance(
    college.catalog_platform as CatalogPlatform | null,
    college.catalog_source as CatalogSource | null,
  );
  const discovery = describeDiscovery(college.catalog_source as CatalogSource | null);

  return (
    <CommandItem
      // Everything searchable goes in `value` so type-ahead hits all of it.
      value={[college.name, college.short_name, college.state, college.city, college.website_domain]
        .filter(Boolean)
        .join(' ')}
      onSelect={onSelect}
      className={cn(
        'gap-3 py-2.5',
        // Indexed schools get a tinted row and an accent rail, so the ones that
        // open instantly stand out while scrolling the full 200.
        indexed && 'bg-primary/[0.04] border-primary/40 border-l-2',
      )}
    >
      <Badge
        variant="secondary"
        className="w-10 shrink-0 justify-center font-mono text-[11px] tabular-nums"
      >
        #{college.rank}
      </Badge>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{college.name}</span>
        <span className="text-muted-foreground block truncate text-xs">
          {[college.city, college.state].filter(Boolean).join(', ')}
        </span>
      </span>

      {indexed ? (
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {provenance ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
                      provenance.kind === 'manual' &&
                        'border-amber-500/40 text-amber-700 dark:text-amber-400',
                      provenance.kind === 'scraped' && 'text-muted-foreground',
                      provenance.kind === 'platform' && 'border-primary/30 text-primary',
                    )}
                  />
                }
              >
                <provenance.icon className="size-3" />
                <span className="hidden md:inline">{provenance.label}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>{provenance.detail}</p>
                {discovery ? <p className="text-muted-foreground mt-1">{discovery}</p> : null}
              </TooltipContent>
            </Tooltip>
          ) : null}

          <Tooltip>
            <TooltipTrigger
              render={
                <span className="text-muted-foreground flex items-center gap-1 text-[11px] tabular-nums" />
              }
            >
              <BookOpen className="size-3" />
              {formatCount(courseCount)}
            </TooltipTrigger>
            <TooltipContent>
              {formatCount(courseCount)} courses cached across{' '}
              {formatCount(college.stats?.departmentCount ?? 0)} departments
            </TooltipContent>
          </Tooltip>

          {attempts > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="text-muted-foreground flex items-center gap-1 text-[11px] tabular-nums" />
                }
              >
                <Users className="size-3" />
                {formatCount(attempts)}
              </TooltipTrigger>
              <TooltipContent>
                {formatCount(attempts)} {attempts === 1 ? 'test has' : 'tests have'} been taken at
                this university
              </TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      ) : null}

      <FavoriteToggle
        target={{ collegeId: college.id }}
        initialFavorited={college.favorited}
        signedIn={signedIn}
        label={college.name}
        size="sm"
      />

      <Check className={cn('size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
    </CommandItem>
  );
}
