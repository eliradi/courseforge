-- ============================================================================
-- Operation runs
--
-- The admin console needs "when did we last do X here, and what did it cost"
-- for four distinct operations. ai_usage alone can't answer it: adapter-backed
-- catalogs make no model calls at all, so a successful retrieval often leaves
-- no rows behind and would look like it never happened.
--
-- Every run therefore records itself here, with the AI cost it incurred rolled
-- up at the time it finished.
-- ============================================================================

create table if not exists public.operation_runs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in (
                  'catalog_check','course_retrieval','course_profile','test_generation'
                )),
  college_id    uuid references public.colleges(id) on delete cascade,
  course_id     uuid references public.courses(id) on delete set null,
  test_set_id   uuid references public.test_sets(id) on delete set null,
  user_id       uuid references auth.users(id) on delete set null,
  ok            boolean not null default true,
  summary       text,
  total_tokens  int not null default 0,
  cost_usd      numeric(12,6) not null default 0,
  started_at    timestamptz not null,
  finished_at   timestamptz not null default now()
);

create index if not exists operation_runs_college_kind_idx
  on public.operation_runs (college_id, kind, finished_at desc);
create index if not exists operation_runs_finished_idx on public.operation_runs (finished_at desc);

-- Operational data: admin-only, so no anon/authenticated policies at all.
alter table public.operation_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Latest run of each kind per college, pivoted into one row.
-- ---------------------------------------------------------------------------
create or replace view public.college_latest_operations as
with ranked as (
  select
    college_id,
    kind,
    ok,
    summary,
    total_tokens,
    cost_usd,
    finished_at,
    row_number() over (partition by college_id, kind order by finished_at desc) as rn
  from public.operation_runs
  where college_id is not null
)
select
  college_id,
  max(finished_at) filter (where kind = 'catalog_check')    as catalog_check_at,
  max(cost_usd)    filter (where kind = 'catalog_check')    as catalog_check_cost,
  max(total_tokens) filter (where kind = 'catalog_check')   as catalog_check_tokens,
  bool_or(ok)      filter (where kind = 'catalog_check')    as catalog_check_ok,

  max(finished_at) filter (where kind = 'course_retrieval') as retrieval_at,
  max(cost_usd)    filter (where kind = 'course_retrieval') as retrieval_cost,
  max(total_tokens) filter (where kind = 'course_retrieval') as retrieval_tokens,
  bool_or(ok)      filter (where kind = 'course_retrieval') as retrieval_ok,

  max(finished_at) filter (where kind = 'course_profile')   as profile_at,
  max(cost_usd)    filter (where kind = 'course_profile')   as profile_cost,
  max(total_tokens) filter (where kind = 'course_profile')  as profile_tokens,
  bool_or(ok)      filter (where kind = 'course_profile')   as profile_ok,

  max(finished_at) filter (where kind = 'test_generation')  as test_generation_at,
  max(cost_usd)    filter (where kind = 'test_generation')  as test_generation_cost,
  max(total_tokens) filter (where kind = 'test_generation') as test_generation_tokens,
  bool_or(ok)      filter (where kind = 'test_generation')  as test_generation_ok
from ranked
where rn = 1
group by college_id;

revoke all on public.operation_runs, public.college_latest_operations from anon, authenticated;
grant select on public.college_latest_operations to service_role;
