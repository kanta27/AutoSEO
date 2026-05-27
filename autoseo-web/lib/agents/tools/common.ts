// Tools every agent can pull from. Each is read-only (no external writes) so
// it's safe to expose to any agent — destructive operations live in
// `lib/connectors/` and only run from the approval handler.
import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import type { AgentTool } from "./index";

// ---------------------------------------------------------------------------
// get_company_context — name, URL, description, profile + brand voice + product
// info documents (the brand-voice doc is the source-of-truth for tone).
export const getCompanyContextTool: AgentTool = {
  name: "get_company_context",
  description:
    "Return the company's identity (name, URL, description, profile JSON) and any " +
    "available context documents (brand_voice, product_info). Call this first.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const sb = supabaseServer();
    const { data: docs } = await sb
      .from("documents")
      .select("kind, title, body")
      .eq("company_id", ctx.company.id);
    const byKind: Record<string, string> = {};
    for (const d of docs ?? []) byKind[d.kind] = d.body;
    return {
      ok: true,
      data: {
        company: {
          name: ctx.company.name,
          url: ctx.company.url,
          description: ctx.company.description,
          profile: ctx.company.profile,
        },
        brand_voice_md: byKind.brand_voice ?? null,
        product_info_md: byKind.product_info ?? null,
        competitor_analysis_md: byKind.competitor_analysis ?? null,
        marketing_strategy_md: byKind.marketing_strategy ?? null,
      },
      log_summary: `company=${ctx.company.name}; docs=${Object.keys(byKind).length}`,
    };
  },
};

// ---------------------------------------------------------------------------
// get_keyword_gaps — pulls signal from existing audit proposals for this
// company. v1 lives off what's already been mined; the richer Python-swarm
// integration is the explicit Competitor-strategy follow-up.
export const getKeywordGapsTool: AgentTool = {
  name: "get_keyword_gaps",
  description:
    "Return a list of likely keyword/topic gaps for this company, derived from " +
    "the most recent SEO/GEO audit. Each gap has: { topic, evidence, severity }. " +
    "If no audit data exists, returns an empty list with a note — the agent should " +
    "then brainstorm from get_company_context.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const sb = supabaseServer();
    const { data: proposals } = await sb
      .from("proposals")
      .select("type, title, summary, payload, created_at")
      .eq("company_id", ctx.company.id)
      .in("type", ["audit_summary", "geo_gap", "issue_critical", "issue_high"])
      .order("created_at", { ascending: false })
      .limit(30);

    const gaps: Array<{ topic: string; evidence: string; severity: string }> = [];
    for (const p of proposals ?? []) {
      if (p.type === "geo_gap") {
        const gap = (p.payload as { gap?: { topic?: string; suggested_addition?: string } })?.gap;
        if (gap?.topic) {
          gaps.push({
            topic: gap.topic,
            evidence: gap.suggested_addition ?? p.summary ?? "",
            severity: "high",
          });
        }
      } else if (p.type === "issue_critical" || p.type === "issue_high") {
        gaps.push({
          topic: p.title,
          evidence: p.summary ?? "",
          severity: p.type === "issue_critical" ? "critical" : "high",
        });
      }
    }

    return {
      ok: true,
      data: {
        gaps,
        note:
          gaps.length === 0
            ? "No audit data yet — brainstorm keyword/topic angles from get_company_context."
            : null,
      },
      log_summary: `${gaps.length} gap(s) from audit data`,
    };
  },
};

// ---------------------------------------------------------------------------
// web_search — Tavily-backed when TAVILY_API_KEY is set, otherwise returns
// a clear "not configured" so the agent proceeds without external research.
// Verified shape: POST https://api.tavily.com/search, Authorization: Bearer,
// body { query }, response { results: [{ title, url, content, score, ... }] }.
export const webSearchTool: AgentTool = {
  name: "web_search",
  description:
    "Search the public web for current, citable facts about a topic. Use sparingly " +
    "(network call). Returns up to 5 results: title, url, short content snippet. " +
    "Returns { available: false, reason } when the search provider is not configured.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (be specific)." },
      max_results: {
        type: "integer",
        description: "Cap on results (1-5). Defaults to 5.",
        minimum: 1,
        maximum: 5,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return {
        ok: true,
        data: {
          available: false,
          reason:
            "TAVILY_API_KEY is not set — proceed without external research.",
        },
        log_summary: "tavily not configured",
      };
    }
    const query = String(args.query ?? "").trim();
    if (!query) {
      return { ok: false, data: { error: "Empty query." } };
    }
    const maxResults = Math.max(1, Math.min(5, Number(args.max_results ?? 5)));
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, max_results: maxResults }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          data: { error: `Tavily ${res.status}: ${text.slice(0, 200)}` },
        };
      }
      const j = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
      };
      const results = (j.results ?? []).slice(0, maxResults).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        content: (r.content ?? "").slice(0, 400),
        score: r.score ?? 0,
      }));
      return {
        ok: true,
        data: { available: true, results },
        log_summary: `tavily q="${query.slice(0, 60)}" → ${results.length} result(s)`,
      };
    } catch (err) {
      return {
        ok: false,
        data: {
          error: err instanceof Error ? err.message : "Tavily call failed.",
        },
      };
    }
  },
};
