// Shopify CMS connector — one implementation of the Publisher contract.
// Multi-platform dispatch lives in ./index.ts; this file is Shopify-only now
// (was the only target before the WordPress session — the platform-neutral
// pieces moved to ./types.ts and ./markdown.ts so connectors share them).
//
// Verified against shopify.dev (REST Admin API 2026-01):
//   POST /admin/api/2026-01/blogs/{blog_id}/articles.json
//   GET  /admin/api/2026-01/blogs.json
// Auth: header `X-Shopify-Access-Token: <admin token>`. Body shape on create:
//   { article: { title, body_html, ... } }  — the `article` wrapper is
// required by the REST Admin API.
import "server-only";

import type { Company } from "@/lib/supabase/types";
import {
  CmsNotConfiguredError,
  CmsPublishError,
  type BlogDraft,
  type PublishResult,
} from "./types";
import { escapeHtml, markdownToBasicHtml } from "./markdown";

// Re-export the shared types/errors so existing callers (e.g. the approval
// handler) can keep importing from "@/lib/connectors/cms" without churn.
export {
  CmsNotConfiguredError,
  CmsPublishError,
  type BlogDraft,
  type PublishResult,
};

const SHOPIFY_API_VERSION = "2026-01";

export async function publishPost(
  _company: Company,
  draft: BlogDraft,
): Promise<PublishResult> {
  if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_TOKEN) {
    throw new CmsNotConfiguredError(
      "Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN in .env.local.",
    );
  }
  return publishToShopify(draft);
}

async function publishToShopify(draft: BlogDraft): Promise<PublishResult> {
  const domain = process.env
    .SHOPIFY_STORE_DOMAIN!.replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const token = process.env.SHOPIFY_ADMIN_TOKEN!;

  const blogId =
    process.env.SHOPIFY_BLOG_ID || (await pickFirstShopifyBlogId(domain, token));
  if (!blogId) {
    throw new CmsPublishError(
      "No blog found on the Shopify store. Create at least one blog under Online Store → Blog Posts → Manage blogs, or set SHOPIFY_BLOG_ID explicitly.",
    );
  }

  const body = {
    article: {
      title: draft.title,
      body_html: markdownToBasicHtml(draft.body_md),
      summary_html: draft.meta_description
        ? `<p>${escapeHtml(draft.meta_description)}</p>`
        : undefined,
      tags: draft.target_keyword ?? undefined,
      handle: draft.slug ?? undefined,
      published_at: new Date().toISOString(),
    },
  };

  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/blogs/${blogId}/articles.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-access-token": token,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new CmsPublishError(
      `Shopify ${res.status} on POST .../articles.json: ${text.slice(0, 400)}`,
      res.status,
    );
  }
  const j = (await res.json()) as { article?: { id?: number; handle?: string } };
  const article = j.article;
  if (!article?.handle) {
    throw new CmsPublishError("Shopify returned 200 but no article.handle.");
  }

  const blogHandle = await fetchShopifyBlogHandle(domain, token, blogId);
  const publicUrl = blogHandle
    ? `https://${domain.replace(/\.myshopify\.com$/, "")}/blogs/${blogHandle}/${article.handle}`
    : `https://${domain.replace(/\.myshopify\.com$/, "")}/blogs?id=${article.id}`;
  return { url: publicUrl };
}

async function pickFirstShopifyBlogId(domain: string, token: string): Promise<string | null> {
  const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/blogs.json`, {
    headers: { "x-shopify-access-token": token },
  });
  if (!res.ok) {
    throw new CmsPublishError(
      `Shopify ${res.status} on GET /blogs.json (used to find a default blog_id). ` +
        `Set SHOPIFY_BLOG_ID directly to skip this lookup.`,
      res.status,
    );
  }
  const j = (await res.json()) as { blogs?: Array<{ id?: number }> };
  const first = j.blogs?.[0]?.id;
  return first ? String(first) : null;
}

async function fetchShopifyBlogHandle(
  domain: string,
  token: string,
  blogId: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/blogs/${blogId}.json`,
      { headers: { "x-shopify-access-token": token } },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { blog?: { handle?: string } };
    return j.blog?.handle ?? null;
  } catch {
    return null;
  }
}
