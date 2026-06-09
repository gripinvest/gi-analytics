/** @type {import('next').NextConfig} */

// Build/deploy stamp, baked at build time and inlined into the bundle so the
// UI can show when THIS frontend was last deployed. Lets anyone tell a fresh
// deploy from a stale alias at a glance (see components/BuildStamp.jsx).
// next.config is evaluated once per `next build`, so these are a single fixed
// value across the server + client compile (no hydration mismatch).
const BUILD_TIME = new Date().toISOString();
const GIT_SHA = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
    NEXT_PUBLIC_GIT_SHA: GIT_SHA,
  },
};

module.exports = nextConfig;
