-- ============================================================================
-- Department coverage
--
-- A "retrieved" university could be mostly empty: bulk runs fetched course
-- lists for only the first few departments, and the rest were stored with no
-- courses. The first student to open one of those departments then triggered a
-- scrape, even though the university looked retrieved. At the time this was
-- added, 73 of 76 retrieved universities were partial — 7,460 of 7,847
-- departments had no courses.
--
-- These views make coverage visible and let retrieval fetch only what's missing.
-- ============================================================================

-- One row per department, including empty ones (course_count 0). Carries the
-- college id so callers filter by university rather than passing hundreds of
-- department ids, which overflows PostgREST's query string.
create or replace view public.department_course_stats as
select d.id              as department_id,
       count(c.id)       as course_count,
       max(c.scraped_at) as last_scraped_at,
       d.college_id
from public.departments d
left join public.courses c on c.department_id = d.id
group by d.id, d.college_id;

-- Same columns as before, with coverage appended (a view can only grow at the end).
create or replace view public.college_stats as
select
  c.id                                    as college_id,
  coalesce(dept.department_count, 0)      as department_count,
  coalesce(crs.course_count, 0)           as course_count,
  coalesce(att.attempts_taken, 0)         as attempts_taken,
  coalesce(ts.test_set_count, 0)          as test_set_count,
  crs.last_scraped_at,
  coalesce(dept.departments_with_courses, 0) as departments_with_courses
from public.colleges c
left join (
  select d.college_id,
         count(*)                               as department_count,
         count(*) filter (where s.course_count > 0) as departments_with_courses
  from public.departments d
  left join public.department_course_stats s on s.department_id = d.id
  group by d.college_id
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

revoke all on public.department_course_stats, public.college_stats from anon, authenticated;
grant select on public.department_course_stats, public.college_stats to service_role;

create index if not exists courses_department_scraped_idx on public.courses (department_id, scraped_at);
