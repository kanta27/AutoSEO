// Left panel — company identity + documents list. Server-rendered, no
// interactive state; clicking a doc opens it in a side drawer in a later
// session.
import type { Company, CompanyDocument } from "@/lib/supabase/types";

const KIND_LABEL: Record<CompanyDocument["kind"], string> = {
  product_info: "Product Information",
  brand_voice: "Brand Voice",
  competitor_analysis: "Competitor Analysis",
  marketing_strategy: "Marketing Strategy",
};

export function CompanyPanel({
  company,
  documents,
}: {
  company: Company;
  documents: CompanyDocument[];
}) {
  const profile = company.profile as { category?: string; team_size?: string };
  return (
    <aside className="panel flex flex-col">
      <div className="panel-header">
        <span>Company</span>
      </div>
      <div className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-ink">{company.name}</h2>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {profile.team_size && profile.team_size !== "unknown" && (
            <span className="chip">{profile.team_size}</span>
          )}
          {profile.category && profile.category !== "unknown" && (
            <span className="chip">{profile.category}</span>
          )}
        </div>
        <p className="mb-5 text-[13px] leading-[1.55] text-ink-2">
          {company.description || "—"}
        </p>

        <h3 className="t-eyebrow mb-2">Documents</h3>
        <ul className="space-y-1">
          {documents.length === 0 && (
            <li className="text-[12px] text-ink-3">No documents yet.</li>
          )}
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[13px] hover:bg-card-2"
            >
              <span>{KIND_LABEL[d.kind] || d.title}</span>
              <span className="text-[11px] text-ink-3">
                {d.body.length > 0 ? "Ready" : "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
