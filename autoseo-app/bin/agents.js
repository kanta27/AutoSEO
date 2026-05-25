#!/usr/bin/env node
// Manual ops CLI for the agent system. Used in dev and when validating wiring.
//
//   node bin/agents.js init                              seed default agents + sample target
//   node bin/agents.js list-agents
//   node bin/agents.js list-proposals [--status pending]
//   node bin/agents.js list-targets
//   node bin/agents.js add-target <name> <domain>        enable a new competitor target
//   node bin/agents.js run <agent-id>                    trigger an agent immediately
//   node bin/agents.js decide <proposal-id> approve|reject

import { seedDefaults } from "../lib/agents/seed.js";
import { listAgents } from "../lib/storage/agents.js";
import { listProposals, decide } from "../lib/storage/proposals.js";
import { listTargets, upsertTarget } from "../lib/storage/targets.js";
import { triggerAgent } from "../lib/agents/scheduler.js";

const [, , cmd, ...args] = process.argv;

function flag(name) {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : null;
}

async function main() {
  switch (cmd) {
    case "init": {
      await seedDefaults();
      console.log("Seeded default agents and sample target. Run 'list-agents' to see them.");
      break;
    }
    case "list-agents": {
      const a = await listAgents();
      console.table(
        a.map((x) => ({ id: x.id, name: x.name, type: x.type, enabled: x.enabled, schedule: x.schedule }))
      );
      break;
    }
    case "list-targets": {
      const t = await listTargets();
      console.table(t.map((x) => ({ id: x.id, name: x.name, domain: x.domain, enabled: x.enabled })));
      break;
    }
    case "list-proposals": {
      const status = flag("status");
      const p = await listProposals(status ? { status } : {});
      console.table(
        p.map((x) => ({ id: x.id, type: x.type, title: x.title.slice(0, 60), status: x.status, createdAt: x.createdAt }))
      );
      break;
    }
    case "add-target": {
      const [name, domain] = args;
      if (!name || !domain) {
        console.error("Usage: agents.js add-target <name> <domain>");
        process.exit(2);
      }
      const t = await upsertTarget({ name, domain, enabled: true, config: {} });
      console.log("Added target " + t.id + " — " + t.name + " (" + t.domain + ")");
      break;
    }
    case "run": {
      const agentId = args[0];
      if (!agentId) {
        console.error("Usage: agents.js run <agent-id>");
        process.exit(2);
      }
      console.log("Running " + agentId + "...");
      await triggerAgent(agentId);
      console.log("Done.");
      break;
    }
    case "decide": {
      const [id, dec] = args;
      if (!id || !["approve", "reject"].includes(dec)) {
        console.error("Usage: agents.js decide <proposal-id> approve|reject");
        process.exit(2);
      }
      const next = await decide(id, dec === "approve" ? "approved" : "rejected");
      console.log("Proposal " + next.id + " -> " + next.status);
      break;
    }
    default:
      console.error(
        "commands: init | list-agents | list-targets | list-proposals | add-target | run | decide"
      );
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
