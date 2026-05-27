// SEO-fix-agent tools.
//
// The agent's job is to pick ONE SEO issue, find the file on disk in the
// customer's repo, propose a full-content replacement, and submit it for
// human review as a `code_change` proposal. Approval opens a PR via the
// GitHub connector — this agent NEVER writes to the repo itself.
//
// Tools:
//   get_seo_findings    — read recent SEO issue_high/issue_critical rows.
//   find_file_in_repo   — GitHub search-code for a filename hint.
//   read_file_in_repo   — GitHub contents API for a single file.
//   submit_code_change  — TERMINAL. Stages the deliverable.
//   submit_unfixable    — TERMINAL. Agent gave up, emit a pending note instead.
import "server-only";

import type { AgentTool } from "../tools";
import { supabaseServer } from "@/lib/supabase/server";
import { isGitHubConfigured, readRepoFile, searchRepoForPath } from "@/lib/connectors/github";

export type CodeChangeFile = { path: string; content: string };

export type CodeChangeDeliverable = {
  kind: "code_change";
  source_agent: "seo";
  rationale: string;
  files: CodeChangeFile[];
  suggested_branch: string;
  suggested_pr_title: string;
  suggested_pr_body: string;
  finding_title?: string;
};

export type UnfixableDeliverable = {
  kind: "unfixable";
  finding_title: string;
  reason: string;
};

export type SeoFixDeliverable = CodeChangeDeliverable | UnfixableDeliverable;

// ---------------------------------------------------------------------------
// get_seo_findings — read the latest pending SEO issue proposals for this
// company so the agent can pick the best target without reading the whole
// audit again. Already-fixed (approved/published) issues are excluded so we
// don't propose the same fix twice in a row.
export const getSeoFindingsTool: AgentTool = {
  name: "get_seo_findings",
  description:
    "Return the most recent pending SEO findings (critical + high severity) " +
    "for this company. Each finding includes title, detail, evidence, and an " +
    "optional `solver.type` hint indicating what kind of fix is appropriate " +
    "(title, description, schema, etc).",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Maximum findings to return (1-15). Defaults to 8.",
        minimum: 1,
        maximum: 15,
      },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    const limit = Math.max(1, Math.min(15, Number(args.limit ?? 8)));
    const sb = supabaseServer();
    const { data: rows } = await sb
      .from("proposals")
      .select("id, type, title, summary, payload, created_at")
      .eq("company_id", ctx.company.id)
      .in("type", ["issue_critical", "issue_high"])
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(limit);

    const findings = (rows ?? []).map((r) => {
      const payload = r.payload as {
        issue?: {
          id?: string;
          category?: string;
          severity?: string;
          detail?: string;
          evidence?: string;
          solver?: { type?: string; current?: string; hint?: string };
        };
      };
      return {
        proposal_id: r.id,
        title: r.title,
        summary: r.summary,
        severity: payload.issue?.severity,
        category: payload.issue?.category,
        detail: payload.issue?.detail,
        evidence: payload.issue?.evidence,
        solver_type: payload.issue?.solver?.type,
        solver_hint: payload.issue?.solver?.hint,
        current_value: payload.issue?.solver?.current,
      };
    });

    return {
      ok: true,
      data: {
        findings,
        note:
          findings.length === 0
            ? "No pending SEO findings — run the SEO audit first."
            : null,
      },
      log_summary: `${findings.length} pending finding(s)`,
    };
  },
};

// ---------------------------------------------------------------------------
// find_file_in_repo — GitHub code search. Used by the agent to locate the
// page file it wants to patch (e.g. searching for "page.tsx" inside a
// products subdirectory). Returns an empty list if search rate-limits or
// nothing matches — the agent should then fall back to submit_unfixable
// rather than guessing a path.
export const findFileInRepoTool: AgentTool = {
  name: "find_file_in_repo",
  description:
    "Search the configured GitHub repo for files whose name matches the hint. " +
    "Returns up to 5 repo-relative paths. Use this BEFORE proposing a " +
    "code_change so you can point at a real file. Returns an empty list if " +
    "GitHub isn't configured or the search rate-limits — in that case use " +
    "submit_unfixable to record the gap.",
  parameters: {
    type: "object",
    properties: {
      filename_hint: {
        type: "string",
        description:
          "Filename to search for, e.g. 'page.tsx', 'index.html', 'layout.tsx'. " +
          "Do NOT pass a path here — the search is filename-only.",
      },
    },
    required: ["filename_hint"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const hint = String(args.filename_hint ?? "").trim();
    if (!hint) {
      return { ok: false, data: { error: "filename_hint is required." } };
    }
    if (!isGitHubConfigured()) {
      return {
        ok: true,
        data: {
          configured: false,
          paths: [],
          note:
            "GitHub is not configured — env vars GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO are missing.",
        },
        log_summary: "github not configured",
      };
    }
    const paths = await searchRepoForPath(hint);
    return {
      ok: true,
      data: { configured: true, paths },
      log_summary: `search "${hint}" → ${paths.length} path(s)`,
    };
  },
};

// ---------------------------------------------------------------------------
// read_file_in_repo — pull a single file's text so the LLM can generate
// FULL replacement content (no diffs). Returns null when missing/binary;
// the agent should fall back to submit_unfixable.
export const readFileInRepoTool: AgentTool = {
  name: "read_file_in_repo",
  description:
    "Read the current contents of a file in the configured GitHub repo on " +
    "the default branch. Returns { found, content }. Use this AFTER " +
    "find_file_in_repo so you have a real path. Bound the content to text " +
    "files (HTML, TSX, MD, JS) — binary returns found=false.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Repo-relative path, no leading slash.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const path = String(args.path ?? "").trim();
    if (!path || path.startsWith("/") || path.includes("..")) {
      return {
        ok: false,
        data: { error: "Path must be repo-relative; no leading slash or '..'." },
      };
    }
    const text = await readRepoFile(path);
    if (text === null) {
      return {
        ok: true,
        data: { found: false, content: null },
        log_summary: `read ${path} → not found`,
      };
    }
    // Cap so a huge file can't blow the context budget.
    const cap = 12000;
    const truncated = text.length > cap;
    return {
      ok: true,
      data: {
        found: true,
        content: truncated ? text.slice(0, cap) : text,
        truncated,
        char_count: text.length,
      },
      log_summary: `read ${path} (${text.length} chars${truncated ? ", truncated" : ""})`,
    };
  },
};

// ---------------------------------------------------------------------------
// submit_code_change — TERMINAL. The agent's deliverable.
// submit_unfixable   — TERMINAL. Used when the agent can't proceed; the
//                       runner returns a "pending note" proposal instead.
//
// Both use the per-call hand-off pattern (matching createSubmitArticleTool)
// so the runner can be invoked concurrently for different companies.
export function createSubmitTools(): {
  submitCodeChange: AgentTool;
  submitUnfixable: AgentTool;
  read: () => SeoFixDeliverable | null;
} {
  let result: SeoFixDeliverable | null = null;

  const submitCodeChange: AgentTool = {
    name: "submit_code_change",
    description:
      "FINAL STEP — propose a code change for human review. Calling this ends " +
      "the agent loop. The human reviewer approves the resulting proposal and " +
      "a PR is opened on the configured GitHub repo. NEVER changes the live " +
      "site or pushes to main — only opens a PR.",
    terminal: true,
    parameters: {
      type: "object",
      properties: {
        finding_title: {
          type: "string",
          description: "The audit finding this fix addresses (verbatim title).",
        },
        rationale: {
          type: "string",
          description:
            "Why this change fixes the finding. Reviewer reads this first.",
        },
        files: {
          type: "array",
          description:
            "Full replacement file contents. Each entry { path, content } " +
            "where path is repo-relative and content is the COMPLETE new file " +
            "text (not a diff).",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
          minItems: 1,
        },
        suggested_branch: {
          type: "string",
          description:
            "Feature branch name. Must NOT equal main/master/prod. Convention: " +
            "'autoseo/fix-<slug>-<unix_ts>'. Lowercase, hyphens, no spaces.",
        },
        suggested_pr_title: {
          type: "string",
          description: "PR title. Imperative voice, e.g. 'Add meta description to /products/foo'.",
        },
        suggested_pr_body: {
          type: "string",
          description:
            "PR body in markdown. Include WHAT changed, WHY (cite the finding), " +
            "and any reviewer caveats. Will be tagged with [autoseo agent] in the connector.",
        },
      },
      required: [
        "finding_title",
        "rationale",
        "files",
        "suggested_branch",
        "suggested_pr_title",
        "suggested_pr_body",
      ],
      additionalProperties: false,
    },
    execute: async (args) => {
      const files = Array.isArray(args.files)
        ? (args.files as CodeChangeFile[]).filter(
            (f) => f && typeof f.path === "string" && typeof f.content === "string",
          )
        : [];
      if (files.length === 0) {
        return { ok: false, data: { error: "files[] is empty after filtering." } };
      }
      const branch = String(args.suggested_branch ?? "").trim();
      // Mirror the connector's guard so the LLM gets immediate feedback
      // instead of waiting for approval-time rejection.
      const protectedNames = new Set(["main", "master", "prod", "production"]);
      if (!branch || protectedNames.has(branch.toLowerCase())) {
        return {
          ok: false,
          data: {
            error:
              `Branch name "${branch}" is invalid. Must not equal main/master/prod. ` +
              "Use a 'autoseo/...' prefix.",
          },
        };
      }
      result = {
        kind: "code_change",
        source_agent: "seo",
        finding_title: String(args.finding_title ?? ""),
        rationale: String(args.rationale ?? ""),
        files,
        suggested_branch: branch,
        suggested_pr_title: String(args.suggested_pr_title ?? ""),
        suggested_pr_body: String(args.suggested_pr_body ?? ""),
      };
      return {
        ok: true,
        data: { received: true, files: files.length },
        log_summary: `submitted code_change (${files.length} file(s)) for "${result.finding_title}"`,
      };
    },
  };

  const submitUnfixable: AgentTool = {
    name: "submit_unfixable",
    description:
      "FINAL STEP — use when the agent CANNOT produce a code change (couldn't " +
      "locate the file, GitHub not configured, etc). The runner records a " +
      "pending proposal note so the human sees the gap and can act manually.",
    terminal: true,
    parameters: {
      type: "object",
      properties: {
        finding_title: { type: "string" },
        reason: {
          type: "string",
          description:
            "Why no code change was produced (e.g. 'couldn't locate page.tsx').",
        },
      },
      required: ["finding_title", "reason"],
      additionalProperties: false,
    },
    execute: async (args) => {
      result = {
        kind: "unfixable",
        finding_title: String(args.finding_title ?? ""),
        reason: String(args.reason ?? ""),
      };
      return {
        ok: true,
        data: { received: true },
        log_summary: `submitted unfixable: ${result.reason.slice(0, 80)}`,
      };
    },
  };

  return { submitCodeChange, submitUnfixable, read: () => result };
}
