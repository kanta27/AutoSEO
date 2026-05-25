#!/usr/bin/env node
// Auto-fix CLI: audit a local HTML file, generate fixes via Claude, write them
// back in place. Re-audits afterwards so you see the before/after score.
//
//   node bin/autofix.js path/to/file.html
//   node bin/autofix.js path/to/file.html --dry-run     # report only, no writes
//   node bin/autofix.js path/to/file.html --no-backup   # skip .bak

import fs from "node:fs/promises";
import path from "node:path";
import { runAudit } from "../src/audit.js";
import { applyFixes } from "../src/applier.js";

function parseArgs(argv) {
  const args = { file: null, dryRun: false, backup: true };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-backup") args.backup = false;
    else if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else if (!args.file) args.file = a;
  }
  return args;
}

function summarize(report, label) {
  console.log(
    `  ${label.padEnd(8)} score ${String(report.score).padStart(3)} ${report.grade}  ` +
      `(critical ${report.counts.critical}, high ${report.counts.high}, ` +
      `medium ${report.counts.medium}, low ${report.counts.low}, good ${report.counts.good})`
  );
}

async function main() {
  const { file, dryRun, backup } = parseArgs(process.argv);
  if (!file) {
    console.error("Usage: node bin/autofix.js <file.html> [--dry-run] [--no-backup]");
    process.exit(2);
  }
  const abs = path.resolve(file);
  let html;
  try {
    html = await fs.readFile(abs, "utf8");
  } catch (err) {
    console.error(`Cannot read ${abs}: ${err.message}`);
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "  warn: ANTHROPIC_API_KEY not set — using deterministic stubs (lower quality).\n"
    );
  }

  console.log(`\n  Auditing ${abs}\n`);
  const before = await runAudit({ html, sourceUrl: abs }, { withFixes: true });
  summarize(before, "BEFORE");

  const fixes = before.solutions?.fixes || [];
  if (!fixes.length) {
    console.log("\n  No applicable fixes — nothing to write.\n");
    return;
  }

  const { html: newHtml, applied, skipped } = applyFixes(html, fixes);

  console.log(`\n  Applying ${applied.length} fix(es):`);
  for (const a of applied) console.log(`    + ${a.type}`);
  for (const s of skipped) console.log(`    - ${s.type}  (${s.reason})`);

  if (dryRun) {
    console.log("\n  --dry-run — no files written.\n");
    return;
  }

  if (backup) {
    const bak = abs + ".bak";
    await fs.writeFile(bak, html, "utf8");
    console.log(`\n  Backup → ${bak}`);
  }
  await fs.writeFile(abs, newHtml, "utf8");
  console.log(`  Wrote  → ${abs}\n`);

  // Re-audit the modified file to prove the lift.
  const after = await runAudit({ html: newHtml, sourceUrl: abs }, { withFixes: false });
  summarize(after, "AFTER");
  const lift = after.score - before.score;
  console.log(
    `\n  Δ score: ${lift >= 0 ? "+" : ""}${lift}  (${before.score} ${before.grade} → ${after.score} ${after.grade})\n`
  );
}

main().catch((err) => {
  console.error(`\n  autofix failed: ${err.message}\n`);
  process.exit(1);
});
