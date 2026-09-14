// battcal mounts at /battcal on the mivehchi.dev platform, so everything is served under that
// path prefix. basePath makes all routes, assets, and API routes resolve under /battcal whether
// the platform serves this as a monorepo app or proxies the path to a standalone deployment.
// turbopack.root points at the REPO root because the app imports the shared SPA from
// ../dashboard/src (npm workspace hoists one React for both).
/** @type {import('next').NextConfig} */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dir = dirname(fileURLToPath(import.meta.url));

// Build marker for deploy verification (ship.mjs checkBuildMarker / deploy-verification):
// the 7-char sha of the commit this deployment was built from. Vercel injects
// VERCEL_GIT_COMMIT_SHA; the Cloudflare Worker build (no such env) sets BUILD_SHA or falls
// through to reading the repo directly; a bare local build with neither reads "dev".
const buildSha = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dir, encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
})();

const nextConfig = {
  turbopack: { root: join(__dir, '..') },
  basePath: '/battcal',
  reactStrictMode: true,
  async redirects() { return [{ source: '/', destination: '/battcal', basePath: false, permanent: false }]; },
  // The dashboard reads its own same-origin API only; no cross-origin browser fetches.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Rides every response including the /auth/* redirects, the only routes node fetch
          // can reach through the WAF challenge.
          { key: 'x-build', value: buildSha },
        ],
      },
      // /auth/start, /auth/callback and /auth/signout are pure redirect handlers (route.ts, no
      // HTML body, no script), so a locked-down CSP costs nothing. Fleet audit 2026-09-02 flagged
      // these as the one route group missing a Content-Security-Policy header even though HSTS/
      // X-Frame-Options/X-Content-Type-Options were already set (finding battcal-1) - same shared
      // root cause as netstats-02 (app-template-flagship's RP auth routes never baked one in).
      // Scoped to /auth/* rather than the whole app: the login page and the mirrored dashboard
      // both render real HTML with inline scripts/fonts and need a broader policy, which is a
      // separate, un-scoped piece of work (see the fleet audit's fix plan).
      {
        source: '/auth/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
