// Hand-written row types so we don't depend on `supabase gen types`. Keep in
// sync with supabase/migrations/0001_init.sql.

export type CompanyPlatform = "shopify" | "wordpress" | "unknown";

// Single competitor row stored inside `companies.competitors` (jsonb).
// `source` distinguishes auto-detected (onboarding LLM + HEAD validation)
// from manually-added (the edit modal in the Company panel).
export type CompetitorSource = "detected" | "manual";
export type Competitor = {
  name: string;
  url: string;
  logo_url?: string;
  source: CompetitorSource;
};

export type Company = {
  id: string;
  url: string;
  name: string;
  description: string | null;
  profile: Record<string, unknown>;
  created_at: string;
  platform: CompanyPlatform;             // added by migration 0004
  platform_meta: Record<string, unknown>; // added by migration 0004
  // ---- migration 0009 ----
  // Auto-classified at onboarding (e.g. "Meal Kit Service"). Promoted from
  // profile->>'category'; the migration backfills existing rows.
  category: string | null;
  // Detected + manual competitors. Always an array (default '[]'::jsonb).
  competitors: Competitor[];
};

export type DocumentKind =
  | "product_info"
  | "brand_voice"
  | "competitor_analysis"
  | "marketing_strategy"
  | "llms_txt"; // added by migration 0009

export type CompanyDocument = {
  id: string;
  company_id: string;
  kind: DocumentKind;
  title: string;
  body: string;
  created_at: string;
  // ---- migration 0009 ----
  // Free-form metadata. Onboarding stamps { is_starter: true } on seeded
  // docs so the Company panel can render a "New" badge until the user
  // edits the doc (when edit lands; v1 just shows the badge unconditionally
  // while is_starter remains true).
  meta: Record<string, unknown>;
};

export type Agent = {
  id: string;
  key: string;
  name: string;
  status: "live" | "coming_soon";
  enabled: boolean;
  description: string | null;
  schedule_hours: number; // added by migration 0002
};

export type ProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "archived"
  | "published"
  | "publish_failed";

export type Proposal = {
  id: string;
  company_id: string;
  agent_key: string;
  type: string;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  status: ProposalStatus;
  created_at: string;
  decided_at: string | null;
  publish_url: string | null;   // added by migration 0003 (set on successful publish)
  publish_error: string | null; // added by migration 0003 (set on publish_failed, OR by Coding when a handoff couldn't be synthesized)
  // ---- migration 0006: handoff to Coding Agent ----
  // True when this proposal was approved with an implied code change. The
  // Coding runner reads the not-yet-synthesized queue and produces a
  // companion `code_change` proposal whose id is stored back in
  // handoff_synthesized_proposal_id.
  handed_off_to_coding: boolean;
  handoff_synthesized_proposal_id: string | null;
};

// Payload shape for `code_change` proposals — emitted by code-fix agents
// (currently `coding`; future SEO-fix/GEO-fix sessions will share the type).
// Approving such a proposal opens a Pull Request via lib/connectors/github.ts;
// rejecting is a clean state flip (no GitHub call). Files carry the FULL
// replacement content — we don't apply diffs.
export type CodeChangePayload = {
  source_agent: "seo" | "geo" | "blog" | string;
  rationale: string;
  files: Array<{ path: string; content: string }>;
  suggested_branch: string;
  suggested_pr_title: string;
  suggested_pr_body: string; // markdown
};

export type AgentRun = {
  id: string;
  company_id: string;
  agent_key: string;
  status: "running" | "done" | "failed";
  started_at: string;
  finished_at: string | null;
  error: string | null;
  proposals_created: number; // added by migration 0002
};
