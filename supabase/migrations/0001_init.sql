-- ============================================================================
-- Aceversity — initial schema
-- ============================================================================
-- Shared scrape cache (colleges/departments/courses/textbooks/course_sections)
-- is public-read; all writes go through server actions using the service role.
-- User-owned data (test_sets/questions/attempts/attempt_answers) is RLS-scoped
-- to auth.uid().
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- colleges --
create table if not exists public.colleges (
  id                    uuid primary key default gen_random_uuid(),
  rank                  int,
  name                  text not null,
  short_name            text,
  city                  text,
  state                 text,
  website_domain        text not null,
  catalog_url           text,
  catalog_platform      text check (catalog_platform in ('courseleaf','acalog','banner','kuali','generic')),
  catalog_discovered_at timestamptz,
  catalog_error         text,
  logo_url              text,
  created_at            timestamptz not null default now()
);

create unique index if not exists colleges_website_domain_key on public.colleges (website_domain);
create index if not exists colleges_rank_idx on public.colleges (rank);
create index if not exists colleges_name_idx on public.colleges (name);

-- ------------------------------------------------------------- departments --
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  college_id  uuid not null references public.colleges(id) on delete cascade,
  code        text not null,
  name        text not null,
  catalog_url text,
  scraped_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (college_id, code)
);

create index if not exists departments_college_idx on public.departments (college_id);

-- ----------------------------------------------------------------- courses --
create table if not exists public.courses (
  id                  uuid primary key default gen_random_uuid(),
  department_id       uuid not null references public.departments(id) on delete cascade,
  course_number       text not null,
  title               text not null,
  description         text,
  credits             text,
  prerequisites       text,
  instructors         text[],
  terms_offered       text,
  syllabus_url        text,
  source_url          text,
  raw_scraped_content text,
  ai_summary          text,
  detail_scraped_at   timestamptz,
  scraped_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (department_id, course_number)
);

create index if not exists courses_department_idx on public.courses (department_id);
create index if not exists courses_number_idx on public.courses (course_number);

-- --------------------------------------------------------------- textbooks --
create table if not exists public.textbooks (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  title      text not null,
  authors    text,
  edition    text,
  isbn       text,
  required   boolean not null default true,
  source     text not null default 'ai_inferred'
               check (source in ('catalog','bookstore','syllabus','ai_inferred')),
  created_at timestamptz not null default now()
);

create index if not exists textbooks_course_idx on public.textbooks (course_id);

-- --------------------------------------------------------- course_sections --
create table if not exists public.course_sections (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  position   int not null default 0,
  title      text not null,
  topics     text[] not null default '{}',
  source     text not null default 'ai_derived'
               check (source in ('textbook_toc','syllabus','ai_derived')),
  created_at timestamptz not null default now(),
  unique (course_id, position)
);

create index if not exists course_sections_course_idx on public.course_sections (course_id, position);

-- --------------------------------------------------------------- test_sets --
create table if not exists public.test_sets (
  id               uuid primary key default gen_random_uuid(),
  course_section_id uuid not null references public.course_sections(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  status           text not null default 'pending'
                     check (status in ('pending','generating','complete','failed')),
  question_count   int not null default 0,
  target_count     int not null default 100,
  model_used       text,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists test_sets_section_idx on public.test_sets (course_section_id);
create index if not exists test_sets_user_idx on public.test_sets (user_id, created_at desc);

-- --------------------------------------------------------------- questions --
create table if not exists public.questions (
  id             uuid primary key default gen_random_uuid(),
  test_set_id    uuid not null references public.test_sets(id) on delete cascade,
  position       int not null,
  type           text not null check (type in ('mcq','true_false','short_answer')),
  difficulty     text not null check (difficulty in ('easy','medium','hard')),
  question       text not null,
  options        jsonb,
  correct_answer text not null,
  explanation    text,
  topic          text,
  created_at     timestamptz not null default now(),
  unique (test_set_id, position)
);

create index if not exists questions_test_set_idx on public.questions (test_set_id, position);

-- ---------------------------------------------------------------- attempts --
create table if not exists public.attempts (
  id              uuid primary key default gen_random_uuid(),
  test_set_id     uuid not null references public.test_sets(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  score           int,
  total_questions int not null default 0
);

create index if not exists attempts_test_set_idx on public.attempts (test_set_id);
create index if not exists attempts_user_idx on public.attempts (user_id, started_at desc);

-- --------------------------------------------------------- attempt_answers --
create table if not exists public.attempt_answers (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer      text,
  is_correct  boolean,
  flagged     boolean not null default false,
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create index if not exists attempt_answers_attempt_idx on public.attempt_answers (attempt_id);

-- ------------------------------------------------------- updated_at helper --
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists test_sets_touch_updated_at on public.test_sets;
create trigger test_sets_touch_updated_at
  before update on public.test_sets
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.colleges        enable row level security;
alter table public.departments     enable row level security;
alter table public.courses         enable row level security;
alter table public.textbooks       enable row level security;
alter table public.course_sections enable row level security;
alter table public.test_sets       enable row level security;
alter table public.questions       enable row level security;
alter table public.attempts        enable row level security;
alter table public.attempt_answers enable row level security;

-- Shared cache: public read, no client writes (service role bypasses RLS).
do $$
declare t text;
begin
  foreach t in array array['colleges','departments','courses','textbooks','course_sections'] loop
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_public_read', t
    );
  end loop;
end $$;

-- test_sets: owner-scoped.
drop policy if exists test_sets_owner_select on public.test_sets;
create policy test_sets_owner_select on public.test_sets
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists test_sets_owner_insert on public.test_sets;
create policy test_sets_owner_insert on public.test_sets
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists test_sets_owner_update on public.test_sets;
create policy test_sets_owner_update on public.test_sets
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists test_sets_owner_delete on public.test_sets;
create policy test_sets_owner_delete on public.test_sets
  for delete to authenticated using (user_id = (select auth.uid()));

-- questions: readable/writable only through an owned test_set.
drop policy if exists questions_owner_select on public.questions;
create policy questions_owner_select on public.questions
  for select to authenticated using (
    exists (
      select 1 from public.test_sets ts
      where ts.id = questions.test_set_id and ts.user_id = (select auth.uid())
    )
  );

drop policy if exists questions_owner_write on public.questions;
create policy questions_owner_write on public.questions
  for all to authenticated
  using (
    exists (
      select 1 from public.test_sets ts
      where ts.id = questions.test_set_id and ts.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.test_sets ts
      where ts.id = questions.test_set_id and ts.user_id = (select auth.uid())
    )
  );

-- attempts: owner-scoped.
drop policy if exists attempts_owner_all on public.attempts;
create policy attempts_owner_all on public.attempts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- attempt_answers: via owned attempt.
drop policy if exists attempt_answers_owner_all on public.attempt_answers;
create policy attempt_answers_owner_all on public.attempt_answers
  for all to authenticated
  using (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_answers.attempt_id and a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_answers.attempt_id and a.user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- Realtime (test-generation progress)
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.test_sets;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
