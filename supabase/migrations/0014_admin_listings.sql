-- ============================================================================
-- Admin listings that outgrow client-side handling
--
-- /admin/courses pages through ~30k courses with filtering and sorting on
-- aggregated columns (tests, attempts, AI cost), so all of that happens here.
-- The dashboard's AI totals are summed here too: PostgREST caps a response at
-- 1000 rows, and the ledger passed that long ago.
-- ============================================================================

-- Same rule as courseLevel() in lib/db/admin-queries.ts: dotted numbers carry
-- the tier after the dot (6.1010 -> 1xxx), otherwise the leading digits count.
create or replace function public.course_level(course_number text)
returns text
language sql
immutable
parallel safe
as $$
  with digits as (
    select coalesce(
      substring(course_number from '\.\s*(\d+)'),
      substring(course_number from '(\d+)')
    )::numeric as value
  ),
  tier as (
    select case
      when value is null then null
      when value < 100 then case when value < 50 then 1 else 2 end
      when value < 1000 then floor(value / 100)
      else floor(value / 1000)
    end as t
    from digits
  )
  select case
    when t is null then 'Unspecified'
    when t <= 1 then 'Introductory'
    when t <= 4 then 'Undergraduate'
    else 'Graduate'
  end
  from tier
$$;

drop function if exists public.admin_course_list(text, text, text, boolean, int, int);

create or replace function public.admin_course_list(
  p_query  text    default null,
  -- 'all' | 'tested' | 'untested'
  p_tested text    default 'all',
  -- course | title | university | department | level | sections | tests | taken | cost
  p_sort   text    default 'course',
  p_desc   boolean default false,
  p_limit  int     default 500,
  p_offset int     default 0
)
returns table (
  id                 uuid,
  course_number      text,
  title              text,
  credits            text,
  level              text,
  department_code    text,
  department_name    text,
  college_id         uuid,
  college_name       text,
  section_count      int,
  test_set_count     int,
  complete_test_sets int,
  attempts_taken     int,
  cost_usd           numeric,
  has_summary        boolean,
  total_count        bigint
)
language plpgsql
stable
set search_path = public
as $$
declare
  -- Whitelisted sort expressions; the user-supplied key never reaches SQL text.
  sort_expr text := case p_sort
    when 'title'      then 'lower(r.title)'
    when 'university' then 'lower(r.college_name)'
    when 'department' then 'lower(r.department_code)'
    when 'level'      then 'r.level_rank'
    when 'sections'   then 'r.section_count'
    when 'tests'      then 'r.complete_test_sets, r.test_set_count'
    when 'taken'      then 'r.attempts_taken'
    when 'cost'       then 'r.cost_usd'
    else                   'lower(r.course_number)'
  end;
  direction text := case when p_desc then 'desc' else 'asc' end;
  ordering  text;
begin
  -- Apply the direction to every part of a compound key.
  select string_agg(part || ' ' || direction || ' nulls last', ', ')
    into ordering
    from unnest(string_to_array(sort_expr, ', ')) as part;

  return query execute format($q$
    with sections as (
      select s.course_id, count(*)::int as n
      from course_sections s
      group by s.course_id
    ),
    tests as (
      select s.course_id,
             count(*)::int                                          as total,
             count(*) filter (where t.status = 'complete')::int     as complete,
             coalesce(sum(a.taken), 0)::int                         as taken
      from test_sets t
      join course_sections s on s.id = t.course_section_id
      left join (
        select test_set_id, count(*) as taken
        from attempts
        where submitted_at is not null
        group by test_set_id
      ) a on a.test_set_id = t.id
      group by s.course_id
    ),
    costs as (
      select u.course_id, sum(u.cost_usd) as cost
      from ai_usage u
      where u.course_id is not null
      group by u.course_id
    ),
    rows as (
      select c.id, c.course_number, c.title, c.credits,
             public.course_level(c.course_number) as level,
             d.code as department_code, d.name as department_name,
             col.id as college_id, coalesce(col.short_name, col.name) as college_name,
             coalesce(sec.n, 0)          as section_count,
             coalesce(t.total, 0)        as test_set_count,
             coalesce(t.complete, 0)     as complete_test_sets,
             coalesce(t.taken, 0)        as attempts_taken,
             coalesce(k.cost, 0)::numeric as cost_usd,
             c.ai_summary is not null    as has_summary
      from courses c
      join departments d on d.id = c.department_id
      join colleges col on col.id = d.college_id
      left join sections sec on sec.course_id = c.id
      left join tests t on t.course_id = c.id
      left join costs k on k.course_id = c.id
      where ($1 is null or $1 = ''
             or c.course_number ilike '%%' || $1 || '%%'
             or c.title ilike '%%' || $1 || '%%'
             or d.code ilike '%%' || $1 || '%%'
             or d.name ilike '%%' || $1 || '%%'
             or col.name ilike '%%' || $1 || '%%'
             or col.short_name ilike '%%' || $1 || '%%')
    ),
    filtered as (
      select r.*,
             case r.level
               when 'Introductory' then 1 when 'Undergraduate' then 2
               when 'Graduate' then 3 else 4
             end as level_rank
      from rows r
      where $2 = 'all'
         or ($2 = 'tested' and r.test_set_count > 0)
         or ($2 = 'untested' and r.test_set_count = 0)
    )
    select r.id, r.course_number, r.title, r.credits, r.level,
           r.department_code, r.department_name, r.college_id, r.college_name,
           r.section_count, r.test_set_count, r.complete_test_sets, r.attempts_taken,
           r.cost_usd, r.has_summary,
           count(*) over () as total_count
    from filtered r
    order by %s, lower(r.course_number), r.id
    limit $3 offset $4
  $q$, ordering)
  using nullif(btrim(replace(replace(coalesce(p_query, ''), '%', '\%'), '_', '\_')), ''),
        coalesce(p_tested, 'all'),
        least(greatest(coalesce(p_limit, 500), 1), 1000),
        greatest(coalesce(p_offset, 0), 0);
end
$$;

-- Admin only: the console calls this with the service role.
revoke all on function public.admin_course_list(text, text, text, boolean, int, int) from public, anon, authenticated;
grant execute on function public.admin_course_list(text, text, text, boolean, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Whole-ledger AI totals for the dashboard.
-- ---------------------------------------------------------------------------
create or replace view public.ai_cost_total as
select count(*)                       as call_count,
       coalesce(sum(total_tokens), 0) as total_tokens,
       coalesce(sum(cost_usd), 0)     as cost_usd
from public.ai_usage;

revoke all on public.ai_cost_total from anon, authenticated;
grant select on public.ai_cost_total to service_role;
