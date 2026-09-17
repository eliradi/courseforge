'use client';

import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  Library,
  ListChecks,
  Loader2,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';

import type {
  AllCoursesSearchResponse,
  CourseMatch,
  CourseSearchResponse,
} from '@/app/api/search/courses/route';
import { CollegePicker, type CollegeOption } from '@/components/college/college-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const DEBOUNCE_MS = 300;

/**
 * Signed-out visitors get answers only; signed-in users also get links into
 * the university, department and course pages (which require sign-in).
 */
const SignedInContext = createContext(false);

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: CourseSearchResponse | AllCoursesSearchResponse }
  | { status: 'error'; message: string };

/**
 * The "do you have this course?" check.
 *
 * Type a course to see where it's taught across every university we hold.
 * Narrowing to one university answers whether we have it there — and whether
 * anything similar is sourced elsewhere. Purely a read of what's stored:
 * nothing here triggers a scrape.
 */
export function CourseFinder({
  colleges,
  signedIn = false,
}: {
  colleges: CollegeOption[];
  signedIn?: boolean;
}) {
  const courseInputId = useId();
  const [college, setCollege] = useState<CollegeOption | null>(null);
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced lookup as the visitor types. Each keystroke cancels the last
  // request so a slow response can never overwrite a newer one.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setLookup({ status: 'idle' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLookup({ status: 'loading' });
      try {
        const params = new URLSearchParams({ q: term });
        if (college) params.set('college', college.id);
        const response = await fetch(`/api/search/courses?${params}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'The lookup failed.');
        setLookup({ status: 'done', result: body as CourseSearchResponse | AllCoursesSearchResponse });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLookup({
          status: 'error',
          message: error instanceof Error ? error.message : 'The lookup failed.',
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [college, query]);

  function pickCollege(next: CollegeOption) {
    setCollege(next);
    // Keep the typed course — it's often the same one being checked elsewhere.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  /** Choosing a suggestion makes it the course being checked. */
  function pickSuggestion(match: CourseMatch) {
    setQuery(match.title);
    inputRef.current?.focus();
  }

  return (
    <SignedInContext.Provider value={signedIn}>
      <div className="space-y-4 text-left">
        <div className="space-y-1.5">
          <Label
            htmlFor={courseInputId}
            className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
          >
            Course
          </Label>
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2" />
            <Input
              ref={inputRef}
              id={courseInputId}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                college
                  ? `Course name or number at ${college.short_name ?? college.name}`
                  : 'Course name or number — e.g. “Machine Learning” or “6.1010”'
              }
              className="h-14 pl-12 text-base shadow-sm"
              autoComplete="off"
              spellCheck={false}
            />
            {lookup.status === 'loading' ? (
              <Loader2 className="text-muted-foreground absolute top-1/2 right-4 size-4 -translate-y-1/2 animate-spin" />
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              University <span className="font-normal normal-case">(optional)</span>
            </Label>
            {college ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-6 px-2 text-xs"
                onClick={() => setCollege(null)}
              >
                <X className="size-3" />
                Search all universities
              </Button>
            ) : null}
          </div>
          <CollegePicker
            colleges={colleges}
            signedIn={signedIn}
            onSelect={pickCollege}
            value={college?.id ?? null}
            placeholder="All universities — or pick one to narrow the results"
          />
        </div>

        <div aria-live="polite" className="space-y-4">
          {lookup.status === 'loading' ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {college ? `Checking ${college.name}…` : 'Searching all universities…'}
            </p>
          ) : null}

          {lookup.status === 'error' ? (
            <p className="text-destructive text-sm">{lookup.message}</p>
          ) : null}

          {lookup.status === 'done' && lookup.result.scope === 'all' ? (
            <AllResults
              result={lookup.result}
              onNarrow={(collegeId) => {
                const next = colleges.find((c) => c.id === collegeId);
                if (next) pickCollege(next);
              }}
            />
          ) : null}

          {lookup.status === 'done' && lookup.result.scope === 'college' ? (
            <>
              <Answer result={lookup.result} onPick={pickSuggestion} />
              <Elsewhere result={lookup.result} />
            </>
          ) : null}
        </div>
      </div>
    </SignedInContext.Provider>
  );
}

/* ------------------------------------------------------------------ answer */

function Answer({
  result,
  onPick,
}: {
  result: CourseSearchResponse;
  onPick: (match: CourseMatch) => void;
}) {
  const { college, match, atCollege } = result;
  const signedIn = useContext(SignedInContext);
  const browseLink = signedIn ? (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/college/${college.id}`} />}>
      <Library className="size-3.5" />
      Browse {college.name}&apos;s departments
    </Button>
  ) : null;

  if (match) {
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/[0.04]">
        <CardContent className="space-y-3 py-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-500" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Yes — this course is in our system.</p>
              <p className="mt-1 text-sm">
                <span className="font-mono">{match.courseNumber}</span> {match.title}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {college.name} · {match.departmentName}
              </p>
            </div>
          </div>

          <TestAvailability match={match} />

          {signedIn ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" nativeButton={false} render={<Link href={`/course/${match.courseId}`} />}>
                View course
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          ) : null}

          {atCollege.length ? (
            <Suggestions
              label={`Other matches at ${college.name}`}
              matches={atCollege.slice(0, 4)}
              onPick={onPick}
            />
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (!college.indexed) {
    return (
      <Card>
        <CardContent className="space-y-3 py-5">
          <div className="flex items-start gap-3">
            <CircleHelp className="text-muted-foreground mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">We haven&apos;t read {college.name}&apos;s catalog yet.</p>
              <p className="text-muted-foreground mt-1 text-sm">
                So we can&apos;t say whether this course is taught there.{' '}
                {signedIn
                  ? 'Opening the university reads its catalog from the official website — it only takes a moment the first time.'
                  : 'Sign in and open the university to have its catalog read from the official website.'}
              </p>
            </div>
          </div>
          {browseLink}
        </CardContent>
      </Card>
    );
  }

  if (atCollege.length) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/[0.04]">
        <CardContent className="space-y-3 py-5">
          <div className="flex items-start gap-3">
            <CircleHelp className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
            <div>
              <p className="font-semibold">No exact match at {college.name}.</p>
              <p className="text-muted-foreground mt-1 text-sm">
                These are the closest courses we have there — pick one to check it.
              </p>
            </div>
          </div>
          <Suggestions matches={atCollege} onPick={onPick} />
        </CardContent>
      </Card>
    );
  }

  const complete = college.departmentCount > 0 && college.departmentsSourced >= college.departmentCount;

  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        <div className="flex items-start gap-3">
          <XCircle className="text-muted-foreground mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">
              {complete
                ? `Not in our system at ${college.name}.`
                : `Not in our system at ${college.name} yet.`}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {complete ? (
                <>
                  We&apos;ve read all {college.departmentCount} of their departments (
                  {college.courseCount.toLocaleString()} courses) and none match “{result.query}”. It may
                  be listed under a different name.
                </>
              ) : (
                <>
                  We&apos;ve only read {college.departmentsSourced} of their {college.departmentCount}{' '}
                  departments so far ({college.courseCount.toLocaleString()} courses), so it may well be
                  taught there — {signedIn ? 'open' : 'sign in and open'} the department it belongs to
                  and we&apos;ll read it.
                </>
              )}
            </p>
          </div>
        </div>
        {browseLink}
      </CardContent>
    </Card>
  );
}

function TestAvailability({ match }: { match: CourseMatch }) {
  const signedIn = useContext(SignedInContext);
  const action = signedIn ? 'open the course' : 'sign in';
  if (match.completeTestSets > 0) {
    const them = match.completeTestSets === 1 ? 'it' : 'them';
    return (
      <p className="flex items-center gap-2 text-sm">
        <ListChecks className="size-4 text-emerald-600 dark:text-emerald-500" />
        {match.completeTestSets} practice test{match.completeTestSets === 1 ? '' : 's'} ready — {action} to
        take {them}.
      </p>
    );
  }
  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <ListChecks className="size-4" />
      {match.hasSections
        ? `No practice tests yet — ${action} to generate the first one.`
        : signedIn
          ? 'No practice tests yet. Opening the course prepares it for testing.'
          : 'No practice tests yet — sign in and open the course to prepare it for testing.'}
    </p>
  );
}

function Suggestions({
  label,
  matches,
  onPick,
}: {
  label?: string;
  matches: CourseMatch[];
  onPick: (match: CourseMatch) => void;
}) {
  return (
    <div>
      {label ? (
        <p className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">{label}</p>
      ) : null}
      <ul className="divide-y rounded-lg border">
        {matches.map((m) => (
          <li key={m.courseId}>
            <button
              type="button"
              onClick={() => onPick(m)}
              className="hover:bg-muted/60 flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
            >
              <span className="text-muted-foreground w-24 shrink-0 truncate font-mono text-xs">
                {m.courseNumber}
              </span>
              <span className="min-w-0 flex-1 truncate">{m.title}</span>
              <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline">
                {m.departmentCode}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------ all universities */

function AllResults({
  result,
  onNarrow,
}: {
  result: AllCoursesSearchResponse;
  onNarrow: (collegeId: string) => void;
}) {
  const { results, query, method } = result;
  const signedIn = useContext(SignedInContext);
  const universities = new Set(results.map((m) => m.collegeId)).size;

  return (
    <Card>
      <CardContent className="py-5">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="text-muted-foreground size-4" />
          <p className="text-sm font-semibold">
            {results.length
              ? `Courses matching “${query}” at ${universities} ${universities === 1 ? 'university' : 'universities'}`
              : `No courses match “${query}” yet`}
          </p>
          {results.length ? (
            <Badge variant="secondary" className="tabular-nums">
              {results.length}
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground -mt-2 mb-3 text-xs">
          {results.length
            ? method === 'meaning'
              ? 'Titles containing your words first, then courses covering the same material. Pick a university below to check one school.'
              : 'Courses whose titles share your words. Pick a university below to check one school.'
            : 'We only hold catalogs we’ve already read. Try other words, or pick a university to see how much of its catalog we have.'}
        </p>

        {results.length ? (
          <ul className="divide-y rounded-lg border">
            {results.map((m) => (
              <li key={m.courseId} className="flex items-center">
                <ElsewhereRow href={signedIn ? `/course/${m.courseId}` : null}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <span className="text-muted-foreground mr-2 font-mono text-xs">
                        {m.courseNumber}
                      </span>
                      {m.title}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {m.collegeName} · {m.departmentName}
                    </span>
                  </span>
                  <TestsBadge count={m.completeTestSets} />
                </ElsewhereRow>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground mr-1 shrink-0 text-xs"
                  title={`Check this course at ${m.collegeName}`}
                  onClick={() => onNarrow(m.collegeId)}
                >
                  Narrow
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TestsBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge
      variant="outline"
      className="shrink-0 gap-1 border-emerald-500/40 text-[11px] text-emerald-700 dark:text-emerald-400"
    >
      <ListChecks className="size-3" />
      {count} test{count === 1 ? '' : 's'}
    </Badge>
  );
}

/* --------------------------------------------------------------- elsewhere */

function Elsewhere({ result }: { result: CourseSearchResponse }) {
  const { elsewhere, query, match, elsewhereBasis, elsewhereMethod } = result;
  const signedIn = useContext(SignedInContext);
  const subject =
    elsewhereBasis === 'course' && match ? `${match.courseNumber} ${match.title}` : `“${query}”`;

  return (
    <Card>
      <CardContent className="py-5">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="text-muted-foreground size-4" />
          <p className="text-sm font-semibold">
            {elsewhere.length
              ? `Similar courses at other universities`
              : `Nothing similar at other universities yet`}
          </p>
          {elsewhere.length ? (
            <Badge variant="secondary" className="tabular-nums">
              {elsewhere.length}
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground -mt-2 mb-3 text-xs">
          {elsewhereMethod === 'meaning'
            ? `Courses covering the same material as ${subject}, judged by title and description.`
            : `Courses whose titles share the words in ${subject}.`}
        </p>

        {elsewhere.length ? (
          <ul className="divide-y rounded-lg border">
            {elsewhere.map((m) => (
              <li key={m.courseId}>
                <ElsewhereRow href={signedIn ? `/course/${m.courseId}` : null}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <span className="text-muted-foreground mr-2 font-mono text-xs">{m.courseNumber}</span>
                      {m.title}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {m.collegeShortName ?? m.collegeName}
                      {m.collegeRank ? ` · #${m.collegeRank}` : ''} · {m.departmentName}
                    </span>
                  </span>
                  <TestsBadge count={m.completeTestSets} />
                </ElsewhereRow>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            None of the other universities we&apos;ve read list a course like {subject}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** A result row: a link for signed-in users, plain text otherwise. */
function ElsewhereRow({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) {
    return <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-sm">{children}</div>;
  }
  return (
    <Link
      href={href}
      className="hover:bg-muted/60 flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-sm"
    >
      {children}
      <ArrowRight className="text-muted-foreground size-3.5 shrink-0" />
    </Link>
  );
}
