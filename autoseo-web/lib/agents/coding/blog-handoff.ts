// Blog handoff → deterministic markdown-PR synthesis.
//
// When the user approves a blog_post proposal AND the company isn't on a
// CMS publish path (or the BLOG_PUBLISH_VIA_CMS flag is off), the approval
// flows to the Coding Agent which synthesizes a code_change that commits
// the article as `${BLOG_REPO_FOLDER}/{slug}.md` in the configured GitHub
// repo. NO LLM call — the blog agent already wrote the article, all we
// need to do is wrap it in a file.
import "server-only";

import type { NewProposal } from "@/lib/proposals";
import type { Proposal } from "@/lib/supabase/types";

export type BlogHandoffOutcome =
  | { ok: true; proposal: NewProposal }
  | { ok: false; reason: string };

const DEFAULT_BLOG_FOLDER = "content/blog";

export function synthesizeBlogHandoff(handoff: Proposal): BlogHandoffOutcome {
  const payload = handoff.payload as {
    title?: string;
    slug?: string;
    meta_description?: string;
    body_md?: string;
    target_keyword?: string;
    internal_links?: Array<{ anchor: string; target_path: string; reason?: string }>;
  };
  const title = payload.title?.trim();
  const slug = payload.slug?.trim();
  const body = payload.body_md ?? "";
  if (!title || !slug || !body) {
    return {
      ok: false,
      reason: `Blog draft is missing required fields (title=${!!title}, slug=${!!slug}, body=${body.length > 0}).`,
    };
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      ok: false,
      reason: `Blog slug "${slug}" is not safe for a filename (kebab-case ASCII only).`,
    };
  }

  const folder = (process.env.BLOG_REPO_FOLDER || DEFAULT_BLOG_FOLDER)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const path = `${folder}/${slug}.md`;
  const content = buildMarkdownFile({
    title,
    slug,
    meta_description: payload.meta_description,
    target_keyword: payload.target_keyword,
    body_md: body,
  });

  const branch = `autoseo/blog-${slug}-${Math.floor(Date.now() / 1000)}`;
  const prTitle = `[autoseo agent] blog: ${title}`;
  const prBody = buildPrBody({
    title,
    slug,
    meta_description: payload.meta_description,
    target_keyword: payload.target_keyword,
    internal_links: payload.internal_links,
    sourceProposalId: handoff.id,
    path,
  });

  const proposal: NewProposal = {
    agent_key: "coding",
    type: "code_change",
    title: prTitle,
    summary:
      `Markdown PR for the approved blog draft "${title}".\n` +
      `— Branch: ${branch} · 1 file (${path})`,
    payload: {
      source_agent: "blog",
      source_proposal_id: handoff.id,
      rationale:
        "Commits the human-approved blog draft to the configured blog folder " +
        "as a markdown file. Opening the PR is the final consent step.",
      files: [{ path, content }],
      suggested_branch: branch,
      suggested_pr_title: prTitle,
      suggested_pr_body: prBody,
      finding_title: title,
    },
  };
  return { ok: true, proposal };
}

// Frontmatter is YAML — quoted strings to handle colons/quotes in user copy.
// Most static-site generators (Astro/Next-MDX/Eleventy/Jekyll) accept this
// shape; the user can adjust the field names in their repo if they use a
// different convention.
function buildMarkdownFile(opts: {
  title: string;
  slug: string;
  meta_description?: string;
  target_keyword?: string;
  body_md: string;
}): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${yamlString(opts.title)}`);
  lines.push(`slug: ${yamlString(opts.slug)}`);
  if (opts.meta_description) {
    lines.push(`description: ${yamlString(opts.meta_description)}`);
  }
  if (opts.target_keyword) {
    lines.push(`keyword: ${yamlString(opts.target_keyword)}`);
  }
  lines.push(`date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`source: autoseo-agent`);
  lines.push("---");
  lines.push("");
  // body_md may or may not start with its own H1. We don't strip — the user
  // approved the body as-is, so the file content matches the draft they saw.
  lines.push(opts.body_md.trim());
  lines.push("");
  return lines.join("\n");
}

function yamlString(s: string): string {
  // Double-quote and escape backslashes + quotes. Sufficient for YAML 1.1
  // double-quoted strings — covers everything except null bytes, which
  // shouldn't appear in title/slug/description copy.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildPrBody(opts: {
  title: string;
  slug: string;
  meta_description?: string;
  target_keyword?: string;
  internal_links?: Array<{ anchor: string; target_path: string; reason?: string }>;
  sourceProposalId: string;
  path: string;
}): string {
  const lines: string[] = [];
  lines.push(`## New blog post: ${opts.title}`);
  lines.push("");
  lines.push(
    "This PR adds a new blog post drafted by the AutoSEO Blog Agent. The " +
      "human reviewer approved the draft in the dashboard; this PR is the " +
      "second consent gate before the content lands in the repo.",
  );
  lines.push("");
  lines.push(`**File:** \`${opts.path}\``);
  if (opts.target_keyword) {
    lines.push(`**Target keyword:** ${opts.target_keyword}`);
  }
  if (opts.meta_description) {
    lines.push(`**Meta description:** ${opts.meta_description}`);
  }
  lines.push(`**Source proposal:** ${opts.sourceProposalId}`);
  if (opts.internal_links?.length) {
    lines.push("");
    lines.push("### Suggested internal links (verify before merging)");
    for (const l of opts.internal_links) {
      lines.push(`- [${l.anchor}](${l.target_path})${l.reason ? ` — ${l.reason}` : ""}`);
    }
  }
  return lines.join("\n");
}
