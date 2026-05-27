// GitHub connector — opens Pull Requests against the configured repo.
//
// Hard rules baked into this module:
//   • PRs ONLY. We NEVER push directly to the base branch, NEVER call the
//     merge endpoint, NEVER force-push. To make that obvious the file does
//     not even import the merge methods from Octokit, and runtime guards
//     refuse to operate when the branch name targets a protected default.
//   • Single-tenant for now. Credentials come from env (GITHUB_TOKEN,
//     GITHUB_OWNER, GITHUB_REPO, GITHUB_DEFAULT_BRANCH). The future
//     per-tenant version reads from the `company` row instead — the
//     `openPullRequest` signature already takes `company` so the call sites
//     don't move.
//   • Errors map to two typed classes the approval handler catches once,
//     same UX shape as the CMS connectors (banner + Retry button).
//
// Verified against the GitHub REST API (docs.github.com/en/rest):
//   GET    /repos/{owner}/{repo}/git/ref/heads/{branch}       → base SHA
//   POST   /repos/{owner}/{repo}/git/refs                     → create branch
//   GET    /repos/{owner}/{repo}/contents/{path}?ref=         → existing SHA
//   PUT    /repos/{owner}/{repo}/contents/{path}              → write file
//   POST   /repos/{owner}/{repo}/pulls                        → open PR
//   GET    /search/code                                       → find a file
// PAT scopes: `repo` for private repos, `public_repo` for public-only.
import "server-only";

import { Octokit } from "@octokit/rest";
import type { Company } from "@/lib/supabase/types";

// Branch names we refuse to push to or open PRs against AS THE HEAD branch.
// (We use these only as the BASE; using one as `head` would mean we're trying
//  to push to a default branch, which this connector is designed to prevent.)
const PROTECTED_BRANCH_NAMES = new Set(["main", "master", "prod", "production"]);

const AUTOSEO_PR_TAG = "[autoseo agent]";

export class GitHubNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`GitHub not configured: ${reason}`);
    this.name = "GitHubNotConfiguredError";
  }
}

export class GitHubOperationError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "GitHubOperationError";
  }
}

export function isGitHubConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_TOKEN &&
      process.env.GITHUB_OWNER &&
      process.env.GITHUB_REPO,
  );
}

export type GitHubFile = {
  // Repo-root-relative path, e.g. "app/products/foo/page.tsx".
  path: string;
  // Full new content. We do not apply diffs — the caller (the LLM) produces
  // the FULL replacement content so the operation is deterministic.
  content: string;
};

export type OpenPullRequestInput = {
  branchName: string;
  baseBranch?: string;            // defaults to env or "main"
  commitMessage: string;
  prTitle: string;
  prBody: string;                 // markdown
  files: GitHubFile[];
};

export type OpenPullRequestResult = {
  url: string;       // PR html_url
  number: number;    // PR number
  branch: string;    // the branch we created (echoed back)
};

// Public surface. `_company` is unused today but reserved so per-tenant
// credentials can be threaded in later without a signature change.
export async function openPullRequest(
  _company: Company,
  input: OpenPullRequestInput,
): Promise<OpenPullRequestResult> {
  if (!isGitHubConfigured()) {
    throw new GitHubNotConfiguredError(
      "Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO in .env.local. " +
        "Generate a PAT at github.com/settings/tokens with `repo` (private repos) or `public_repo` (public-only) scope.",
    );
  }

  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const baseBranch =
    input.baseBranch || process.env.GITHUB_DEFAULT_BRANCH || "main";
  const headBranch = input.branchName;

  // ---------------------------------------------------------------------------
  // Safety guards. These are non-negotiable — if anything looks like an
  // attempt to push to a protected branch, we refuse before talking to GitHub.
  if (!headBranch || typeof headBranch !== "string") {
    throw new GitHubOperationError("branchName is required.");
  }
  if (headBranch === baseBranch) {
    throw new GitHubOperationError(
      `Refusing to open a PR where head === base (${headBranch}).`,
    );
  }
  if (PROTECTED_BRANCH_NAMES.has(headBranch.toLowerCase())) {
    throw new GitHubOperationError(
      `Refusing to use protected branch name "${headBranch}" as the PR head. ` +
        "Use a feature branch like 'autoseo/...' instead.",
    );
  }
  if (!input.files?.length) {
    throw new GitHubOperationError("Must provide at least one file.");
  }
  for (const f of input.files) {
    if (!f.path || typeof f.content !== "string") {
      throw new GitHubOperationError(
        `Invalid file entry: ${JSON.stringify({ path: f.path, hasContent: typeof f.content === "string" })}`,
      );
    }
    // GitHub paths must not start with a slash and must be relative.
    if (f.path.startsWith("/") || f.path.includes("..")) {
      throw new GitHubOperationError(
        `Refusing path "${f.path}" — must be repo-relative, no leading slash or '..'.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // All commit + PR text gets the agent tag so the customer can grep their
  // repo history and tell which commits came from AutoSEO.
  const taggedMessage = `${input.commitMessage}\n\n${AUTOSEO_PR_TAG}`;
  const taggedBody = `${input.prBody}\n\n---\n${AUTOSEO_PR_TAG}`;

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  // 1) Base SHA — the commit the new branch will fork from.
  let baseSha: string;
  try {
    const ref = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });
    baseSha = ref.data.object.sha;
  } catch (err) {
    throw rethrow(err, `Could not read base branch "${baseBranch}".`);
  }

  // 2) Create the feature branch off baseSha. If a branch with the same name
  //    already exists (e.g. user retried before we deleted it) the API
  //    returns 422 with "Reference already exists" — surface as an operation
  //    error so the caller picks a fresh name.
  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${headBranch}`,
      sha: baseSha,
    });
  } catch (err) {
    throw rethrow(err, `Could not create branch "${headBranch}".`);
  }

  // 3) Write every file to the new branch. For each path we PUT content; if
  //    the file already exists we must include its SHA so GitHub treats it
  //    as an update instead of a create-conflict.
  for (const file of input.files) {
    let existingSha: string | undefined;
    try {
      const got = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: file.path,
        ref: headBranch,
      });
      // Type narrows: a file response is an object with `.sha`; directory
      // responses are arrays. We only handle the file case.
      if (!Array.isArray(got.data) && "sha" in got.data) {
        existingSha = got.data.sha;
      }
    } catch (err) {
      // 404 → it's a new file; any other error is an actual failure.
      const status = (err as { status?: number })?.status;
      if (status !== 404) {
        throw rethrow(err, `Could not check existing content for "${file.path}".`);
      }
    }

    try {
      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: file.path,
        message: `${taggedMessage}\n(file: ${file.path})`,
        content: Buffer.from(file.content, "utf8").toString("base64"),
        branch: headBranch,
        sha: existingSha,
      });
    } catch (err) {
      throw rethrow(err, `Could not write "${file.path}" on branch "${headBranch}".`);
    }
  }

  // 4) Open the PR. base ← protected branch, head ← our feature branch.
  //    We deliberately do not call `octokit.rest.pulls.merge` anywhere.
  try {
    const created = await octokit.rest.pulls.create({
      owner,
      repo,
      title: input.prTitle,
      head: headBranch,
      base: baseBranch,
      body: taggedBody,
    });
    return {
      url: created.data.html_url,
      number: created.data.number,
      branch: headBranch,
    };
  } catch (err) {
    throw rethrow(err, `Could not open PR ${baseBranch} ← ${headBranch}.`);
  }
}

// Light-touch repo file finder. Used by the SEO-fix agent to locate the
// page it's trying to patch. Returns up to `limit` paths or [] if none.
export async function searchRepoForPath(
  filenameHint: string,
  limit = 5,
): Promise<string[]> {
  if (!isGitHubConfigured()) return [];
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  try {
    // q syntax: `filename:foo extension:html repo:owner/repo`
    const q = `filename:${filenameHint} repo:${owner}/${repo}`;
    const res = await octokit.rest.search.code({ q, per_page: limit });
    return res.data.items.map((it) => it.path);
  } catch {
    // search/code is rate-limited and surfaces 403/422 cleanly — we don't want
    // the agent to crash on those, just fall back to "couldn't locate".
    return [];
  }
}

// Read a file's raw text on a given branch. Returns null if missing.
export async function readRepoFile(
  path: string,
  branch?: string,
): Promise<string | null> {
  if (!isGitHubConfigured()) return null;
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const ref = branch || process.env.GITHUB_DEFAULT_BRANCH || "main";
  try {
    const got = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(got.data) || !("content" in got.data)) return null;
    const content = got.data.content;
    if (typeof content !== "string") return null;
    // Contents API returns base64 with newlines; Buffer handles that.
    return Buffer.from(content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

// Pretty-print Octokit errors into our typed exception. We never throw the
// raw Octokit error past this module — the approval handler catches our
// types, nothing else.
function rethrow(err: unknown, context: string): GitHubOperationError {
  if (err instanceof GitHubOperationError) return err;
  const e = err as { status?: number; message?: string; response?: { data?: { message?: string } } };
  const status = e?.status;
  const detail = e?.response?.data?.message || e?.message || String(err);
  return new GitHubOperationError(
    `${context} GitHub ${status ?? "?"}: ${String(detail).slice(0, 300)}`,
    status,
  );
}
