-- code_change proposals — agents propose file edits, approval opens a PR.
-- The actual schema change here is small because the existing columns already
-- support what we need:
--   • proposals.type is free-form text (no check constraint), so a new type
--     value 'code_change' needs no enum update.
--   • proposals.status already permits 'published' and 'publish_failed'
--     (migration 0003); we reuse them — a merged PR is the "published" state.
--   • proposals.publish_url + publish_error already exist (migration 0003);
--     the GitHub connector writes the PR html_url into publish_url and the
--     typed error message into publish_error.
--
-- The agent that produces code_change proposals (`coding` agent_key) is also
-- already seeded in 0001_init.sql. We only refresh its description here so
-- the catalog reflects the new behaviour.
--
-- Safe to re-run.

update agents
  set
    description =
      'Proposes code-level SEO/GEO fixes (meta tags, schema, page edits) as ' ||
      'pull requests on your GitHub repo. Never merges — you review and merge.',
    status = 'live'
  where key = 'coding';

-- A comment on the proposals table to make this discoverable from psql/Supabase
-- studio without spelunking through migrations.
comment on column proposals.type is
  'Proposal kind. Known values: audit_summary, issue_critical, issue_high, ' ||
  'geo_gap, blog_post, code_change. Free-form to allow new agent types ' ||
  'without a schema change; the approval handler dispatches on it.';
