-- ============================================================================
-- Course embeddings — "similar courses" by meaning, not by shared title words
--
-- Each course gets one embedding of its title, department and description.
-- The home page's "similar courses at other universities" compares those, so
-- "Machine Learning" finds "Statistical Learning" and a search by course number
-- finds courses like the one that number names.
--
-- Rows are written by lib/ai/embeddings.ts (service role) whenever courses are
-- scraped or their description changes, and backfilled by `pnpm embed-courses`.
-- ============================================================================

create extension if not exists vector with schema extensions;

create table if not exists public.course_embeddings (
  course_id    uuid primary key references public.courses(id) on delete cascade,
  -- Denormalised from the course's department so "other universities" can be
  -- filtered without a join inside the nearest-neighbour scan.
  college_id   uuid not null references public.colleges(id) on delete cascade,
  embedding    extensions.vector(1536) not null,
  model        text not null,
  -- Hash of the embedded text + model: unchanged courses are never re-embedded.
  content_hash text not null,
  embedded_at  timestamptz not null default now()
);

create index if not exists course_embeddings_hnsw_idx
  on public.course_embeddings using hnsw (embedding extensions.vector_cosine_ops);

create index if not exists course_embeddings_college_idx
  on public.course_embeddings (college_id);

-- Service role only: no policies, so RLS denies every client read and write.
-- Visitors reach the data through similar_courses below.
alter table public.course_embeddings enable row level security;

-- ---------------------------------------------------------------------------
-- similar_courses
--
-- Nearest courses to either a stored course (p_course_id) or a query embedding
-- (p_embedding, as the '[0.1,0.2,…]' text form), at universities other than
-- p_exclude_college_id. Same row shape as search_courses, plus `similarity`
-- (cosine, 0–1), so the API can treat both sources alike.
-- ---------------------------------------------------------------------------
drop function if exists public.similar_courses(text, uuid, uuid, int, int, real);

create or replace function public.similar_courses(
  p_embedding          text default null,
  p_course_id          uuid default null,
  p_exclude_college_id uuid default null,
  p_limit              int  default 10,
  p_per_college        int  default 2,
  p_min_similarity     real default 0.5
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
  similarity         real,
  has_sections       boolean,
  complete_test_sets int
)
language plpgsql
stable
-- Definer rights because course_embeddings has no client policies; everything
-- returned is otherwise public catalog data (see search_courses).
security definer
set search_path = public, extensions
as $$
declare
  target extensions.vector(1536);
  lim    int := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  if p_course_id is not null then
    select e.embedding into target from public.course_embeddings e where e.course_id = p_course_id;
  elsif p_embedding is not null then
    target := p_embedding::extensions.vector(1536);
  end if;
  if target is null then
    return;
  end if;

  -- The HNSW index returns ef_search candidates before filtering; widen it and
  -- let pgvector keep scanning when the exclusion filter discards rows.
  perform set_config('hnsw.ef_search', '200', true);
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);

  return query
  with nearest as (
    select e.course_id, e.college_id, (1 - (e.embedding <=> target))::real as similarity
    from public.course_embeddings e
    where (p_exclude_college_id is null or e.college_id <> p_exclude_college_id)
      and (p_course_id is null or e.course_id <> p_course_id)
    order by e.embedding <=> target
    limit 200
  ),
  ranked as (
    select n.*,
           row_number() over (partition by n.college_id order by n.similarity desc) as per_college
    from nearest n
    where n.similarity >= coalesce(p_min_similarity, 0)
  )
  select
    c.id, c.course_number, c.title,
    d.id, d.code, d.name,
    col.id, col.name, col.short_name, col.rank,
    r.similarity,
    exists (select 1 from public.course_sections s where s.course_id = c.id),
    (
      select count(*)::int
      from public.test_sets t
      join public.course_sections s on s.id = t.course_section_id
      where s.course_id = c.id and t.status = 'complete'
    )
  from ranked r
  join public.courses c on c.id = r.course_id
  join public.departments d on d.id = c.department_id
  join public.colleges col on col.id = r.college_id
  where p_per_college is null or r.per_college <= p_per_college
  order by r.similarity desc, col.rank nulls last, c.course_number
  limit lim;
end
$$;

revoke all on function public.similar_courses(text, uuid, uuid, int, int, real) from public;
grant execute on function public.similar_courses(text, uuid, uuid, int, int, real)
  to anon, authenticated, service_role;
