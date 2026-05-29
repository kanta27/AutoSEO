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
import type { Competitor, DocumentKind } from "@/lib/supabase/types";
import {
  generateAllStarterDocs,
  STARTER_DOC_TITLES,
} from "@/lib/onboarding/starter-docs";

export const runtime = "nodejs";
// Onboarding fans out to several LLM + network calls; bump above the 60s
// default to cover the long tail (PSI-style slow LLM responses + 5x HEAD
// validations).
export const maxDuration = 120;

// Classify only handles the small structured fields now. The two markdown
// bodies it used to return (brand_voice_md, product_info_md) silently failed
// when the LLM truncated the bundled JSON — see lib/onboarding/starter-docs.ts
// for the per-kind replacements that own those bodies now.
type ClassifyResult = {
  name: string;
  description: string;
  category: string;
  team_size: string;
};

const CLASSIFY_SYSTEM = `You analyze a company's homepage and return a JSON object
that captures who they are at a glance, for downstream marketing tools.

Return strictly:
{
  "name": "short brand/company name",
  "description": "one sentence (<= 24 words) describing what they do",
  "category": "industry/category, lowercase, hyphenated if needed",
  "team_size": "best guess: solo | small (2-10) | mid (11-50) | large (51+) | unknown"
}
Never invent facts. If you cannot tell, write "unknown".`;

const COMPETITORS_SYSTEM = `You are identifying DIRECT competitors for a company.

A DIRECT competitor must:
- Operate in the EXACT same category (not adjacent — restaurant-delivery is NOT a competitor
  to meal-kit-delivery; SaaS-CRM is NOT a competitor to SaaS-helpdesk; B2B accounting is NOT
  a competitor to B2C personal finance).
- Be a well-known company (Wikipedia-tier name recognition or close to it). Don't invent.
- Have a working public website at a clean domain (https + the canonical homepage).
- Be the SAME shape of business — same audience (B2C vs B2B), same monetisation model,
  similar pricing tier.

Return strictly:
{
  "competitors": [
    { "name": "Brand name", "url": "https://www.example.com", "reason": "one short sentence" }
  ]
}

Rules:
- 5 competitors maximum. 3 is fine if you can't think of 5 strong ones.
- "reason": ONE short sentence on why they compete (same category + same shape).
- DO NOT include companies in adjacent-but-different categories.
- DO NOT include the input company itself.
- DO NOT include marketplaces or aggregators unless the input company IS one.
- Output JSON only, no prose, no code fences.

Example for "Meal Kit Delivery Service":
{
  "competitors": [
    { "name": "HelloFresh", "url": "https://www.hellofresh.com",
      "reason": "Largest meal-kit delivery service; same B2C subscription model." },
    { "name": "Blue Apron", "url": "https://www.blueapron.com",
      "reason": "Pioneer of meal-kit delivery; direct B2C competitor." },
    { "name": "Home Chef", "url": "https://www.homechef.com",
      "reason": "Meal-kit subscription with similar audience and pricing tier." }
  ]
}

Counter-example (DO NOT return these for a meal-kit service):
- Grubhub / DoorDash / Uber Eats — restaurant DELIVERY, not meal kits.
- Instacart — grocery delivery, not meal kits.
- Walmart / Whole Foods — grocery retail, different shape entirely.`;

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
    ? await detectCompetitors({
        name: classified.name,
        url,
        category: classified.category,
        description: classified.description,
      }).catch((err) => {
        console.warn(
          "[onboard] competitor detection failed:",
          err instanceof Error ? err.message : err,
        );
        return [] as Competitor[];
      })
    : [];

  // 4. Generate all five starter documents IN PARALLEL — one prompt per kind,
  //    plain markdown output (no JSON parsing to break), Promise.allSettled
  //    so a single 429 / transient error never poisons the other four. Per-
  //    kind failures get REGEN_PLACEHOLDER + meta.regeneration_pending=true
  //    so the document viewer can offer a Regenerate button without re-
  //    running the four successful kinds.
  const starterDocs = hasLlmKey()
    ? await generateAllStarterDocs({
        name: classified.name,
        url,
        category: classified.category,
        description: classified.description,
        competitors,
      })
    : [];

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

  // 7. Insert the starter documents. Each carries `meta.is_starter: true`
  //    (drives nothing now but signals "this came from onboarding" — useful
  //    for telemetry and the future Reset-to-starter flow). Per-kind
  //    failures additionally carry `meta.regeneration_pending: true` so the
  //    document viewer offers Regenerate.
  type StarterDocRow = {
    company_id: string;
    kind: DocumentKind;
    title: string;
    body: string;
    meta: { is_starter: true; regeneration_pending?: boolean };
  };
  const rows: StarterDocRow[] = starterDocs.map((d) => ({
    company_id: companyId,
    kind: d.kind,
    title: STARTER_DOC_TITLES[d.kind] ?? d.kind,
    body: d.body,
    meta: d.failed
      ? { is_starter: true, regeneration_pending: true }
      : { is_starter: true },
  }));
  await sb.from("documents").insert(rows);

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
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Competitor detection — LLM → JSON list → tolerant validation.
//
// Validation contract:
//   • Try HEAD first (cheap). 2xx/3xx → ok.
//   • If HEAD returns 403/405, treat as "site exists but blocking bots" — keep.
//   • Else fall back to GET with `Range: bytes=0-0` (one-byte read).
//   • Each attempt has a 3-second timeout.
//   • For each LLM candidate, try BOTH the bare hostname and its `www.`
//     counterpart — whichever resolves first wins, and that variant becomes
//     the stored URL.
//
// Both axes (HEAD/GET and bare/www) were added after Session 2's first
// detection on easypans.com returned only `grubhub.com` (wrong category) —
// the HEAD-only path was dropping real meal-kit homepages that 403 on HEAD.

// "Mozilla-shaped" UA — matches the brief. Real-browser shape so Cloudflare
// and friends don't reflexively 403 us, while still identifying as us in the
// comment.
const COMPETITOR_USER_AGENT =
  "Mozilla/5.0 (compatible; AutoSEO competitor check)";

async function detectCompetitors(input: {
  name: string;
  url: string;
  category: string;
  description: string;
}): Promise<Competitor[]> {
  const client = llm();
  let completion;
  try {
    completion = await client.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 1000,
      // Ask Groq's compat endpoint for a JSON object directly. Some models
      // ignore this and return prose anyway, so we still parse defensively
      // below — but when honoured it removes the "extracted code-fence by
      // accident" failure mode entirely.
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: COMPETITORS_SYSTEM },
        {
          role: "user",
          content:
            `Company:        ${input.name}\n` +
            `Website:        ${input.url}\n` +
            `Category:       ${input.category || "(unknown)"}\n` +
            `Description:    ${input.description || "(unknown)"}\n\n` +
            `Return only the JSON object described in the system prompt. 3-5 ` +
            `DIRECT competitors in the EXACT same category, same business shape.`,
        },
      ],
    });
  } catch (err) {
    console.warn(
      "[onboard:detect-competitors] LLM call failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }

  const text = completion.choices?.[0]?.message?.content ?? "";
  const candidates = parseCompetitorsJson(text, input.url);
  if (candidates.length === 0) {
    console.warn(
      "[onboard:detect-competitors] LLM returned no usable candidates.",
    );
    return [];
  }

  // Resolve every candidate in parallel. Each resolution tries up to 4
  // request variants (HEAD/GET × bare/www), but the per-request timeout is
  // 3s and they short-circuit on first success, so the wall-clock ceiling
  // for the whole step stays bounded.
  const settled = await Promise.allSettled(
    candidates.map((c) => resolveCompetitorUrl(c.url)),
  );

  const valid: Competitor[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const r = settled[i];
    if (r.status === "fulfilled" && r.value) {
      valid.push({
        name: candidates[i].name,
        url: r.value,
        source: "detected",
      });
    }
    if (valid.length >= MAX_COMPETITORS) break;
  }
  if (valid.length === 0) {
    console.warn(
      `[onboard:detect-competitors] 0/${candidates.length} candidates passed validation.`,
    );
  }
  return valid;
}

function parseCompetitorsJson(
  text: string,
  excludeUrl: string,
): Array<{ name: string; url: string }> {
  // Strict JSON-mode usually gives us a clean object; otherwise pluck the
  // first {...} block out of any surrounding prose / code fences.
  const candidate = text.trim().startsWith("{")
    ? text
    : text.match(/\{[\s\S]*\}/)?.[0] ?? "";
  if (!candidate) return [];
  let parsed: { competitors?: Array<{ name?: unknown; url?: unknown }> };
  try {
    parsed = JSON.parse(candidate);
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
    // Reject the input company itself and duplicates from the LLM. The
    // hostname comparison ignores www. so a www/non-www flip doesn't sneak
    // the company past the filter.
    if (host === excludeHost) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    out.push({ name, url });
  }
  return out;
}

// Try the URL as given, then its www-flipped counterpart. Returns the first
// variant that responded as "reachable", or null if all variants failed.
async function resolveCompetitorUrl(url: string): Promise<string | null> {
  const variants = candidateUrlVariants(url);
  for (const v of variants) {
    if (await isReachable(v)) return v;
  }
  return null;
}

// Yield the URL itself plus its www-flipped counterpart, deduped + normalised.
function candidateUrlVariants(url: string): string[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  // Force https on every variant — the brief calls for this even when the
  // LLM hands us http://.
  u.protocol = "https:";
  u.hash = "";
  u.search = "";
  const out = new Set<string>();
  out.add(stripTrailingSlash(u.toString()));
  const host = u.hostname.toLowerCase();
  const flipped = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  try {
    const alt = new URL(u.toString());
    alt.hostname = flipped;
    out.add(stripTrailingSlash(alt.toString()));
  } catch {
    /* ignore — original is already in the set */
  }
  return Array.from(out);
}

type ReachabilityProbe = "ok" | "blocked" | "fail";

// "Reachable" means: the server answered, AND either it accepted us or it
// rejected us with a status that proves the URL itself exists (403/405).
// Anything else — 4xx not-found, 5xx error, or a network throw — is "fail".
async function isReachable(url: string): Promise<boolean> {
  const head = await probe(url, "HEAD");
  if (head === "ok" || head === "blocked") return true;
  const get = await probe(url, "GET");
  return get === "ok" || get === "blocked";
}

async function probe(url: string, method: "HEAD" | "GET"): Promise<ReachabilityProbe> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), COMPETITOR_HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": COMPETITOR_USER_AGENT,
        // Single-byte read on GET so a "Cloudflare-blocks-HEAD-but-allows-GET"
        // host doesn't make us pull the whole homepage.
        ...(method === "GET" ? { range: "bytes=0-0" } : {}),
      },
    });
    if (res.status >= 200 && res.status < 400) return "ok";
    // 403 (forbidden) and 405 (method not allowed) both prove the URL exists
    // on a real server — keep these. 404 / 410 / 5xx are real "no" answers.
    if (res.status === 403 || res.status === 405) return "blocked";
    return "fail";
  } catch {
    return "fail";
  } finally {
    clearTimeout(t);
  }
}

function stripTrailingSlash(url: string): string {
  // Strip trailing slash on the origin-only form so dedup + storage is canonical.
  // Path-having URLs keep their trailing slash where it's meaningful.
  return url.replace(/\/$/, "");
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

