// Full-width Activity section under the 4-column dashboard grid. Server-
// rendered — the parent passes already-fetched runs in to keep the query
// surface in one place (the dashboard page).
//
// Shows the most recent agent invocations across all companies so the user
// can audit "what did the autonomous swarm do while I was away".
import type { AgentRun, Agent, Company } from "@/lib/supabase/types";

export type ActivityRow = AgentRun & {
  // Joined locally by the dashboard page from the agents + companies it
  // already loads, to avoid a second round-trip for FK names.
  agent_name: string;
  company_name: string;
};

export function ActivitySection({
  runs,
}: {
  runs: ActivityRow[];
}) {
  return (
    <section className="panel mt-4 lg:col-span-4">
      <div className="panel-header">
        <span>Activity</span>
        <span className="font-mono text-[11px] text-ink-3">
          last {runs.length} run{runs.length === 1 ? "" : "s"}
        </span>
      </div>
      {runs.length === 0 ? (
        <p className="p-5 text-[13px] text-ink-3">
          No agent runs yet. Click <span className="font-mono">Run all
          agents now</span> in the header, or enable the local scheduler with
          <span className="font-mono"> ENABLE_LOCAL_SCHEDULER=true</span>.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-3">
                <th className="px-5 py-2 font-medium">Agent</th>
                <th className="px-5 py-2 font-medium">Company</th>
                <th className="px-5 py-2 font-medium">Started</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Proposals</th>
                <th className="px-5 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2 font-medium text-ink">{r.agent_name}</td>
                  <td className="px-5 py-2 text-ink-2">{r.company_name}</td>
                  <td className="px-5 py-2 font-mono text-[12px] text-ink-3">
                    {relativeTime(r.started_at)}
                  </td>
                  <td className="px-5 py-2">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-5 py-2 font-mono text-[12px] text-ink-2">
                    {r.status === "done" ? r.proposals_created : "—"}
                  </td>
                  <td
                    className="max-w-[420px] truncate px-5 py-2 text-[12px] text-warn"
                    title={r.error ?? undefined}
                  >
                    {r.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusChip({ status }: { status: AgentRun["status"] }) {
  if (status === "done") return <span className="chip chip-live">done</span>;
  if (status === "failed") return <span className="chip text-warn">failed</span>;
  return <span className="chip chip-soon">running</span>;
}

// Join helper — the dashboard already loads agents + the active company, so
// it can hydrate run rows with their human names without an extra query.
export function joinActivity(
  runs: AgentRun[],
  agents: Agent[],
  companies: Company[],
): ActivityRow[] {
  const agentByKey = new Map(agents.map((a) => [a.key, a]));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  return runs.map((r) => ({
    ...r,
    agent_name: agentByKey.get(r.agent_key)?.name ?? r.agent_key,
    company_name: companyById.get(r.company_id)?.name ?? r.company_id,
  }));
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
