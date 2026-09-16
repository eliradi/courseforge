import { BookOpen, GraduationCap, ListChecks, Star } from 'lucide-react';
import Link from 'next/link';

import { FavoriteToggle } from '@/components/favorite-toggle';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { catalogProvenance, formatCount } from '@/lib/catalog-source';
import type { FavoriteCollege, FavoriteCourse } from '@/lib/db/queries';
import type { CatalogPlatform, CatalogSource } from '@/lib/supabase/types';

/** The signed-in user's starred colleges and courses, shown above the picker. */
export function FavoritesSection({
  colleges,
  courses,
}: {
  colleges: FavoriteCollege[];
  courses: FavoriteCourse[];
}) {
  if (!colleges.length && !courses.length) return null;

  return (
    <section className="mb-14 text-left">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Star className="size-4 fill-amber-400 text-amber-500" />
        Your favourites
      </h2>

      {colleges.length ? (
        <div className="mb-6">
          <h3 className="text-muted-foreground mb-2.5 text-xs font-medium tracking-wide uppercase">
            Universities
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {colleges.map(({ college, stats }) => {
              const provenance = catalogProvenance(
                college.catalog_platform as CatalogPlatform | null,
                college.catalog_source as CatalogSource | null,
              );

              return (
                <Card key={college.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="flex items-start gap-3 py-4">
                    <Link href={`/college/${college.id}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{college.name}</span>
                      <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                        <span>{[college.city, college.state].filter(Boolean).join(', ')}</span>
                        {stats && stats.courseCount > 0 ? (
                          <span className="flex items-center gap-1 tabular-nums">
                            <BookOpen className="size-3" />
                            {formatCount(stats.courseCount)}
                          </span>
                        ) : null}
                        {provenance ? (
                          <span className="flex items-center gap-1">
                            <provenance.icon className="size-3" />
                            {provenance.label}
                          </span>
                        ) : null}
                      </span>
                    </Link>

                    <FavoriteToggle
                      target={{ collegeId: college.id }}
                      initialFavorited
                      signedIn
                      label={college.name}
                      size="sm"
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      {courses.length ? (
        <div>
          <h3 className="text-muted-foreground mb-2.5 text-xs font-medium tracking-wide uppercase">
            Courses
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {courses.map(({ course, department, college, sectionCount }) => (
              <Card key={course.id} className="hover:border-primary/50 transition-colors">
                <CardContent className="flex items-start gap-3 py-4">
                  <Link href={`/course/${course.id}`} className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">
                        {course.course_number}
                      </Badge>
                      <span className="truncate text-sm font-medium">{course.title}</span>
                    </span>
                    <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                      <span className="flex items-center gap-1">
                        <GraduationCap className="size-3" />
                        {college.short_name ?? college.name}
                      </span>
                      <span>{department.code}</span>
                      {sectionCount > 0 ? (
                        <span className="flex items-center gap-1 tabular-nums">
                          <ListChecks className="size-3" />
                          {sectionCount} sections
                        </span>
                      ) : null}
                    </span>
                  </Link>

                  <FavoriteToggle
                    target={{ courseId: course.id }}
                    initialFavorited
                    signedIn
                    label={`${course.course_number} ${course.title}`}
                    size="sm"
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
