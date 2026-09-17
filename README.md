# Aceversity

Browse the live course catalog of top-ranked worldwide universities, drill down to a
single course, and generate 100 original practice questions for every section of
it.

Aceversity reads each school's **own** catalog — not a third-party dataset — by
fingerprinting the catalog platform and running a purpose-built adapter against
it. Everything it scrapes is cached and shared, so the second visitor to a
college pays nothing.

**Data already in the database is always used as-is on the student path**,
however old it is. Browsing to a course and taking a test never re-scrapes a
catalog that has already been read; scraping happens only for a college,
department or course that has never been sourced.

"Sourced" is tracked explicitly. `departments.courses_scraped_at` is set whenever
a department's course list is read successfully — **including when it comes back
empty**. Some catalogs still list retired departments whose courses are all
inactive (FSU's `BUBAD`, for one); before this, such a department looked
permanently unsourced and was scraped again on every visit. Now a student sees
"No current courses listed", and nothing is fetched until someone deliberately
checks again. Refreshing is always an
explicit action — **Re-scrape** on the college and department pages, or
**Retrieve** / **Bulk check & retrieve** in the admin console.

---

## What's in the box

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, RSC, Server Actions) |
| Language | TypeScript, `strict` |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Database | Supabase (Postgres + RLS + magic-link Auth) |
| Validation | Zod at every API and AI boundary |
| AI | Vercel AI SDK v5 through the **Vercel AI Gateway** |
| Scraping | Self-hosted Dockerised Playwright service + per-platform adapters |
| Charts | Recharts |
| Deploy target | Vercel (app) + Fly.io/Railway (scraper) |

---

## Quick start

```bash
pnpm install
cp .env.example .env.local        # fill in the values below

# 1. database
pnpm db:push                      # applies supabase/migrations/*.sql
pnpm db:seed                      # inserts the 200 colleges

# 2. scraper service (separate terminal)
cd scraper-service
docker build -t aceversity-scraper .
docker run --rm -p 8080:8080 -e SCRAPER_SERVICE_SECRET=dev-secret aceversity-scraper

# 3. app
pnpm dev                          # http://localhost:3000
```

### Environment

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=postgresql://…    # only used by pnpm db:push / db:seed / db:types

AI_GATEWAY_API_KEY=               # required for summaries, sections and tests
SCRAPER_SERVICE_URL=http://localhost:8080
SCRAPER_SERVICE_SECRET=dev-secret

BRAVE_SEARCH_API_KEY=             # optional: catalog search fallback
RESEND_API_KEY=                   # optional
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Two of these gate real features.** Without `SCRAPER_SERVICE_URL`, catalog
browsing can only serve what's already cached. Without `AI_GATEWAY_API_KEY`,
course summaries, textbook inference, section derivation and test generation are
all disabled — the UI says so explicitly rather than failing silently.

### Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` / `pnpm start` | Production build and serve |
| `pnpm test` | Unit tests (question mix, de-duping, validation, catalog parsing) |
| `pnpm typecheck` / `pnpm lint` | `tsc --noEmit` / ESLint |
| `pnpm db:push` / `pnpm db:seed` / `pnpm db:types` | Migrations, seed, regenerate DB types |
| `pnpm probe <domain> [name] [DEPT]` | Run the real pipeline against one college and print what it found |
| `pnpm sweep [limit] [offset]` | Run catalog discovery across seeded colleges and tally which adapter each lands on |
| `pnpm generate-probe <COURSE_NUMBER> [SECTION]` | Generate a real test set and print the resulting type/difficulty mix and validation stats |

---

## How it works

### 1. Catalog discovery

Given only `mit.edu`, find the course catalog:

1. **URL heuristics** — probe `catalog.`, `bulletin.`, `catalogue.`, `guide.`,
   `courses.`, `classes.`, `/catalog`, `/courses`, `registrar.…/catalog` and
   friends over plain HTTP.
2. **Sitemap + homepage nav mining** if nothing scored well.
3. **Score** each candidate: catalog subdomain, page title, platform
   fingerprints, and how many subject-looking links it carries. Pages on the
   university's `www` host are heavily penalised unless they carry a fingerprint
   or sit under `/catalog` — a school's `/academics` landing page, a news post
   or a president's letter would otherwise beat the real catalog.
4. **Confirm** the winner with the fast model ("is this a course catalog
   index?"), then **fingerprint the platform** and cache both on the college row.
5. **Brave Search** as a last resort, if a key is set.

If nothing clears the bar, discovery returns nothing and the UI shows a
**paste-the-catalog-URL** escape hatch rather than a confidently wrong answer.

### 2. Adapters

The registry tries adapters in priority order; the first `detect()` that returns
true wins and is cached on the college.

| Adapter | Fingerprint | Strategy |
|---|---|---|
| **CourseLeaf** | `courseleaf.js`, `/ribbit/`, `.courseblock` | Fully static. Subject A–Z index → `.courseblock` nodes. Uses CourseLeaf's tagged `.courseblockprereq` / `terms` / `hours` / `instructors` spans rather than mining prose. |
| **Acalog** | `acalog`, `content.php?catoid=`, `preview_course_nopop.php` | Static, paginated via `filter[cpage]` until no new courses (cap 40). Departments from the index filter dropdown. |
| **Coursedog** | `coursedog` in markup/bundles | SPA over a JSON API. `/intercept` once to learn the tenant slug + catalog id, then page the API directly (200/page, server-side department filter). |
| **Ellucian Banner** | `/StudentRegistrationSsb/ssb/` (SSB9), `bwckctlg` (SSB8) | SSB9: one `/render` to mint the session cookie, then pure JSON — terms → subjects → paginated course search. SSB8: form-POST and parse the table. |
| **Kuali** | `kuali` in bundles, `/api/…` XHR | `/intercept` the SPA's own JSON, then paginate those endpoints directly. |
| **Generic** | always matches | `/render` → markdown → `generateObject` extraction against the same Zod schemas, plus free heuristic parsers that often work without AI at all. Bounded `/crawl` when a course list spans unlinked pages. Colleges landing here are logged. |

Every adapter returns identically-shaped, Zod-validated data, so nothing
downstream knows or cares which platform a school uses.

> **A note on Coursedog.** The original spec named five adapters. A discovery
> sweep over the top 40 showed a meaningful share of schools (Stanford, Berkeley,
> Emory, UCSB, …) running Coursedog and falling through to the slow, AI-dependent
> generic path. It has a clean public JSON API, so it earned a first-class
> adapter — added in `supabase/migrations/0002_coursedog_platform.sql`.

Current sweep over the top 40 colleges: **18 CourseLeaf, 4 Coursedog, 1 Kuali,
14 generic, 3 not found** (which show the manual-URL prompt).

### 3. Course profile

Opening a course fills in, each stage independent so one failure never blanks
the page:

1. **Catalog detail** via the adapter.
2. **AI summary** — two paragraphs from the raw scrape, generated once and
   cached on the row.
3. **Textbooks** — syllabus → catalog entry → campus bookstore
   (`{slug}.bncollege.com`, `bkstr.com/{slug}store`) → AI inference. The source
   is shown as a badge on every row; inferred books are visibly marked.
4. **Sections** — textbook table of contents (Google Books) → syllabus weekly
   schedule → AI-derived 10–15 section outline. This is what tests are built on,
   so it tries hard before falling back.

### 4. Test generation

`createTestSet(courseSectionId)` inserts the row; `/api/test-sets/generate`
streams the run. (A hundred questions takes minutes — far longer than a server
action should hold a request open, so the action creates and the route
generates.)

- **100 questions in 4 batches of 25**, run sequentially.
- The global mix is exact: **70 MCQ / 15 true-false / 15 short answer** and
  **30 easy / 45 medium / 25 hard**. The mix is expanded into 100 typed slots,
  dealt round-robin, then cut into batches — so totals are exact *and* no batch
  is all-hard or all-MCQ. Enforced by tests.
- **Every question is Zod-validated** after generation: MCQs must have exactly
  four distinct options with the answer among them verbatim; true/false answers
  must be `True`/`False`. Invalid questions are discarded, not patched.
- **De-duplication** — normalised-token Jaccard against every stem already in
  the set; anything over 0.8 similarity is rejected and regenerated.
- **No re-sourcing** — generation reads the course and section from the
  database; it never calls the scraper.
- **Progress** — `question_count` is written after each batch, so the UI advances
  via Supabase Realtime (with polling as a fallback).
- **Resumable** — a batch that fails after two retries marks the set `failed`
  but keeps its questions; "Resume" fills only the remainder.
- **Top-up pass** — if the batches come up a question or two short (the model
  repeats itself near the end), a final pass asks for exactly the set-wide
  deficit, by type and difficulty, before anything is called failed.
- **Guardrails** — 10 test sets per user per day, enforced server-side; existing
  complete sets offer "View existing" alongside "Generate fresh".

Verified against MIT 6.1010 through the live Gateway: **100 questions in ~5.5
minutes, mix exactly 70/15/15 and 30/45/25, zero malformed MCQs, zero duplicate
stems, all five section topics covered.**

### 5. Shared test library

Generated tests belong to the whole app, not to the person who generated them.
Any signed-in user can take, review and export any completed test set; only its
creator can resume a failed run or delete it. "Generate fresh" adds a new set
alongside the old ones — nothing is ever replaced.

Rebuilding a course profile used to destroy this: `course_sections` was deleted
and re-inserted, which cascaded through `test_sets` into `questions`. Sections
are now upserted by `(course_id, position)`, and a section is only removed when
no test set references it.

### 6. The dashboard

The home page doubles as a signed-in dashboard, above the college picker.

**Your test history** lists every test the user has finished, grouped by test
set: latest and best score, how many attempts, the score sequence
(`41% → 58% → 73% → 84%`) and the points gained since the first go. Each row
offers **Retake** (a fresh attempt on the same test), **Review answers**, and
**Take a new one** (the course's test dashboard). Above the list sit four
summary tiles and a progress chart of every score over time, with a running
average line and an overall trend — the trend only appears once there are at
least four attempts, so it isn't claimed on noise.

**Your favourites** holds starred universities and check-marked courses. Both
toggles are optimistic and roll back if the write fails; signed-out visitors are
sent to sign-in rather than shown a dead control.

History is read through the user's own Supabase client, so RLS scopes attempts
to them — the query joins out into the shared test library and the public
catalog cache, but it can only ever return their own results.

### 7. Admin console (`/admin`)

Password sign-in at `/admin/login`, gated on `app_metadata.role === 'admin'` —
service-role-writable only, so a user cannot grant it to themselves. Middleware
bounces non-admins before the page renders, and every page re-checks server-side.

| Tab | Shows |
|---|---|
| **Overview** | Users, indexed/seeded universities, cached courses, total AI spend, test sets, questions, attempts. |
| **Users** | A searchable table (email, user id, favourite) sortable on every column — joined, last seen, favourites, tests made, taken, average/best score, AI calls and cost. Click a row for favourites and recent results. |
| **Universities** | All 200 with retrieval method, department coverage (`sourced/total`, amber when incomplete; hover for how many hold courses), courses, tests, attempts, total AI cost, and a **Latest activity** cell showing when each of the four tracked operations last ran here and what that run cost. Every column sorts (Depts by share sourced, Latest activity by most recent run). **Check method** and **Retrieve** open a live dialog (below). |
| **Courses** | Every cached course (total shown at the top) with its university, department, derived level, sections, whether tests exist (complete/total), how many people have taken them, and AI cost. 500 per page; search, the tested/untested filter, sort column and page live in the URL, and the database does the work (`admin_course_list`, migration 0014), so sorting on tests or cost covers all courses, not just the page. |

Create or repair the account with:

```bash
pnpm create-admin admin@example.com "<a strong password>"
```

### 8. Live retrieval console

**Check method** and **Retrieve** stream into a dialog rather than reporting only
a final result. Every step is shown as it happens — each scraper request with its
URL, HTTP status, duration and response size, each pipeline stage, each
department's course count — followed by a summary with elapsed time and AI cost.

The same events are mirrored to the browser console as a collapsed group, with
per-level colouring and a `console.table` of every request at the end, so a run
can be inspected after the fact without re-running it.

This works through `lib/scraping/trace.ts`: an `AsyncLocalStorage` sink that any
layer can report to without knowing who is listening. The scraper client reports
every call; the admin route wraps a run in `withTrace` and forwards each event
over SSE. Nothing else in the stack changed to support it.

### 9. Bulk check &amp; retrieve

**Bulk check & retrieve** on the Universities tab runs the whole fleet. Before
starting, you set:

- **National ranking range** — an inclusive from–to window (1–200). Universities
  are processed in ranking order; an inverted range is rejected by both the form
  and the API.
- **Re-retrieve if older than (days)** — a university is a candidate when it has
  no course data at all, or its newest course row predates the cutoff. `0`
  includes everything.
- **Max universities this run** — a hard cap within the range, because each one
  takes roughly 30–90 seconds. When the range holds more matches than the cap,
  the dialog says so; run again to continue from where it stopped.
- **Departments per university** — all departments that still need courses by
  default, or a fixed number per university.
- **Include partly retrieved universities** — also pick universities whose data
  is current but still has departments that were never sourced (typically from an
  earlier run limited to a few departments).

The dialog previews how many universities match before you commit. Candidates are
re-selected server-side rather than trusted from the browser.

**Retrieval only fetches what's missing.** The stored department list is reused
unless it is stale, and a department is fetched only if it was never sourced or
its last check is older than the cutoff. Running the same job twice costs nothing
the second time. The single-university **Retrieve** button works the same way.

Each university is **checked first, and retrieved only if the check succeeds**,
so a school whose catalog can't be located costs one discovery pass instead of a
failed crawl. Universities run one at a time so a failure stays isolated, and
**Stop** aborts the stream, which the server notices between universities.

The dialog shows per-university status and cost on the left and the full live
trace on the right; the same detail goes to the browser console. Every university
records its own `catalog_check` and `course_retrieval` run, so per-university cost
lands in the Latest activity column afterwards.

> On Vercel a single request is capped by `maxDuration`, so keep bulk batches
> modest there and run several. Locally there is no such limit.

### 10. Operation runs

Four operations record themselves in `operation_runs`: catalog checks, course
retrievals, course profiling, and user test generation. Each row carries the
timestamp, whether it succeeded, a short summary, and the AI cost rolled up from
`ai_usage` over the run's own window.

`ai_usage` alone couldn't answer "when did we last retrieve this university, and
what did it cost" — adapter-backed catalogs make no model calls at all, so a
successful retrieval often leaves no usage rows and would look like it never
happened. The `college_latest_operations` view pivots the newest run of each kind
into the row the admin table renders.

### 11. Cost tracking

Every model call writes a row to `ai_usage`: operation, model, tokens in/out, and
the dollar cost computed from the rate card in `lib/ai/pricing.ts`. Rates are
stamped onto each row, so historical cost stays correct when pricing changes.

Attribution rides on an `AsyncLocalStorage` context rather than being threaded
through every adapter signature — the pipeline wraps its work in
`withUsageContext({ collegeId, courseId })` and the recorder reads it — so a
scrape's cost lands on the right university without touching the scraping API.
The ledger is admin-only: RLS denies every client read and the aggregate views
are granted to `service_role` alone.

### 12. Quiz and scoring

One question per screen, progress bar, flag-for-review, and a jump grid.
**Grading happens server-side** against the stored answers — the client never
receives the key before submission. Short answers are graded on token overlap
with the model answer and always shown for self-review. The score screen charts
accuracy by topic (radar) and results by difficulty (stacked bars), with a
filterable per-question review. Export is JSON or a self-contained printable
HTML page whose answer key is hidden by the print stylesheet.

---

## Checking a course

Signed-out visitors get a two-step check on the home page instead of a plain
college picker: **choose a university, type a course name or number**, and the
answer appears as they type.

- **Yes — this course is in our system**, with its department, whether practice
  tests already exist.
- **No exact match** — the closest courses held there, any of which can be picked.
- **Not in our system (yet)** — worded by how much of the university we've read,
  so "we've read 6 of 46 departments" isn't mistaken for a definite no.
- **Catalog not read yet** — with a prompt to sign in and open the university.

For signed-out visitors the check links nowhere: university, department, course
and test pages all need sign-in, and "similar courses at other universities" are
listed as plain text.

Signed-in users get the same check as the **Check a course** tab on the home page,
next to **Browse universities** (the original picker). There every result links
through — *View course*, each similar course, and *Browse … departments* — and the
wording says "open the course" rather than "sign in". The last tab used is
remembered per browser. Both modes are `components/college/course-finder.tsx`
with a `signedIn` flag, wrapped by `components/college/home-search.tsx`.

### Similar courses at other universities

Found by **meaning**, not shared title words. Every course has an embedding
(`openai/text-embedding-3-small` via the AI Gateway) of its title, department
and description, stored in `course_embeddings` (pgvector, HNSW index) and
queried through the `similar_courses` SQL function.

- When the check finds the course, similar courses are the ones closest to
  **that course's** embedding — so searching "6.7900" finds machine-learning
  courses elsewhere, not other courses numbered 6.7900.
- Otherwise the **typed text** is embedded (cached in memory; ~$0.0000002 a
  lookup, recorded as `search_embedding`) and compared instead.
- Title-word matches fill any remaining slots, and are the whole answer when
  embeddings are unavailable. The response says which was used
  (`elsewhereMethod`), and the page words its explanation to match.
- Thresholds live in `app/api/search/courses/route.ts`
  (`MIN_SIMILARITY_TO_COURSE`, `MIN_SIMILARITY_TO_QUERY`).

Keeping it current: scraping a department embeds its courses, and re-reading a
course's catalog entry re-embeds it. A content hash skips unchanged courses, so
repeat scrapes cost nothing. Costs are recorded as `course_embedding` under the
course's university.

```bash
pnpm embed-courses --dry-run   # courses, tokens and cost if all were new
pnpm embed-courses             # embed everything new or changed (~30k courses ≈ $0.04)
```

Run it once after applying migration `0013`, and again after changing
`AI_EMBEDDING_MODEL` (the replacement must return 1536 dimensions).

Below the answer, **similar courses at other universities** are listed with their
practice-test counts.

It's a read of stored data only — nothing on this page triggers a scrape.
`search_courses` (migration `0012`) does the matching with pg_trgm, in about
20 ms over 30k courses:

- **Finding the course** ranks by how well the query matches, and treats a result
  as *the* course only when it names every distinctive word typed and clearly
  beats the next differently-titled course. Cross-listed copies share a title and
  count as one.
- **Similar courses** compare only the distinctive words — generic ones such as
  *Introduction to* or *Fundamentals of* are ignored, and every distinctive word
  the visitor typed must appear. Whole-title trigram scores couldn't separate
  "Introduction to Psychology" from "Introduction to Africology".
- A few unambiguous abbreviations are expanded first (`intro`, `adv`, `prin`, …).

## Repairing untitled courses

An older CourseLeaf parser missed the newer "detail" layout, where code, title and
credits sit in separate `detail-code` / `detail-title` / `detail-hours` spans
(Notre Dame, UNC, Georgetown, UT Austin), plus MIT's `1.63[J]` and Iowa's
`ACCT:3500 … s.h.` headings. About a third of stored courses ended up with their
code as their title, which makes them unsearchable by name.

The parser is fixed. Existing rows are repaired with:

```bash
pnpm repair-titles           # dry run: which departments, how many rows
pnpm repair-titles --apply   # refresh them and remove superseded rows
```

A superseded row is only removed if nothing (sections, tests) refers to it.

## Troubleshooting

**A site is behind bot protection.** Some catalogs (Gonzaga, for one) answer every
static request with an HTTP 202 challenge page a couple of kilobytes long. The
run reports that it reached the catalog but could not read a department list, and
offers the manual-URL escape hatch. Rendering those through `/render` instead of
`/fetch` would likely get past it — a worthwhile future adapter step.

**A page renders but nothing is clickable (dev only).** Next's dev server compiles
routes on demand. If a route's *first* compile happens on a request that returns
before rendering — a redirect or a 404 — it can cache a build with no client
chunk, leaving the page permanently inert for that dev session. You'll see a 404
for `/_next/static/chunks/app/<route>/page.js` in the browser console.

Auth gating lives in `middleware.ts` partly to avoid this: protected routes now
redirect before the page renders at all. If it still happens, restart the dev
server with a clean cache:

```bash
rm -rf .next && pnpm dev
```

`pnpm build` and `pnpm dev` no longer share an output directory: local
production builds go to `.next-build/` (see `next.config.ts`), so building while
the dev server runs is safe. If a `ChunkLoadError` still appears, check that only
one dev server is running for this project — two servers on the same `.next`
(the second one silently moves to port 3001) delete each other's chunks.

## Security and data model

- **Public-read shared cache**: `colleges`, `departments`, `courses`,
  `textbooks`, `course_sections`. Client writes are impossible; only server
  actions using the service role write to them.
- **Shared, owner-writable**: `test_sets` and `questions` are readable by any
  signed-in user (the shared test library) but only the creator can write them.
- **Strictly private**: `attempts`, `attempt_answers` and `favorites` are
  RLS-restricted to `user_id = auth.uid()`; answers and scores never leak.
- **Admin-only**: `ai_usage`, `operation_runs` and the `*_ai_cost` /
  `college_stats` / `college_latest_operations` views have no anon/authenticated
  grants at all and are read with the service role.
- **Everything except the home page's course check requires sign-in**
  (Supabase magic link). `middleware.ts` redirects signed-out visitors from
  `/college/*`, `/course/*` and `/test/*` to the login page, and answers the
  scrape-triggering `/api/colleges/*`, `/api/departments/*` and
  `/api/courses/*` with 401. `/api/search/courses` stays public.

## Scraping etiquette

- One in-flight request per host with a 1.5 s gap; global concurrency 3.
- Honest `AceversityBot/1.0` User-Agent, and `robots.txt` `Disallow` rules are
  honoured (longest-match wins, `Allow` beats `Disallow` at equal length).
- 30 s timeout per call and one retry with backoff; on final failure a debug
  screenshot is captured and the user sees a real error with a retry and the
  manual-URL escape hatch — never a blank screen.
- Only public catalog and bookstore pages are read, and only **extracted facts
  and topic outlines** are stored. Full copyrighted book content never is, and
  generated questions are written originally rather than reproduced.

---

## Deploying

**App → Vercel.** Import the repo, set every variable from `.env.example`, and
point `SCRAPER_SERVICE_URL` at the deployed scraper. Add your production origin
to Supabase → Authentication → URL Configuration so magic links come back to the
right place.

**Scraper → Fly.io / Railway / any VPS.** See
[`scraper-service/README.md`](scraper-service/README.md). It cannot run on
Vercel; Chromium does not fit in a serverless function.

**Database.** Apply `supabase/migrations/*.sql` in order, then `supabase/seed.sql`
(idempotent — re-running refreshes ranking metadata without disturbing cached
catalog discovery).

## Project layout

```
app/
  page.tsx                            college picker
  college/[id]/                       department browser
  college/[id]/dept/[deptId]/         course list
  course/[courseId]/                  course profile (the centrepiece)
  course/[courseId]/tests/            test dashboard
  test/[testSetId]/                   quiz + score report
  admin/                              console: overview · users · universities · courses
  actions/                            server actions (auth, test sets, attempts)
  api/                                SSE progress streams + export
lib/
  ai/          models · prompts · generate-questions · dedupe · summary · extract
  scraping/    client · queue · robots · discover-catalog · pipeline · textbooks · sections
  scraping/adapters/  types · registry · courseleaf · acalog · coursedog · banner · kuali · generic
  scraping/trace.ts   ambient run tracing · db/operation-runs.ts
  db/queries.ts · db/admin-queries.ts · validation/schemas.ts · supabase/
  auth/admin.ts · catalog-source.ts · grading.ts · sse.ts
components/    layout · college · course · test · ui (shadcn)
scraper-service/  standalone Dockerised Playwright service
supabase/      migrations · seed.sql
tests/         unit tests
```
