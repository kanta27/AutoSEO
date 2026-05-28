-- Handoff signal — when the user approves an SEO/GEO/Blog proposal whose
-- implementation is "make a code change", we set handed_off_to_coding=true.
-- The Coding Agent's runner picks these up, synthesizes a `code_change`
-- proposal (full file content + branch + PR title), and links it back via
-- handoff_synthesized_proposal_id. The user then approves the code_change
-- as the second gate to actually open the PR.
--
-- Safe to re-run.

alter table proposals
  add column if not exists handed_off_to_coding boolean not null default false,
  add column if not exists handoff_synthesized_proposal_id uuid
    references proposals(id) on delete set null;

-- Hot-path index: the Coding runner's "what's in the queue" lookup.
-- Partial index keeps it tiny — only the not-yet-synthesized handoffs
-- (typically a handful per company) ever live here.
create index if not exists proposals_handed_off_idx
  on proposals (company_id, handed_off_to_coding)
  where handed_off_to_coding = true and handoff_synthesized_proposal_id is null;

comment on column proposals.handed_off_to_coding is
  'Set true on approval of an SEO/GEO/Blog proposal that should yield a code ' ||
  'change. Coding Agent reads these and synthesizes a code_change proposal ' ||
  'whose approval opens the PR.';

comment on column proposals.handoff_synthesized_proposal_id is
  'After Coding synthesizes a code_change for a handed-off proposal, the ' ||
  'original row links to it here so the UI can show the chain.';
