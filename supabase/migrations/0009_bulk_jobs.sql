-- ============================================================================
-- Durable bulk jobs
--
-- Bulk check-and-retrieve used to run inside the HTTP request that streamed its
-- progress. The job and the connection were one thing: a dev-server restart, a
-- recompile, a laptop sleeping, or a Wi-Fi blip ended the request and took the
-- job with it, and the browser could only report "network error". A real run
-- processed eight universities in eleven minutes before dying that way — a full
-- 200 would take hours.
--
-- Jobs now live here. The runner writes progress to the database; the browser
-- reads it back and can reconnect at any point from the last event it saw. A job
-- whose runner disappeared is detectable by its stale heartbeat and can be
-- resumed from the universities it hadn't finished.
-- ============================================================================

create table if not exists public.bulk_jobs (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid references auth.users(id) on delete set null,
  params           jsonb not null,
  status           text not null default 'running'
                     check (status in ('running','completed','cancelled','interrupted','failed')),
  cancel_requested boolean not null default false,
  total            int not null default 0,
  processed        int not null default 0,
  succeeded        int not null default 0,
  failed           int not null default 0,
  total_cost_usd   numeric(12,6) not null default 0,
  current_college_id uuid references public.colleges(id) on delete set null,
  error            text,
  heartbeat_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index if not exists bulk_jobs_created_idx on public.bulk_jobs (created_at desc);

-- One row per university, frozen at creation, so resume knows exactly what's left.
create table if not exists public.bulk_job_items (
  job_id     uuid not null references public.bulk_jobs(id) on delete cascade,
  college_id uuid not null references public.colleges(id) on delete cascade,
  position   int not null,
  status     text not null default 'pending'
               check (status in ('pending','running','ok','failed','skipped')),
  summary    text,
  cost_usd   numeric(12,6) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (job_id, college_id)
);

create index if not exists bulk_job_items_order_idx on public.bulk_job_items (job_id, position);

-- The progress log the browser replays and tails.
create table if not exists public.bulk_job_events (
  job_id     uuid not null references public.bulk_jobs(id) on delete cascade,
  seq        int not null,
  event      jsonb not null,
  created_at timestamptz not null default now(),
  primary key (job_id, seq)
);

-- Admin-only operational data.
alter table public.bulk_jobs       enable row level security;
alter table public.bulk_job_items  enable row level security;
alter table public.bulk_job_events enable row level security;
