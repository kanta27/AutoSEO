import type { Config } from "tailwindcss";

// Palette + typography lifted from autoseo-site/index.html so the new app
// stays visually consistent with the existing landing page. Values are
// exposed as both Tailwind tokens and CSS variables (see app/globals.css).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#FAF7F2",
        "bg-2": "#F1ECE2",
        "bg-3": "#E8E1D2",
        ink: "#141210",
        "ink-2": "#2A2622",
        "ink-3": "#5C544A",
        "ink-4": "#8C8275",
        line: "rgba(20,18,16,.10)",
        "line-2": "rgba(20,18,16,.18)",
        card: "#FFFFFF",
        "card-2": "#FBF8F1",
        accent: "#FF5B2E",
        "accent-soft": "#FFE6DC",
        lime: "#D4F26A",
        sky: "#BDE0FF",
        rose: "#FFC9BE",
        gold: "#F8CF3E",
        mint: "#B8E8C9",
        violet: "#D6C8FF",
        ok: "#138A4A",
        warn: "#C24A1B",
      },
      fontFamily: {
        sans: ["Geist", "Inter", "system-ui", "sans-serif"],
        serif: ["'Instrument Serif'", "'Times New Roman'", "serif"],
        mono: ["'Geist Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "8px",
        md: "14px",
        lg: "22px",
        xl: "28px",
      },
      boxShadow: {
        "elev-1": "0 1px 0 rgba(20,18,16,.04), 0 1px 2px rgba(20,18,16,.04)",
        "elev-2": "0 4px 16px rgba(20,18,16,.06), 0 1px 2px rgba(20,18,16,.06)",
        "elev-3":
          "0 20px 48px -12px rgba(20,18,16,.18), 0 4px 12px rgba(20,18,16,.08)",
      },
    },
  },
  plugins: [],
};

export default config;
