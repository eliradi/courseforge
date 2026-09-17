-- ============================================================================
-- International universities
--
-- The catalog started as the US News top 200. Non-US universities join it
-- ranked by QS World University Rankings, so a rank only means something next
-- to the list it came from: `rank_source` names that list, and `country` says
-- where the university is. `state` stays US-only.
-- ============================================================================

alter table public.colleges
  add column if not exists country     text not null default 'United States',
  add column if not exists rank_source text not null default 'US News';

create index if not exists colleges_country_idx on public.colleges (country);
