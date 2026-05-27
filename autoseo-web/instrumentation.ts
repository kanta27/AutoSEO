// Next.js instrumentation hook — runs once when the server boots (and again
// after a full restart, but NOT on every file change in dev). This is the
// canonical place to start the local scheduler interval.
//
// Requires `experimental.instrumentationHook: true` in next.config.js (Next
// 14.2). The body is gated again inside startLocalScheduler so this is a
// no-op unless ENABLE_LOCAL_SCHEDULER === "true".

export async function register(): Promise<void> {
  // Only nodejs runtime supports timers / Supabase. Skip when this same
  // file gets loaded under the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLocalScheduler } = await import("@/lib/scheduler/local");
  startLocalScheduler();
}
