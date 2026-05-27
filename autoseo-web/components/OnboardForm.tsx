"use client";

// The single hero CTA: a URL → audit → dashboard pipeline. Visually one pill;
// internally a form with a focus ring on the whole shell (not the input) so
// it reads as one product input rather than a stacked input+button.
//
// Onboarding takes ~15s end-to-end (audit + classify). The submitting state
// shows a spinner + "Analyzing your site…" so the user has something to look
// at instead of a dead button.

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

export function OnboardForm() {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Onboarding failed (${res.status})`);
      }
      const { companyId } = (await res.json()) as { companyId: string };
      window.location.href = `/dashboard?company=${companyId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onboarding failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full">
      <form
        onSubmit={onSubmit}
        className={
          "group flex items-center gap-2 rounded-full border bg-white p-2 shadow-elev-2 transition " +
          "focus-within:border-ink focus-within:shadow-elev-3"
        }
        style={{ borderColor: "rgba(20,18,16,.18)" }}
        aria-busy={submitting}
      >
        <span className="ml-3 hidden text-[15px] text-ink-4 sm:inline" aria-hidden>
          https://
        </span>
        <input
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="www.your-site.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 bg-transparent pl-3 text-[16px] text-ink placeholder:text-ink-4 focus:outline-none sm:pl-0"
          disabled={submitting}
          aria-label="Your website URL"
        />
        <button
          type="submit"
          disabled={submitting || !url.trim()}
          className="btn-accent btn px-5 py-2.5 text-[14px] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden />
              <span>Analyzing your site…</span>
            </>
          ) : (
            <>
              <span>Get started</span>
              <ArrowRight size={16} aria-hidden />
            </>
          )}
        </button>
      </form>
      {error && (
        <p className="mt-3 text-[13px] text-warn" role="alert">
          {error}
        </p>
      )}
      {submitting && !error && (
        <p className="mt-3 text-[12px] text-ink-3">
          Auditing the page, drafting your brand voice, and building the first
          actions feed. Usually ~15&nbsp;seconds.
        </p>
      )}
    </div>
  );
}
