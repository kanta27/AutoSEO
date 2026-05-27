// Dispatcher — picks the right Publisher implementation for a company's
// detected platform. Returns `null` for `unknown` / unsupported, which the
// approval handler treats as "manual mode" (no connector call; UI surfaces
// Copy-markdown buttons instead).
//
// Adding a Webflow/Ghost connector later = one new file + one line here.
import "server-only";

import type { CompanyPlatform } from "@/lib/supabase/types";
import type { Publisher } from "./types";
import { publishPost as shopifyPublish } from "./cms";
import { publishPost as wordpressPublish } from "./wordpress";

export function getPublisher(platform: CompanyPlatform): Publisher | null {
  switch (platform) {
    case "shopify":
      return shopifyPublish;
    case "wordpress":
      return wordpressPublish;
    case "unknown":
    default:
      return null;
  }
}

// Re-export the shared types so callers don't need to know which file they
// live in. Keeps the public surface small.
export type { Publisher, BlogDraft, PublishResult } from "./types";
export { CmsNotConfiguredError, CmsPublishError } from "./types";
