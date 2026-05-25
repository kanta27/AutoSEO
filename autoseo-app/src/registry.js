// Domain → API-key registry. File-backed (no DB) so this stays a single-binary
// service. One key per registered domain — re-registering the same domain
// returns the existing key.

import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const DATA_DIR = process.env.AUTOSEO_DATA_DIR || "data";
const REG_PATH = path.join(DATA_DIR, "registry.json");

async function load() {
  try {
    return JSON.parse(await fs.readFile(REG_PATH, "utf8"));
  } catch {
    return { byDomain: {}, byKey: {} };
  }
}

async function save(reg) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(REG_PATH, JSON.stringify(reg, null, 2), "utf8");
}

export function normalizeDomain(url) {
  try {
    const u = new URL(/^https?:/i.test(url) ? url : "https://" + url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export async function getOrCreateKey(url) {
  const domain = normalizeDomain(url);
  if (!domain) throw new Error("Invalid URL.");
  const reg = await load();
  if (reg.byDomain[domain]) {
    const apiKey = reg.byDomain[domain];
    return { domain, apiKey, existed: true, info: reg.byKey[apiKey] };
  }
  const apiKey = "auto_" + crypto.randomBytes(16).toString("hex");
  reg.byDomain[domain] = apiKey;
  reg.byKey[apiKey] = { domain, createdAt: new Date().toISOString() };
  await save(reg);
  return { domain, apiKey, existed: false, info: reg.byKey[apiKey] };
}

export async function getKeyInfo(apiKey) {
  if (!apiKey) return null;
  const reg = await load();
  return reg.byKey[apiKey] || null;
}

export async function allKeys() {
  const reg = await load();
  return Object.entries(reg.byKey).map(([apiKey, info]) => ({ apiKey, ...info }));
}
