// File-backed storage primitives. Atomic writes via temp-file + rename so a
// crash mid-write can't corrupt a record. Two patterns:
//   - "table" file:  data/<table>.json  (small lists like agents, targets)
//   - "record" dir:  data/<table>/<id>.json  (per-record files for proposals, runs, logs)

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.AUTOSEO_DATA_DIR || "data";

export function dataPath(...segments) {
  return path.join(DATA_DIR, ...segments);
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function newId(prefix = "id") {
  return prefix + "_" + crypto.randomBytes(10).toString("hex");
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

export async function writeJsonAtomic(file, data) {
  await ensureDir(path.dirname(file));
  const tmp = file + ".tmp." + crypto.randomBytes(4).toString("hex");
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

async function listDir(dir) {
  try {
    return await fs.readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

export async function readAllJson(dir) {
  const out = [];
  for (const f of await listDir(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
    } catch {
      // skip corrupt files rather than crashing the whole listing
    }
  }
  return out;
}
