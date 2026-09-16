-- ============================================================================
-- Catalog provenance + per-college aggregate stats
--
-- The college picker highlights schools we've already indexed, shows how their
-- catalog was obtained, and how many tests have been taken there. The first
-- needs a new column (we were computing the discovery route and throwing it
-- away); the last needs an aggregate that spans every user's attempts.
-- ============================================================================

-- How the catalog URL was arrived at, as distinct from which platform serves it.
alter table public.colleges
  add column if not exists catalog_source text;

alter table public.colleges
  drop constraint if exists colleges_catalog_source_check;

alter table public.colleges
  add constraint colleges_catalog_source_check
  check (catalog_source in ('heuristic','sitemap','homepage','search','manual'));

comment on column public.colleges.catalog_source is
  'How the catalog URL was found: URL heuristics, sitemap/homepage mining, web search, or pasted by a user.';

-- ---------------------------------------------------------------------------
-- college_stats
--
-- Aggregates only — no user ids, no per-user rows. Counting attempts means
-- reading across every user''s rows, so this is deliberately NOT granted to
-- anon/authenticated; it is read server-side with the service role, exactly
-- like the other shared-cache maintenance queries.
--
-- Written as independent grouped subqueries rather than one wide join so the
-- course and attempt fan-outs never multiply against each other.
-- ---------------------------------------------------------------------------
create or replace view public.college_stats as
select
  c.id                                    as college_id,
  coalesce(dept.department_count, 0)      as department_count,
  coalesce(crs.course_count, 0)           as course_count,
  coalesce(att.attempts_taken, 0)         as attempts_taken,
  coalesce(ts.test_set_count, 0)          as test_set_count,
  crs.last_scraped_at
from public.colleges c
left join (
  select college_id, count(*) as department_count
  from public.departments
  group by college_id
) dept on dept.college_id = c.id
left join (
  select d.college_id,
         count(*)              as course_count,
         max(co.scraped_at)    as last_scraped_at
  from public.courses co
  join public.departments d on d.id = co.department_id
  group by d.college_id
) crs on crs.college_id = c.id
left join (
  select d.college_id, count(*) as test_set_count
  from public.test_sets t
  join public.course_sections cs on cs.id = t.course_section_id
  join public.courses co        on co.id = cs.course_id
  join public.departments d     on d.id = co.department_id
  group by d.college_id
) ts on ts.college_id = c.id
left join (
  select d.college_id, count(*) as attempts_taken
  from public.attempts a
  join public.test_sets t       on t.id = a.test_set_id
  join public.course_sections cs on cs.id = t.course_section_id
  join public.courses co        on co.id = cs.course_id
  join public.departments d     on d.id = co.department_id
  where a.submitted_at is not null
  group by d.college_id
) att on att.college_id = c.id;

revoke all on public.college_stats from anon, authenticated;
grant select on public.college_stats to service_role;

-- Supporting indexes for the joins above.
create index if not exists attempts_submitted_idx on public.attempts (test_set_id) where submitted_at is not null;
create index if not exists course_sections_course_id_idx on public.course_sections (course_id);
