// The 4-panel dashboard + full-width Activity section. Server component:
// loads the company + documents + proposals + agents + recent runs in one
// fan-out, then hands them to the (mostly client) panels.
import { redirect } from "next/navigation";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import { LLM_MODEL, LLM_PROVIDER } from "@/lib/llm";
import type {
  Agent,
  AgentRun,
  Company,
  CompanyDocument,
  Proposal,
} from "@/lib/supabase/types";
import { CompanyPanel } from "@/components/CompanyPanel";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { ActionsFeed } from "@/components/ActionsFeed";
import { ChatPanel } from "@/components/ChatPanel";
import { RunAllButton } from "@/components/RunAllButton";
import { ActivitySection, joinActivity } from "@/components/ActivitySection";

export const dynamic = "force-dynamic";

type DashboardData = {
  company: Company;
  documents: CompanyDocument[];
  proposals: Proposal[];
  agents: Agent[];
  recentRuns: AgentRun[];
  allCompanies: Company[];
};

async function loadDashboard(companyId?: string): Promise<DashboardData | null> {
  if (!hasSupabaseEnv()) return null;
  const sb = supabaseServer();

  const companyQuery = companyId
    ? sb.from("companies").select("*").eq("id", companyId).maybeSingle()
    : sb.from("companies").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { data: company } = await companyQuery;
  if (!company) return null;

  const [docsRes, propsRes, agentsRes, runsRes, allCompaniesRes] = await Promise.all([
    sb
      .from("documents")
      .select("*")
      .eq("company_id", company.id)
      .order("created_at", { ascending: true }),
    sb
      .from("proposals")
      .select("*")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(200),
    sb.from("agents").select("*").order("name"),
    // Activity is GLOBAL (across companies) so the user can see what the
    // scheduler did everywhere, not just the company they're viewing.
    sb
      .from("agent_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20),
    sb.from("companies").select("*"),
  ]);

  return {
    company: company as Company,
    documents: (docsRes.data ?? []) as CompanyDocument[],
    proposals: (propsRes.data ?? []) as Proposal[],
    agents: (agentsRes.data ?? []) as Agent[],
    recentRuns: (runsRes.data ?? []) as AgentRun[],
    allCompanies: (allCompaniesRes.data ?? []) as Company[],
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { company?: string };
}) {
  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-2xl p-10 text-center">
        <h1 className="t-h2 mb-2">Supabase not configured</h1>
        <p className="text-ink-3">
          Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local and run the
          migration in supabase/migrations/0001_init.sql.
        </p>
      </main>
    );
  }
  const data = await loadDashboard(searchParams.company);
  if (!data) redirect("/");

  const activityRows = joinActivity(data.recentRuns, data.agents, data.allCompanies);

  return (
    <main className="min-h-screen px-4 py-6 md:px-6">
      <header className="mx-auto mb-6 flex max-w-[1500px] items-center justify-between gap-4">
        <a href="/" className="t-eyebrow">AutoSEO.live</a>
        <div className="flex items-center gap-4">
          <span className="hidden font-mono text-[12px] text-ink-3 sm:inline">
            {data.company.url}
          </span>
          <RunAllButton />
        </div>
      </header>
      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_360px_360px]">
        <CompanyPanel company={data.company} documents={data.documents} />
        <AnalyticsPanel proposals={data.proposals} />
        <ActionsFeed
          companyId={data.company.id}
          initialProposals={data.proposals}
          agents={data.agents}
        />
        <ChatPanel
          companyId={data.company.id}
          companyName={data.company.name}
          modelLabel={`${LLM_MODEL} · ${LLM_PROVIDER}`}
        />
      </div>
      <div className="mx-auto max-w-[1500px]">
        <ActivitySection runs={activityRows} />
      </div>
    </main>
  );
}
