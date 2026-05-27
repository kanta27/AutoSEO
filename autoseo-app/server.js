// AutoSEO app server — serves the UI, the audit/auto-fix APIs, and the v1
// always-on API (register, fixes, refresh, agent.js).
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "./src/audit.js";
import { applyFixes } from "./src/applier.js";
import { getOrCreateKey, getKeyInfo, normalizeDomain } from "./src/registry.js";
import * as cache from "./src/cache.js";
import { structurizeFixes } from "./src/structurize.js";
import { generateAgentScript, generateInstallScript } from "./src/generator.js";
import { startScheduler } from "./src/scheduler.js";
import { adminRouter } from "./lib/admin/routes.js";
import { startAgentScheduler } from "./lib/agents/scheduler.js";
import { seedDefaults } from "./lib/agents/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Auto-fix can write to disk, so it's gated behind an explicit root directory.
// Set AUTOSEO_FIXES_ROOT to the folder the API is allowed to touch.
const FIXES_ROOT = process.env.AUTOSEO_FIXES_ROOT
  ? path.resolve(process.env.AUTOSEO_FIXES_ROOT)
  : null;

// Public endpoint baked into the embedded agent (so it phones home to the
// right host). Override for production: AUTOSEO_PUBLIC_ENDPOINT=https://api.autoseo.live.
const PUBLIC_ENDPOINT =
  process.env.AUTOSEO_PUBLIC_ENDPOINT || `http://localhost:${PORT}`;

app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/admin/api", adminRouter());

// CORS for the always-on API — the embedded agent calls /v1/fixes from any origin.
app.use("/v1", (req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.post("/api/audit", async (req, res) => {
  const { url, withFixes = true } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Provide a 'url' string." });
  }
  try {
    const report = await runAudit(url, { withFixes });

    // Auto-register the domain & cache structured fixes so always-on mode
    // works the moment the user clicks "Make it automatic". Idempotent.
    if (withFixes) {
      try {
        const { apiKey } = await getOrCreateKey(report.meta.finalUrl);
        const structured = structurizeFixes(report.solutions?.fixes || []);
        await cache.set(apiKey, report.meta.finalUrl, {
          fixes: structured,
          score: report.score,
          grade: report.grade,
        });
        const scriptUrl = `${PUBLIC_ENDPOINT}/v1/agent.js?key=${encodeURIComponent(apiKey)}`;
        report.automatic = {
          apiKey,
          scriptUrl,
          snippet: `<script async src="${scriptUrl}"></script>`,
          installScript: await generateInstallScript({ apiKey, endpoint: PUBLIC_ENDPOINT }),
        };
      } catch (e) {
        // Registration failure must not break the audit flow.
        console.warn("auto-register failed:", e.message);
      }
    }

    res.json(report);
  } catch (err) {
    res.status(422).json({ error: err.message || "Audit failed." });
  }
});

// --- /v1 always-on API ---------------------------------------------------

// POST /v1/register { url } — explicit registration (the UI uses /api/audit
// which auto-registers; this is here for programmatic clients).
app.post("/v1/register", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Provide 'url'." });
  try {
    const { domain, apiKey, existed } = await getOrCreateKey(url);
    const audit = await runAudit(url, { withFixes: true });
    const structured = structurizeFixes(audit.solutions?.fixes || []);
    const entry = await cache.set(apiKey, audit.meta.finalUrl, {
      fixes: structured,
      score: audit.score,
      grade: audit.grade,
    });
    res.json({
      apiKey,
      domain,
      existed,
      scriptUrl: `${PUBLIC_ENDPOINT}/v1/agent.js?key=${encodeURIComponent(apiKey)}`,
      snippet: `<script async src="${PUBLIC_ENDPOINT}/v1/agent.js?key=${encodeURIComponent(apiKey)}"></script>`,
      fixes: entry.fixes,
      score: audit.score,
      grade: audit.grade,
    });
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// GET /v1/fixes?key=&url= — hot path; called from the customer's browser on
// every page load. Stale-while-revalidate so reads are always fast.
app.get("/v1/fixes", async (req, res) => {
  const apiKey = String(req.query.key || "");
  const url = String(req.query.url || "");
  if (!apiKey) return res.status(401).json({ error: "Missing key." });
  if (!url) return res.status(400).json({ error: "Missing url." });

  const info = await getKeyInfo(apiKey);
  if (!info) return res.status(401).json({ error: "Invalid key." });

  // Keys are scoped to one domain — refuse if the URL is for a different host.
  const reqDomain = normalizeDomain(url);
  if (reqDomain !== info.domain) {
    return res.status(403).json({ error: "Key not valid for this domain." });
  }

  let entry = await cache.get(apiKey, url);
  if (!entry) {
    // Cold miss — block once to populate.
    try {
      const audit = await runAudit(url, { withFixes: true });
      entry = await cache.set(apiKey, url, {
        fixes: structurizeFixes(audit.solutions?.fixes || []),
        score: audit.score,
        grade: audit.grade,
      });
    } catch (err) {
      return res.status(422).json({ error: err.message });
    }
  } else if (cache.isStale(entry)) {
    // Return stale immediately; refresh in background.
    runAudit(url, { withFixes: true })
      .then((audit) =>
        cache.set(apiKey, url, {
          fixes: structurizeFixes(audit.solutions?.fixes || []),
          score: audit.score,
          grade: audit.grade,
        })
      )
      .catch(() => {});
  }

  res.set("Cache-Control", "public, max-age=600");
  res.json(entry);
});

// POST /v1/refresh?key= — manual re-audit of every cached URL for this key.
app.post("/v1/refresh", async (req, res) => {
  const apiKey = String(req.query.key || (req.body || {}).key || "");
  const info = await getKeyInfo(apiKey);
  if (!info) return res.status(401).json({ error: "Invalid key." });

  const existing = await cache.listForKey(apiKey);
  const urls = existing.length ? existing.map((e) => e.url) : ["https://" + info.domain];

  const results = await Promise.allSettled(
    urls.map(async (u) => {
      const audit = await runAudit(u, { withFixes: true });
      return cache.set(apiKey, u, {
        fixes: structurizeFixes(audit.solutions?.fixes || []),
        score: audit.score,
        grade: audit.grade,
      });
    })
  );
  res.json({
    domain: info.domain,
    total: urls.length,
    refreshed: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").map((r) => r.reason?.message),
  });
});

// GET /v1/agent.js?key= — serves the embedded runtime with the key baked in.
app.get("/v1/agent.js", async (req, res) => {
  const apiKey = String(req.query.key || "");
  const info = apiKey && (await getKeyInfo(apiKey));
  if (!info) {
    return res.status(401).type("text/plain").send("// invalid AutoSEO key");
  }
  try {
    const script = await generateAgentScript({ apiKey, endpoint: PUBLIC_ENDPOINT });
    res.set("Cache-Control", "public, max-age=300");
    res.type("application/javascript").send(script);
  } catch (err) {
    res.status(500).type("text/plain").send("// agent generation failed");
  }
});

// Auto-fix endpoint: audit a local HTML file, generate fixes, write them back.
// Path is resolved under FIXES_ROOT to prevent traversal / arbitrary writes.
app.post("/api/autofix", async (req, res) => {
  if (!FIXES_ROOT) {
    return res.status(403).json({
      error: "Auto-fix is disabled. Start the server with AUTOSEO_FIXES_ROOT set to enable it.",
    });
  }
  const { filePath, dryRun = false, backup = true } = req.body || {};
  if (!filePath || typeof filePath !== "string") {
    return res.status(400).json({ error: "Provide a 'filePath' string." });
  }
  const abs = path.resolve(FIXES_ROOT, filePath);
  if (!abs.startsWith(FIXES_ROOT + path.sep) && abs !== FIXES_ROOT) {
    return res.status(400).json({ error: "filePath must resolve under AUTOSEO_FIXES_ROOT." });
  }
  try {
    const html = await fs.readFile(abs, "utf8");
    const before = await runAudit({ html, sourceUrl: abs }, { withFixes: true });
    const { html: newHtml, applied, skipped } = applyFixes(html, before.solutions?.fixes || []);

    if (!dryRun && applied.length) {
      if (backup) await fs.writeFile(abs + ".bak", html, "utf8");
      await fs.writeFile(abs, newHtml, "utf8");
    }
    const after = applied.length
      ? await runAudit({ html: newHtml, sourceUrl: abs }, { withFixes: false })
      : before;

    res.json({
      file: abs,
      dryRun,
      before: { score: before.score, grade: before.grade, counts: before.counts },
      after: { score: after.score, grade: after.grade, counts: after.counts },
      applied,
      skipped,
    });
  } catch (err) {
    res.status(422).json({ error: err.message || "Auto-fix failed." });
  }
});

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    autofix: Boolean(FIXES_ROOT),
    fixesRoot: FIXES_ROOT,
    publicEndpoint: PUBLIC_ENDPOINT,
  })
);

// Kick off the background refresher (single-process, in-memory). Safe to skip
// in tests or dev by setting AUTOSEO_DISABLE_SCHEDULER=1.
startScheduler({ runAudit });

// Phase 1 agent system — seed defaults on first boot, then start the cron
// scheduler that fires enabled agents on their cron expressions.
seedDefaults()
  .then(() => startAgentScheduler())
  .catch((err) => console.warn("[agents] startup failed:", err.message));

// Bind explicitly to 0.0.0.0 so both `localhost:PORT` and `127.0.0.1:PORT`
// resolve to a reachable socket regardless of the host's IPv4/IPv6 preference.
// (Without this, Node 17+ defaults can bind IPv6-only on some Windows boxes,
// which breaks `127.0.0.1` clients — and vice-versa.) The web app's audit
// fetcher has a one-shot loopback fallback for safety, but binding to all
// IPv4 interfaces makes the fallback unnecessary in practice.
const HOST = process.env.HOST || "0.0.0.0";
const server = app.listen(PORT, HOST, () => {
  console.log(`\n  AutoSEO running → http://localhost:${PORT}  (bound ${HOST}:${PORT})`);
  console.log(
    `  Claude fixes: ${
      process.env.ANTHROPIC_API_KEY ? "ON" : "OFF (set ANTHROPIC_API_KEY to enable)"
    }\n`
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n  Port ${PORT} is already in use — another AutoSEO server is likely running.\n` +
        `  Either stop it, or start on a different port:  $env:PORT=3001; npm start\n`
    );
    process.exit(1);
  }
  throw err;
});
