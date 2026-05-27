// POST /api/proposals/:id  { decision: "approved" | "rejected" }
//
// Flips a proposal's status. For most proposal types this is just a state
// change — the user is signalling "I accept the agent's suggestion". For
// `blog_post` proposals, an approval also triggers the CMS connector to
// publish the article; on success the proposal moves to `published` with
// the live URL stored. On failure it moves to `publish_failed` with the
// error text — the user can adjust env config and POST again with
// `{ decision: "approved" }` to retry.
//
// Connectors are the ONLY external writers in this app and are only ever
// invoked here, never by an agent directly. This is the human gate.

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import { getPublisher } from "@/lib/connectors";
import {
  CmsNotConfiguredError,
  CmsPublishError,
  type BlogDraft,
} from "@/lib/connectors/types";
import type { Company, Proposal } from "@/lib/supabase/types";

export const runtime = "nodejs";

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

  // Allow decide on `pending`, AND on `publish_failed` (retry path).
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
    decision === "approved" && p.status === "publish_failed" && p.type === "blog_post";
  if (p.status !== "pending" && !isRetryablePublishFail) {
    return NextResponse.json(
      { error: `Proposal already ${p.status}.` },
      { status: 409 },
    );
  }

  // Rejection is always a simple state flip, regardless of type.
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

  // Approval. For blog_post we run the publish step; for other types we just
  // mark approved (real publish actions for those types land in future sessions).
  if (p.type !== "blog_post") {
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

  // blog_post approval. Dispatch by the company's detected platform:
  //   shopify / wordpress → call the matching connector
  //   unknown / unsupported → MANUAL mode: mark approved but DON'T publish.
  //                            The UI surfaces Copy-markdown buttons.
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

  // Manual mode — no connector to call. Move to `approved` with publish_url
  // null; the UI keys off (approved && type==='blog_post' && !publish_url) to
  // show Copy buttons.
  if (!publisher) {
    const { data, error } = await sb
      .from("proposals")
      .update({
        status: "approved",
        publish_url: null,
        publish_error: null,
        decided_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .select("*")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Update failed." }, { status: 500 });
    }
    return NextResponse.json({ proposal: data, manual: true });
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
      .eq("id", params.id)
      .select("*")
      .single();
    if (error || !data) {
      // Publishing succeeded externally but we couldn't record it — surface
      // the URL anyway so the user knows the article is live.
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
        // Don't set decided_at on a failed publish — that way the next retry
        // can still pass the "must be pending or publish_failed" guard, and
        // the activity log distinguishes "decided" from "tried to decide".
      })
      .eq("id", params.id)
      .select("*")
      .single();
    return NextResponse.json(
      {
        proposal: data ?? p,
        error: msg,
      },
      { status: 422 },
    );
  }
}
