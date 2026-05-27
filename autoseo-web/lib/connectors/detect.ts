// Best-effort platform detection at onboarding time.
//
// Strategy (cheap → expensive):
//   1. Probe `{origin}/wp-json/` — the WordPress REST API discovery endpoint.
//      A 200 + JSON manifest with `name`/`description` is the definitive WP
//      signal and ends detection.
//   2. Fetch the homepage and substring-scan for Shopify markers (Shopify
//      assets/JS globals/`.myshopify.com`).
//   3. Otherwise → `'unknown'` (manual-copy mode in the UI).
//
// All probes are timeboxed; any thrown error or non-2xx is treated as "no
// signal" and we fall through. Detection MUST NEVER throw out of this module
// because onboarding catches no error from it — a failed detect should leave
// the company on `'unknown'` and let the user keep going.
import "server-only";

import type { CompanyPlatform } from "@/lib/supabase/types";

export type PlatformDetection = {
  platform: CompanyPlatform;
  meta: Record<string, unknown>;
};

const PROBE_TIMEOUT_MS = 5000;

export async function detectPlatform(url: string): Promise<PlatformDetection> {
  const origin = safeOrigin(url);
  if (!origin) {
    return { platform: "unknown", meta: { reason: "bad URL" } };
  }
  const meta: Record<string, unknown> = { probed_origin: origin };

  // 1. WordPress probe — definitive when it returns the discovery JSON.
  try {
    const wp = await timedFetch(`${origin}/wp-json/`, PROBE_TIMEOUT_MS);
    if (wp && wp.ok) {
      const j = (await wp.json().catch(() => null)) as
        | { name?: string; description?: string; gmt_offset?: number }
        | null;
      if (j && (typeof j.name === "string" || typeof j.description === "string")) {
        meta.wp_json_ok = true;
        if (j.name) meta.wp_site_name = j.name;
        return { platform: "wordpress", meta };
      }
      meta.wp_json_ok = false;
    } else if (wp) {
      meta.wp_json_status = wp.status;
    }
  } catch {
    /* network/timeout → not WP, fall through */
  }

  // 2. Shopify markers in the homepage HTML.
  try {
    const home = await timedFetch(origin, PROBE_TIMEOUT_MS);
    if (home && home.ok) {
      const text = (await home.text().catch(() => "")).slice(0, 50_000);
      const generator = (text.match(
        /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i,
      ) || [])[1];
      if (generator) meta.generator = generator;

      const hasShopify =
        text.includes("cdn.shopify.com") ||
        text.includes(".myshopify.com") ||
        /Shopify\s*\.\s*shop\b/.test(text) ||
        /window\s*\.\s*Shopify\b/.test(text);
      if (hasShopify) {
        meta.shopify_markers = true;
        return { platform: "shopify", meta };
      }

      // Sometimes the homepage has WP markers even when /wp-json/ is blocked.
      if (/wp-content|wp-includes/.test(text) || /WordPress/i.test(generator ?? "")) {
        meta.wp_html_markers = true;
        return { platform: "wordpress", meta };
      }
    } else if (home) {
      meta.home_status = home.status;
    }
  } catch {
    /* network/timeout → unknown */
  }

  return { platform: "unknown", meta };
}

function safeOrigin(input: string): string | null {
  try {
    const u = new URL(input);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

async function timedFetch(url: string, timeoutMs: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      // Be polite + identifiable; some WAFs 403 the default node UA.
      headers: { "user-agent": "AutoSEO-platform-detect/1.0" },
      redirect: "follow",
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
