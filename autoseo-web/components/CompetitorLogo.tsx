"use client";

// Small circular brand logo for the Company panel's competitors grid.
//
// Source order (computed at render — never stored on the row):
//   1. Clearbit's free logo CDN — https://logo.clearbit.com/{domain}
//   2. Google's favicon service — https://www.google.com/s2/favicons?domain={domain}&sz=64
//
// Clearbit returns real brand logos (PNG, transparent) for most known sites
// but 404s for the long tail. The favicon service is universal but produces
// a smaller, less polished icon. We try Clearbit first and let the <img>
// onError handler fall back. If BOTH fail (rare), we collapse to a coloured
// monogram circle so the grid never has a busted image icon.

import { useState } from "react";

type LogoStage = "clearbit" | "favicon" | "monogram";

export function CompetitorLogo({
  url,
  name,
  size = 36,
}: {
  url: string;
  name: string;
  size?: number;
}) {
  const [stage, setStage] = useState<LogoStage>("clearbit");
  const domain = safeHost(url);
  if (!domain) {
    return <Monogram name={name} size={size} />;
  }

  const src =
    stage === "clearbit"
      ? `https://logo.clearbit.com/${domain}`
      : stage === "favicon"
        ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
        : null;

  if (!src) return <Monogram name={name} size={size} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${name} logo`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setStage(stage === "clearbit" ? "favicon" : "monogram")}
      className="shrink-0 rounded-full border border-line bg-white object-cover"
      style={{ width: size, height: size }}
    />
  );
}

// Last-resort: render the first letter on a coloured circle picked
// deterministically from the name so the grid still looks intentional.
function Monogram({ name, size }: { name: string; size: number }) {
  const ch = (name.trim()[0] || "?").toUpperCase();
  // Cycle through the Tailwind tokens we already have so monograms stay
  // on-palette without inventing new colours.
  const palette = ["bg-lime", "bg-sky", "bg-rose", "bg-gold", "bg-mint", "bg-violet"];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const bg = palette[hash % palette.length];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full border border-line text-[12px] font-semibold text-ink ${bg}`}
      style={{ width: size, height: size }}
      aria-label={`${name} logo`}
    >
      {ch}
    </span>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
