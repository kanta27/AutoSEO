"use client";

// Small pencil-icon button next to the COMPETITORS heading in the Company
// panel. Opens a minimal modal whose body is a textarea (one URL per line)
// + a Save button. v1: REPLACES the manual list — detected competitors are
// preserved server-side, so the user only manages their own additions here.
//
// Implementation notes:
//   • We use a controlled-state modal (no <dialog>) so the styling matches
//     the rest of the dashboard's panels and so the open/close transition
//     stays consistent across browsers.
//   • Server-side response shape: { ok, competitors, counts }. We use
//     router.refresh() to re-render the parent server component with the
//     updated row — no need to lift state into a context.
//   • The textarea seed shows ONLY the manual entries so the user doesn't
//     accidentally delete detected ones by leaving them out.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Competitor } from "@/lib/supabase/types";

export function EditCompetitorsButton({
  companyId,
  competitors,
}: {
  companyId: string;
  competitors: Competitor[];
}) {
  const [open, setOpen] = useState(false);
  const initialManualText = competitors
    .filter((c) => c.source === "manual")
    .map((c) => c.url)
    .join("\n");
  const [text, setText] = useState(initialManualText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function reset() {
    setText(initialManualText);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const parsed = parseTextarea(text);
      const res = await fetch(`/api/companies/${companyId}/competitors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ competitors: parsed }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error || `Save failed (${res.status})`);
        return;
      }
      setOpen(false);
      // Re-fetch the dashboard so the panel re-renders with the new list.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        aria-label="Edit competitors"
        title="Edit competitors"
        className="text-ink-3 hover:text-ink"
      >
        <PencilIcon />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="panel w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <span>Edit Competitors</span>
              <span className="font-mono text-[11px] text-ink-3">
                manual
              </span>
            </div>
            <div className="space-y-3 p-5">
              <p className="text-[12px] leading-[1.5] text-ink-3">
                One URL per line. Auto-detected competitors are kept
                separately and not affected by what you put here.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={saving}
                rows={6}
                placeholder={"hellofresh.com\nblueapron.com\nhomechef.com"}
                className="w-full rounded-md border border-line bg-card-2 p-3 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-ink"
              />
              {error ? (
                <p className="text-[12px] text-warn">{error}</p>
              ) : null}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="text-[13px] text-ink-3 hover:text-ink hover:underline disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="btn btn-primary text-[13px]"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// Split the textarea body into trimmed non-empty lines. Each line is the URL;
// the server fills in `name` from the hostname if absent.
function parseTextarea(text: string): Array<{ url: string }> {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((url) => ({ url }));
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
