// Fallback notifier — logs digests to stdout. Used when Interakt creds are
// missing or AGENT_DRY_RUN=1 is set.

export class ConsoleNotifier {
  async sendDigest({ summary, proposals, dashboardUrl }) {
    console.log("\n  [notifier] " + summary);
    for (const p of proposals) {
      console.log("    • " + p.title + "  (" + p.id + ")");
    }
    if (dashboardUrl) console.log("  → " + dashboardUrl);
    console.log("");
  }
}
