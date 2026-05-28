// /dashboard/activity
//
// Full-width Activity table — moved off the main dashboard so the agent grid
// stays the focus. Linked from the dashboard footer ("Activity →").
//
// Same component (ActivitySection) the dashboard used to inline — just
// rendered on its own page. Clear-failed button still works (uses the same
// Server Action).
import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Agent, AgentRun, Company } from "@/lib/supabase/types";
import { ActivitySection, joinActivity } from "@/components/ActivitySection";

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: { company?: string };
}) {
  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-2xl p-10 text-center">
        <h1 className="t-h2 mb-2">Supabase not configured</h1>
        <p className="text-ink-3">
          Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
        </p>
      </main>
    );
  }

  const sb = supabaseServer();
  // Loose match for the "active company" — keeps the back-link URL coherent
  // even though Activity is global across all companies.
  const companyQuery = searchParams.company
    ? sb.from("companies").select("*").eq("id", searchParams.company).maybeSingle()
    : sb
        .from("companies")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const { data: company } = await companyQuery;
  if (!company) redirect("/");

  const [{ data: runsRows }, { data: agentsRows }, { data: companiesRows }, failedCountRes] =
    await Promise.all([
      // Activity is GLOBAL across all companies so the user sees the whole
      // scheduler picture, not just this company.
      sb
        .from("agent_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(50),
      sb.from("agents").select("*").order("name"),
      sb.from("companies").select("*"),
      sb
        .from("agent_runs")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed"),
    ]);

  const runs = (runsRows ?? []) as AgentRun[];
  const agents = (agentsRows ?? []) as Agent[];
  const companies = (companiesRows ?? []) as Company[];
  const activity = joinActivity(runs, agents, companies);
  const co = company as Company;

  return (
    <main className="min-h-screen px-4 py-6 md:px-6">
      <header className="mx-auto mb-6 flex max-w-[1500px] items-center justify-between gap-4">
        <Link
          href={`/dashboard${searchParams.company ? `?company=${searchParams.company}` : ""}`}
          className="t-eyebrow hover:text-ink"
        >
          ← Back to dashboard
        </Link>
        <span className="hidden font-mono text-[12px] text-ink-3 sm:inline">{co.url}</span>
      </header>
      <div className="mx-auto max-w-[1500px]">
        <ActivitySection runs={activity} failedCount={failedCountRes.count ?? 0} />
      </div>
    </main>
  );
}
