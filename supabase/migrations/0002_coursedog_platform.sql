-- ============================================================================
-- Add the Coursedog catalog platform.
--
-- Coursedog is a Nuxt SPA backed by a public JSON API and is used by a sizeable
-- slice of the top-200 (UCSB, Emory, Rice, WashU, Princeton, Caltech, UCSD, …).
-- Those schools were landing on the slow, AI-assisted generic path, so it gets
-- a first-class adapter.
-- ============================================================================

alter table public.colleges
  drop constraint if exists colleges_catalog_platform_check;

alter table public.colleges
  add constraint colleges_catalog_platform_check
  check (catalog_platform in ('courseleaf','acalog','banner','kuali','coursedog','generic'));
