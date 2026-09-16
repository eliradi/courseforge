import { BookOpen, ListChecks, Search } from 'lucide-react';

import { CollegePicker } from '@/components/college/college-picker';
import { FavoritesSection } from '@/components/college/favorites-section';
import { TestHistorySection } from '@/components/dashboard/test-history';
import {
  getCollegeStats,
  getFavoriteIds,
  getTestHistory,
  listColleges,
  listFavorites,
} from '@/lib/db/queries';
import { getUser } from '@/lib/supabase/server';

// Stats move whenever someone takes a test, so this page is rendered per request.
export const dynamic = 'force-dynamic';

const STEPS = [
  {
    icon: Search,
    title: 'Pick your college',
    body: 'All 200 top-ranked US national universities, searchable by name, abbreviation or state.',
  },
  {
    icon: BookOpen,
    title: 'Drill into a course',
    body: 'We find the official catalog, read the department list, and pull the full course profile.',
  },
  {
    icon: ListChecks,
    title: 'Generate practice tests',
    body: '100 original questions per section, graded and charted by topic and difficulty.',
  },
];

export default async function HomePage() {
  const user = await getUser();
  const [colleges, stats, favoriteIds, favorites, history] = await Promise.all([
    listColleges(),
    getCollegeStats(),
    getFavoriteIds(user?.id ?? null),
    user ? listFavorites(user.id) : Promise.resolve({ colleges: [], courses: [] }),
    getTestHistory(user?.id ?? null),
  ]);

  const options = colleges.map((college) => ({
    ...college,
    stats: stats.get(college.id) ?? null,
    favorited: favoriteIds.collegeIds.has(college.id),
  }));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:py-24">
      <section className="text-center">
        <p className="text-primary mb-3 text-sm font-medium">
          {colleges.length} universities · live catalogs
        </p>
        <h1 className="text-4xl font-semibold sm:text-5xl">
          Explore any college course.
          <br />
          Then test yourself on it.
        </h1>
        <p className="text-muted-foreground mx-auto mt-5 max-w-xl text-lg">
          CourseForge reads a university&apos;s own course catalog, builds a full profile of the
          course you pick, and generates a hundred practice questions for every section.
        </p>

        <div className="mx-auto mt-10 max-w-xl">
          <CollegePicker colleges={options} signedIn={Boolean(user)} />
          <p className="text-muted-foreground mt-3 text-xs">
            Start typing — try &ldquo;MIT&rdquo;, &ldquo;Berkeley&rdquo;, or &ldquo;Texas&rdquo;.
          </p>
        </div>
      </section>

      {user ? (
        <div className="mt-16">
          <TestHistorySection history={history} />
          <FavoritesSection colleges={favorites.colleges} courses={favorites.courses} />
        </div>
      ) : null}

      <section className="mt-20 grid gap-8 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <div key={step.title}>
            <div className="bg-primary/10 text-primary mb-3 flex size-9 items-center justify-center rounded-lg">
              <step.icon className="size-4" />
            </div>
            <h2 className="text-sm font-semibold">
              <span className="text-muted-foreground mr-1.5 font-mono text-xs">0{index + 1}</span>
              {step.title}
            </h2>
            <p className="text-muted-foreground mt-1.5 text-sm">{step.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
