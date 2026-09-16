-- ============================================================================
-- Per-course AI cost
--
-- The admin courses tab previously summed ai_usage client-side with a
-- `.in('course_id', [...])` filter. PostgREST puts that list in the query
-- string, so once the catalog grew past a few hundred courses the request was
-- too long and silently returned nothing — every course showed no cost.
-- Aggregating in the database removes the limit entirely.
-- ============================================================================

create or replace view public.course_ai_cost as
select course_id,
       count(*)          as call_count,
       sum(total_tokens) as total_tokens,
       sum(cost_usd)     as cost_usd
from public.ai_usage
where course_id is not null
group by course_id;

revoke all on public.course_ai_cost from anon, authenticated;
grant select on public.course_ai_cost to service_role;
