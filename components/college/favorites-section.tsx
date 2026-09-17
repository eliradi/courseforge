import { ArrowUpRight, BookOpen, GraduationCap, Layers, MapPin, Star } from 'lucide-react';
import Link from 'next/link';

import { FavoriteToggle } from '@/components/favorite-toggle';
import { catalogProvenance, formatCount } from '@/lib/catalog-source';
import { formatLocation } from '@/lib/colleges';
import type { FavoriteCollege, FavoriteCourse } from '@/lib/db/queries';
import type { CatalogPlatform, CatalogSource } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';

/** Two-letter monogram for a university tile: "MIT" → "MI", "University of Oxford" → "UO". */
function monogram(name: string, shortName: string | null): string {
  const source = shortName && shortName.length <= 12 ? shortName : name;
  const words = source
    .replace(/[–—-]/g, ' ')
    .split(/\s+/)
    .filter((w) => /^[A-Za-zÀ-ž]/.test(w) && !/^(of|the|and|at|in|for|de|du)$/i.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? source).slice(0, 2).toUpperCase();
}

/** The signed-in user's starred colleges and courses, shown above the search. */
export function FavoritesSection({
  colleges,
  courses,
}: {
  colleges: FavoriteCollege[];
  courses: FavoriteCourse[];
}) {
  const total = colleges.length + courses.length;
  if (!total) return null;

  // With both kinds, courses and universities sit side by side as single-column
  // lists; with only one, it gets the full width in two columns.
  const both = colleges.length > 0 && courses.length > 0;
  const listClass = cn('grid gap-2.5', !both && 'sm:grid-cols-2');

  return (
    <section className="from-primary/[0.06] via-background to-brand-teal/[0.06] relative mb-14 overflow-hidden rounded-3xl border bg-gradient-to-br p-5 text-left shadow-sm sm:p-7">
      <header className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 shadow-sm shadow-amber-500/30">
          <Star className="size-5 fill-white text-white" />
        </span>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Your favourites</h2>
          <p className="text-muted-foreground text-sm">
            {total} saved · pick up where you left off
          </p>
        </div>
      </header>

      <div className={cn('grid gap-6', both && 'md:grid-cols-2')}>
        {courses.length ? (
          <div className="min-w-0">
            <ColumnHeading icon={BookOpen} label="Courses" count={courses.length} tone="primary" />
            <ul className={listClass}>
              {courses.map(({ course, department, college, sectionCount }) => (
                <li key={course.id} className="min-w-0">
                  <FavoriteCard
                    href={`/course/${course.id}`}
                    tile={
                      <span className="bg-primary/10 text-primary ring-primary/15 flex h-11 w-20 shrink-0 items-center justify-center rounded-xl px-1.5 font-mono text-[11px] font-semibold ring-1 ring-inset">
                        <span className="truncate">{course.course_number}</span>
                      </span>
                    }
                    title={course.title}
                    meta={
                      <>
                        <Meta icon={GraduationCap}>{college.short_name ?? college.name}</Meta>
                        <Meta>{department.code}</Meta>
                        {sectionCount > 0 ? (
                          <Meta icon={Layers}>
                            {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}
                          </Meta>
                        ) : null}
                      </>
                    }
                    toggle={
                      <FavoriteToggle
                        target={{ courseId: course.id }}
                        initialFavorited
                        signedIn
                        label={`${course.course_number} ${course.title}`}
                        size="sm"
                      />
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {colleges.length ? (
          <div className="min-w-0">
            <ColumnHeading
              icon={GraduationCap}
              label="Universities"
              count={colleges.length}
              tone="teal"
            />
            <ul className={listClass}>
              {colleges.map(({ college, stats }) => {
                const provenance = catalogProvenance(
                  college.catalog_platform as CatalogPlatform | null,
                  college.catalog_source as CatalogSource | null,
                );
                const location = formatLocation(college);

                return (
                  <li key={college.id} className="min-w-0">
                    <FavoriteCard
                      href={`/college/${college.id}`}
                      tile={
                        <span className="from-primary to-brand-teal flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold tracking-wide text-white shadow-sm">
                          {monogram(college.name, college.short_name)}
                        </span>
                      }
                      title={college.name}
                      meta={
                        <>
                          {location ? <Meta icon={MapPin}>{location}</Meta> : null}
                          {stats && stats.courseCount > 0 ? (
                            <Meta icon={BookOpen}>{formatCount(stats.courseCount)} courses</Meta>
                          ) : null}
                          {provenance ? (
                            <Meta icon={provenance.icon}>{provenance.label}</Meta>
                          ) : null}
                        </>
                      }
                      toggle={
                        <FavoriteToggle
                          target={{ collegeId: college.id }}
                          initialFavorited
                          signedIn
                          label={college.name}
                          size="sm"
                        />
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ColumnHeading({
  icon: Icon,
  label,
  count,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  tone: 'primary' | 'teal';
}) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <Icon className={cn('size-4', tone === 'primary' ? 'text-primary' : 'text-brand-teal')} />
      {label}
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
          tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-brand-teal/10 text-brand-teal',
        )}
      >
        {count}
      </span>
    </h3>
  );
}

/** One saved item: the whole card is the link; the star sits on top of it. */
function FavoriteCard({
  href,
  tile,
  title,
  meta,
  toggle,
}: {
  href: string;
  tile: React.ReactNode;
  title: string;
  meta: React.ReactNode;
  toggle: React.ReactNode;
}) {
  return (
    <div className="group bg-card/80 hover:border-primary/40 hover:shadow-primary/5 relative flex items-center gap-3.5 rounded-2xl border p-3 pr-10 shadow-xs backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      {tile}
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="group-hover:text-primary block truncate text-[15px] leading-snug font-semibold transition-colors after:absolute after:inset-0 after:rounded-2xl"
        >
          {title}
        </Link>
        <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          {meta}
        </p>
      </div>
      <ArrowUpRight className="text-muted-foreground/0 group-hover:text-primary absolute right-3 bottom-3 size-4 transition-colors" />
      {/* Above the stretched link so starring doesn't navigate. */}
      <div className="absolute top-2.5 right-2.5 z-10">{toggle}</div>
    </div>
  );
}

function Meta({
  icon: Icon,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      {Icon ? <Icon className="size-3 shrink-0" /> : null}
      {children}
    </span>
  );
}
