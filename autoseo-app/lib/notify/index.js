// Notifier factory — chooses Console or Interakt based on env. Lazy-init so
// import-time has no side effects.

import { ConsoleNotifier } from "./console.js";
import { InteraktNotifier } from "./interakt.js";

let _instance = null;

export function getNotifier() {
  if (_instance) return _instance;
  if (process.env.AGENT_DRY_RUN === "1") {
    _instance = new ConsoleNotifier();
    return _instance;
  }
  if (process.env.INTERAKT_API_KEY && process.env.INTERAKT_PHONE_NUMBER) {
    _instance = new InteraktNotifier({
      apiKey: process.env.INTERAKT_API_KEY,
      phone: process.env.INTERAKT_PHONE_NUMBER,
      templateName: process.env.INTERAKT_TEMPLATE_NAME || "agent_digest",
      languageCode: process.env.INTERAKT_LANG || "en",
    });
  } else {
    _instance = new ConsoleNotifier();
  }
  return _instance;
}
