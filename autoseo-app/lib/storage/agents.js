import { readJson, writeJsonAtomic, dataPath } from "./db.js";

const FILE = dataPath("agents.json");

export async function listAgents() {
  const data = await readJson(FILE, { agents: [] });
  return data.agents;
}

export async function getAgent(id) {
  const all = await listAgents();
  return all.find((a) => a.id === id) || null;
}

export async function upsertAgent(agent) {
  const data = await readJson(FILE, { agents: [] });
  const idx = data.agents.findIndex((a) => a.id === agent.id);
  if (idx === -1) data.agents.push(agent);
  else data.agents[idx] = { ...data.agents[idx], ...agent };
  await writeJsonAtomic(FILE, data);
  return idx === -1 ? agent : data.agents[idx];
}
