// get_last_snapshot — returns the most recent stored snapshot for a target
// (optionally narrowed to one URL) so the agent can diff against it.

import { getLastSnapshot } from "../../storage/snapshots.js";

export const getLastSnapshotTool = {
  name: "get_last_snapshot",
  description:
    "Get the previously stored content for a competitor target (optionally a specific URL) " +
    "so you can identify what's new since the last run. Returns content truncated to 4000 chars.",
  input_schema: {
    type: "object",
    properties: {
      target_id: { type: "string" },
      url: { type: "string", description: "Optional: limit to one URL within the target." },
    },
    required: ["target_id"],
  },
  async execute({ target_id, url }) {
    const snap = await getLastSnapshot({ targetId: target_id, url });
    if (!snap) return { found: false };
    return {
      found: true,
      url: snap.url,
      capturedAt: snap.capturedAt,
      contentHash: snap.contentHash,
      content: (snap.content || "").slice(0, 4000),
    };
  },
};
