// Dashboard agent card — one per agent in the live grid + coming-soon row.
//
// Distinct from `AgentCard` in components/AgentCard.tsx which is the static
// marketing card on the public landing page. This one adds:
//   • pendingCount (proposals where agent_key=K, status='pending')
//   • lastRunAt    (max(agent_runs.finished_at) where status='done')
//   • drill-down navigation for `live` agents (/dashboard/agents/{key})
//
// The two coexist intentionally — the landing card emphasises identity, the
// dashboard card emphasises queue depth.
import type { LucideIcon } from "lucide-react";
import {
  Search,
  Globe,
  PenLine,
  Code2,
  Briefcase,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  Network,
  Video,
  Sparkles,
} from "lucide-react";
import type { Agent } from "@/lib/supabase/types";

// Per-agent display config. Keys must match the `agents.key` column.
const AGENT_CONFIG: Record<
  string,
  { icon: LucideIcon; pendingNoun: string }
> = {
  seo: { icon: Search, pendingNoun: "recommendations" },
  geo: { icon: Globe, pendingNoun: "recommendations" },
  blog: { icon: PenLine, pendingNoun: "drafts" },
  // Coding card has two stages — handoffs waiting + PRs ready. The primary
  // count is the handoff queue ("items waiting"); the secondary count for
  // "PRs ready to open" is passed in via the optional `secondary` prop.
  coding: { icon: Code2, pendingNoun: "items waiting for Coding" },
  linkedin: { icon: Briefcase, pendingNoun: "drafts" },
  x: { icon: MessageCircle, pendingNoun: "drafts" },
  reddit: { icon: MessagesSquare, pendingNoun: "drafts" },
  hn: { icon: Network, pendingNoun: "drafts" },
  writer: { icon: Newspaper, pendingNoun: "drafts" },
  ugc: { icon: Video, pendingNoun: "drafts" },
};

const FALLBACK_ICON: LucideIcon = Sparkles;

export function DashboardAgentCard({
  agent,
  pendingCount,
  lastRunAt,
  href,
  secondary,
}: {
  agent: Agent;
  pendingCount: number;
  lastRunAt: string | null;
  // Drill-down href for live agents. Omitted for coming_soon (rendered dim).
  href?: string;
  // Optional second-line count, used by the Coding card to show
  // "N items waiting for Coding" alongside its primary "M PRs ready to open".
  // When omitted, only the primary line renders.
  secondary?: { count: number; noun: string };
}) {
  const cfg = AGENT_CONFIG[agent.key] ?? { icon: FALLBACK_ICON, pendingNoun: "items" };
  const Icon = cfg.icon;
  const isLive = agent.status === "live";

  const body = (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-ink-2" aria-hidden />
          <span className="text-[13px] font-semibold text-ink">{agent.name}</span>
        </div>
        <span className={isLive ? "chip chip-live" : "chip chip-soon"}>
          {isLive ? "live" : "soon"}
        </span>
      </div>
      {agent.description && (
        <p className="mb-3 line-clamp-2 text-[12px] leading-[1.4] text-ink-3">
          {agent.description}
        </p>
      )}
      <div className="mt-auto flex items-baseline gap-2">
        <span className="text-[28px] font-semibold text-ink">
          {isLive ? pendingCount : "—"}
        </span>
        <span className="text-[12px] text-ink-3">
          {isLive ? cfg.pendingNoun : "coming soon"}
        </span>
      </div>
      {isLive && secondary && (
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[15px] font-medium text-ink-2">
            {secondary.count}
          </span>
          <span className="text-[12px] text-ink-3">{secondary.noun}</span>
        </div>
      )}
      {isLive && (
        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3">
          <span>
            Last run: <span className="font-mono">{lastRunAt ? relativeTime(lastRunAt) : "—"}</span>
          </span>
          <span aria-hidden>→</span>
        </div>
      )}
    </div>
  );

  if (!isLive || !href) {
    return (
      <div
        className="panel block h-full cursor-not-allowed opacity-60"
        aria-disabled="true"
      >
        {body}
      </div>
    );
  }

  return (
    <a
      href={href}
      className="panel block h-full transition hover:border-ink/30 hover:shadow-elev-3"
      aria-label={`${agent.name}: ${pendingCount} ${cfg.pendingNoun}`}
    >
      {body}
    </a>
  );
}

// Local copy of the relative-time helper so we don't make a one-helper utils
// module just yet. Mirrors ActivitySection.tsx for visual consistency.
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
