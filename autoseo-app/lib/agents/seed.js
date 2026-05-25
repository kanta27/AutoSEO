// Default seed data — the three agent rows (competitor enabled, seo/content
// disabled stubs) and a sample competitor target so the dashboard isn't empty.
// Idempotent: only writes records that don't already exist.

import { listAgents, upsertAgent } from "../storage/agents.js";
import { listTargets, upsertTarget } from "../storage/targets.js";

export async function seedDefaults() {
  const agents = await listAgents();

  if (!agents.find((a) => a.id === "agent_competitor")) {
    await upsertAgent({
      id: "agent_competitor",
      name: "Competitor Intelligence",
      type: "competitor",
      enabled: true,
      schedule: "0 7 * * *", // 07:00 daily
      config: {},
    });
  }
  if (!agents.find((a) => a.id === "agent_seo")) {
    await upsertAgent({
      id: "agent_seo",
      name: "SEO Watchdog",
      type: "seo",
      enabled: false,
      schedule: "0 8 * * *",
      config: { stub: true },
    });
  }
  if (!agents.find((a) => a.id === "agent_content")) {
    await upsertAgent({
      id: "agent_content",
      name: "Content Writer",
      type: "content",
      enabled: false,
      schedule: "0 9 * * 1", // Mondays 09:00
      config: { stub: true },
    });
  }

  const targets = await listTargets();
  if (!targets.length) {
    await upsertTarget({
      id: "tgt_example",
      name: "Example Domain",
      domain: "example.com",
      enabled: true,
      config: {},
    });
  }
}
