// Hand-written row types so we don't depend on `supabase gen types`. Keep in
// sync with supabase/migrations/0001_init.sql.

export type CompanyPlatform = "shopify" | "wordpress" | "unknown";

export type Company = {
  id: string;
  url: string;
  name: string;
  description: string | null;
  profile: Record<string, unknown>;
  created_at: string;
  platform: CompanyPlatform;             // added by migration 0004
  platform_meta: Record<string, unknown>; // added by migration 0004
};

export type DocumentKind =
  | "product_info"
  | "brand_voice"
  | "competitor_analysis"
  | "marketing_strategy";

export type CompanyDocument = {
  id: string;
  company_id: string;
  kind: DocumentKind;
  title: string;
  body: string;
  created_at: string;
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
  publish_error: string | null; // added by migration 0003 (set on publish_failed)
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
