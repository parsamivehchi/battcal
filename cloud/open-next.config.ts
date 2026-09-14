import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Deliberately bare - do NOT copy mivehchi.app's open-next.config.ts.
//
// That one carries kvIncrementalCache + memoryQueue + a custom mountProxy behind
// dangerousDisableConfigValidation, all of which exist for its ISR homepage and its
// Vercel-hosted path mounts. This app has neither: every route is behind the owner gate and
// dynamic, and it proxies nothing. OpenNext's own scaffold ships incrementalCache commented
// out for exactly this case, so an empty config is the supported default, not a shortcut.
export default defineCloudflareConfig({});
