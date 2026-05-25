// Prioritizer (spec §3.3) — score every finding and roll up an overall grade.
// score ≈ severity weight (impact) × confidence, sorted desc. "good" findings
// are positive signals, excluded from the issue queue but used for the score.

const SEVERITY = {
  critical: { weight: 10, label: "Critical" },
  high: { weight: 6, label: "High" },
  medium: { weight: 3, label: "Medium" },
  low: { weight: 1, label: "Low" },
  good: { weight: 0, label: "Good" },
};

const CATEGORY_LABEL = {
  "on-page": "On-Page",
  technical: "Technical",
  schema: "Structured Data",
  geo: "GEO / AI Visibility",
  social: "Social",
};

export function prioritize(findings) {
  const issues = [];
  const wins = [];

  for (const find of findings) {
    const sev = SEVERITY[find.severity] || SEVERITY.low;
    if (find.severity === "good") {
      wins.push(find);
    } else {
      issues.push({ ...find, score: sev.weight, severityLabel: sev.label });
    }
  }

  issues.sort((a, b) => b.score - a.score);

  // Overall score: start at 100, subtract weighted penalties (capped so one
  // disastrous page can't go negative), then clamp to 0–100.
  const penalty = issues.reduce((sum, i) => sum + i.score, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty * 2));
  const grade =
    score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";

  // Per-category breakdown
  const byCategory = {};
  for (const cat of Object.keys(CATEGORY_LABEL)) {
    byCategory[cat] = { label: CATEGORY_LABEL[cat], issues: 0, wins: 0, penalty: 0 };
  }
  for (const i of issues) {
    const c = byCategory[i.category];
    if (c) { c.issues++; c.penalty += i.score; }
  }
  for (const w of wins) {
    const c = byCategory[w.category];
    if (c) c.wins++;
  }

  const counts = {
    critical: issues.filter((i) => i.severity === "critical").length,
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
    good: wins.length,
  };

  return { score, grade, issues, wins, byCategory, counts };
}
