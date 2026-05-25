"use client";

import { useState } from "react";

export function OnboardForm() {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
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
    <form
      onSubmit={onSubmit}
      className="flex items-center gap-2 rounded-full border bg-white p-1.5 shadow-elev-2"
      style={{ borderColor: "rgba(20,18,16,.18)" }}
    >
      <input
        type="text"
        placeholder="www.your-site.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="ml-3 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-4 focus:outline-none"
        disabled={submitting}
      />
      <button
        type="submit"
        disabled={submitting || !url.trim()}
        className="btn-accent btn disabled:opacity-50"
      >
        {submitting ? "Starting…" : "Get started →"}
      </button>
      {error && (
        <span className="mr-2 text-[12px] text-warn" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
