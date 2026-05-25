// Stub interface for the Python LangGraph brand swarm (autoseo-agents/).
// Wiring it into the "Run" button is deferred — running the swarm spawns a
// subprocess, depends on DataForSEO credentials, and takes minutes. This file
// defines the boundary so the type exists and a future session can fill it in
// without touching the routes that call it.
import "server-only";

export type PythonSwarmReport = {
  unavailable: true;
  reason: string;
};

export async function runPythonSwarm(_target: {
  domain: string;
  brand?: string;
  seedKeywords?: string[];
}): Promise<PythonSwarmReport> {
  return {
    unavailable: true,
    reason:
      "Python swarm wiring deferred (would spawn `py -3 main.py --target …` and " +
      "read reports/<domain>.json). See README.md > Future sessions.",
  };
}
