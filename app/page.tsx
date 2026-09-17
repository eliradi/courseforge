import { ArrowRight } from 'lucide-react';
import Image from 'next/image';

import { CourseFinder } from '@/components/college/course-finder';
import { FavoritesSection } from '@/components/college/favorites-section';
import { HomeSearch } from '@/components/college/home-search';
import { TestHistorySection } from '@/components/dashboard/test-history';
import { BrandLogo } from '@/components/layout/brand-logo';
import { FloatingControls, StartAcingButton } from '@/components/layout/landing-controls';
import { PricingSection } from '@/components/marketing/pricing-section';
import {
  getCollegeStats,
  getFavoriteIds,
  getTestHistory,
  listColleges,
  listFavorites,
} from '@/lib/db/queries';
import { getUser } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

// Stats move whenever someone takes a test, so this page is rendered per request.
export const dynamic = 'force-dynamic';

const STEPS = [
  {
    image: '/icon-search.png',
    title: 'Find a course or university',
    body: 'Check a course by its name or number, or browse the full catalog of a top-ranked university anywhere in the world.',
  },
  {
    image: '/icon-generate.png',
    title: 'Generate practice tests',
    body: 'Choose 10 to 100 original questions per section, graded and charted by topic and difficulty.',
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
    <div
      id="top"
      className={cn(
        'mx-auto w-full max-w-4xl px-4 pb-16 sm:pb-24',
        user ? 'pt-10 sm:pt-14' : 'pt-16 sm:pt-14',
      )}
    >
      {/* Signed-in visitors get the regular site header instead (see SiteHeader). */}
      {user ? null : (
        <>
          <FloatingControls />
          <BrandLogo
            alt="Aceversity — Ace Your University Journey"
            imageClassName="h-20 sm:h-28"
            className="mx-auto"
            priority
          />
          <div className="mt-5 mb-12 flex justify-center">
            <StartAcingButton />
          </div>
        </>
      )}

      {user ? (
        <>
          <FavoritesSection colleges={favorites.colleges} courses={favorites.courses} />
          <TestHistorySection history={history} />
        </>
      ) : null}

      <section className="text-center">
        <p className="text-primary mb-3 text-sm font-medium">
          {colleges.length} universities · live catalogs
        </p>
        {/* Half-size for signed-in users, who are here to search rather than read the pitch. */}
        <h1 className={cn('font-semibold', user ? 'text-xl sm:text-2xl' : 'text-4xl sm:text-5xl')}>
          <span className="text-primary">Explore any college course.</span>
          <br />
          <span className="text-brand-teal">Then test yourself on it.</span>
        </h1>
        {user ? null : (
          <p className="text-muted-foreground mx-auto mt-5 max-w-xl text-lg">
            Aceversity reads a university&apos;s own course catalog, builds a full profile of the
            course you pick, and generates practice questions for every section.
          </p>
        )}

        <div className={cn('mx-auto max-w-xl', user ? 'mt-6' : 'mt-10')}>
          {user ? (
            <HomeSearch colleges={options} />
          ) : (
            // Signed-out visitors check a specific course before committing to anything.
            <CourseFinder colleges={options} />
          )}
        </div>
      </section>

      {/* Signed-in visitors already know the product; the pitch is for newcomers. */}
      {user ? null : (
        <>
          <section className="mt-24 text-center">
            <p className="text-brand-teal text-sm font-semibold">How it works</p>
            <h2 className="text-primary mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
              Two steps to exam-ready
            </h2>

            <div className="relative mx-auto mt-10 max-w-3xl">
              {/* Connector between the steps on wider screens. */}
              <span
                aria-hidden
                className="bg-background text-muted-foreground absolute top-1/2 left-1/2 z-10 hidden size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm sm:flex"
              >
                <ArrowRight className="size-4" />
              </span>
              <ol className="grid gap-8 sm:grid-cols-2 sm:gap-10">
                {STEPS.map((step, index) => (
                  <li
                    key={step.title}
                    className="group from-primary/[0.05] to-brand-teal/[0.06] bg-card relative flex flex-col items-center rounded-3xl border bg-gradient-to-b px-6 pt-9 pb-7 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md"
                  >
                    <span className="from-primary to-brand-teal absolute -top-3.5 flex size-7 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-sm ring-4 ring-background">
                      {index + 1}
                    </span>
                    <Image
                      src={step.image}
                      alt=""
                      width={256}
                      height={256}
                      className="size-20 drop-shadow-md transition-transform duration-300 group-hover:scale-105"
                    />
                    <h3 className="mt-5 text-lg font-semibold tracking-tight">{step.title}</h3>
                    <p className="text-muted-foreground mt-2 max-w-xs text-sm leading-relaxed">
                      {step.body}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <PricingSection />
        </>
      )}
    </div>
  );
}
