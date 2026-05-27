-- Blog agent — first agent on top of the shared agentic-loop skeleton.
-- Safe to re-run: all changes use `if (not) exists`.

-- ---------------------------------------------------------------------------
-- 1. Add the blog agent to the catalog. Weekly cadence (168h) because daily
-- blog publishing would be both unusual and costly.
insert into agents (key, name, status, enabled, description, schedule_hours)
  values (
    'blog',
    'Blog Agent',
    'live',
    true,
    'Drafts ranking-targeted articles in your brand voice for your approval.',
    168
  )
on conflict (key) do update
  set name = excluded.name,
      status = excluded.status,
      description = excluded.description,
      schedule_hours = excluded.schedule_hours;

-- ---------------------------------------------------------------------------
-- 2. Extend proposals.status to include the publish lifecycle. The default
-- `pending → approved/rejected/archived` was enough for review-only types;
-- blog posts have a publish step that can succeed or fail externally.
alter table proposals drop constraint if exists proposals_status_check;
alter table proposals
  add constraint proposals_status_check
    check (status in (
      'pending', 'approved', 'rejected', 'archived',
      'published', 'publish_failed'
    ));

alter table proposals
  add column if not exists publish_url   text,
  add column if not exists publish_error text;

-- ---------------------------------------------------------------------------
-- 3. Per-step trace of an agentic loop. Without this, debugging a misbehaving
-- agent (why did it pick this keyword, what did the tool return) is painful.
-- One row per LLM step or tool call, scoped to a single agent_runs row.
create table if not exists agent_logs (
  id          uuid primary key default uuid_generate_v4(),
  run_id      uuid not null references agent_runs(id) on delete cascade,
  step        int not null,
  role        text not null check (role in (
                'plan', 'tool_call', 'tool_result', 'final', 'error'
              )),
  content     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists agent_logs_run_idx on agent_logs (run_id, step);
