-- PageSpeed Insights cache. PSI calls are slow (10-30s) and rate-limited
-- (25k/day public quota, 4 QPS), so we keep results around for 6 hours per
-- URL. The TTL is enforced in the application layer (lib/engines/pagespeed.ts)
-- so we don't need a partial-index or expiry cron — old rows are simply
-- overwritten on the next refresh past the TTL.
--
-- Safe to re-run.
--
-- Note: this is migration 0008 (not 0007 as the original session brief
-- suggested) — 0007 was taken by the blog daily-cadence cutover.

create table if not exists pagespeed_cache (
  url        text primary key,
  result     jsonb not null,
  fetched_at timestamptz not null default now()
);

comment on table pagespeed_cache is
  'Per-URL PageSpeed Insights snapshot. 6-hour TTL enforced in lib/engines/pagespeed.ts; ' ||
  'older rows are upserted on the next refresh. Refresh button on the dashboard bypasses ' ||
  'the TTL via { refresh: true } on POST /api/pagespeed.';
