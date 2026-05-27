"use client";

// Third panel — the Actions Feed. Groups pending proposals by agent and lets
// the user Approve/Reject. For most proposal types Approve is a status flip;
// for `blog_post` the approval handler also publishes via the CMS connector
// and the row transitions to `published` (or `publish_failed` — retryable).
//
// "Current / Archived" toggles the filter between status=pending (+ retryable
// publish_failed) and the rest.

import { useMemo, useState, useTransition } from "react";
import type { Agent, CompanyPlatform, Proposal } from "@/lib/supabase/types";
import { markdownToBasicHtml } from "@/lib/connectors/markdown";

const AGENT_ORDER = [
  "seo",
  "geo",
  "blog",
  "coding",
  "reddit",
  "x",
  "linkedin",
  "hn",
  "writer",
  "ugc",
];

export function ActionsFeed({
  companyId,
  initialProposals,
  agents,
  companyPlatform,
}: {
  companyId: string;
  initialProposals: Proposal[];
  agents: Agent[];
  // Drives the manual-copy fallback in the blog-post card: when the platform
  // is 'unknown', approving doesn't publish — it just records intent and the
  // UI surfaces Copy-markdown / Copy-HTML buttons.
  companyPlatform: CompanyPlatform;
}) {
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals);
  const [tab, setTab] = useState<"current" | "archived">("current");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = useMemo(
    () =>
      proposals.filter((p) => {
        const isCurrent = p.status === "pending" || p.status === "publish_failed";
        return tab === "current" ? isCurrent : !isCurrent;
      }),
    [proposals, tab],
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
    const prev = proposals.find((p) => p.id === id);
    if (!prev) return;
    // Optimistic. blog_post approval has its own server-side outcome (published
    // vs publish_failed), so we don't pretend to know — leave at 'pending'
    // visually until the response lands. Reject is always a clean flip.
    if (decision === "rejected") {
      setProposals((cur) =>
        cur.map((p) =>
          p.id === id
            ? { ...p, status: "rejected", decided_at: new Date().toISOString() }
            : p,
        ),
      );
    }
    startTransition(async () => {
      const res = await fetch(`/api/proposals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        proposal?: Proposal;
        error?: string;
      };
      if (j.proposal) {
        setProposals((cur) => cur.map((p) => (p.id === id ? j.proposal! : p)));
      } else if (!res.ok) {
        // Roll back optimistic reject.
        setProposals((cur) => cur.map((p) => (p.id === id ? prev : p)));
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
        {runError && <p className="mt-2 text-[12px] text-warn">{runError}</p>}
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
                      companyPlatform={companyPlatform}
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
  companyPlatform,
}: {
  proposal: Proposal;
  onDecide: (d: "approved" | "rejected") => void;
  archivable: boolean;
  companyPlatform: CompanyPlatform;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isBlog = proposal.type === "blog_post";
  const isActionable =
    !archivable && (proposal.status === "pending" || proposal.status === "publish_failed");
  // Manual-mode = a blog_post that the user approved but no auto-publisher
  // existed for. Status `approved` + no publish_url is the discriminator.
  const isManualMode =
    isBlog && proposal.status === "approved" && !proposal.publish_url;

  return (
    <li className="rounded-md border border-line bg-card-2 p-3">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="flex flex-1 items-center gap-2">
          <div className="text-[13px] font-medium text-ink">{proposal.title}</div>
          {isBlog && <PlatformChip platform={companyPlatform} />}
        </div>
        <StatusChip status={proposal.status} />
      </div>
      {proposal.summary && (
        <p className="mb-2 whitespace-pre-line text-[12px] leading-[1.5] text-ink-3">
          {proposal.summary}
        </p>
      )}

      {isBlog && (
        <BlogPreview
          proposal={proposal}
          open={previewOpen}
          onToggle={() => setPreviewOpen((v) => !v)}
        />
      )}

      {proposal.status === "published" && proposal.publish_url && (
        <a
          href={proposal.publish_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex text-[12px] font-medium text-ok hover:underline"
        >
          View live →
        </a>
      )}
      {proposal.status === "publish_failed" && proposal.publish_error && (
        <p className="mt-2 break-words text-[12px] text-warn">
          Publish failed: {proposal.publish_error}
        </p>
      )}

      {isManualMode && <ManualCopyActions proposal={proposal} />}

      {isActionable && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary px-3 py-1.5 text-[12px]"
            onClick={() => onDecide("approved")}
          >
            {proposal.status === "publish_failed"
              ? "Retry publish"
              : isBlog && companyPlatform === "unknown"
              ? "Approve (manual copy)"
              : "Approve"}
          </button>
          {proposal.status === "pending" && (
            <button
              type="button"
              className="btn px-3 py-1.5 text-[12px]"
              onClick={() => onDecide("rejected")}
            >
              Reject
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function PlatformChip({ platform }: { platform: CompanyPlatform }) {
  const map: Record<CompanyPlatform, { cls: string; label: string }> = {
    shopify: { cls: "chip", label: "shopify" },
    wordpress: { cls: "chip", label: "wordpress" },
    unknown: { cls: "chip chip-soon", label: "manual" },
  };
  const m = map[platform];
  return <span className={`${m.cls} font-mono !text-[10px]`}>{m.label}</span>;
}

function ManualCopyActions({ proposal }: { proposal: Proposal }) {
  const [copied, setCopied] = useState<null | "md" | "html">(null);
  const payload = proposal.payload as { body_md?: string };
  const md = payload.body_md ?? "";

  async function copy(kind: "md" | "html") {
    const text = kind === "md" ? md : markdownToBasicHtml(md);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-line bg-card p-3">
      <p className="mb-2 text-[12px] leading-[1.5] text-ink-2">
        Your platform isn&apos;t auto-publish yet — paste this into your site.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => copy("md")}
          className="btn px-3 py-1.5 text-[12px]"
        >
          {copied === "md" ? "Copied ✓" : "Copy markdown"}
        </button>
        <button
          type="button"
          onClick={() => copy("html")}
          className="btn px-3 py-1.5 text-[12px]"
        >
          {copied === "html" ? "Copied ✓" : "Copy HTML"}
        </button>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: Proposal["status"] }) {
  if (status === "pending") return null;
  const map: Record<Proposal["status"], { cls: string; label: string }> = {
    pending: { cls: "chip", label: "pending" },
    approved: { cls: "chip chip-live", label: "approved" },
    rejected: { cls: "chip chip-soon", label: "rejected" },
    archived: { cls: "chip chip-soon", label: "archived" },
    published: { cls: "chip chip-live", label: "published" },
    publish_failed: { cls: "chip text-warn", label: "publish failed" },
  };
  const m = map[status];
  return <span className={m.cls}>{m.label}</span>;
}

function BlogPreview({
  proposal,
  open,
  onToggle,
}: {
  proposal: Proposal;
  open: boolean;
  onToggle: () => void;
}) {
  const payload = proposal.payload as {
    meta_description?: string;
    body_md?: string;
    target_keyword?: string;
    slug?: string;
    self_check?: { passed?: boolean; issues?: string[]; metrics?: Record<string, unknown> };
    internal_links?: Array<{ anchor: string; target_path: string; reason?: string }>;
  };
  const excerpt = (payload.body_md ?? "").slice(0, 600);
  const hasMore = (payload.body_md ?? "").length > 600;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="text-[11px] font-medium uppercase tracking-wider text-ink-3 hover:text-ink"
      >
        {open ? "Hide preview ▴" : "Preview draft ▾"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-line bg-card p-3 text-[12px] text-ink-2">
          {payload.target_keyword && (
            <div>
              <span className="t-eyebrow">Target keyword</span>
              <div className="mt-1 font-mono text-[12px]">{payload.target_keyword}</div>
            </div>
          )}
          {payload.slug && (
            <div>
              <span className="t-eyebrow">Slug</span>
              <div className="mt-1 font-mono text-[12px]">/{payload.slug}</div>
            </div>
          )}
          {payload.meta_description && (
            <div>
              <span className="t-eyebrow">Meta description</span>
              <p className="mt-1 italic">{payload.meta_description}</p>
            </div>
          )}
          {excerpt && (
            <div>
              <span className="t-eyebrow">Body (first 600 chars)</span>
              <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-[12px] leading-[1.55]">
                {excerpt}
                {hasMore ? "\n\n…" : ""}
              </pre>
            </div>
          )}
          {payload.self_check && (
            <div>
              <span className="t-eyebrow">Self-check</span>
              <p className="mt-1">
                {payload.self_check.passed ? "Passed all checks." : null}
                {payload.self_check.issues?.length
                  ? `${payload.self_check.issues.length} issue(s): ${payload.self_check.issues.join("; ")}`
                  : null}
              </p>
            </div>
          )}
          {payload.internal_links?.length ? (
            <div>
              <span className="t-eyebrow">Internal link suggestions</span>
              <ul className="mt-1 list-disc pl-5">
                {payload.internal_links.map((l, i) => (
                  <li key={i}>
                    <span className="font-mono">{l.target_path}</span> — {l.anchor}
                    {l.reason ? <span className="text-ink-3"> ({l.reason})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
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
    (a, b) => AGENT_ORDER.indexOf(a[0]) - AGENT_ORDER.indexOf(b[0]),
  );
  return ordered.map(([key, items]) => ({
    agent: agentLookup.get(key) ?? ({ key, name: key.toUpperCase() } as Agent),
    items,
  }));
}
