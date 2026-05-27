// Hand-written row types so we don't depend on `supabase gen types`. Keep in
// sync with supabase/migrations/0001_init.sql.

export type Company = {
  id: string;
  url: string;
  name: string;
  description: string | null;
  profile: Record<string, unknown>;
  created_at: string;
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

export type ProposalStatus = "pending" | "approved" | "rejected" | "archived";

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
