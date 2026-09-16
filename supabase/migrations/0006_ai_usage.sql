-- ============================================================================
-- AI usage + cost ledger
--
-- Every model call the app makes writes one row here: which operation, which
-- model, tokens in/out, and the dollar cost computed at call time from the rate
-- card in lib/ai/pricing.ts. Rates are recorded per row so historical cost stays
-- correct when pricing changes.
--
-- Rows are attributed to whatever context the call ran under — a college (during
-- catalog scraping), a course (profile build), a test set (question generation)
-- — so the admin dashboard can answer "what did this university cost us?".
-- ============================================================================

create table if not exists public.ai_usage (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete set null,
  college_id     uuid references public.colleges(id) on delete set null,
  course_id      uuid references public.courses(id) on delete set null,
  test_set_id    uuid references public.test_sets(id) on delete set null,
  operation      text not null,
  model          text not null,
  input_tokens   int  not null default 0,
  output_tokens  int  not null default 0,
  total_tokens   int  not null default 0,
  -- Rate card in effect at call time, $ per million tokens.
  input_rate     numeric(10,4),
  output_rate    numeric(10,4),
  cost_usd       numeric(12,6) not null default 0,
  succeeded      boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists ai_usage_college_idx  on public.ai_usage (college_id);
create index if not exists ai_usage_course_idx   on public.ai_usage (course_id);
create index if not exists ai_usage_user_idx     on public.ai_usage (user_id);
create index if not exists ai_usage_test_set_idx on public.ai_usage (test_set_id);
create index if not exists ai_usage_created_idx  on public.ai_usage (created_at desc);

-- Cost data is admin-only: no anon/authenticated policies at all, so RLS denies
-- every client read. The admin dashboard reads it with the service role.
alter table public.ai_usage enable row level security;

-- ---------------------------------------------------------------------------
-- Aggregates for the admin dashboard.
-- ---------------------------------------------------------------------------
create or replace view public.college_ai_cost as
select college_id,
       count(*)                      as call_count,
       sum(input_tokens)             as input_tokens,
       sum(output_tokens)            as output_tokens,
       sum(total_tokens)             as total_tokens,
       sum(cost_usd)                 as cost_usd
from public.ai_usage
where college_id is not null
group by college_id;

create or replace view public.user_ai_cost as
select user_id,
       count(*)          as call_count,
       sum(total_tokens) as total_tokens,
       sum(cost_usd)     as cost_usd
from public.ai_usage
where user_id is not null
group by user_id;

revoke all on public.college_ai_cost, public.user_ai_cost from anon, authenticated;
grant select on public.college_ai_cost, public.user_ai_cost to service_role;
