// Landing page. Server component: lists agents straight from Supabase. The
// URL input posts to /api/onboard which redirects to /dashboard.
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Agent } from "@/lib/supabase/types";
import { OnboardForm } from "@/components/OnboardForm";

export const dynamic = "force-dynamic";

async function fetchAgents(): Promise<Agent[]> {
  if (!hasSupabaseEnv()) return [];
  const { data, error } = await supabaseServer()
    .from("agents")
    .select("*")
    .order("status", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.warn("[landing] agents fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as Agent[];
}

export default async function LandingPage() {
  const agents = await fetchAgents();
  const live = agents.filter((a) => a.status === "live");
  const soon = agents.filter((a) => a.status === "coming_soon");

  return (
    <main className="min-h-screen px-6 pb-24 pt-16 md:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex items-center justify-between">
          <div className="t-eyebrow">AutoSEO.live</div>
          <a href="/dashboard" className="btn">
            Open dashboard
          </a>
        </header>

        <section className="mb-12 text-center">
          <p className="t-eyebrow mb-4">New — GEO Agent · Citations on AI engines</p>
          <h1 className="t-display mb-6">
            Meet AutoSEO,<br />the autonomous CMO
          </h1>
          <p className="mx-auto max-w-xl text-[17px] leading-[1.5] text-ink-2">
            One agent stack that audits your site, drafts the fixes, and keeps
            optimizing across Google and every AI answer engine.
          </p>

          <div className="mx-auto mt-8 max-w-xl">
            <OnboardForm />
            <p className="mt-3 text-[12px] text-ink-3">
              Free to start · No credit card required
            </p>
          </div>
        </section>

        {agents.length === 0 ? (
          <ConnectSupabaseHint />
        ) : (
          <>
            <p className="t-eyebrow mb-4 text-center">
              {live.length} live · {soon.length} coming soon
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...live, ...soon].map((a) => (
                <AgentCard key={a.id} agent={a} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const isLive = agent.status === "live";
  return (
    <div className="panel p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-ink">{agent.name}</h3>
        <span className={isLive ? "chip chip-live" : "chip chip-soon"}>
          {isLive ? "Live" : "Soon"}
        </span>
      </div>
      <p className="text-[13px] leading-[1.5] text-ink-3">
        {agent.description || "—"}
      </p>
    </div>
  );
}

function ConnectSupabaseHint() {
  return (
    <div className="panel mx-auto max-w-2xl p-6 text-center">
      <h3 className="t-h2 mb-2">Connect Supabase to see the agent catalog</h3>
      <p className="text-[14px] text-ink-3">
        Set <code className="font-mono text-[12px]">SUPABASE_URL</code> and{" "}
        <code className="font-mono text-[12px]">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
        in <code className="font-mono text-[12px]">.env.local</code>, then run the
        SQL in <code className="font-mono text-[12px]">supabase/migrations/0001_init.sql</code>.
      </p>
    </div>
  );
}
