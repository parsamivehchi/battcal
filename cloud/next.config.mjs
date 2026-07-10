// battcal mounts at /battcal on the mivehchi.dev platform, so everything is served under that
// path prefix. basePath makes all routes, assets, and API routes resolve under /battcal whether
// the platform serves this as a monorepo app or proxies the path to a standalone deployment.
// turbopack.root points at the REPO root because the app imports the shared SPA from
// ../dashboard/src (npm workspace hoists one React for both).
/** @type {import('next').NextConfig} */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dir = dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  turbopack: { root: join(__dir, '..') },
  basePath: '/battcal',
  reactStrictMode: true,
  async redirects() { return [{ source: '/', destination: '/battcal', basePath: false, permanent: false }]; },
  // The dashboard reads its own same-origin API only; no cross-origin browser fetches.
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
};
export default nextConfig;
