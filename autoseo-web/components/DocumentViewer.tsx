"use client";

// Client-side document viewer + editor.
//
// Two modes:
//   • view  — renders the markdown body via react-markdown.
//   • edit  — full-width monospace textarea showing the raw markdown source,
//             with Save + Cancel above. Save PUTs to /api/documents/:id and
//             on success swaps back to view + flashes a small inline toast.
//
// react-markdown is configured to its safe defaults (no raw-HTML passthrough,
// no script execution). We do NOT enable rehype-raw or remark-html.
//
// State is intentionally local — no global store. The parent server page
// loads the doc, marks viewed_at, and hands us the initial row.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import type { CompanyDocument } from "@/lib/supabase/types";

// Matches the server cap so we surface the same boundary before round-tripping.
const MAX_BODY_CHARS = 50_000;

export function DocumentViewer({
  initialDoc,
}: {
  initialDoc: CompanyDocument;
}) {
  const [doc, setDoc] = useState<CompanyDocument>(initialDoc);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draftBody, setDraftBody] = useState(initialDoc.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // Auto-dismiss the toast after 4s. Clear on unmount so we don't try to
  // setState after teardown.
  useEffect(() => {
    if (!toast) return;
    toastTimerRef.current = setTimeout(() => setToast(null), 4_000);
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [toast]);

  function enterEdit() {
    setDraftBody(doc.body);
    setError(null);
    setMode("edit");
  }

  function cancel() {
    setDraftBody(doc.body);
    setError(null);
    setMode("view");
  }

  async function save() {
    if (saving) return;
    if (draftBody.length > MAX_BODY_CHARS) {
      setError(
        `Too long: ${draftBody.length.toLocaleString()} chars. Cap is ${MAX_BODY_CHARS.toLocaleString()}.`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draftBody }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        document?: CompanyDocument;
        error?: string;
      };
      if (!res.ok || !j.ok || !j.document) {
        setError(j.error || `Save failed (${res.status})`);
        return;
      }
      setDoc(j.document);
      setDraftBody(j.document.body);
      setMode("view");
      setToast("Saved. The next agent run will use this.");
      // Re-render the dashboard server tree so the Company panel's "Edited"
      // chip appears the moment the user navigates back.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSaving(false);
    }
  }

  const charsOver = Math.max(0, draftBody.length - MAX_BODY_CHARS);

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[12px] text-ink-3">
          {mode === "view" ? (
            <span>
              Last edited: {relativeTime(doc.updated_at)} · Kind:{" "}
              <span className="font-mono">{doc.kind}</span>
            </span>
          ) : (
            <span>
              Editing raw markdown · {draftBody.length.toLocaleString()} chars
              {charsOver > 0 ? (
                <span className="ml-2 text-warn">
                  {charsOver.toLocaleString()} over cap
                </span>
              ) : null}
            </span>
          )}
        </div>
        {mode === "view" ? (
          <button
            type="button"
            onClick={enterEdit}
            className="btn text-[13px]"
            aria-label="Edit document"
          >
            <PencilIcon /> Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="text-[13px] text-ink-3 hover:text-ink hover:underline disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || charsOver > 0}
              className="btn btn-primary text-[13px]"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {mode === "view" ? (
        <article className="rounded-md border border-line bg-card-2 p-5">
          {doc.body.trim() ? (
            <MarkdownBlock source={doc.body} />
          ) : (
            <p className="text-[12px] text-ink-3">
              This document is empty. Click <strong>Edit</strong> to add content.
            </p>
          )}
        </article>
      ) : (
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          disabled={saving}
          rows={30}
          spellCheck
          className="w-full rounded-md border border-line bg-card-2 p-4 font-mono text-[12px] leading-[1.55] focus:outline-none focus:ring-1 focus:ring-ink"
        />
      )}

      {error ? (
        <p className="mt-2 text-[12px] text-warn">{error}</p>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 rounded-md border border-line bg-ink px-4 py-2 text-[12px] text-white shadow-elev-3"
        >
          {toast}
        </div>
      ) : null}
    </>
  );
}

// Plain react-markdown render with a few Tailwind class overrides per element
// so the doc looks at home next to the rest of the app — react-markdown's
// default DOM is unstyled.
function MarkdownBlock({ source }: { source: string }) {
  return (
    <div className="markdown-body space-y-3 text-[14px] leading-[1.6] text-ink">
      <ReactMarkdown
        // No raw HTML, no script execution. These are react-markdown's
        // defaults; we make them explicit so a future contributor doesn't
        // flip them on inadvertently.
        skipHtml
        components={{
          h1: (props) => (
            <h1 className="t-h2 mt-4 first:mt-0" {...props} />
          ),
          h2: (props) => (
            <h2 className="t-h2 mt-4 text-[20px]" {...props} />
          ),
          h3: (props) => (
            <h3 className="mt-4 text-[16px] font-semibold" {...props} />
          ),
          p: (props) => (
            <p className="text-[14px] leading-[1.6] text-ink-2" {...props} />
          ),
          ul: (props) => (
            <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink-2" {...props} />
          ),
          ol: (props) => (
            <ol className="list-decimal space-y-1 pl-5 text-[14px] text-ink-2" {...props} />
          ),
          li: (props) => <li className="leading-[1.55]" {...props} />,
          code: ({ children, ...rest }) => (
            <code
              className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[12px] text-ink"
              {...rest}
            >
              {children}
            </code>
          ),
          pre: (props) => (
            <pre
              className="overflow-x-auto rounded-md border border-line bg-card p-3 font-mono text-[12px]"
              {...props}
            />
          ),
          a: (props) => (
            <a
              className="text-ink underline decoration-ink-3 underline-offset-2 hover:decoration-ink"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          blockquote: (props) => (
            <blockquote
              className="border-l-2 border-ink-3 pl-3 text-ink-3"
              {...props}
            />
          ),
          hr: () => <hr className="my-4 border-line" />,
          strong: (props) => <strong className="font-semibold text-ink" {...props} />,
          em: (props) => <em className="italic" {...props} />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

// "30s ago" / "2m ago" / "3h ago" / "4d ago". Matches the same shape used in
// other places on the dashboard so the perceived time-scale is consistent.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diff < 60) return `${diff}s ago`;
  const min = Math.round(diff / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
