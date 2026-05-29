// POST /api/documents/:id/regenerate
//
// Re-runs the per-kind prompt from lib/onboarding/starter-docs.ts for ONE
// document and writes the result back. Used by the "Regenerate with AI"
// button on the document viewer for:
//
//   • Documents that came out of onboarding with the
//     `meta.regeneration_pending=true` flag (per-kind LLM failure).
//   • Legacy documents from before this fix landed whose body is one of
//     the old `(Set GROQ_API_KEY ...)` placeholder strings.
//
// Same secrecy posture as /api/documents/:id: service-role on the server
// side, no public auth on the route itself yet.
import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import { hasLlmKey } from "@/lib/llm";
import {
  regenerateStarterDoc,
  STARTER_DOC_KINDS,
} from "@/lib/onboarding/starter-docs";
import type { Competitor, DocumentKind } from "@/lib/supabase/types";

export const runtime = "nodejs";
// Llama 3.3 70B can take 15-25s for one of these prompts on a busy day.
// Budget above that so the route doesn't 504 mid-call.
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured." },
      { status: 500 },
    );
  }
  if (!hasLlmKey()) {
    return NextResponse.json(
      { ok: false, error: "GROQ_API_KEY missing." },
      { status: 500 },
    );
  }
  const id = params.id;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });
  }

  const sb = supabaseServer();

  // Read the document so we know which kind to regenerate.
  const { data: doc, error: docErr } = await sb
    .from("documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (docErr) {
    return NextResponse.json(
      { ok: false, error: docErr.message },
      { status: 500 },
    );
  }
  if (!doc) {
    return NextResponse.json(
      { ok: false, error: "Document not found." },
      { status: 404 },
    );
  }
  const kind = doc.kind as DocumentKind;
  if (!STARTER_DOC_KINDS.includes(kind)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Regenerate not supported for kind "${kind}". ` +
          `Only the starter kinds (${STARTER_DOC_KINDS.join(", ")}) have prompts.`,
      },
      { status: 400 },
    );
  }

  // Pull the parent company for prompt context.
  const { data: company, error: coErr } = await sb
    .from("companies")
    .select("id, name, url, description, category, competitors")
    .eq("id", doc.company_id)
    .maybeSingle();
  if (coErr || !company) {
    return NextResponse.json(
      { ok: false, error: coErr?.message || "Company not found." },
      { status: 404 },
    );
  }

  const competitors = Array.isArray(company.competitors)
    ? (company.competitors as Competitor[])
    : [];

  let newBody: string;
  try {
    newBody = await regenerateStarterDoc(kind, {
      name: company.name,
      url: company.url,
      category: company.category ?? "",
      description: company.description ?? "",
      competitors,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[api:documents:regenerate] kind=${kind} failed:`, reason);
    return NextResponse.json(
      { ok: false, error: `Regeneration failed: ${reason}` },
      { status: 502 },
    );
  }

  // Merge into existing meta — preserve is_starter and any future fields,
  // strip regeneration_pending. user_edited stays whatever it was; the user
  // is performing a regenerate, not a manual edit.
  const existingMeta =
    doc.meta && typeof doc.meta === "object" && !Array.isArray(doc.meta)
      ? { ...(doc.meta as Record<string, unknown>) }
      : {};
  delete existingMeta.regeneration_pending;

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await sb
    .from("documents")
    .update({
      body: newBody,
      meta: existingMeta,
      updated_at: now,
      // Mark viewed too — the user is clearly looking at it.
      viewed_at: doc.viewed_at ?? now,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (updErr || !updated) {
    return NextResponse.json(
      { ok: false, error: updErr?.message || "Update failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, document: updated });
}
