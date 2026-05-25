import path from "node:path";
import { readJson, writeJsonAtomic, readAllJson, dataPath, newId } from "./db.js";

const DIR = dataPath("proposals");

export async function createProposal({ agentId, runId, type, title, summary, payload }) {
  const p = {
    id: newId("prop"),
    agentId,
    runId,
    type,
    title,
    summary,
    payload,
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  await writeJsonAtomic(path.join(DIR, p.id + ".json"), p);
  return p;
}

export async function getProposal(id) {
  return readJson(path.join(DIR, id + ".json"), null);
}

export async function listProposals({ status, agentId, limit = 100 } = {}) {
  let all = await readAllJson(DIR);
  if (status) all = all.filter((p) => p.status === status);
  if (agentId) all = all.filter((p) => p.agentId === agentId);
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all.slice(0, limit);
}

export async function decide(id, decision) {
  if (!["approved", "rejected"].includes(decision)) {
    throw new Error("decision must be 'approved' or 'rejected'");
  }
  const cur = await getProposal(id);
  if (!cur) throw new Error("Proposal not found: " + id);
  if (cur.status !== "pending") throw new Error("Proposal already " + cur.status);
  const next = { ...cur, status: decision, decidedAt: new Date().toISOString() };
  await writeJsonAtomic(path.join(DIR, id + ".json"), next);
  return next;
}
