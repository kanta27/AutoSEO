// POST /api/companies/:id/competitors  { competitors: [{ name?: string, url: string }] }
//
// Replaces the company's MANUAL competitors with the supplied list. Detected
// competitors (the onboarding LLM's output) are preserved — the manual list
// is layered on top, so the user can curate without losing the auto-detected
// baseline.
//
// Validation rules (kept tight so a sloppy textarea entry can't poison the row):
//   • URL is required, name optional (defaults to the hostname).
//   • URL must parse to http/https.
//   • Hostname must be unique within the manual list AND not collide with the
//     existing detected list (we let detected take precedence).
//   • Cap at 10 manual entries to keep the panel readable.
//
// No HEAD-validation here — we trust the user; if a manual URL is wrong they
// can edit it. Onboarding only HEAD-validates because the LLM might invent
// URLs.

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Competitor } from "@/lib/supabase/types";

export const runtime = "nodejs";

const MAX_MANUAL_COMPETITORS = 10;

type Body = {
  competitors?: Array<{ name?: unknown; url?: unknown }>;
};

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase not configured." },
      { status: 500 },
    );
  }
  const companyId = params.id;
  if (!companyId) {
    return NextResponse.json({ error: "Missing company id." }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const rawList = Array.isArray(body.competitors) ? body.competitors : [];

  const sb = supabaseServer();
  const { data: company, error: readErr } = await sb
    .from("companies")
    .select("competitors")
    .eq("id", companyId)
    .maybeSingle();
  if (readErr || !company) {
    return NextResponse.json(
      { error: readErr?.message || "Company not found." },
      { status: 404 },
    );
  }
  // Detected list stays untouched. We REPLACE all rows whose source === 'manual'.
  const existing = Array.isArray(company.competitors)
    ? (company.competitors as Competitor[])
    : [];
  const detected = existing.filter((c) => c.source === "detected");
  const detectedHosts = new Set(
    detected
      .map((c) => safeHost(c.url))
      .filter((h) => h.length > 0),
  );

  const seen = new Set<string>(detectedHosts);
  const manual: Competitor[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const urlRaw = typeof item.url === "string" ? item.url.trim() : "";
    if (!urlRaw) continue;
    const url = ensureHttpsUrl(urlRaw);
    if (!url) continue;
    const host = safeHost(url);
    if (!host) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    const name =
      typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : host;
    manual.push({ name, url, source: "manual" });
    if (manual.length >= MAX_MANUAL_COMPETITORS) break;
  }

  const merged: Competitor[] = [...detected, ...manual];
  const { error: updErr } = await sb
    .from("companies")
    .update({ competitors: merged })
    .eq("id", companyId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    competitors: merged,
    counts: { detected: detected.length, manual: manual.length },
  });
}

function ensureHttpsUrl(raw: string): string | null {
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
