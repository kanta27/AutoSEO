"use client";

// Third panel — the Actions Feed. Groups pending proposals by agent and lets
// the user Approve/Reject (status flip only this session; real publish is a
// later session). "Current / Archived" toggles the filter between
// status=pending and status in (approved, rejected, archived).

import { useMemo, useState, useTransition } from "react";
import type { Agent, Proposal } from "@/lib/supabase/types";

const AGENT_ORDER = ["seo", "geo", "coding", "reddit", "x", "linkedin", "hn", "writer", "ugc"];

export function ActionsFeed({
  companyId,
  initialProposals,
  agents,
}: {
  companyId: string;
  initialProposals: Proposal[];
  agents: Agent[];
}) {
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals);
  const [tab, setTab] = useState<"current" | "archived">("current");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = useMemo(
    () =>
      proposals.filter((p) =>
        tab === "current" ? p.status === "pending" : p.status !== "pending"
      ),
    [proposals, tab]
  );

  const grouped = useMemo(() => groupByAgent(visible, agents), [visible, agents]);

  async function runSeo() {
    setRunError(null);
    setRunning(true);
    try {
      const res = await fetch("/api/agents/seo/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const j = (await res.json()) as { proposals?: Proposal[]; error?: string };
      if (!res.ok) throw new Error(j.error || `Run failed (${res.status})`);
      if (j.proposals?.length) {
        setProposals((cur) => [...j.proposals!, ...cur]);
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function decide(id: string, decision: "approved" | "rejected") {
    // optimistic
    setProposals((cur) =>
      cur.map((p) =>
        p.id === id
          ? { ...p, status: decision, decided_at: new Date().toISOString() }
          : p
      )
    );
    startTransition(async () => {
      const res = await fetch(`/api/proposals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        // revert if the API rejected the change
        setProposals((cur) =>
          cur.map((p) =>
            p.id === id ? { ...p, status: "pending", decided_at: null } : p
          )
        );
      }
    });
  }

  return (
    <section className="panel flex flex-col">
      <div className="panel-header">
        <span>Actions Feed</span>
        <div className="flex items-center gap-1 text-[11px]">
          {(["current", "archived"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "rounded-full px-2.5 py-1 font-medium " +
                (tab === t ? "bg-ink text-white" : "text-ink-3 hover:text-ink")
              }
            >
              {t === "current" ? "Current" : "Archived"}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-line p-4">
        <button
          type="button"
          onClick={runSeo}
          disabled={running}
          className="btn btn-primary w-full disabled:opacity-50"
        >
          {running ? "Running SEO + GEO…" : "Run SEO + GEO audit"}
        </button>
        {runError && (
          <p className="mt-2 text-[12px] text-warn">{runError}</p>
        )}
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-4">
        {visible.length === 0 ? (
          <p className="text-[13px] text-ink-3">
            {tab === "current"
              ? "Nothing pending. Run an agent to populate."
              : "No archived items yet."}
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.map(({ agent, items }) => (
              <div key={agent.key}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="t-eyebrow">{agent.name}</span>
                  <span className="font-mono text-[11px] text-ink-3">
                    {items.length}
                  </span>
                </div>
                <ul className="space-y-2">
                  {items.map((p) => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      onDecide={(d) => decide(p.id, d)}
                      archivable={tab === "archived"}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ProposalCard({
  proposal,
  onDecide,
  archivable,
}: {
  proposal: Proposal;
  onDecide: (d: "approved" | "rejected") => void;
  archivable: boolean;
}) {
  return (
    <li className="rounded-md border border-line bg-card-2 p-3">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-ink">{proposal.title}</div>
        {proposal.status !== "pending" && (
          <span
            className={
              "chip " +
              (proposal.status === "approved"
                ? "chip-live"
                : proposal.status === "rejected"
                ? "chip-soon"
                : "")
            }
          >
            {proposal.status}
          </span>
        )}
      </div>
      {proposal.summary && (
        <p className="mb-2 text-[12px] leading-[1.5] text-ink-3">
          {proposal.summary}
        </p>
      )}
      {!archivable && proposal.status === "pending" && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary px-3 py-1.5 text-[12px]"
            onClick={() => onDecide("approved")}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn px-3 py-1.5 text-[12px]"
            onClick={() => onDecide("rejected")}
          >
            Reject
          </button>
        </div>
      )}
    </li>
  );
}

function groupByAgent(items: Proposal[], agents: Agent[]) {
  const byKey = new Map<string, Proposal[]>();
  for (const it of items) {
    const arr = byKey.get(it.agent_key) ?? [];
    arr.push(it);
    byKey.set(it.agent_key, arr);
  }
  const agentLookup = new Map(agents.map((a) => [a.key, a]));
  const ordered = [...byKey.entries()].sort(
    (a, b) => AGENT_ORDER.indexOf(a[0]) - AGENT_ORDER.indexOf(b[0])
  );
  return ordered.map(([key, items]) => ({
    agent: agentLookup.get(key) ?? ({ key, name: key.toUpperCase() } as Agent),
    items,
  }));
}
