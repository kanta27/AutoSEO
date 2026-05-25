// Interakt WhatsApp notifier. Uses the public template-message API.
//
// Setup (one-time, in your Interakt console):
//   1. Approve a template like "agent_digest" with two body variables:
//        Hi {{1}} — {{2}} new proposals waiting: {{3}}
//      (Or any 1-3 variable template; configure INTERAKT_TEMPLATE_VARS below.)
//   2. Set INTERAKT_API_KEY, INTERAKT_PHONE_NUMBER (full international format
//      like +919876543210), INTERAKT_TEMPLATE_NAME, optional INTERAKT_COUNTRY_CODE
//      (defaults to extracted from phone number).
//
// On any send failure we log and swallow — notifications must never break runs.

export class InteraktNotifier {
  constructor({ apiKey, phone, templateName, languageCode = "en" }) {
    this.apiKey = apiKey;
    this.phone = phone;
    this.templateName = templateName;
    this.languageCode = languageCode;
  }

  _splitPhone() {
    // "+919876543210" → { countryCode: "+91", phoneNumber: "9876543210" }
    const m = /^\+(\d{1,3})(\d{6,})$/.exec((this.phone || "").trim());
    if (!m) return { countryCode: "+91", phoneNumber: (this.phone || "").replace(/\D/g, "") };
    return { countryCode: "+" + m[1], phoneNumber: m[2] };
  }

  async sendDigest({ summary, proposals, dashboardUrl }) {
    const { countryCode, phoneNumber } = this._splitPhone();
    const titles = proposals.slice(0, 5).map((p) => "• " + p.title).join("\n");
    const body = (summary + "\n" + titles).slice(0, 900);

    try {
      const r = await fetch("https://api.interakt.ai/v1/public/message/", {
        method: "POST",
        headers: {
          Authorization: `Basic ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          countryCode,
          phoneNumber,
          type: "Template",
          template: {
            name: this.templateName,
            languageCode: this.languageCode,
            bodyValues: [body, dashboardUrl || "(dashboard offline)"],
          },
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        console.warn(`[interakt] HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn("[interakt] send failed: " + err.message);
    }
  }
}
