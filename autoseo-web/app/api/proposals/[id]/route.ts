// POST /api/proposals/:id  { decision: "approved" | "rejected" }
//
// Single human gate for every proposal. Routes the approval based on proposal
// `type`:
//
//   • code_change     → GitHub PR (the existing connector). The user has
//                       reviewed the proposed file contents.
//   • blog_post       → DEFAULT: hand off to Coding Agent (markdown PR path).
//                       LEGACY: when BLOG_PUBLISH_VIA_CMS=true AND the
//                       company is on shopify/wordpress, fall through to the
//                       existing CMS publish flow.
//   • issue_high      → hand off to Coding Agent (synthesize a code fix).
//   • issue_critical  → same.
//   • geo_gap         → same (Coding will synthesize a page rewrite).
//   • audit_summary   → informational; plain state flip to 'approved'.
//   • everything else → plain state flip to 'approved'.
//
// Handoff = set status='approved' AND handed_off_to_coding=true. The Coding
// runner reads that queue and synthesizes a companion code_change proposal,
// which the user then approves as the SECOND gate (that's what actually
// opens the PR — every external action requires two consents in the handoff
// flow, the original approval and the PR approval).

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import {
  getPublisher,
  openPullRequest,
  GitHubNotConfiguredError,
  GitHubOperationError,
} from "@/lib/connectors";
import {
  CmsNotConfiguredError,
  CmsPublishError,
  type BlogDraft,
} from "@/lib/connectors/types";
import type { CodeChangePayload, Company, Proposal } from "@/lib/supabase/types";

export const runtime = "nodejs";

// Proposal types that imply a code change and should be routed to Coding.
// Kept here (not exported) so the dispatch lives in one obvious place.
const HANDOFF_TYPES = new Set<string>([
  "issue_critical",
  "issue_high",
  "geo_gap",
  // blog_post is handled separately because the CMS path can still win when
  // the platform + feature flag both allow it.
]);

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }

  let decision: "approved" | "rejected";
  try {
    const body = (await req.json()) as { decision?: string };
    if (body.decision !== "approved" && body.decision !== "rejected") throw new Error();
    decision = body.decision;
  } catch {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 },
    );
  }

  const sb = supabaseServer();

  const { data: proposal, error: lookupErr } = await sb
    .from("proposals")
    .select("*")
    .eq("id", params.id)
    .single();
  if (lookupErr || !proposal) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const p = proposal as Proposal;
  const isRetryablePublishFail =
    decision === "approved" &&
    p.status === "publish_failed" &&
    (p.type === "blog_post" || p.type === "code_change");
  if (p.status !== "pending" && !isRetryablePublishFail) {
    return NextResponse.json(
      { error: `Proposal already ${p.status}.` },
      { status: 409 },
    );
  }

  // Rejection is always a clean state flip regardless of type.
  if (decision === "rejected") {
    const { data, error } = await sb
      .from("proposals")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", params.id)
      .select("*")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Update failed." }, { status: 500 });
    }
    return NextResponse.json({ proposal: data });
  }

  // ===========================================================================
  // Approval dispatch.

  // 1) code_change → GitHub PR.
  if (p.type === "code_change") {
    return handleCodeChangeApproval(sb, p, params.id);
  }

  // 2) Handoff types (issue_critical, issue_high, geo_gap) → flip approved
  //    AND mark handed_off_to_coding. Coding runner picks it up.
  if (HANDOFF_TYPES.has(p.type)) {
    return handoffToCoding(sb, p, params.id);
  }

  // 3) blog_post: special branch — Coding handoff is the DEFAULT publish path.
  //    Falls through to legacy CMS publish only when both the feature flag
  //    and the platform are set.
  if (p.type === "blog_post") {
    const useLegacyCms =
      process.env.BLOG_PUBLISH_VIA_CMS === "true" &&
      (await blogPlatformSupportsCms(sb, p.company_id));
    if (useLegacyCms) {
      return handleBlogCmsPublish(sb, p, params.id);
    }
    return handoffToCoding(sb, p, params.id);
  }

  // 4) Everything else (audit_summary, code_change_skipped, custom types) —
  //    plain state flip to approved.
  const { data, error } = await sb
    .from("proposals")
    .update({ status: "approved", decided_at: new Date().toISOString() })
    .eq("id", params.id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Update failed." }, { status: 500 });
  }
  return NextResponse.json({ proposal: data });
}

// ---------------------------------------------------------------------------
// Dispatch helpers. Each owns one type's full lifecycle so the dispatch above
// stays readable. They all return a NextResponse.

async function handoffToCoding(
  sb: ReturnType<typeof supabaseServer>,
  p: Proposal,
  id: string,
): Promise<Response> {
  const { data, error } = await sb
    .from("proposals")
    .update({
      status: "approved",
      decided_at: new Date().toISOString(),
      handed_off_to_coding: true,
      // Clear any previous publish_error so a retry-handoff (after a
      // "couldn't synthesize" failure) starts clean.
      publish_error: null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Update failed." }, { status: 500 });
  }
  // The `handed_off: true` flag is what the client uses to toast
  // "Sent to Coding Agent." — separate from the proposal row itself.
  return NextResponse.json({ proposal: data, handed_off: true });
}

async function handleCodeChangeApproval(
  sb: ReturnType<typeof supabaseServer>,
  p: Proposal,
  id: string,
): Promise<Response> {
  const { data: company } = await sb
    .from("companies")
    .select("id, url, name, description, profile, created_at, platform, platform_meta")
    .eq("id", p.company_id)
    .single();
  if (!company) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }
  const co = company as Company;
  const payload = p.payload as unknown as CodeChangePayload;

  try {
    const pr = await openPullRequest(co, {
      branchName: payload.suggested_branch,
      commitMessage: payload.suggested_pr_title,
      prTitle: payload.suggested_pr_title,
      prBody: payload.suggested_pr_body,
      files: payload.files,
    });
    const { data, error } = await sb
      .from("proposals")
      .update({
        status: "published",
        publish_url: pr.url,
        publish_error: null,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) {
      return NextResponse.json({
        proposal: { ...p, status: "published", publish_url: pr.url },
        warning: `PR opened at ${pr.url} but failed to record: ${error?.message}`,
      });
    }
    return NextResponse.json({ proposal: data });
  } catch (err) {
    const msg =
      err instanceof GitHubNotConfiguredError
        ? err.message
        : err instanceof GitHubOperationError
        ? err.message
        : err instanceof Error
        ? err.message
        : "GitHub call failed.";
    const { data } = await sb
      .from("proposals")
      .update({
        status: "publish_failed",
        publish_error: msg.slice(0, 500),
      })
      .eq("id", id)
      .select("*")
      .single();
    return NextResponse.json(
      { proposal: data ?? p, error: msg },
      { status: 422 },
    );
  }
}

// Legacy CMS publish — preserved from earlier sessions, now only fires when
// BLOG_PUBLISH_VIA_CMS=true AND the company's detected platform has a
// connector (shopify / wordpress). All other blog approvals route to Coding.
async function handleBlogCmsPublish(
  sb: ReturnType<typeof supabaseServer>,
  p: Proposal,
  id: string,
): Promise<Response> {
  const { data: company } = await sb
    .from("companies")
    .select("id, url, name, description, profile, created_at, platform, platform_meta")
    .eq("id", p.company_id)
    .single();
  if (!company) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }
  const co = company as Company;
  const publisher = getPublisher(co.platform);
  if (!publisher) {
    // The feature-flag gate above already ensured the platform is supported,
    // but defend against a races (platform changed since the check).
    return handoffToCoding(sb, p, id);
  }

  const draft = p.payload as unknown as BlogDraft;
  try {
    const { url } = await publisher(co, draft);
    const { data, error } = await sb
      .from("proposals")
      .update({
        status: "published",
        publish_url: url,
        publish_error: null,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) {
      return NextResponse.json({
        proposal: { ...p, status: "published", publish_url: url },
        warning: `Published at ${url} but failed to update proposal row: ${error?.message}`,
      });
    }
    return NextResponse.json({ proposal: data });
  } catch (err) {
    const msg =
      err instanceof CmsNotConfiguredError
        ? err.message
        : err instanceof CmsPublishError
        ? err.message
        : err instanceof Error
        ? err.message
        : "Publish failed.";
    const { data } = await sb
      .from("proposals")
      .update({
        status: "publish_failed",
        publish_error: msg.slice(0, 500),
      })
      .eq("id", id)
      .select("*")
      .single();
    return NextResponse.json(
      { proposal: data ?? p, error: msg },
      { status: 422 },
    );
  }
}

async function blogPlatformSupportsCms(
  sb: ReturnType<typeof supabaseServer>,
  companyId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("companies")
    .select("platform")
    .eq("id", companyId)
    .single();
  const platform = data?.platform;
  return platform === "shopify" || platform === "wordpress";
}
