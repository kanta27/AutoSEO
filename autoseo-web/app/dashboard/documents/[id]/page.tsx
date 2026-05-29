// /dashboard/documents/[id]
//
// One-document focused page. Mirrors the per-agent drill-down's visual
// language (back link, panel-style heading, body) so the dashboard's pages
// feel like one family.
//
// The server component loads the doc, marks viewed_at on first load (so the
// Company panel's "New" badge clears the moment the user gets here), and
// hands the row to <DocumentViewer> for the interactive render/edit toggle.
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Company, CompanyDocument, DocumentKind } from "@/lib/supabase/types";
import { DocumentViewer } from "@/components/DocumentViewer";

export const dynamic = "force-dynamic";

// Human-readable label per kind. Falls back to doc.title when an unknown
// kind shows up (shouldn't happen — the CHECK constraint guards this).
const KIND_LABEL: Record<DocumentKind, string> = {
  product_info: "Product Information",
  brand_voice: "Brand Voice",
  competitor_analysis: "Competitor Analysis",
  marketing_strategy: "Marketing Strategy",
  llms_txt: "llms.txt",
};

// One-sentence "consumed by" footer per kind so the user understands WHY
// they should edit it. The Blog agent's tool registry (lib/agents/tools/
// common.ts) is the source of truth; this copy describes the same wiring
// in plain English.
const KIND_CONSUMED_BY: Record<DocumentKind, string> = {
  brand_voice:
    "Read by the Blog Agent (and the AI CMO chat) when drafting articles. Edit to change the voice.",
  product_info:
    "Read by the Blog and SEO agents when generating content. Edit to refine what the agents pitch.",
  competitor_analysis:
    "Read by the Blog Agent when picking topics. Edit to influence which angles get covered.",
  marketing_strategy:
    "Referenced by the AI CMO chat when you ask for strategic advice. Edit to set your North Star.",
  llms_txt:
    "A markdown file you can publish at /llms.txt so AI engines (ChatGPT, Perplexity, AI Overviews) can summarise your site accurately. Edit and copy the contents to your site.",
};

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { company?: string };
}) {
  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-2xl p-10 text-center">
        <h1 className="t-h2 mb-2">Supabase not configured</h1>
        <p className="text-ink-3">
          Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
        </p>
      </main>
    );
  }

  const sb = supabaseServer();
  const { data: docRow, error } = await sb
    .from("documents")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (error || !docRow) notFound();
  const doc = docRow as CompanyDocument;

  // First-view → stamp viewed_at server-side so the Company panel's badge
  // clears even if the user lands here via the API. Subsequent loads no-op.
  if (!doc.viewed_at) {
    const now = new Date().toISOString();
    const { error: updErr } = await sb
      .from("documents")
      .update({ viewed_at: now })
      .eq("id", doc.id);
    if (!updErr) doc.viewed_at = now;
  }

  // Load just the company URL for the breadcrumb. Anything more is wasted
  // bytes since the dashboard already has the full company row.
  const { data: companyRow } = await sb
    .from("companies")
    .select("id, url")
    .eq("id", doc.company_id)
    .maybeSingle();
  if (!companyRow) redirect("/");
  const company = companyRow as Pick<Company, "id" | "url">;

  const companyParam =
    searchParams.company ?? company.id
      ? `?company=${searchParams.company ?? company.id}`
      : "";

  const label = KIND_LABEL[doc.kind] ?? doc.title;
  const consumedBy = KIND_CONSUMED_BY[doc.kind] ?? "";

  return (
    <main className="min-h-screen px-4 py-6 md:px-6">
      <header className="mx-auto mb-6 flex max-w-[900px] items-center justify-between gap-4">
        <Link
          href={`/dashboard${companyParam}`}
          className="t-eyebrow hover:text-ink"
        >
          ← Back to dashboard
        </Link>
        <span className="hidden font-mono text-[12px] text-ink-3 sm:inline">
          {company.url}
        </span>
      </header>

      <div className="mx-auto max-w-[900px] space-y-4">
        <section className="panel">
          <div className="panel-header">
            <span>{label}</span>
            <div className="flex items-center gap-2">
              {doc.user_edited ? (
                <span className="chip chip-soon">edited</span>
              ) : null}
            </div>
          </div>
          <div className="p-5">
            <DocumentViewer initialDoc={doc} />
            {consumedBy ? (
              <p className="mt-5 border-t border-line pt-4 text-[12px] leading-[1.5] text-ink-3">
                {consumedBy}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
