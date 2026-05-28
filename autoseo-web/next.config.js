/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Load instrumentation.ts at server boot. Required for the local
    // scheduler interval — see lib/scheduler/local.ts.
    instrumentationHook: true,
  },
  webpack: (config, { nextRuntime }) => {
    // instrumentation.ts is compiled for BOTH the edge and nodejs runtimes,
    // and its dynamic-import chain pulls in lib/agents/skills.ts (which uses
    // `fs` + `path`). Under the nodejs runtime that's fine; under the edge
    // runtime the module is never actually executed (the `register()` body
    // returns early when NEXT_RUNTIME !== "nodejs"), but webpack still needs
    // to resolve the imports at build time. Stub them on edge.
    if (nextRuntime === "edge") {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
