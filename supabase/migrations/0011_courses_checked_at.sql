-- ============================================================================
-- Remember when a department's courses were checked, not just whether any exist
--
-- "No courses stored" used to be read as "never sourced". But some departments
-- are genuinely empty — retired codes still listed by the catalog, whose courses
-- are all inactive (FSU's BUBAD, EDPLS and EDLPS, for example). Those looked
-- permanently unsourced: every student visit triggered a fresh scrape, every
-- retrieval fetched them again, and the university could never show as complete.
--
-- courses_scraped_at is set whenever a department's course list is read
-- successfully, including when it comes back empty.
-- ============================================================================

alter table public.departments
  add column if not exists courses_scraped_at timestamptz;

comment on column public.departments.courses_scraped_at is
  'When this department''s course list was last read successfully — set even when it had no courses.';

-- Departments that already hold courses were evidently checked.
update public.departments d
set courses_scraped_at = s.last_scraped_at
from (
  select department_id, max(scraped_at) as last_scraped_at
  from public.courses
  group by department_id
) s
where s.department_id = d.id
  and d.courses_scraped_at is null;

-- Stats views gain the checked timestamp and a "sourced" count (appended columns).
create or replace view public.department_course_stats as
select d.id                 as department_id,
       count(c.id)          as course_count,
       max(c.scraped_at)    as last_scraped_at,
       d.college_id,
       d.courses_scraped_at
from public.departments d
left join public.courses c on c.department_id = d.id
group by d.id, d.college_id, d.courses_scraped_at;

create or replace view public.college_stats as
select
  c.id                                    as college_id,
  coalesce(dept.department_count, 0)      as department_count,
  coalesce(crs.course_count, 0)           as course_count,
  coalesce(att.attempts_taken, 0)         as attempts_taken,
  coalesce(ts.test_set_count, 0)          as test_set_count,
  crs.last_scraped_at,
  coalesce(dept.departments_with_courses, 0) as departments_with_courses,
  coalesce(dept.departments_sourced, 0)      as departments_sourced
from public.colleges c
left join (
  select d.college_id,
         count(*)                                              as department_count,
         count(*) filter (where s.course_count > 0)            as departments_with_courses,
         count(*) filter (where s.courses_scraped_at is not null) as departments_sourced
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
