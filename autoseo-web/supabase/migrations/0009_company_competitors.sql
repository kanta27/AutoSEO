-- Rich Company panel — promote category to a column, store detected/manual
-- competitors as a structured list, and let documents carry a "is_starter"
-- flag so the dashboard can show a "New" badge until the user edits them.
--
-- Note: this is migration 0009 (not 0008 as the original session brief
-- suggested). 0008 was already taken by the PageSpeed cache migration.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Companies — add `competitors` jsonb and `category` text.
--    Backfill `category` from the existing `profile->>'category'` value so
--    existing companies keep their classification.
alter table companies
  add column if not exists competitors jsonb not null default '[]'::jsonb,
  add column if not exists category text;

update companies
   set category = profile->>'category'
 where category is null
   and profile ? 'category';

comment on column companies.competitors is
  'Array of { name, url, logo_url?, source: detected|manual }. Detected ones come ' ||
  'from the onboarding LLM step (validated via HEAD fetch); manual ones from ' ||
  '/api/companies/:id/competitors. Logo URLs are computed at render time and ' ||
  'almost never stored — the optional field exists for future caching.';

comment on column companies.category is
  'Auto-classified industry/category (e.g. "Meal Kit Service"). Onboarding sets ' ||
  'it; was previously stored at profile->>''category''. Promoted to its own ' ||
  'column for query simplicity.';

-- ---------------------------------------------------------------------------
-- 2. Documents — add `meta` jsonb (for { is_starter: true }) and expand the
--    kind check to include `llms_txt`. Drop-and-recreate the constraint so
--    repeated runs don't accumulate the kind list.
alter table documents
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table documents drop constraint if exists documents_kind_check;
alter table documents
  add constraint documents_kind_check
    check (kind in (
      'product_info',
      'brand_voice',
      'competitor_analysis',
      'marketing_strategy',
      'llms_txt'
    ));

comment on column documents.meta is
  'Free-form metadata. Onboarding stamps { is_starter: true } on seeded docs ' ||
  'so the Company panel can show a "New" badge until the user edits the doc.';
