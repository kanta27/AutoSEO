-- Document viewer + editor (Session: finish the documents).
-- Adds three columns to `documents`:
--   • viewed_at    — set on the first GET of the viewer page; drives the
--                    "New" badge in the Company panel.
--   • user_edited  — set true on the first successful PUT; drives the
--                    small "Edited" chip in the Company panel and signals
--                    to any future telemetry that the agent is reading
--                    customer-tuned content rather than the LLM's starter.
--   • updated_at   — basic edit timestamp. The original 0001 schema didn't
--                    have one; we need it for the "Last edited: 2 min ago"
--                    label in the viewer header.
--
-- Safe to re-run.

alter table documents
  add column if not exists viewed_at   timestamptz,
  add column if not exists user_edited boolean     not null default false,
  add column if not exists updated_at  timestamptz not null default now();

comment on column documents.viewed_at is
  'First-view timestamp. NULL until the viewer page loads the row, then ' ||
  'set once and never updated. Drives the "New" pill in the Company panel.';

comment on column documents.user_edited is
  'True once the user saves any edit through /api/documents/:id (PUT). ' ||
  'Drives the "Edited" pill in the Company panel.';

comment on column documents.updated_at is
  'Last-modified timestamp. Bumped by every successful PUT on /api/documents/:id.';
