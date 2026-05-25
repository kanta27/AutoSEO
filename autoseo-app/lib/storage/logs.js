// One JSON file per run, containing the ordered list of log entries
// (reasoning text, tool calls, tool results). Read-modify-write is fine: a run
// is single-writer.

import path from "node:path";
import { readJson, writeJsonAtomic, dataPath } from "./db.js";

const DIR = dataPath("logs");

export async function appendLog(runId, entry) {
  const file = path.join(DIR, runId + ".json");
  const arr = await readJson(file, []);
  arr.push({ ...entry, at: new Date().toISOString() });
  await writeJsonAtomic(file, arr);
}

export async function getLogs(runId) {
  return readJson(path.join(DIR, runId + ".json"), []);
}
