"use client";

// The "Pending fix synthesis" section on the Coding drill-down. One row per
// handed-off-but-not-yet-synthesized proposal. Each row shows the source
// agent, the original title + previous "couldn't synthesize" reason if
// any, and lets the user Cancel the handoff (clears handed_off_to_coding).
//
// "Synthesize now" is intentionally NOT a per-row button — the Coding
// runner processes the whole queue in one pass (it handles per-handoff
// error isolation internally). The page header's "Process pending handoffs"
// button covers that.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Proposal } from "@/lib/supabase/types";

export function CodingHandoffQueue({
  handoffs,
}: {
  handoffs: Proposal[];
}) {
  const router = useRouter();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function cancelHandoff(id: string) {
    setErr(null);
    setPendingIds((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/proposals/${id}/cancel-handoff`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setPendingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  if (!handoffs.length) {
    return (
      <p className="p-5 text-[13px] text-ink-3">
        No pending handoffs. When you approve an SEO finding, GEO gap, or blog
        draft, it shows up here for the Coding Agent to synthesize into a PR.
      </p>
    );
  }

  return (
    <div className="space-y-2 p-5">
      {err && <p className="text-[12px] text-warn">{err}</p>}
      <ul className="space-y-2">
        {handoffs.map((h) => (
          <li
            key={h.id}
            className="rounded-md border border-line bg-card-2 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink">{h.title}</div>
                {h.summary && (
                  <p className="mt-1 text-[12px] leading-[1.45] text-ink-3">
                    {h.summary}
                  </p>
                )}
                {/* Source breadcrumb — instantly tells the reviewer which
                    SEO/GEO/Blog finding this synthesis is for, without having
                    to dig into the payload. Data comes from the proposal row
                    itself (agent_key + title) — no extra queries. */}
                <p className="mt-2 text-[11px] text-ink-3">
                  Source: {sourceAgentLabel(h.agent_key)} · {sourceTypeLabel(h.type)} — &ldquo;
                  {truncate(h.title, 80)}&rdquo;
                </p>
                {h.publish_error && (
                  <p className="mt-2 break-words rounded border border-line bg-card p-2 text-[12px] text-warn">
                    Couldn&apos;t synthesize: {h.publish_error}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={pendingIds.has(h.id)}
                onClick={() => cancelHandoff(h.id)}
                className="btn px-3 py-1.5 text-[12px] disabled:opacity-50"
                title="Remove from Coding's queue. The proposal stays approved but won't get a PR."
              >
                {pendingIds.has(h.id) ? "Canceling…" : "Cancel handoff"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-ink-3">
        Press <span className="font-mono">Process pending handoffs</span> at the
        top to synthesize these into Pull Requests for your approval.
      </p>
    </div>
  );
}

function sourceAgentLabel(agentKey: string): string {
  switch (agentKey) {
    case "seo":
      return "SEO Agent";
    case "geo":
      return "GEO Agent";
    case "blog":
      return "Blog Agent";
    case "coding":
      return "Coding Agent";
    default:
      return agentKey;
  }
}

function sourceTypeLabel(type: string): string {
  switch (type) {
    case "issue_critical":
      return "critical finding";
    case "issue_high":
      return "high-priority finding";
    case "geo_gap":
      return "citable gap";
    case "blog_post":
      return "blog draft";
    default:
      return type;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
