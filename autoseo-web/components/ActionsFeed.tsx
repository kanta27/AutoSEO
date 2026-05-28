"use client";

// Three-section proposal feed for the agent drill-down pages.
//
// Old shape: tabbed Current/Archived with Approve + Reject buttons.
// New shape: three always-visible sections stacked top-to-bottom.
//
//   ┌─ Action Feed   (status='pending')     → Approve button only
//   ├─ Pending Feed  (sent to Coding / CMS, → inline pill, no buttons
//   │                 publish_failed,         (Retry button for publish_failed)
//   │                 manual-mode blog)
//   └─ Complete Feed (downstream done,      → inline pill (View PR / View live)
//                     rejected/archived)
//
// Rules of the road:
//   • No Reject button anywhere. The user's flow is Approve-only; the
//     surviving dismiss path is Cancel-handoff in the Coding drill-down.
//   • The Approve button stays visible AFTER click via optimistic update
//     so the row moves Action → Pending in place.
//   • To know if a handed-off SEO/GEO/Blog row's downstream PR has actually
//     opened, the page fetches the linked code_change's status and passes
//     it in via `codeChangeLookup`. Without this, we'd miscategorise
//     "approved + handed-off + synthesized" as Pending forever.

import { useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import type { Agent, CompanyPlatform, Proposal, ProposalStatus } from "@/lib/supabase/types";
import { markdownToBasicHtml } from "@/lib/connectors/markdown";

// Linked-code_change lookup. Built by the drill-down page from the set of
// `handoff_synthesized_proposal_id` values on this agent's proposals. Used
// to decide if a handed-off SEO/GEO/Blog row's downstream work shipped.
export type CodeChangeLookup = Map<
  string,
  { status: ProposalStatus; publish_url: string | null }
>;

type Bucket = "action" | "pending" | "complete";

export function ActionsFeed({
  companyId: _companyId,
  initialProposals,
  agents: _agents,
  companyPlatform,
  codeChangeLookup,
}: {
  // Kept in the signature for backwards compat with callers — no longer
  // used inside the component (the per-agent Run button moved to the
  // drill-down page header).
  companyId: string;
  initialProposals: Proposal[];
  agents: Agent[];
  // Drives the manual-copy fallback in the blog-post card: when the platform
  // is 'unknown', approving doesn't publish — it just records intent and the
  // UI surfaces Copy-markdown / Copy-HTML buttons.
  companyPlatform: CompanyPlatform;
  // Status + publish_url for any code_change that's a downstream synthesis
  // of a row in `initialProposals`. Empty Map is fine — those rows just
  // bucket as Pending until they show up.
  codeChangeLookup?: CodeChangeLookup;
}) {
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals);
  // Transient banner shown after an approval that handed off to Coding.
  const [handoffToast, setHandoffToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Preserve ?company= when building handoff follow-up links.
  const searchParams = useSearchParams();
  const companyQs = searchParams.get("company") ?? "";

  const lookup = codeChangeLookup ?? new Map();

  // Bucket each proposal once per render. Keeps render bodies clean.
  const buckets = useMemo(() => {
    const action: Proposal[] = [];
    const pending: Proposal[] = [];
    const complete: Proposal[] = [];
    for (const p of proposals) {
      const b = bucketProposal(p, lookup);
      if (b === "action") action.push(p);
      else if (b === "pending") pending.push(p);
      else complete.push(p);
    }
    return { action, pending, complete };
  }, [proposals, lookup]);

  async function approve(id: string) {
    const prev = proposals.find((p) => p.id === id);
    if (!prev) return;
    // No optimistic flip — server's response carries the authoritative new
    // status (could be approved+handed_off, published, or publish_failed).
    // We just block the button during the round-trip via React's pending
    // state on the card (handled in ProposalCard via in-flight set).
    startTransition(async () => {
      const res = await fetch(`/api/proposals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        proposal?: Proposal;
        error?: string;
        handed_off?: boolean;
      };
      if (j.proposal) {
        setProposals((cur) => cur.map((p) => (p.id === id ? j.proposal! : p)));
        if (j.handed_off) {
          setHandoffToast(
            "Sent to Coding Agent. Process it from the Coding drill-down.",
          );
          setTimeout(() => setHandoffToast(null), 4000);
        }
      }
    });
  }

  return (
    <section className="flex flex-col gap-6">
      {handoffToast && (
        <div
          className="rounded-md border border-line bg-card-2 px-4 py-2 text-[12px] text-ink-2"
          role="status"
          aria-live="polite"
        >
          {handoffToast}
        </div>
      )}

      <FeedSection
        label="Action Feed"
        emptyText="No items in Action Feed — run an agent to populate."
        items={buckets.action}
        bucket="action"
        onApprove={approve}
        companyPlatform={companyPlatform}
        companyQs={companyQs}
        codeChangeLookup={lookup}
      />
      <FeedSection
        label="Pending Feed"
        emptyText="No items in Pending Feed — nothing waiting on a downstream agent."
        items={buckets.pending}
        bucket="pending"
        onApprove={approve}
        companyPlatform={companyPlatform}
        companyQs={companyQs}
        codeChangeLookup={lookup}
      />
      <FeedSection
        label="Complete Feed"
        emptyText="No completed items yet."
        items={buckets.complete}
        bucket="complete"
        onApprove={approve}
        companyPlatform={companyPlatform}
        companyQs={companyQs}
        codeChangeLookup={lookup}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bucketing logic. Single source of truth for "where does this row render."
function bucketProposal(p: Proposal, lookup: CodeChangeLookup): Bucket {
  // The user can still Approve a pending row — it's the actionable state.
  if (p.status === "pending") return "action";

  // publish_failed still has Retry, so it's actionable in spirit but doesn't
  // belong in Action Feed (the user already approved). Pending Feed gets it.
  if (p.status === "publish_failed") return "pending";

  // Handoff lifecycle — the downstream work decides Complete vs Pending.
  if (p.status === "approved" && p.handed_off_to_coding) {
    const synthId = p.handoff_synthesized_proposal_id;
    if (synthId) {
      const downstream = lookup.get(synthId);
      if (downstream?.status === "published") return "complete";
    }
    return "pending";
  }

  // Manual-mode CMS blog: approved + !handed_off + no publish_url. The user
  // still has to paste markdown into their site — leave it in Pending Feed
  // alongside the Copy-markdown affordance.
  if (
    p.status === "approved" &&
    !p.handed_off_to_coding &&
    p.type === "blog_post" &&
    !p.publish_url
  ) {
    return "pending";
  }

  // Plain approved (non-blog, non-handoff) → no downstream to wait on.
  if (p.status === "approved") return "complete";

  // Live artifact reached the world.
  if (p.status === "published") return "complete";

  // Legacy rejected / archived rows live here for the record (no UI to
  // re-trigger them — the Reject button is gone).
  return "complete";
}

// ---------------------------------------------------------------------------
// Section wrapper: header + count + list (or empty placeholder).
function FeedSection({
  label,
  emptyText,
  items,
  bucket,
  onApprove,
  companyPlatform,
  companyQs,
  codeChangeLookup,
}: {
  label: string;
  emptyText: string;
  items: Proposal[];
  bucket: Bucket;
  onApprove: (id: string) => void;
  companyPlatform: CompanyPlatform;
  companyQs: string;
  codeChangeLookup: CodeChangeLookup;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-ink-3">
          {items.length}
        </span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-4">
        {items.length === 0 ? (
          <p className="text-[13px] text-ink-3">{emptyText}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                bucket={bucket}
                onApprove={() => onApprove(p.id)}
                companyPlatform={companyPlatform}
                companyQs={companyQs}
                codeChangeLookup={codeChangeLookup}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function ProposalCard({
  proposal,
  bucket,
  onApprove,
  companyPlatform,
  companyQs,
  codeChangeLookup,
}: {
  proposal: Proposal;
  bucket: Bucket;
  onApprove: () => void;
  companyPlatform: CompanyPlatform;
  companyQs: string;
  codeChangeLookup: CodeChangeLookup;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isBlog = proposal.type === "blog_post";
  const isCodeChange = proposal.type === "code_change";
  const isPendingStatus = proposal.status === "pending";
  const isPublishFailed = proposal.status === "publish_failed";
  // Manual-mode = a blog_post approved but no auto-publisher existed. Status
  // 'approved' + no publish_url + not handed off. After the handoff session
  // this is only reachable when BLOG_PUBLISH_VIA_CMS=true AND the platform
  // connector is null — kept for compatibility with prior data.
  const isManualMode =
    isBlog &&
    proposal.status === "approved" &&
    !proposal.publish_url &&
    !proposal.handed_off_to_coding;

  // Approve button copy depends on the proposal type. publish_failed shows
  // a Retry label so the user knows it's a re-attempt.
  const buttonLabel = isPublishFailed
    ? isCodeChange
      ? "Retry PR"
      : "Retry publish"
    : isCodeChange
    ? "Open Pull Request"
    : "Approve";

  return (
    <li
      id={`proposal-${proposal.id}`}
      className="rounded-md border border-line bg-card-2 p-3 scroll-mt-24"
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="flex flex-1 items-center gap-2">
          <div className="text-[13px] font-medium text-ink">{proposal.title}</div>
          {isBlog && <PlatformChip platform={companyPlatform} />}
        </div>
        {/* The inline pill carries the row's status — and for handoff
            rows it's clickable into the downstream agent's drill-down. */}
        <StatusPill
          proposal={proposal}
          companyQs={companyQs}
          codeChangeLookup={codeChangeLookup}
        />
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

      {isCodeChange && (
        <CodeChangePreview
          proposal={proposal}
          open={previewOpen}
          onToggle={() => setPreviewOpen((v) => !v)}
        />
      )}

      {isPublishFailed && proposal.publish_error && (
        <p className="mt-2 break-words text-[12px] text-warn">
          Publish failed: {proposal.publish_error}
        </p>
      )}

      {isManualMode && <ManualCopyActions proposal={proposal} />}

      {/* Action button — only on rows the user can still act on. The bucket
          guard is belt-and-braces (Action Feed gets pending, Pending Feed
          gets publish_failed). */}
      {(bucket === "action" && isPendingStatus) ||
      (bucket === "pending" && isPublishFailed) ? (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary px-3 py-1.5 text-[12px]"
            onClick={onApprove}
          >
            {buttonLabel}
          </button>
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Inline pill — combines status + downstream link into one element. Wrapped
// in an anchor when there's a destination (handoff, PR, live URL).
function StatusPill({
  proposal,
  companyQs,
  codeChangeLookup,
}: {
  proposal: Proposal;
  companyQs: string;
  codeChangeLookup: CodeChangeLookup;
}) {
  if (proposal.status === "pending") return null;
  const codingHref = `/dashboard/agents/coding${companyQs ? `?${companyQs}` : ""}`;

  // Handed off — Pending or Complete depending on downstream status.
  if (proposal.status === "approved" && proposal.handed_off_to_coding) {
    const synthId = proposal.handoff_synthesized_proposal_id;
    if (synthId) {
      const downstream = codeChangeLookup.get(synthId);
      if (downstream?.status === "published" && downstream.publish_url) {
        // Downstream PR opened — pill IS the link to the PR.
        return (
          <a
            href={downstream.publish_url}
            target="_blank"
            rel="noreferrer"
            className="chip chip-live hover:opacity-90"
            title="The downstream code change shipped — view the PR on GitHub."
          >
            PR opened — View PR →
          </a>
        );
      }
      // Synthesized but PR not opened yet — link to that code_change card.
      return (
        <a
          href={`${codingHref}#proposal-${synthId}`}
          className="chip hover:border-ink/40"
          title="Jump to the synthesized code change in Coding."
        >
          Code change drafted →
        </a>
      );
    }
    // Handed off but Coding hasn't processed yet.
    return (
      <a
        href={codingHref}
        className="chip chip-soon hover:opacity-80"
        title="Sent to the Coding Agent. Process from the Coding drill-down."
      >
        Sent to Coding Agent →
      </a>
    );
  }

  // This row IS a code_change that opened a PR — pill carries the link.
  if (proposal.status === "published" && proposal.type === "code_change") {
    if (proposal.publish_url) {
      return (
        <a
          href={proposal.publish_url}
          target="_blank"
          rel="noreferrer"
          className="chip chip-live hover:opacity-90"
        >
          PR opened — View PR →
        </a>
      );
    }
    return <span className="chip chip-live">PR opened</span>;
  }

  // CMS-published blog — pill carries the live link.
  if (proposal.status === "published" && proposal.publish_url) {
    return (
      <a
        href={proposal.publish_url}
        target="_blank"
        rel="noreferrer"
        className="chip chip-live hover:opacity-90"
      >
        Published — View live →
      </a>
    );
  }

  const map: Record<ProposalStatus, { cls: string; label: string }> = {
    pending: { cls: "chip", label: "pending" },
    approved: { cls: "chip chip-live", label: "Approved" },
    rejected: { cls: "chip chip-soon", label: "Rejected" },
    archived: { cls: "chip chip-soon", label: "Archived" },
    published: { cls: "chip chip-live", label: "Published" },
    publish_failed: { cls: "chip text-warn", label: "Publish failed" },
  };
  const m = map[proposal.status];
  return <span className={m.cls}>{m.label}</span>;
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

// ---------------------------------------------------------------------------
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

function CodeChangePreview({
  proposal,
  open,
  onToggle,
}: {
  proposal: Proposal;
  open: boolean;
  onToggle: () => void;
}) {
  const payload = proposal.payload as {
    source_agent?: string;
    rationale?: string;
    files?: Array<{ path: string; content: string }>;
    suggested_branch?: string;
    suggested_pr_title?: string;
    suggested_pr_body?: string;
    finding_title?: string;
  };
  const files = payload.files ?? [];

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="text-[11px] font-medium uppercase tracking-wider text-ink-3 hover:text-ink"
      >
        {open ? "Hide changes ▴" : `Show changes (${files.length} file${files.length === 1 ? "" : "s"}) ▾`}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-line bg-card p-3 text-[12px] text-ink-2">
          {payload.source_agent && (
            <div>
              <span className="t-eyebrow">Source agent</span>
              <div className="mt-1 font-mono text-[12px]">{payload.source_agent}</div>
            </div>
          )}
          {payload.finding_title && (
            <div>
              <span className="t-eyebrow">Finding</span>
              <p className="mt-1">{payload.finding_title}</p>
            </div>
          )}
          {payload.rationale && (
            <div>
              <span className="t-eyebrow">Rationale</span>
              <p className="mt-1">{payload.rationale}</p>
            </div>
          )}
          {payload.suggested_branch && (
            <div>
              <span className="t-eyebrow">Branch</span>
              <div className="mt-1 font-mono text-[12px]">{payload.suggested_branch}</div>
            </div>
          )}
          {payload.suggested_pr_title && (
            <div>
              <span className="t-eyebrow">PR title</span>
              <p className="mt-1">{payload.suggested_pr_title}</p>
            </div>
          )}
          {files.length > 0 && (
            <div>
              <span className="t-eyebrow">Files</span>
              <ul className="mt-1 space-y-2">
                {files.map((f, i) => (
                  <li key={i}>
                    <div className="font-mono text-[11px] text-ink-3">{f.path}</div>
                    <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-card-2 p-2 text-[11px] leading-[1.45]">
                      {(f.content ?? "").slice(0, 2000)}
                      {(f.content ?? "").length > 2000 ? "\n…" : ""}
                    </pre>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {payload.suggested_pr_body && (
            <div>
              <span className="t-eyebrow">PR body</span>
              <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-[12px] leading-[1.55]">
                {payload.suggested_pr_body}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
