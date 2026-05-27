// POST /api/scheduler/run
//
// The cron-facing entry point. A real cron (Vercel Cron, Cloud Scheduler,
// crontab, GitHub Actions schedule) calls this with the secret header. It
// always RESPECTS dueness — so it's safe to point a cron at this every minute
// if you want; only agents whose schedule_hours has elapsed actually run.
//
// Secret is required to keep the public from triggering paid engine work.
// Pair with the dashboard's `/api/scheduler/run-now` (same-origin, no
// dueness) for the UI button.

import { NextResponse } from "next/server";
import { runAllDue } from "@/lib/scheduler/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SCHEDULER_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "SCHEDULER_SECRET not configured on the server." },
      { status: 500 },
    );
  }
  const provided = req.headers.get("x-scheduler-secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const summary = await runAllDue({ respectDueness: true });
  return NextResponse.json(summary);
}
