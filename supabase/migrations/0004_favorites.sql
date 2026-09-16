-- ============================================================================
-- Favourites
--
-- One table for both kinds of favourite. Exactly one of college_id/course_id is
-- set per row, enforced by a check constraint, which keeps the "what has this
-- user starred" query a single scan instead of a union of two tables.
-- ============================================================================

create table if not exists public.favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  college_id uuid references public.colleges(id) on delete cascade,
  course_id  uuid references public.courses(id)  on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_exactly_one_target check (num_nonnulls(college_id, course_id) = 1)
);

-- NULLs compare as distinct in Postgres, so a user can hold many course
-- favourites (each with a NULL college_id) and still only star a college once.
create unique index if not exists favorites_user_college_key on public.favorites (user_id, college_id)
  where college_id is not null;
create unique index if not exists favorites_user_course_key on public.favorites (user_id, course_id)
  where course_id is not null;

create index if not exists favorites_user_idx on public.favorites (user_id, created_at desc);

alter table public.favorites enable row level security;

drop policy if exists favorites_owner_all on public.favorites;
create policy favorites_owner_all on public.favorites
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
