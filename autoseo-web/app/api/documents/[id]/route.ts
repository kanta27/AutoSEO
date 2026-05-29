// GET  /api/documents/:id            → returns the document row.
//                                       Marks viewed_at = now() on first read.
// PUT  /api/documents/:id  { body }  → updates body, sets user_edited=true,
//                                       bumps updated_at. Cap: 50,000 chars.
//
// Same secrecy posture as /api/proposals/:id — no auth on the route itself;
// service-role access in supabaseServer() is the guarantor that arbitrary
// callers can't reach this from the public internet without first making it
// past the deployment edge.
import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_BODY_CHARS = 50_000;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase not configured." },
      { status: 500 },
    );
  }
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data: doc, error } = await sb
    .from("documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  // First view → stamp viewed_at. We deliberately do NOT update viewed_at on
  // subsequent reads — it's a "did the user ever look at this" signal, not a
  // last-touch timestamp.
  if (!doc.viewed_at) {
    const now = new Date().toISOString();
    const { error: updErr } = await sb
      .from("documents")
      .update({ viewed_at: now })
      .eq("id", id);
    if (!updErr) {
      doc.viewed_at = now;
    }
  }

  return NextResponse.json({ ok: true, document: doc });
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase not configured." },
      { status: 500 },
    );
  }
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const body = (raw as { body?: unknown })?.body;
  if (typeof body !== "string") {
    return NextResponse.json(
      { error: "Body must be a string." },
      { status: 400 },
    );
  }
  if (body.length > MAX_BODY_CHARS) {
    return NextResponse.json(
      {
        error:
          `Body is ${body.length.toLocaleString()} characters — the cap is ` +
          `${MAX_BODY_CHARS.toLocaleString()}. Please shorten or split this document.`,
      },
      { status: 413 },
    );
  }

  const sb = supabaseServer();
  const now = new Date().toISOString();
  const { data: doc, error } = await sb
    .from("documents")
    .update({
      body,
      user_edited: true,
      updated_at: now,
      // Mark viewed too — if the user is editing the doc, "viewed" is
      // self-evidently true. Prevents a weird "Edited but never viewed"
      // state if the editor is opened by deep link.
      viewed_at: now,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, document: doc });
}
