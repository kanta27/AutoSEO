-- AutoSEO web — initial schema. Single-tenant for now; auth + RLS are a later
-- session. All writes go through the service-role key on the server side, so
-- we deliberately do NOT enable RLS yet.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- companies — one per install for now. The dashboard always loads "the" company
-- (most recent row). Multi-tenant adds (user_id, plan, …) later.
create table if not exists companies (
  id          uuid primary key default uuid_generate_v4(),
  url         text not null,
  name        text not null,
  description text,
  profile     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- documents — generated context blobs (markdown) the AI CMO chat reads from.
create table if not exists documents (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references companies(id) on delete cascade,
  kind        text not null check (kind in (
                'product_info', 'brand_voice', 'competitor_analysis', 'marketing_strategy'
              )),
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists documents_company_id_idx on documents (company_id);

-- agents — the catalog of marketing agents (live + coming_soon). Seeded below.
create table if not exists agents (
  id          uuid primary key default uuid_generate_v4(),
  key         text not null unique,
  name        text not null,
  status      text not null check (status in ('live', 'coming_soon')),
  enabled     boolean not null default true,
  description text
);

-- proposals — the Actions Feed. One row per atomic suggestion an agent makes.
create table if not exists proposals (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references companies(id) on delete cascade,
  agent_key   text not null references agents(key),
  type        text not null,
  title       text not null,
  summary     text,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'archived')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create index if not exists proposals_company_status_idx on proposals (company_id, status, created_at desc);
create index if not exists proposals_agent_key_idx on proposals (agent_key);

-- agent_runs — one row per invocation of an agent. Joined into the feed
-- header so the user can see "running…" feedback.
create table if not exists agent_runs (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references companies(id) on delete cascade,
  agent_key   text not null references agents(key),
  status      text not null default 'running'
                check (status in ('running', 'done', 'failed')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  error       text
);
create index if not exists agent_runs_company_id_idx on agent_runs (company_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Seed agents. on conflict (key) do update keeps name/status fresh across
-- re-runs but never duplicates rows.
insert into agents (key, name, status, enabled, description) values
  ('seo',      'SEO Agent',         'live',        true,
   'Suggests keyword opportunities and drafts blog posts and landing pages for your approval.'),
  ('geo',      'GEO Agent',         'live',        true,
   'Gets your brand cited in ChatGPT and Google AI Overviews.'),
  ('coding',   'Coding Agent',      'live',        true,
   'Automates technical SEO fixes and site improvements.'),
  ('reddit',   'Reddit Agent',      'coming_soon', true,
   'Finds relevant threads and drafts reply ideas and posts for you to review before publishing.'),
  ('x',        'X (Twitter) Agent', 'coming_soon', true,
   'Generates post and thread drafts you can edit, refine, and post yourself.'),
  ('linkedin', 'LinkedIn Agent',    'coming_soon', true,
   'Suggests content ideas and drafts professional posts for you to personalise and share.'),
  ('hn',       'Hacker News Agent', 'coming_soon', true,
   'Identifies the right moments to share and drafts comments for you to post.'),
  ('writer',   'Writer Agent',      'coming_soon', true,
   'Drafts long-form content, articles, and copy tailored to your brand voice.'),
  ('ugc',      'UGC Videos Agent',  'coming_soon', true,
   'Guided briefs, multi-aspect AI clips, and downloads for social and ads.')
on conflict (key) do update
  set name = excluded.name,
      status = excluded.status,
      description = excluded.description;
