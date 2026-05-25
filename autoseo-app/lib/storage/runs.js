import path from "node:path";
import { readJson, writeJsonAtomic, readAllJson, dataPath, newId } from "./db.js";

const DIR = dataPath("runs");

export async function createRun({ agentId }) {
  const run = {
    id: newId("run"),
    agentId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    tokenUsage: null,
    costUsd: 0,
    error: null,
    proposalCount: 0,
  };
  await writeJsonAtomic(path.join(DIR, run.id + ".json"), run);
  return run;
}

export async function getRun(id) {
  return readJson(path.join(DIR, id + ".json"), null);
}

export async function updateRun(id, patch) {
  const cur = await getRun(id);
  if (!cur) throw new Error("Run not found: " + id);
  const next = { ...cur, ...patch };
  await writeJsonAtomic(path.join(DIR, id + ".json"), next);
  return next;
}

export async function listRuns({ agentId, limit = 50 } = {}) {
  const all = await readAllJson(DIR);
  const filtered = agentId ? all.filter((r) => r.agentId === agentId) : all;
  filtered.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return filtered.slice(0, limit);
}
