-- ============================================================================
-- Generated tests become a shared library
--
-- Two changes, both aimed at never throwing away a generated test:
--
--   1. RLS — any signed-in user can read every test set and its questions, so a
--      test generated once is reusable by everyone asking for that section.
--      Creating, editing and deleting stay owner-scoped, and attempts/answers
--      remain strictly private to the user who made them.
--
--   2. Regeneration no longer destroys history. Rebuilding a course profile used
--      to delete and re-insert course_sections, which cascaded through test_sets
--      into questions. Sections are now upserted by (course_id, position); see
--      upsertSections() in lib/db/queries.ts for the matching write path.
-- ============================================================================

-- ---- test_sets: shared read, owner-scoped writes -------------------------
drop policy if exists test_sets_owner_select on public.test_sets;

drop policy if exists test_sets_shared_select on public.test_sets;
create policy test_sets_shared_select on public.test_sets
  for select to authenticated using (true);

-- (insert/update/delete policies from 0001 already restrict to the owner)

-- ---- questions: readable for any test set, writable only via your own ----
drop policy if exists questions_owner_select on public.questions;

drop policy if exists questions_shared_select on public.questions;
create policy questions_shared_select on public.questions
  for select to authenticated using (true);

drop policy if exists questions_owner_write on public.questions;

drop policy if exists questions_owner_insert on public.questions;
create policy questions_owner_insert on public.questions
  for insert to authenticated with check (
    exists (
      select 1 from public.test_sets ts
      where ts.id = questions.test_set_id and ts.user_id = (select auth.uid())
    )
  );

drop policy if exists questions_owner_update on public.questions;
create policy questions_owner_update on public.questions
  for update to authenticated
  using (
    exists (
      select 1 from public.test_sets ts
      where ts.id = questions.test_set_id and ts.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.test_sets ts
      where ts.id = questions.test_set_id and ts.user_id = (select auth.uid())
    )
  );

drop policy if exists questions_owner_delete on public.questions;
create policy questions_owner_delete on public.questions
  for delete to authenticated using (
    exists (
      select 1 from public.test_sets ts
      where ts.id = questions.test_set_id and ts.user_id = (select auth.uid())
    )
  );

-- attempts / attempt_answers keep their owner-only policies from 0001.

-- A section's tests are looked up constantly now that they are shared.
create index if not exists test_sets_section_status_idx
  on public.test_sets (course_section_id, status);
