// Iconographic agent card for the landing-page grid. Reads agents from the
// Supabase catalog unchanged — this is presentation only. Live cards are
// elevated and full-color; coming-soon cards are visually desaturated but
// kept in the layout so the roadmap is legible at a glance.
import {
  Search,
  Globe,
  Code2,
  MessageSquare,
  PenLine,
  MessageCircle,
  Briefcase,
  Newspaper,
  Clapperboard,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Agent } from "@/lib/supabase/types";

// Per-agent icon + bezel tint. Tints reuse existing token swatches (lime/sky/
// rose/gold/mint/violet/accent-soft) so we don't introduce a parallel palette.
// Generic icons only — never platform brand marks, since we don't want to
// imply any third-party endorsement.
const ICONS: Record<string, { icon: LucideIcon; tint: string; ink: string }> = {
  seo:      { icon: Search,        tint: "bg-lime",        ink: "text-[#2a4513]" },
  geo:      { icon: Globe,         tint: "bg-sky",         ink: "text-[#0e3a66]" },
  coding:   { icon: Code2,         tint: "bg-violet",      ink: "text-[#3a2b66]" },
  reddit:   { icon: MessageSquare, tint: "bg-accent-soft", ink: "text-warn"      },
  writer:   { icon: PenLine,       tint: "bg-rose",        ink: "text-[#7a1f10]" },
  x:        { icon: MessageCircle, tint: "bg-bg-3",        ink: "text-ink"       },
  linkedin: { icon: Briefcase,     tint: "bg-sky",         ink: "text-[#0e3a66]" },
  hn:       { icon: Newspaper,     tint: "bg-accent-soft", ink: "text-warn"      },
  ugc:      { icon: Clapperboard,  tint: "bg-gold",        ink: "text-[#5c4a07]" },
};

const FALLBACK = { icon: Sparkles, tint: "bg-bg-3", ink: "text-ink" };

export function AgentCard({ agent }: { agent: Agent }) {
  const isLive = agent.status === "live";
  const visual = ICONS[agent.key] ?? FALLBACK;
  const Icon = visual.icon;

  return (
    <div
      className={
        "group relative flex h-full flex-col rounded-lg border p-5 transition " +
        (isLive
          ? "bg-card-2 border-line shadow-elev-1 hover:-translate-y-0.5 hover:shadow-elev-2 hover:border-line-2"
          : "bg-card border-line opacity-70")
      }
    >
      <div className="mb-4 flex items-start justify-between">
        <div
          className={
            "flex h-10 w-10 items-center justify-center rounded-md " +
            (isLive ? visual.tint : "bg-bg-2")
          }
          aria-hidden="true"
        >
          <Icon
            size={20}
            strokeWidth={1.75}
            className={isLive ? visual.ink : "text-ink-4"}
          />
        </div>
        <span className={isLive ? "chip chip-live" : "chip chip-soon"}>
          {isLive ? "Live" : "Soon"}
        </span>
      </div>
      <h3
        className={
          "mb-1 text-[15px] font-semibold leading-tight " +
          (isLive ? "text-ink" : "text-ink-3")
        }
      >
        {agent.name}
      </h3>
      <p
        className={
          "text-[13px] leading-[1.5] " + (isLive ? "text-ink-3" : "text-ink-4")
        }
      >
        {agent.description || "—"}
      </p>
    </div>
  );
}
