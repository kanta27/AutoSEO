// Local in-process scheduler. Only useful during development OR on a long-
// running server you control. Production deploys should hit `/api/scheduler/run`
// from a real cron (Vercel Cron, Cloud Scheduler, crontab) — see README.
//
// Two safety properties:
//   1. Gated by ENABLE_LOCAL_SCHEDULER === "true" so it never runs unless the
//      operator explicitly turns it on.
//   2. A `globalThis` flag prevents double-starting under Next's hot reload
//      (which re-evaluates server modules but preserves the process).
//   3. An in-flight guard prevents a slow tick from overlapping a fast one.
//
// The tick interval is just how often we *check* — the actual agent runs
// respect each agent's schedule_hours via runAllDue({ respectDueness: true }).
import "server-only";

import { runAllDue } from "./run";

const DEFAULT_INTERVAL_MINUTES = 15;

type SchedulerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

// Hot-reload survives globalThis but blows away local module state. Stash on
// globalThis so we don't start two intervals on a route file change.
const G = globalThis as unknown as { __autoseoScheduler?: SchedulerState };
function state(): SchedulerState {
  if (!G.__autoseoScheduler) {
    G.__autoseoScheduler = { started: false, running: false, timer: null };
  }
  return G.__autoseoScheduler;
}

export function startLocalScheduler(): void {
  if (process.env.ENABLE_LOCAL_SCHEDULER !== "true") return;
  const s = state();
  if (s.started) return;
  s.started = true;

  const minutes = Math.max(
    1,
    Number(process.env.LOCAL_SCHEDULER_INTERVAL_MINUTES || DEFAULT_INTERVAL_MINUTES),
  );
  const intervalMs = minutes * 60_000;

  // Fire one tick on startup so a freshly-rebooted server doesn't sit idle
  // for the whole interval before the first check.
  void tick();
  s.timer = setInterval(tick, intervalMs);
  if (s.timer.unref) s.timer.unref(); // don't keep the event loop alive on its own

  // eslint-disable-next-line no-console
  console.log(
    `[scheduler] local timer started — checking every ${minutes} minute(s)`,
  );
}

async function tick(): Promise<void> {
  const s = state();
  if (s.running) {
    // Skip — previous tick still in flight. Catch-up dueness handles missed ticks.
    return;
  }
  s.running = true;
  try {
    const summary = await runAllDue({ respectDueness: true });
    if (summary.agentsRun || summary.failures.length) {
      // eslint-disable-next-line no-console
      console.log(
        `[scheduler] tick — companies=${summary.companies} agentsRun=${summary.agentsRun} ` +
          `proposals=${summary.proposalsCreated} failures=${summary.failures.length} ` +
          `(${summary.durationMs}ms)`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[scheduler] tick threw (should be impossible):", err);
  } finally {
    s.running = false;
  }
}
