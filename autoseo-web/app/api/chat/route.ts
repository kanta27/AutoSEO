// POST /api/chat  { companyId, messages: [{role, content}] }  → SSE stream of
// `{ delta }` chunks, terminated by `[DONE]`. Server-side only; the MeshAPI
// key never reaches the browser.

import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import { llm, hasLlmKey, LLM_MODEL } from "@/lib/llm";
import type { Company, CompanyDocument, Proposal } from "@/lib/supabase/types";

export const runtime = "nodejs";

const SYSTEM_BASE = `You are the AI CMO for AutoSEO.live, a marketing platform.
You answer the user's questions about their company's SEO/GEO state, recommend
next actions, and explain audit findings in plain language.

Rules:
- Ground every claim in the company context provided. Quote scores, issue titles,
  or proposal IDs when you reference them.
- Be concise. Bulleted lists for plans; short paragraphs for explanations.
- If the user asks for something requiring data not in context (real GA traffic,
  rank positions, etc.), say what you don't know and suggest the relevant agent.
- Never invent metrics. If the audit score is missing, say "no audit yet".`;

type ChatBody = {
  companyId?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
};

export async function POST(req: Request) {
  if (!hasSupabaseEnv()) {
    return jsonError(500, "Supabase not configured.");
  }
  if (!hasLlmKey()) {
    return jsonError(500, "MESHAPI_API_KEY missing — chat is disabled.");
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  if (!body.companyId || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError(400, "Provide companyId and messages[].");
  }

  const ctx = await loadContext(body.companyId);
  if (!ctx) return jsonError(404, "Company not found.");

  // OpenAI-compatible streaming through MeshAPI. The system prompt is the
  // FIRST message (role:"system") — OpenAI doesn't have a top-level system
  // param like Anthropic's SDK did. Re-emit `choices[0].delta.content` chunks
  // as Server-Sent Events so the existing ChatPanel keeps working unchanged.
  const client = llm();
  const stream = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 1024,
    stream: true,
    messages: [
      { role: "system", content: `${SYSTEM_BASE}\n\n${renderContext(ctx)}` },
      ...body.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  const encoder = new TextEncoder();
  const sse = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            const chunk = `data: ${JSON.stringify({ delta })}\n\n`;
            controller.enqueue(encoder.encode(chunk));
          }
        }
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "stream error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

type ChatContext = {
  company: Company;
  documents: CompanyDocument[];
  pending: Proposal[];
  summary: Proposal | null;
};

async function loadContext(companyId: string): Promise<ChatContext | null> {
  const sb = supabaseServer();
  const { data: company } = await sb
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return null;

  const [docs, pending, summary] = await Promise.all([
    sb.from("documents").select("*").eq("company_id", companyId),
    sb
      .from("proposals")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20),
    sb
      .from("proposals")
      .select("*")
      .eq("company_id", companyId)
      .eq("type", "audit_summary")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    company: company as Company,
    documents: (docs.data ?? []) as CompanyDocument[],
    pending: (pending.data ?? []) as Proposal[],
    summary: (summary.data ?? null) as Proposal | null,
  };
}

function renderContext(ctx: ChatContext): string {
  const lines: string[] = [];
  lines.push(`## Company`);
  lines.push(`Name: ${ctx.company.name}`);
  lines.push(`URL: ${ctx.company.url}`);
  if (ctx.company.description) lines.push(`Description: ${ctx.company.description}`);
  const profile = ctx.company.profile as { category?: string; team_size?: string };
  if (profile.category) lines.push(`Category: ${profile.category}`);
  if (profile.team_size) lines.push(`Team size: ${profile.team_size}`);

  if (ctx.summary) {
    const p = ctx.summary.payload as { score?: number; grade?: string };
    lines.push(``, `## Latest audit`);
    lines.push(`Score: ${p.score ?? "—"} / 100 (grade ${p.grade ?? "—"})`);
    lines.push(`Headline: ${ctx.summary.title}`);
    if (ctx.summary.summary) lines.push(`Detail: ${ctx.summary.summary}`);
  } else {
    lines.push(``, `## Latest audit`, `No audit run yet.`);
  }

  if (ctx.pending.length) {
    lines.push(``, `## Pending proposals (${ctx.pending.length})`);
    for (const p of ctx.pending.slice(0, 15)) {
      lines.push(`- [${p.agent_key} · ${p.type}] ${p.title}${p.summary ? " — " + p.summary : ""}`);
    }
  }

  if (ctx.documents.length) {
    lines.push(``, `## Documents`);
    for (const d of ctx.documents) {
      lines.push(`### ${d.title} (${d.kind})`);
      lines.push(d.body.slice(0, 1500));
    }
  }

  return lines.join("\n");
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
