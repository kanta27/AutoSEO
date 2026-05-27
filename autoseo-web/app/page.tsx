// Landing page. Server component: lists agents straight from Supabase. The
// URL input posts to /api/onboard which redirects to /dashboard. All counts
// + signal lines are derived from real agent data — no faked numbers.
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Agent } from "@/lib/supabase/types";
import { OnboardForm } from "@/components/OnboardForm";
import { AgentCard } from "@/components/AgentCard";

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

  // Truthful signal line: only mention "more coming" when there actually are
  // coming-soon agents in the catalog.
  const signal =
    live.length > 0
      ? `${live.length} agent${live.length === 1 ? "" : "s"} live` +
        (soon.length ? ` · ${soon.length} more coming` : "")
      : null;

  return (
    <main className="min-h-screen px-6 pb-24 pt-8 md:px-10 md:pt-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-12 flex items-center justify-between md:mb-16">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full bg-accent"
            />
            <span className="t-eyebrow !text-ink">AutoSEO.live</span>
          </div>
          <a href="/dashboard" className="btn text-[13px]">
            Open dashboard
          </a>
        </header>

        <section className="mb-14 text-center md:mb-20">
          {signal && <p className="t-eyebrow mb-5">{signal}</p>}
          <h1 className="t-display mx-auto mb-6 max-w-3xl">
            Meet AutoSEO,<br className="hidden sm:block" />
            <span className="italic-serif">the autonomous CMO</span>
          </h1>
          <p className="mx-auto mb-9 max-w-xl text-[17px] leading-[1.55] text-ink-2">
            One agent stack that audits your site, drafts the fixes, and keeps
            optimizing across Google and every AI answer engine.
          </p>

          <div className="mx-auto max-w-xl">
            <OnboardForm />
            <p className="mt-4 text-[12px] text-ink-3">
              Free to start · No credit card required
            </p>
          </div>
        </section>

        {agents.length === 0 ? (
          <ConnectSupabaseHint />
        ) : (
          <section aria-labelledby="agents-heading">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="t-eyebrow mb-2">The roster</p>
                <h2
                  id="agents-heading"
                  className="t-h2 max-w-xl"
                >
                  Every agent working on your growth
                </h2>
              </div>
              <p className="hidden max-w-[260px] text-right text-[13px] leading-[1.5] text-ink-3 md:block">
                Drafts every move and routes it to your Actions Feed —
                you approve before anything ships.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...live, ...soon].map((a) => (
                <AgentCard key={a.id} agent={a} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function ConnectSupabaseHint() {
  return (
    <div className="panel mx-auto max-w-2xl p-7 text-center">
      <h3 className="t-h2 mb-2">Connect Supabase to see the agent catalog</h3>
      <p className="text-[14px] leading-[1.55] text-ink-3">
        Set <code className="font-mono text-[12px]">SUPABASE_URL</code> and{" "}
        <code className="font-mono text-[12px]">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
        in <code className="font-mono text-[12px]">.env.local</code>, then run the
        SQL in{" "}
        <code className="font-mono text-[12px]">
          supabase/migrations/0001_init.sql
        </code>
        .
      </p>
    </div>
  );
}
