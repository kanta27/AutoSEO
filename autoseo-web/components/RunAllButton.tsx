"use client";

// Dashboard header button — "Run all agents now". POSTs to the same-origin
// `/api/scheduler/run-now` so the secret never leaves the server. Triggers a
// router refresh after completion so the Activity section + Actions Feed
// pick up the new rows without a hard reload.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";

type Summary = {
  agentsRun: number;
  proposalsCreated: number;
  failures: Array<{ company: string; agentKey: string; error: string }>;
};

export function RunAllButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function onClick() {
    if (running) return;
    setRunning(true);
    setMsg(null);
    try {
      const res = await fetch("/api/scheduler/run-now", { method: "POST" });
      const j = (await res.json()) as Summary | { error: string };
      if (!res.ok || "error" in j) {
        throw new Error("error" in j ? j.error : `HTTP ${res.status}`);
      }
      const parts: string[] = [];
      parts.push(
        `${j.agentsRun} agent${j.agentsRun === 1 ? "" : "s"} run`,
      );
      parts.push(
        `${j.proposalsCreated} proposal${j.proposalsCreated === 1 ? "" : "s"}`,
      );
      if (j.failures.length) parts.push(`${j.failures.length} failed`);
      setMsg(parts.join(" · "));
      startTransition(() => router.refresh());
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className="font-mono text-[11px] text-ink-3" aria-live="polite">
          {msg}
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={running}
        className="btn px-3 py-1.5 text-[12px] disabled:opacity-60"
      >
        {running ? (
          <>
            <Loader2 size={14} className="animate-spin" aria-hidden />
            Running…
          </>
        ) : (
          <>
            <Play size={14} aria-hidden />
            Run all agents now
          </>
        )}
      </button>
    </div>
  );
}
