// Company panel — identity + description + structured documents + auto-detected
// competitors grid. Server-rendered for SEO + simplicity; the only interactive
// pieces (logo onError fallback, edit-competitors modal) are tiny client
// components composed in.
//
// The layout mirrors the reference image:
//   Header:        Company name (left) + Edit (right, deferred — visual only)
//   Header chips:  Contextual actions ("Add team size & category",
//                  "Improve writing quality") — link out to the doc that
//                  fixes the gap. Visual placeholders until the edit flow lands.
//   Body:          Description paragraph from companies.description.
//   DOCUMENTS:     The 5 starter docs (+ a placeholder Articles folder).
//                  Docs with meta.is_starter=true get a "New" pill.
//   COMPETITORS:   2-col grid of small logos + hostnames. Pencil button →
//                  EditCompetitorsButton modal.
import Link from "next/link";
import type {
  Company,
  CompanyDocument,
  Competitor,
  DocumentKind,
} from "@/lib/supabase/types";
import { CompetitorLogo } from "./CompetitorLogo";
import { EditCompetitorsButton } from "./EditCompetitorsButton";

// Display order + label for the 5 known starter doc kinds. Anything else
// the LLM/agent has emitted later is appended after these in arrival order.
const STARTER_KIND_ORDER: DocumentKind[] = [
  "product_info",
  "competitor_analysis",
  "brand_voice",
  "marketing_strategy",
  "llms_txt",
];

const KIND_LABEL: Record<DocumentKind, string> = {
  product_info: "Product Information",
  brand_voice: "Brand Voice",
  competitor_analysis: "Competitor Analysis",
  marketing_strategy: "Marketing Strategy",
  llms_txt: "llms.txt",
};

export function CompanyPanel({
  company,
  documents,
}: {
  company: Company;
  documents: CompanyDocument[];
}) {
  const profile = company.profile as { category?: string; team_size?: string };
  // Prefer the dedicated `category` column (migration 0009); fall back to
  // the legacy profile.category for rows onboarded before the migration ran.
  const category = company.category ?? profile.category ?? null;
  const teamSize =
    typeof profile.team_size === "string" ? profile.team_size : null;

  const orderedDocs = orderDocuments(documents);
  const competitors = Array.isArray(company.competitors)
    ? company.competitors
    : [];

  // Chip 1: shows when EITHER category or team_size is missing/unknown.
  const needsProfile =
    !category || category === "unknown" || !teamSize || teamSize === "unknown";

  return (
    <aside className="panel flex h-full flex-col">
      <div className="panel-header">
        <span>Company</span>
        <span className="text-[12px] text-ink-3">
          {/* Edit affordance is visual until a company-edit flow lands. */}
          edit
        </span>
      </div>
      <div className="space-y-5 p-5">
        <div>
          <h2 className="t-h2 mb-2 leading-tight">{company.name}</h2>
          <div className="flex flex-wrap gap-1.5">
            {needsProfile ? (
              <span className="chip chip-soon" title="Onboarding couldn't infer this.">
                Add team size & category
              </span>
            ) : (
              <>
                {teamSize && <span className="chip">{teamSize}</span>}
                {category && <span className="chip">{category}</span>}
              </>
            )}
            <Link
              href="#documents"
              className="chip chip-soon hover:bg-bg-3"
              title="Refine the brand voice document."
            >
              Improve writing quality
            </Link>
          </div>
        </div>

        <p className="text-[13px] leading-[1.55] text-ink-2">
          {company.description || "—"}
        </p>

        <div id="documents">
          <h3 className="t-eyebrow mb-2">Documents</h3>
          <ul className="space-y-1">
            {orderedDocs.length === 0 ? (
              <li className="rounded-md border border-line bg-card-2 px-3 py-2 text-[12px] text-ink-3">
                No documents yet. Onboarding seeds these automatically when a
                Groq key is set.
              </li>
            ) : (
              orderedDocs.map((d) => (
                <DocRow key={d.id} doc={d} />
              ))
            )}
            {/* Articles is a placeholder folder for a future content library
                — visual only, no link target. */}
            <li
              className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[13px] text-ink-3"
              aria-disabled
            >
              <span className="flex items-center gap-2">
                <FolderIcon /> Articles
              </span>
              <span className="font-mono text-[11px]">—</span>
            </li>
          </ul>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="t-eyebrow">Competitors</h3>
            <EditCompetitorsButton
              companyId={company.id}
              competitors={competitors}
            />
          </div>
          {competitors.length === 0 ? (
            <p className="text-[12px] leading-[1.5] text-ink-3">
              No competitors yet. Onboarding detects them automatically; you can
              also add some with the edit pencil.
            </p>
          ) : (
            <CompetitorGrid competitors={competitors} />
          )}
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Documents list

function DocRow({ doc }: { doc: CompanyDocument }) {
  const label = KIND_LABEL[doc.kind] ?? doc.title;
  // `meta` is `not null default '{}'` post-migration, but rows created
  // before 0009 ran will be null — read defensively.
  const meta = (doc.meta ?? {}) as { is_starter?: boolean };
  const isStarter = Boolean(meta.is_starter);
  return (
    <li className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[13px] hover:bg-card-2">
      <span className="flex items-center gap-2">
        <FileIcon /> {label}
      </span>
      <div className="flex items-center gap-2">
        {isStarter ? <span className="chip chip-soon text-[10px]">New</span> : null}
        <span className="text-[11px] text-ink-3">›</span>
      </div>
    </li>
  );
}

// Sort by the canonical starter order, then any leftover kinds in arrival
// order. Duplicates of the same kind are de-duped, keeping the earliest one.
function orderDocuments(docs: CompanyDocument[]): CompanyDocument[] {
  const byKind = new Map<DocumentKind, CompanyDocument>();
  const leftovers: CompanyDocument[] = [];
  for (const d of docs) {
    if (STARTER_KIND_ORDER.includes(d.kind)) {
      if (!byKind.has(d.kind)) byKind.set(d.kind, d);
    } else {
      leftovers.push(d);
    }
  }
  const ordered: CompanyDocument[] = [];
  for (const k of STARTER_KIND_ORDER) {
    const d = byKind.get(k);
    if (d) ordered.push(d);
  }
  return ordered.concat(leftovers);
}

// ---------------------------------------------------------------------------
// Competitors grid

function CompetitorGrid({ competitors }: { competitors: Competitor[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2">
      {competitors.map((c) => (
        <li
          key={`${c.source}-${c.url}`}
          className="flex items-center gap-2 rounded-md border border-line bg-card-2 px-2.5 py-1.5"
        >
          <CompetitorLogo url={c.url} name={c.name} size={28} />
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer"
            title={c.name}
            className="truncate text-[12px] text-ink hover:underline"
          >
            {prettyHost(c.url)}
          </a>
        </li>
      ))}
    </ul>
  );
}

function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

// ---------------------------------------------------------------------------
// Icons — kept inline to avoid pulling in an icon library for two glyphs.

function FileIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-3"
      aria-hidden
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-3"
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
