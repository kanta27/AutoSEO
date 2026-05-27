-- Scheduler v1: per-agent run interval + per-run proposal count.
--
-- Both columns use `add column if not exists` so this migration is safe to
-- re-run against a DB that already has it applied.

alter table agents
  add column if not exists schedule_hours int not null default 24;

alter table agent_runs
  add column if not exists proposals_created int not null default 0;

-- Speeds up the due-logic query (latest successful run per (company, agent)).
create index if not exists agent_runs_due_lookup_idx
  on agent_runs (company_id, agent_key, status, started_at desc);
