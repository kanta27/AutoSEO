"use client";

// Tiny client button in the Activity header. Confirms with the actual count
// of failed rows (computed server-side, passed in), then calls the
// `clearFailedRuns` Server Action. The action revalidates /dashboard, so
// the parent server component re-renders with the rows gone.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearFailedRuns } from "@/lib/actions/clear-failed";

export function ClearFailedButton({ failedCount }: { failedCount: number }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  if (failedCount === 0) return null;

  function onClick() {
    setErr(null);
    const ok = window.confirm(
      `Delete ${failedCount} failed run${failedCount === 1 ? "" : "s"}? This can't be undone.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await clearFailedRuns();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      // The Server Action calls revalidatePath('/dashboard'); router.refresh
      // re-pulls the server-rendered Activity table here in the active tab.
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-[11px] text-warn" title={err}>error</span>}
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-[11px] font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
        title="Permanently delete all rows whose status is 'failed'."
      >
        {pending ? "Clearing…" : `Clear failed (${failedCount})`}
      </button>
    </div>
  );
}
