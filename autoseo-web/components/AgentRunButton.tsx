"use client";

// Per-agent Run button used in the drill-down pages. Hits the matching
// /api/agents/{key}/run endpoint, then router.refresh()es so the page
// re-renders with the new agent_runs row, new proposals, and updated
// dashboard counts (when navigating back).
//
// Coming-soon agents render the button disabled with "Coming soon" text.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";

type RunEndpoint = {
  path: string;
  label: string;
  runningLabel: string;
};

// Per-agent button copy + endpoint. Adding a new agent? One line here.
const RUN_ENDPOINTS: Record<string, RunEndpoint> = {
  seo: {
    path: "/api/agents/seo/run",
    label: "Run SEO audit",
    runningLabel: "Auditing…",
  },
  geo: {
    path: "/api/agents/geo/run",
    label: "Run GEO check",
    runningLabel: "Checking…",
  },
  blog: {
    path: "/api/agents/blog/run",
    label: "Generate blog draft",
    runningLabel: "Drafting…",
  },
  coding: {
    path: "/api/agents/coding/run",
    label: "Process pending handoffs",
    runningLabel: "Processing…",
  },
};

export function AgentRunButton({
  agentKey,
  companyId,
  liveStatus,
}: {
  agentKey: string;
  companyId: string;
  // 'live' or 'coming_soon' — drives the disabled state without us having to
  // hard-code the agent list here.
  liveStatus: "live" | "coming_soon";
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const endpoint = RUN_ENDPOINTS[agentKey];
  if (!endpoint) return null;
  if (liveStatus !== "live") {
    return (
      <button type="button" disabled className="btn px-3 py-1.5 text-[12px] opacity-60">
        Coming soon
      </button>
    );
  }

  async function onClick() {
    if (running) return;
    setRunning(true);
    setMsg(null);
    try {
      const res = await fetch(endpoint.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        proposals?: unknown[];
        synthesized?: number;
        processed?: number;
        failure?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);

      // Build a short status message depending on which endpoint replied.
      const parts: string[] = [];
      if (typeof j.synthesized === "number") {
        parts.push(`${j.synthesized}/${j.processed ?? 0} synthesized`);
      } else if (Array.isArray(j.proposals)) {
        parts.push(`${j.proposals.length} proposal${j.proposals.length === 1 ? "" : "s"}`);
      }
      if (j.failure) parts.push(j.failure);
      setMsg(parts.join(" · ") || "Done");
      startTransition(() => router.refresh());
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className="font-mono text-[11px] text-ink-3" aria-live="polite">
          {msg}
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={running}
        className="btn btn-primary px-3 py-1.5 text-[12px] disabled:opacity-60"
      >
        {running ? (
          <>
            <Loader2 size={14} className="animate-spin" aria-hidden />
            {endpoint.runningLabel}
          </>
        ) : (
          <>
            <Play size={14} aria-hidden />
            {endpoint.label}
          </>
        )}
      </button>
    </div>
  );
}
