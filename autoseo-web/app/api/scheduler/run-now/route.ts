// POST /api/scheduler/run-now
//
// The dashboard's "Run all agents now" button hits this. Two design choices
// worth being explicit about:
//
// 1. Same-origin only — checks Origin against the host header. We deliberately
//    do NOT use SCHEDULER_SECRET here because that key must never reach the
//    browser; once multi-tenant auth lands, this becomes a session check.
//
// 2. Ignores dueness. A manual click is "I want results NOW" — gating it on
//    schedule_hours would make the button feel broken right after onboarding
//    (when nothing is "due" yet). Cron callers should use /api/scheduler/run
//    instead, which respects dueness.

import { NextResponse } from "next/server";
import { runAllDue } from "@/lib/scheduler/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  // Allow when there's no Origin header at all (server-side same-process
  // calls, tests, curl) AND when Origin matches our host.
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: "Bad Origin header." }, { status: 400 });
    }
    if (!host || originHost !== host) {
      return NextResponse.json(
        { error: "Cross-origin requests are not allowed here." },
        { status: 403 },
      );
    }
  }

  const summary = await runAllDue({ respectDueness: false });
  return NextResponse.json(summary);
}
