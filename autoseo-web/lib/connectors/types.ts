// Shared types + error classes for every content publish connector.
// The "Cms" prefix on the errors is deliberately CMS-generic — both Shopify
// and WordPress (and future Webflow/Ghost) throw the same types so the
// approval handler can catch once.
import "server-only";

import type { Company } from "@/lib/supabase/types";

// The blog agent's submit_article output shape — what every connector receives.
// Kept in this shared file so any new connector imports one canonical type.
export type BlogDraft = {
  title: string;
  slug?: string;
  meta_description?: string;
  // Markdown — connectors run this through `markdownToBasicHtml` before sending.
  body_md: string;
  target_keyword?: string;
  // Surface-only suggestions; not auto-injected into the published body.
  internal_links?: Array<{ anchor: string; target_path: string; reason?: string }>;
};

export type PublishResult = {
  // Public URL of the published post on the destination platform.
  url: string;
};

// Every connector takes (company, draft) and returns PublishResult. The
// `company` parameter is what makes future per-tenant credentials plug in
// here without touching call sites.
export type Publisher = (company: Company, draft: BlogDraft) => Promise<PublishResult>;

// Thrown when the connector's env config is missing/incomplete. The approval
// handler turns this into a `publish_failed` proposal with a visible banner.
export class CmsNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`CMS not configured: ${reason}`);
    this.name = "CmsNotConfiguredError";
  }
}

// Thrown when the upstream platform's API rejects the publish. `status` is
// the HTTP status when known so the UI can distinguish 4xx (fix the draft)
// from 5xx (transient).
export class CmsPublishError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "CmsPublishError";
  }
}
