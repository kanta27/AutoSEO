// Background re-audit loop — the "self-updating" half of always-on mode.
// Once per tick, for every registered key, refresh any cached fix entry whose
// age exceeds the configured interval. New audits land in the same cache the
// embedded agent reads from, so the customer's site auto-picks-up new fixes.

import { allKeys } from "./registry.js";
import * as cache from "./cache.js";
import { structurizeFixes } from "./structurize.js";

const REFRESH_MS =
  (parseInt(process.env.AUTOSEO_REFRESH_HOURS || "24", 10)) * 3600 * 1000;
const TICK_MS = 60 * 60 * 1000; // wake every hour, work only on entries past TTL

export function startScheduler({ runAudit }) {
  if (process.env.AUTOSEO_DISABLE_SCHEDULER === "1") return;

  async function tick() {
    let refreshed = 0;
    try {
      const keys = await allKeys();
      for (const { apiKey, domain } of keys) {
        const entries = await cache.listForKey(apiKey);
        const targets = entries.length ? entries : [{ url: "https://" + domain }];
        for (const e of targets) {
          if (e.cachedAt && Date.now() - Date.parse(e.cachedAt) < REFRESH_MS) continue;
          try {
            const audit = await runAudit(e.url, { withFixes: true });
            await cache.set(apiKey, audit.meta.finalUrl, {
              fixes: structurizeFixes(audit.solutions?.fixes || []),
              score: audit.score,
              grade: audit.grade,
            });
            refreshed++;
          } catch (err) {
            console.warn(`[scheduler] ${e.url}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      console.warn("[scheduler] tick failed:", err.message);
    }
    if (refreshed) console.log(`[scheduler] refreshed ${refreshed} entr${refreshed === 1 ? "y" : "ies"}`);
  }

  // First sweep ~5s after boot; then hourly.
  setTimeout(tick, 5000).unref?.();
  setInterval(tick, TICK_MS).unref?.();
}
