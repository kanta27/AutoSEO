// Admin API — mounted at /admin/api. No auth (dev-mode only). When hardening
// later, gate this router behind a token check or your existing auth.

import express from "express";
import { listAgents, upsertAgent } from "../storage/agents.js";
import { listProposals, getProposal, decide } from "../storage/proposals.js";
import { listRuns, getRun } from "../storage/runs.js";
import { getLogs } from "../storage/logs.js";
import { listTargets, upsertTarget } from "../storage/targets.js";
import { triggerAgent } from "../agents/scheduler.js";
import { getSpendToday } from "../llm/client.js";

export function adminRouter() {
  const r = express.Router();

  // Agents
  r.get("/agents", async (_req, res) => res.json({ agents: await listAgents() }));
  r.post("/agents/:id/enabled", async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    res.json({ agent: await upsertAgent({ id: req.params.id, enabled }) });
  });
  r.post("/agents/:id/run", (req, res) => {
    // Kick off in background; response returns immediately.
    triggerAgent(req.params.id).catch((err) => console.error("[admin] trigger:", err.message));
    res.json({ ok: true, message: "Agent run started in background." });
  });

  // Proposals
  r.get("/proposals", async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.agentId) filter.agentId = String(req.query.agentId);
    res.json({ proposals: await listProposals(filter) });
  });
  r.get("/proposals/:id", async (req, res) => {
    const p = await getProposal(req.params.id);
    if (!p) return res.status(404).json({ error: "Not found" });
    const logs = await getLogs(p.runId);
    res.json({ proposal: p, logs });
  });
  r.post("/proposals/:id/decide", async (req, res) => {
    const dec = req.body?.decision;
    if (!["approved", "rejected"].includes(dec)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    }
    try {
      res.json({ proposal: await decide(req.params.id, dec) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Runs
  r.get("/runs", async (req, res) =>
    res.json({ runs: await listRuns({ agentId: req.query.agentId }) })
  );
  r.get("/runs/:id", async (req, res) => {
    const run = await getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Not found" });
    res.json({ run, logs: await getLogs(req.params.id) });
  });

  // Targets
  r.get("/targets", async (_req, res) => res.json({ targets: await listTargets() }));
  r.post("/targets", async (req, res) =>
    res.json({ target: await upsertTarget(req.body || {}) })
  );

  // Spend
  r.get("/spend", async (_req, res) => res.json(await getSpendToday()));

  return r;
}
