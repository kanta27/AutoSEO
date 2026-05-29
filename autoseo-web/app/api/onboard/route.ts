// POST /api/onboard
//
// 1. Audit the URL via the Node engine (also seeds the dashboard's first
//    Actions Feed card).
// 2. Ask the LLM (Groq via the OpenAI-compatible endpoint) to infer company
//    name/description + first-pass documents.
// 3. Detect 3-5 competitors via a second LLM call, then validate each URL
//    with a HEAD fetch (3s timeout, Promise.allSettled). Detection failures
//    NEVER block onboarding.
// 4. Generate three more starter documents (competitor_analysis,
//    marketing_strategy, llms_txt) in one bundled LLM call so the Company
//    panel is populated from day one.
// 5. Insert companies + 5 starter documents + one summary proposal.
// 6. Return { companyId } so the client redirects to /dashboard?company=…
//
// All four LLM/network steps degrade gracefully: if the engine is down we
// still create the company with hostname-derived defaults; if the LLM key
// is missing we skip enrichment entirely; if competitor detection fails we
// store an empty array.

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import { llm, hasLlmKey, LLM_MODEL } from "@/lib/llm";
import { runNodeAudit, EngineUnavailableError } from "@/lib/engines/node-audit";
import { proposalsFromAudit } from "@/lib/proposals";
import { detectPlatform } from "@/lib/connectors/detect";
import type { Competitor } from "@/lib/supabase/types";

export const runtime = "nodejs";
// Onboarding fans out to several LLM + network calls; bump above the 60s
// default to cover the long tail (PSI-style slow LLM responses + 5x HEAD
// validations).
export const maxDuration = 120;

type ClassifyResult = {
  name: string;
  description: string;
  category: string;
  team_size: string;
  brand_voice_md: string;
  product_info_md: string;
};

type StarterDocsResult = {
  competitor_analysis_md: string;
  marketing_strategy_md: string;
  llms_txt: string;
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

const COMPETITORS_SYSTEM = `You identify direct competitors for a company. Return strictly:
{
  "competitors": [
    { "name": "Brand name", "url": "https://example.com" },
    ...
  ]
}
Rules:
- Up to 5 entries. Pick WELL-KNOWN, REAL companies that serve the same audience.
- url MUST be the company's actual public homepage, beginning with https://.
- Do NOT invent companies. If you can only name 2-3 real ones, return that.
- Do NOT include the input company itself.
- Output JSON only, no prose.`;

const STARTER_DOCS_SYSTEM = `You write three starter marketing documents for a company.
Return strictly JSON:
{
  "competitor_analysis_md": "...",
  "marketing_strategy_md": "...",
  "llms_txt": "..."
}

competitor_analysis_md: a short markdown bulleted summary of the supplied competitors
(one line per competitor: bold name then a one-line positioning + a note on what differentiates
the input company from them). 5-8 bullets max.

marketing_strategy_md: a markdown numbered list of 3-5 starter strategic ideas for this
company given its category and competitor landscape. Concrete, not generic.

llms_txt: a starter llms.txt file following the format at https://llmstxt.org.
Specifically:
  # {Company Name}
  > One-sentence description.

  ## About
  - 2-3 bullet points on the company.

  ## Products & Services
  - 2-3 bullet points on what they offer.

  ## Audience
  - 1-2 bullet points on who they serve.
Pure markdown. No code fences.

Never invent specific facts you weren't given (prices, customer names, exact dates).
Be useful but conservative.`;

// HEAD-validation cap and per-request timeout for competitor URLs.
const COMPETITOR_HEAD_TIMEOUT_MS = 3_000;
const MAX_COMPETITORS = 5;

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

  // 3. Detect competitors. The detector ALWAYS returns an array (possibly
  //    empty) — onboarding never fails because competitor enrichment fell over.
  const competitors = hasLlmKey()
    ? await detectCompetitors(classified.name, url, classified.category).catch((err) => {
        console.warn(
          "[onboard] competitor detection failed:",
          err instanceof Error ? err.message : err,
        );
        return [] as Competitor[];
      })
    : [];

  // 4. Bundle the three new starter docs into ONE LLM call so we don't pay
  //    three round-trips. Fallback strings ensure the docs still get created
  //    even if this step bombs.
  let starter: StarterDocsResult = fallbackStarterDocs(classified.name, classified.description);
  if (hasLlmKey()) {
    try {
      starter = await generateStarterDocs(classified, competitors);
    } catch (err) {
      console.warn(
        "[onboard] starter docs failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 5. Detect the CMS platform — best-effort, never blocks onboarding. The
  // detector swallows all errors internally and returns 'unknown' on failure.
  const detection = await detectPlatform(url).catch(() => ({
    platform: "unknown" as const,
    meta: { error: "detection threw" },
  }));

  // 6. Insert company. Both `category` (new column) and `profile.category`
  //    (legacy location) get written so anything still reading from profile
  //    keeps working until it's migrated.
  const { data: company, error: companyErr } = await sb
    .from("companies")
    .insert({
      url,
      name: classified.name,
      description: classified.description,
      category: classified.category && classified.category !== "unknown"
        ? classified.category
        : null,
      competitors,
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

  // 7. Insert the 5 starter documents. Each gets `meta: { is_starter: true }`
  //    so the Company panel can render a "New" badge until edit-doc lands.
  const STARTER_META = { is_starter: true };
  await sb.from("documents").insert([
    {
      company_id: companyId,
      kind: "product_info",
      title: "Product Information",
      body: classified.product_info_md || "_(Set GROQ_API_KEY to auto-generate.)_",
      meta: STARTER_META,
    },
    {
      company_id: companyId,
      kind: "brand_voice",
      title: "Brand Voice",
      body: classified.brand_voice_md || "_(Set GROQ_API_KEY to auto-generate.)_",
      meta: STARTER_META,
    },
    {
      company_id: companyId,
      kind: "competitor_analysis",
      title: "Competitor Analysis",
      body: starter.competitor_analysis_md,
      meta: STARTER_META,
    },
    {
      company_id: companyId,
      kind: "marketing_strategy",
      title: "Marketing Strategy",
      body: starter.marketing_strategy_md,
      meta: STARTER_META,
    },
    {
      company_id: companyId,
      kind: "llms_txt",
      title: "llms.txt",
      body: starter.llms_txt,
      meta: STARTER_META,
    },
  ]);

  // 8. Seed the Actions Feed with the audit summary so the dashboard isn't empty.
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

// ---------------------------------------------------------------------------
// Helpers

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
    brand_voice_md: "_(Set GROQ_API_KEY to auto-generate brand voice notes from the homepage.)_",
    product_info_md: "_(Set GROQ_API_KEY to auto-generate product info from the homepage.)_",
  };
}

function fallbackStarterDocs(name: string, description: string): StarterDocsResult {
  return {
    competitor_analysis_md:
      "_(Competitor analysis will populate once GROQ_API_KEY is set. Use the edit pencil on the Competitors grid to add competitors manually.)_",
    marketing_strategy_md:
      "_(Marketing strategy will populate once GROQ_API_KEY is set.)_",
    llms_txt:
      `# ${name}\n> ${description || "_(no description)_"}\n\n## About\n- _(generated on first audit)_\n`,
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

  // OpenAI-compatible (Groq): system prompt is the first message, not a
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

// ---------------------------------------------------------------------------
// Competitor detection — LLM → JSON list → HEAD validation in parallel.

async function detectCompetitors(
  companyName: string,
  companyUrl: string,
  category: string,
): Promise<Competitor[]> {
  const client = llm();
  const completion = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 800,
    messages: [
      { role: "system", content: COMPETITORS_SYSTEM },
      {
        role: "user",
        content:
          `Company: ${companyName}\n` +
          `URL: ${companyUrl}\n` +
          `Category: ${category || "(unknown)"}\n\n` +
          `Return only the JSON object. Up to 5 well-known direct competitors.`,
      },
    ],
  });

  const text = completion.choices?.[0]?.message?.content ?? "";
  const candidates = parseCompetitorsJson(text, companyUrl);
  if (candidates.length === 0) return [];

  // Validate every candidate URL in parallel — one slow site never holds up
  // the others. Cap with MAX_COMPETITORS after filtering out failures.
  const settled = await Promise.allSettled(
    candidates.map((c) => validateUrl(c.url)),
  );
  const valid: Competitor[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const r = settled[i];
    if (r.status === "fulfilled" && r.value === true) {
      valid.push({
        name: candidates[i].name,
        url: candidates[i].url,
        source: "detected",
      });
    }
    if (valid.length >= MAX_COMPETITORS) break;
  }
  return valid;
}

function parseCompetitorsJson(
  text: string,
  excludeUrl: string,
): Array<{ name: string; url: string }> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let parsed: { competitors?: Array<{ name?: unknown; url?: unknown }> };
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return [];
  }
  const raw = parsed.competitors;
  if (!Array.isArray(raw)) return [];
  const excludeHost = safeHost(excludeUrl);
  const seen = new Set<string>();
  const out: Array<{ name: string; url: string }> = [];
  for (const item of raw) {
    if (!item) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const urlRaw = typeof item.url === "string" ? item.url.trim() : "";
    if (!name || !urlRaw) continue;
    const url = ensureHttpsUrl(urlRaw);
    if (!url) continue;
    const host = safeHost(url);
    if (!host) continue;
    // Reject the input company itself and duplicates from the LLM.
    if (host === excludeHost) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    out.push({ name, url });
  }
  return out;
}

// HEAD a URL with a tight timeout. Accept any 2xx/3xx; reject 4xx/5xx and
// any throw (DNS, timeout, TLS error). Some hosts refuse HEAD — for v1 those
// are simply missed rather than retried as GET.
async function validateUrl(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), COMPETITOR_HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        // A real UA so polite scrapers (Cloudflare etc) don't 403 us on principle.
        "user-agent": "AutoSEO-Onboarding/1.0 (+https://autoseo.live)",
      },
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function ensureHttpsUrl(raw: string): string | null {
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Strip a trailing slash off the origin-only form so the stored URL is
    // canonical and dedup-friendly.
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

// ---------------------------------------------------------------------------
// Starter docs bundle — ONE LLM call returning all three markdown blocks.

async function generateStarterDocs(
  classified: ClassifyResult,
  competitors: Competitor[],
): Promise<StarterDocsResult> {
  const client = llm();
  const completion = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 1800,
    messages: [
      { role: "system", content: STARTER_DOCS_SYSTEM },
      {
        role: "user",
        content:
          `Company: ${classified.name}\n` +
          `Description: ${classified.description}\n` +
          `Category: ${classified.category}\n` +
          `Competitors: ${
            competitors.length
              ? competitors.map((c) => `${c.name} (${c.url})`).join(", ")
              : "(none detected)"
          }\n\n` +
          `Return only the JSON object. Markdown bodies, no code fences.`,
      },
    ],
  });

  const text = completion.choices?.[0]?.message?.content ?? "";
  const parsed = parseStarterDocsJson(text);
  if (parsed) return parsed;
  // LLM came back malformed — return fallbacks rather than blowing up.
  return fallbackStarterDocs(classified.name, classified.description);
}

function parseStarterDocsJson(text: string): StarterDocsResult | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as Partial<StarterDocsResult>;
    return {
      competitor_analysis_md: String(obj.competitor_analysis_md ?? "").trim(),
      marketing_strategy_md: String(obj.marketing_strategy_md ?? "").trim(),
      llms_txt: String(obj.llms_txt ?? "").trim(),
    };
  } catch {
    return null;
  }
}
