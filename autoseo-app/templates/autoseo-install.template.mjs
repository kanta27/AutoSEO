#!/usr/bin/env node
// AutoSEO installer — pastes the AutoSEO agent <script> into your HTML so your
// SEO/GEO tags update themselves on every page load. Zero dependencies.
//
// Usage:
//   node autoseo-install.mjs path/to/your/index.html
//   node autoseo-install.mjs path/to/your/index.html --dry-run
//
// Writes <file>.bak before overwriting. Idempotent — if the agent is already
// installed it does nothing.

import fs from "node:fs/promises";
import path from "node:path";

const PAYLOAD = /*__AUTOSEO_PAYLOAD__*/ null;
const API_KEY = PAYLOAD?.apiKey || "";
const SCRIPT_URL = PAYLOAD?.scriptUrl || "";
const GENERATED_AT = PAYLOAD?.generatedAt || "";

function tag() {
  return (
    '<script async src="' +
    SCRIPT_URL +
    '" data-autoseo-key="' +
    API_KEY +
    '"></script>'
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const file = argv.find((a) => !a.startsWith("-"));
  if (!file) {
    console.error("Usage: node autoseo-install.mjs <file.html> [--dry-run]");
    process.exit(2);
  }
  if (!API_KEY || !SCRIPT_URL) {
    console.error("This installer has no payload — regenerate it from AutoSEO.");
    process.exit(1);
  }

  const abs = path.resolve(file);
  const html = await fs.readFile(abs, "utf8");

  console.log("\n  AutoSEO installer");
  if (GENERATED_AT) console.log("  Generated  : " + GENERATED_AT);
  console.log("  Target file: " + abs);
  console.log("  Agent URL  : " + SCRIPT_URL + "\n");

  if (html.includes(SCRIPT_URL)) {
    console.log("  Agent already installed — nothing to do.\n");
    return;
  }

  const snippet = tag();
  let updated;
  if (/<\/head>/i.test(html)) {
    updated = html.replace(/<\/head>/i, "  " + snippet + "\n</head>");
  } else if (/<html[^>]*>/i.test(html)) {
    updated = html.replace(/(<html[^>]*>)/i, "$1\n<head>\n  " + snippet + "\n</head>");
  } else {
    updated = snippet + "\n" + html;
  }

  if (dryRun) {
    console.log("  --dry-run — would insert this line into <head>:");
    console.log("    " + snippet + "\n");
    return;
  }

  await fs.writeFile(abs + ".bak", html, "utf8");
  await fs.writeFile(abs, updated, "utf8");
  console.log("  ✓ Installed.");
  console.log("    Backup → " + abs + ".bak");
  console.log("    Wrote  → " + abs);
  console.log("\n  Deploy as usual. Your SEO/GEO tags now update themselves.\n");
}

main().catch((e) => {
  console.error("install failed: " + e.message);
  process.exit(1);
});
