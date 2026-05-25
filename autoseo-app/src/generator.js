// Generators for the three downloadable artifacts:
//   1. autoseo-fix.mjs       — one-shot installer (bakes current fixes into HTML)
//   2. agent.js (served live) — embedded runtime that hot-updates on every page load
//   3. autoseo-install.mjs   — installer that drops the agent <script> into HTML
//
// Each is a real file under templates/ with a `/*__AUTOSEO_…__*/ <default>`
// placeholder; here we inject the per-customer payload at request time.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, "..", "templates");

const cache = new Map();
async function load(name) {
  if (cache.has(name)) return cache.get(name);
  const txt = await readFile(path.join(TEMPLATES, name), "utf8");
  cache.set(name, txt);
  return txt;
}

function jsonLiteral(obj) {
  // Encode `</` so the payload is safe even if the script ends up embedded in HTML.
  return JSON.stringify(obj, null, 2).replace(/<\//g, "<\\/");
}

export async function generateFixScript({ url, fixes }) {
  const template = await load("autoseo-fix.template.mjs");
  const payload = {
    url,
    generatedAt: new Date().toISOString(),
    fixes: (fixes || []).map((f) => ({ type: f.type, value: f.value, rationale: f.rationale })),
  };
  return template.replace("/*__AUTOSEO_PAYLOAD__*/ null", jsonLiteral(payload));
}

export async function generateAgentScript({ apiKey, endpoint }) {
  const template = await load("agent.template.js");
  return template
    .replace("/*__AUTOSEO_KEY__*/ null", JSON.stringify(apiKey))
    .replace('/*__AUTOSEO_ENDPOINT__*/ ""', JSON.stringify(endpoint));
}

export async function generateInstallScript({ apiKey, endpoint }) {
  const template = await load("autoseo-install.template.mjs");
  const payload = {
    apiKey,
    scriptUrl: `${endpoint}/v1/agent.js?key=${encodeURIComponent(apiKey)}`,
    generatedAt: new Date().toISOString(),
  };
  return template.replace("/*__AUTOSEO_PAYLOAD__*/ null", jsonLiteral(payload));
}
