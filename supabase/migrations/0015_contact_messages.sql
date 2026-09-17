-- ============================================================================
-- Contact form submissions
--
-- The public /contact page writes here through a server action using the
-- service role. No client policies: RLS denies every anon/authenticated read
-- and write, so messages are only visible from the server.
-- ============================================================================

create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  name        text not null,
  email       text not null,
  topic       text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;
