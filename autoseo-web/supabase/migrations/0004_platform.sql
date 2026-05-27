-- Multi-platform publishing: detect the user's CMS at onboarding and route
-- blog-post approvals to the right connector (or to manual-copy mode for
-- unknown platforms).
--
-- Safe to re-run.

alter table companies
  add column if not exists platform text not null default 'unknown';

-- Restrict to the platforms we currently dispatch to. Adding a new connector
-- (Webflow / Ghost / etc.) will be an `alter ... drop constraint ... add ...`
-- migration alongside the new connector code.
alter table companies
  drop constraint if exists companies_platform_check;
alter table companies
  add constraint companies_platform_check
    check (platform in ('shopify', 'wordpress', 'unknown'));

-- Detection-time hints (e.g. {wp_json_ok: true, generator: "WordPress 6.5"})
-- so we can debug "why did detection say X" later without redoing the probe.
alter table companies
  add column if not exists platform_meta jsonb not null default '{}'::jsonb;
