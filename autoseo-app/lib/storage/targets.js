import { readJson, writeJsonAtomic, dataPath, newId } from "./db.js";

const FILE = dataPath("competitor_targets.json");

export async function listTargets({ enabledOnly = false } = {}) {
  const data = await readJson(FILE, { targets: [] });
  return enabledOnly ? data.targets.filter((t) => t.enabled) : data.targets;
}

export async function getTarget(id) {
  const all = await listTargets();
  return all.find((t) => t.id === id) || null;
}

export async function upsertTarget(target) {
  const data = await readJson(FILE, { targets: [] });
  if (!target.id) target.id = newId("tgt");
  const idx = data.targets.findIndex((t) => t.id === target.id);
  if (idx === -1) data.targets.push(target);
  else data.targets[idx] = { ...data.targets[idx], ...target };
  await writeJsonAtomic(FILE, data);
  return target;
}
