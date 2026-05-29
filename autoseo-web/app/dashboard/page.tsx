// Dashboard — agent-centric layout per the user's sketch.
//
// Top strip:    Company (now hosts competitors)  |  Graphs   (2 columns)
// PageSpeed:    Full-width PageSpeedPanel (Mobile + Desktop + CWV)
// Live row:     SEO   |  GEO   |  Blog   |  Coding    (4 cards)
// Bottom row:   LinkedIn / X (coming-soon, 2 cards)   |   AI CMO chat (compact)
//
// Session 2 (rich Company panel) moved competitors INTO CompanyPanel, so the
// top strip went from three columns to two; Graphs gets the freed width.
// All actions remain human-gated — every agent card drills into the existing
// ActionsFeed with the same Approve/Reject/Open-PR/Copy-markdown handlers.
import { redirect } from "next/navigation";
import Link from "next/link";
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
import { GraphsPanel } from "@/components/GraphsPanel";
// Standalone CompetitorsPanel retired in Session 2 — competitors now live
// inside CompanyPanel. The file is left in the tree for one release in case
// any other route imports it.
import { DashboardAgentCard } from "@/components/DashboardAgentCard";
import { ChatPanel } from "@/components/ChatPanel";
import { RunAllButton } from "@/components/RunAllButton";
import {
  PageSpeedPanel,
  type PageSpeedClientResult,
} from "@/components/PageSpeedPanel";

export const dynamic = "force-dynamic";

// Agents we explicitly want on the dashboard's live row. Listed in display
// order. Any other live agents in the catalog still get shown — they're
// appended to this row after the named four.
const PRIMARY_LIVE_KEYS = ["seo", "geo", "blog", "coding"] as const;
// Coming-soon agents featured in the bottom row (left of the chat). Per the
// sketch, LinkedIn + X. Other coming-soon agents are intentionally NOT
// surfaced on the main dashboard this session — they sit behind a future
// "All agents" page.
const FEATURED_SOON_KEYS = ["linkedin", "x"] as const;

type DashboardData = {
  company: Company;
  documents: CompanyDocument[];
  // Slim subset — we only need type + agent_key + status for counts, plus
  // the audit_summary row(s) for the Graphs panel. Pulling all proposals so
  // GraphsPanel and the count-tally share one query.
  proposals: Proposal[];
  agents: Agent[];
  // Per-agent last successful run timestamp. Indexed by agent_key.
  lastRunByAgent: Record<string, string | null>;
  // PageSpeed cache snapshot for the company URL. NULL when no row exists
  // OR when the row is older than the cache TTL (6h) — in both cases the
  // PageSpeedPanel triggers a fresh fetch on mount. We deliberately never
  // call PSI from SSR: the call is 15-30s and would block the dashboard.
  pagespeed: PageSpeedClientResult | null;
};

// Six hours, same TTL as lib/engines/pagespeed.ts. Duplicated to keep this
// file decoupled from the engine module (which is "server-only" — fine here,
// but we'd rather not import server-only into the data-loader path more
// than necessary).
const PAGESPEED_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function loadDashboard(companyId?: string): Promise<DashboardData | null> {
  if (!hasSupabaseEnv()) return null;
  const sb = supabaseServer();

  const companyQuery = companyId
    ? sb.from("companies").select("*").eq("id", companyId).maybeSingle()
    : sb
        .from("companies")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const { data: company } = await companyQuery;
  if (!company) return null;
  const co = company as Company;

  const normalizedCompanyUrl = normalizePsiUrl(co.url);

  const [docsRes, propsRes, agentsRes, runsRes, psRes] = await Promise.all([
    sb
      .from("documents")
      .select("*")
      .eq("company_id", co.id)
      .order("created_at", { ascending: true }),
    // Full rows so GraphsPanel can read the audit_summary payload + the
    // count tally can group by agent_key. The 200-row cap matches the
    // previous dashboard query so memory stays bounded.
    sb
      .from("proposals")
      .select("*")
      .eq("company_id", co.id)
      .order("created_at", { ascending: false })
      .limit(200),
    sb.from("agents").select("*").order("name"),
    // Per-agent last `done` run. Pulled wide enough that the most recent
    // success for each agent_key is in the slice — 100 rows covers months
    // even with the daily cadence.
    sb
      .from("agent_runs")
      .select("agent_key, finished_at, status")
      .eq("company_id", co.id)
      .eq("status", "done")
      .order("finished_at", { ascending: false })
      .limit(100),
    // PSI cache row, by exact URL match. If the row is missing or stale, we
    // pass null and the client component does the slow fetch on mount.
    sb
      .from("pagespeed_cache")
      .select("result, fetched_at")
      .eq("url", normalizedCompanyUrl)
      .maybeSingle(),
  ]);

  // In-memory group-by — cheaper than N count queries and runs once per
  // dashboard load.
  const lastRunByAgent: Record<string, string | null> = {};
  for (const r of (runsRes.data ?? []) as Array<Pick<AgentRun, "agent_key" | "finished_at">>) {
    if (!r.finished_at) continue;
    if (!lastRunByAgent[r.agent_key]) lastRunByAgent[r.agent_key] = r.finished_at;
  }

  // PSI cache priming. We only pass `initialResult` when the cached row is
  // still fresh — otherwise the client kicks off /api/pagespeed itself and
  // shows the loading spinner. The PSI engine's own write path is the source
  // of truth for the row shape; we just trust it here.
  const psRow = psRes.data as
    | { result: PageSpeedClientResult; fetched_at: string }
    | null;
  let pagespeed: PageSpeedClientResult | null = null;
  if (psRow?.result && psRow.fetched_at) {
    const age = Date.now() - new Date(psRow.fetched_at).getTime();
    if (age < PAGESPEED_CACHE_TTL_MS) {
      pagespeed = { ...psRow.result, fromCache: true };
    }
  }

  return {
    company: co,
    documents: (docsRes.data ?? []) as CompanyDocument[],
    proposals: (propsRes.data ?? []) as Proposal[],
    agents: (agentsRes.data ?? []) as Agent[],
    lastRunByAgent,
    pagespeed,
  };
}

// Match the normalisation lib/engines/pagespeed.ts uses so the cache key
// lookup is exact. (The engine prefixes https, strips trailing slash; we
// can't import its server-only normaliser from this loader without dragging
// the whole module in, so we duplicate the small bit of logic.)
function normalizePsiUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
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

  // Pending-count per agent — single in-memory tally over the proposals slice.
  // The Coding card uses a special two-stage display: the primary count is
  // the handoff queue ("items waiting"), the secondary count is the
  // synthesized code_change pile ("PRs ready to open"). For every OTHER
  // agent, the primary count is just "pending proposals for this agent_key".
  const pendingByAgent: Record<string, number> = {};
  let codingHandoffsWaiting = 0;
  let codingPRsReady = 0;
  for (const p of data.proposals) {
    if (p.handed_off_to_coding && !p.handoff_synthesized_proposal_id) {
      codingHandoffsWaiting += 1;
    }
    if (p.status !== "pending") continue;
    if (p.agent_key === "coding" && p.type === "code_change") {
      codingPRsReady += 1;
    } else {
      pendingByAgent[p.agent_key] = (pendingByAgent[p.agent_key] ?? 0) + 1;
    }
  }

  // Build the four live-row cards in the order PRIMARY_LIVE_KEYS dictates,
  // then any other `live` agents that aren't already in the row. Coming-soon
  // cards are filtered to FEATURED_SOON_KEYS so the bottom row matches the
  // sketch (LinkedIn + X).
  const agentByKey = new Map(data.agents.map((a) => [a.key, a]));
  const liveAgents: Agent[] = [];
  for (const k of PRIMARY_LIVE_KEYS) {
    const a = agentByKey.get(k);
    if (a && a.status === "live") liveAgents.push(a);
  }
  for (const a of data.agents) {
    if (a.status === "live" && !liveAgents.includes(a)) liveAgents.push(a);
  }
  const featuredSoon: Agent[] = [];
  for (const k of FEATURED_SOON_KEYS) {
    const a = agentByKey.get(k);
    if (a) featuredSoon.push(a);
  }

  const companyParam = searchParams.company ? `?company=${searchParams.company}` : "";

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

      <div className="mx-auto max-w-[1500px] space-y-4">
        {/* Top context strip — 2 columns at md+, stacks on mobile.
            Company panel hosts the competitor grid now (Session 2). */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CompanyPanel company={data.company} documents={data.documents} />
          <GraphsPanel proposals={data.proposals} />
        </div>

        {/* PageSpeed lab data — two stacked panels (scores + CWV). Server
            pre-fills `initialResult` only when the cache is ≤6h old; the
            client fires a fresh PSI call otherwise. */}
        <PageSpeedPanel
          url={data.company.url}
          initialResult={data.pagespeed}
        />

        {/* Live agent row — 1 / 2 / 4 cards by viewport. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {liveAgents.map((a) => {
            const isCoding = a.key === "coding";
            return (
              <DashboardAgentCard
                key={a.key}
                agent={a}
                pendingCount={isCoding ? codingHandoffsWaiting : pendingByAgent[a.key] ?? 0}
                lastRunAt={data.lastRunByAgent[a.key] ?? null}
                href={`/dashboard/agents/${a.key}${companyParam}`}
                secondary={
                  isCoding
                    ? { count: codingPRsReady, noun: "PRs ready to open" }
                    : undefined
                }
              />
            );
          })}
        </div>

        {/* Bottom row — coming-soon agents (left) + compact chat (right).
            On mobile: stacks; on md+: the 2 soon-cards sit beside the chat. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {featuredSoon.map((a) => (
              <DashboardAgentCard
                key={a.key}
                agent={a}
                pendingCount={0}
                lastRunAt={null}
              />
            ))}
          </div>
          <ChatPanel
            companyId={data.company.id}
            companyName={data.company.name}
            modelLabel={`${LLM_MODEL} · ${LLM_PROVIDER}`}
            compact
          />
        </div>

        {/* Footer link to the (now-relocated) Activity table. Small, low-key. */}
        <div className="flex justify-end pt-2">
          <Link
            href={`/dashboard/activity${companyParam}`}
            className="text-[12px] text-ink-3 hover:text-ink hover:underline"
          >
            Activity →
          </Link>
        </div>
      </div>
    </main>
  );
}
