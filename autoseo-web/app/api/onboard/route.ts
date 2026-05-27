// POST /api/onboard
//
// 1. Audit the URL via the Node engine (also seeds the dashboard's first
//    Actions Feed card).
// 2. Ask the LLM (Gemini via the OpenAI-compatible endpoint) to infer company
//    name/description + first-pass documents.
// 3. Insert companies + documents + one summary proposal.
// 4. Return { companyId } so the client redirects to /dashboard?company=…
//
// All three of those degrade gracefully: if the engine is down we still create
// the company with hostname-derived defaults; if the LLM key is missing we
// skip the document generation.

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import { llm, hasLlmKey, LLM_MODEL } from "@/lib/llm";
import { runNodeAudit, EngineUnavailableError } from "@/lib/engines/node-audit";
import { proposalsFromAudit } from "@/lib/proposals";
import { detectPlatform } from "@/lib/connectors/detect";

export const runtime = "nodejs";

type ClassifyResult = {
  name: string;
  description: string;
  category: string;
  team_size: string;
  brand_voice_md: string;
  product_info_md: string;
};

const CLASSIFY_SYSTEM = `You analyze a company's homepage and return a JSON object
that captures who they are, in their own voice, for use as marketing context.

Return strictly:
{
  "name": "short brand/company name",
  "description": "one sentence (<= 24 words) describing what they do",
  "category": "industry/category, lowercase, hyphenated if needed",
  "team_size": "best guess: solo | small (2-10) | mid (11-50) | large (51+) | unknown",
  "brand_voice_md": "markdown notes on tone, voice principles, words to use, words to avoid",
  "product_info_md": "markdown summary of products/services, audience, primary use cases"
}
Never invent facts. If you cannot tell, write "unknown" or leave the markdown short.`;

export async function POST(req: Request) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase not configured. See .env.example." },
      { status: 500 }
    );
  }

  let rawUrl: string;
  try {
    const body = (await req.json()) as { url?: string };
    rawUrl = (body.url || "").trim();
    if (!rawUrl) throw new Error();
  } catch {
    return NextResponse.json({ error: "Provide a 'url' string." }, { status: 400 });
  }

  const url = normalizeUrl(rawUrl);
  const sb = supabaseServer();

  // 1. Audit (graceful if engine is offline — we still create the company).
  let audit: Awaited<ReturnType<typeof runNodeAudit>> | null = null;
  let auditError: string | null = null;
  try {
    audit = await runNodeAudit(url, { withFixes: true });
  } catch (err) {
    auditError =
      err instanceof EngineUnavailableError
        ? err.message
        : err instanceof Error
        ? err.message
        : String(err);
    console.warn("[onboard] audit failed:", auditError);
  }

  // 2. LLM classification (graceful if no key or model errors).
  const fallback = fallbackClassify(url, audit?.meta?.title);
  let classified: ClassifyResult = fallback;
  if (hasLlmKey()) {
    try {
      classified = await classifyWithLlm(url, audit);
    } catch (err) {
      console.warn("[onboard] classify failed:", err instanceof Error ? err.message : err);
    }
  }

  // 3. Detect the CMS platform — best-effort, never blocks onboarding. The
  // detector swallows all errors internally and returns 'unknown' on failure.
  const detection = await detectPlatform(url).catch(() => ({
    platform: "unknown" as const,
    meta: { error: "detection threw" },
  }));

  // 4. Insert company (now with platform + platform_meta).
  const { data: company, error: companyErr } = await sb
    .from("companies")
    .insert({
      url,
      name: classified.name,
      description: classified.description,
      profile: {
        category: classified.category,
        team_size: classified.team_size,
        audit_score: audit?.score ?? null,
        audit_grade: audit?.grade ?? null,
        first_audited_at: audit?.meta?.fetchedAt ?? null,
      },
      platform: detection.platform,
      platform_meta: detection.meta,
    })
    .select("id")
    .single();

  if (companyErr || !company) {
    return NextResponse.json(
      { error: companyErr?.message || "Insert failed" },
      { status: 500 }
    );
  }
  const companyId = company.id as string;

  // 4. Insert documents (only the two we can populate on first audit).
  if (classified.product_info_md || classified.brand_voice_md) {
    await sb.from("documents").insert([
      {
        company_id: companyId,
        kind: "product_info",
        title: "Product information",
        body: classified.product_info_md || "_(Generated on first audit. Edit anytime.)_",
      },
      {
        company_id: companyId,
        kind: "brand_voice",
        title: "Brand voice",
        body: classified.brand_voice_md || "_(Generated on first audit. Edit anytime.)_",
      },
    ]);
  }

  // 5. Seed the Actions Feed with the audit summary so the dashboard isn't empty.
  if (audit) {
    const props = proposalsFromAudit(audit);
    if (props.length) {
      await sb
        .from("proposals")
        .insert(props.map((p) => ({ ...p, company_id: companyId })));
    }
  } else if (auditError) {
    await sb.from("proposals").insert({
      company_id: companyId,
      agent_key: "seo",
      type: "engine_offline",
      title: "Audit engine offline",
      summary: auditError,
      payload: { engineUrl: process.env.NODE_ENGINE_URL || "http://localhost:3000" },
    });
  }

  return NextResponse.json({ companyId });
}

function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return u;
  }
}

function fallbackClassify(url: string, title?: string): ClassifyResult {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}
  return {
    name: title?.split(/[—|·-]/)[0].trim() || host,
    description: title || `Company at ${host}`,
    category: "unknown",
    team_size: "unknown",
    brand_voice_md: "_(Set GEMINI_API_KEY to auto-generate brand voice notes from the homepage.)_",
    product_info_md: "_(Set GEMINI_API_KEY to auto-generate product info from the homepage.)_",
  };
}

async function classifyWithLlm(
  url: string,
  audit: Awaited<ReturnType<typeof runNodeAudit>> | null
): Promise<ClassifyResult> {
  const client = llm();
  const context = {
    url,
    title: audit?.meta?.title ?? null,
    score: audit?.score ?? null,
    grade: audit?.grade ?? null,
    issues_top: (audit?.issues ?? []).slice(0, 6).map((i) => i.title),
  };

  // OpenAI-compatible (Gemini): system prompt is the first message, not a
  // separate top-level field. Response is choices[0].message.content (string).
  const completion = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 1500,
    messages: [
      { role: "system", content: CLASSIFY_SYSTEM },
      {
        role: "user",
        content:
          `Homepage audit context:\n${JSON.stringify(context, null, 2)}\n\n` +
          `Return only the JSON object described in the system prompt. No prose.`,
      },
    ],
  });

  const text = completion.choices?.[0]?.message?.content ?? "";
  return parseClassifyJson(text) ?? fallbackClassify(url, audit?.meta?.title);
}

function parseClassifyJson(text: string): ClassifyResult | null {
  // Tolerate prose framing — pluck the first {...} block.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as Partial<ClassifyResult>;
    if (!obj.name || !obj.description) return null;
    return {
      name: String(obj.name),
      description: String(obj.description),
      category: String(obj.category ?? "unknown"),
      team_size: String(obj.team_size ?? "unknown"),
      brand_voice_md: String(obj.brand_voice_md ?? ""),
      product_info_md: String(obj.product_info_md ?? ""),
    };
  } catch {
    return null;
  }
}

