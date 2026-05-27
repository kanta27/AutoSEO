/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Load instrumentation.ts at server boot. Required for the local
    // scheduler interval — see lib/scheduler/local.ts.
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
