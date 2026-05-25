// Per-target snapshot store. Used by the competitor agent's diff workflow:
// snapshots are written every crawl regardless of LLM outcome so we always
// have history, and the agent reads the last one to detect what's new.

import path from "node:path";
import crypto from "node:crypto";
import { writeJsonAtomic, readAllJson, dataPath } from "./db.js";

function dirFor(targetId) {
  return dataPath("snapshots", targetId);
}

export function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function saveSnapshot({ targetId, url, content }) {
  const snap = {
    id: "snap_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex"),
    targetId,
    url,
    contentHash: hashContent(content),
    content,
    capturedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(path.join(dirFor(targetId), snap.id + ".json"), snap);
  return snap;
}

export async function getLastSnapshot({ targetId, url }) {
  const snaps = await readAllJson(dirFor(targetId));
  const matching = url ? snaps.filter((s) => s.url === url) : snaps;
  matching.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  return matching[0] || null;
}

export async function listSnapshots(targetId, { limit = 50 } = {}) {
  const snaps = await readAllJson(dirFor(targetId));
  snaps.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  return snaps.slice(0, limit);
}
