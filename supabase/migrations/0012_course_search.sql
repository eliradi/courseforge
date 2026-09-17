-- ============================================================================
-- Course search
--
-- Powers the public "is this course in your system?" check on the home page:
-- given free text (a course name or number), find matching courses at one
-- university, and similar courses at the others.
--
-- Matching uses pg_trgm so typos, partial names and word order still hit:
--   "machine learning"  -> "Introduction to Machine Learning"
--   "cs229" / "CS 229"  -> course number CS 229
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

create index if not exists courses_title_trgm_idx
  on public.courses using gin (title extensions.gin_trgm_ops);

-- Prefix/partial course-number matches ("CS 22" -> "CS 229"). Without this the
-- OR in search_courses can't use indexes for every branch and falls back to a
-- sequential scan: ~1s over 30k courses, versus ~9ms with it.
create index if not exists courses_number_trgm_idx
  on public.courses using gin (course_number extensions.gin_trgm_ops);

-- Course numbers compared with spacing and punctuation stripped ("CS-229" = "cs229").
create index if not exists courses_number_norm_idx
  on public.courses (lower(regexp_replace(course_number, '[^a-zA-Z0-9]', '', 'g')));

-- ---------------------------------------------------------------------------
-- Distinctive words
--
-- Character trigrams on whole titles are dominated by generic words: "Introduction
-- to Psychology" scored 0.59 against "Introduction to Africology", while
-- "Linear Algebra for Data Science" scored 0.47 against "linear algebra". No
-- single cut-off separated good from bad. Comparing only the distinctive words —
-- and requiring every one the visitor typed to be present — does.
-- ---------------------------------------------------------------------------
create or replace function public.course_content_words(input text)
returns text[]
language sql
immutable
parallel safe
as $$
  select coalesce(array_agg(distinct w), '{}')
  from regexp_split_to_table(lower(coalesce(input, '')), '[^a-z0-9]+') as w
  where length(w) > 1
    and w !~ '^[0-9]+$'
    and w <> all (array[
      'introduction','intro','to','of','the','and','in','for','an','on','with','at','by',
      'fundamentals','fundamental','principles','principle','foundations','foundation',
      'advanced','adv','topics','topic','special','selected','seminar','survey','basic','basics',
      'elementary','intermediate','general','studies','study','course','ii','iii','iv',
      'lab','laboratory','honors','hon','part','applied','practicum','independent'
    ])
$$;

-- Share of the query's distinctive words found in the title (plurals and
-- inflections count: "structure" ~ "structures"). NULL when the query has none.
create or replace function public.content_coverage(query_words text[], title_words text[])
returns real
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select case
    when cardinality(query_words) = 0 then null
    else (
      select count(*)::real
      from unnest(query_words) as q
      where exists (
        select 1 from unnest(title_words) as t
        where t = q or (length(q) >= 5 and length(t) >= 5 and similarity(q, t) >= 0.6)
      )
    ) / cardinality(query_words)
  end
$$;

-- Return type changed during development (exactness added); replace cleanly.
drop function if exists public.search_courses(text, uuid, uuid, int, int);
drop function if exists public.search_courses(text, uuid, uuid, int, int, text);

create or replace function public.search_courses(
  q                    text,
  p_college_id         uuid default null,
  p_exclude_college_id uuid default null,
  p_limit              int  default 10,
  p_per_college        int  default null,
  -- 'score' ranks by how well the query matches (good for "find this course");
  -- 'exactness' ranks by overall likeness (good for "similar courses elsewhere",
  -- where sharing one word like "Fundamentals" shouldn't be enough).
  p_rank_by            text default 'score'
)
returns table (
  course_id          uuid,
  course_number      text,
  title              text,
  department_id      uuid,
  department_code    text,
  department_name    text,
  college_id         uuid,
  college_name       text,
  college_short_name text,
  college_rank       int,
  -- Ranking: how well the query matches, including "query is contained in title".
  score              real,
  -- Identity: how close this is to being the course the query names. Symmetric,
  -- so "machine learning" is not an exact match for "… via Machine Learning".
  exactness          real,
  -- Share of the query's distinctive words present in the title (NULL if none typed).
  coverage           real,
  has_sections       boolean,
  complete_test_sets int
)
language sql
stable
-- Definer rights only so anonymous visitors can see how many practice tests a
-- course has; everything else returned is already public-read catalog data.
security definer
-- No `set pg_trgm.*` here: Supabase refuses those in a function's SET clause for
-- non-superusers. The filter below uses the operators at their defaults and adds
-- an index-backed ILIKE for plain substring hits instead.
set search_path = public, extensions
as $$
  with params as (
    select
      btrim(q) as term,
      lower(regexp_replace(btrim(q), '[^a-zA-Z0-9]', '', 'g')) as term_number,
      -- Escape LIKE wildcards so a stray % in the input stays literal.
      replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') as term_like,
      least(greatest(coalesce(p_limit, 10), 1), 25) as lim,
      public.course_content_words(btrim(q)) as qwords
  ),
  matches as (
    select
      c.id, c.course_number, c.title,
      d.id as department_id, d.code as department_code, d.name as department_name,
      d.college_id,
      greatest(
        word_similarity(p.term, c.title),
        similarity(p.term, c.title),
        case when lower(regexp_replace(c.course_number, '[^a-zA-Z0-9]', '', 'g')) = p.term_number
             then 1.0 else 0 end,
        case when c.title ilike '%' || p.term_like || '%' then 0.9 else 0 end
      )::real as score,
      greatest(
        similarity(p.term, c.title),
        case when lower(regexp_replace(c.course_number, '[^a-zA-Z0-9]', '', 'g')) = p.term_number
             then 1.0 else 0 end,
        case when lower(regexp_replace(c.title, '[^a-zA-Z0-9]', '', 'g')) = p.term_number
             then 1.0 else 0 end
      )::real as exactness,
      public.content_coverage(p.qwords, public.course_content_words(c.title)) as coverage,
      -- Likeness of the distinctive parts only, for ordering "similar" results.
      case when cardinality(p.qwords) > 0
           then similarity(array_to_string(p.qwords, ' '),
                           array_to_string(public.course_content_words(c.title), ' '))
           else similarity(p.term, c.title)
      end::real as likeness
    from public.courses c
    join public.departments d on d.id = c.department_id
    cross join params p
    where length(p.term) >= 2
      and (p_college_id is null or d.college_id = p_college_id)
      and (p_exclude_college_id is null or d.college_id <> p_exclude_college_id)
      and (
        c.title % p.term                                   -- similar overall (≥ 0.3)
        or p.term <% c.title                               -- query's words in the title (≥ 0.6)
        or c.title ilike '%' || p.term_like || '%'         -- plain substring
        or lower(regexp_replace(c.course_number, '[^a-zA-Z0-9]', '', 'g')) = p.term_number
        or c.course_number ilike p.term_like || '%'
      )
  ),
  scored as (
    -- The operators above are deliberately permissive; drop weak hits here.
    select * from matches
    where case when p_rank_by = 'exactness'
               -- "Similar" means every distinctive word the visitor typed is there.
               then coalesce(coverage, case when exactness >= 0.5 then 1 else 0 end) >= 1
               else score >= 0.35 or exactness >= 0.35
          end
  ),
  ranked as (
    select m.*,
           row_number() over (
             partition by m.college_id
             order by case when p_rank_by = 'exactness' then m.likeness else m.score end desc,
                      m.exactness desc, m.score desc, m.course_number
           ) as per_college
    from scored m
  )
  select
    r.id, r.course_number, r.title,
    r.department_id, r.department_code, r.department_name,
    col.id, col.name, col.short_name, col.rank,
    r.score,
    r.exactness,
    r.coverage,
    exists (select 1 from public.course_sections s where s.course_id = r.id) as has_sections,
    (
      select count(*)::int
      from public.test_sets t
      join public.course_sections s on s.id = t.course_section_id
      where s.course_id = r.id and t.status = 'complete'
    ) as complete_test_sets
  from ranked r
  join public.colleges col on col.id = r.college_id
  cross join params p
  where p_per_college is null or r.per_college <= p_per_college
  order by case when p_rank_by = 'exactness' then r.likeness else r.score end desc,
           r.exactness desc, r.score desc, col.rank nulls last, r.course_number
  limit (select lim from params);
$$;

revoke all on function public.search_courses(text, uuid, uuid, int, int, text) from public;
grant execute on function public.search_courses(text, uuid, uuid, int, int, text) to anon, authenticated, service_role;
grant execute on function public.course_content_words(text) to anon, authenticated, service_role;
grant execute on function public.content_coverage(text[], text[]) to anon, authenticated, service_role;
